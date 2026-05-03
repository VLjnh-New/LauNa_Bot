import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { log } from '../../logger.js';

const THREADS_APP_ID = '238260118697367';
const THREADS_UA = 'Instagram 319.0.0.34.109 Android (33/13; 420dpi; 1080x2340; samsung; SM-G991B; o1s; exynos2100; en_US; 555906680)';
const THREADS_COOKIE = `ig_did=D9A591B0-EC17-4F89-A66A-E1F3DC7AABE4; dpr=2.625; csrftoken=8OyqgMydyDanRS0BCyouz3cYKgwDiRZP; ds_user_id=65837870586; sessionid=65837870586%3Auys0k84AY6w33p%3A7%3AAYhCx18z06p1JRWauEwYhX7pQbmXF0JJ_M9yGfUPiw; mid=acebGAABAAHq-ydcQyuz6pGXR1Cv; rur="PRN\\05465837870586\\0541806227497:01fe63361456664d4ef83cc35b5ee498965261e85b0f682c10204af912afed85c5ac7af5"`;

const CACHE_DIR = path.join(process.cwd(), 'src', 'modules', 'cache', 'threads_temp');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function extractShortcode(url) {
    const match = url.match(/threads\.(?:net|com)\/@[\w.-]+\/post\/([\w-]+)/) ||
                  url.match(/threads\.(?:net|com)\/t\/([\w-]+)/);
    if (!match) throw new Error("URL Threads không hợp lệ");
    return match[1];
}

function shortcodeToId(shortcode) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let id = BigInt(0);
    for (const char of shortcode) {
        const idx = alphabet.indexOf(char);
        if (idx === -1) continue;
        id = (id * BigInt(64)) + BigInt(idx);
    }
    return id.toString();
}

/**
 * Lấy danh sách media từ một bài đăng Threads (dùng trong autodown)
 * @returns {Array} mảng các object { url, type: 'image'|'video' }
 */
export async function fetchThreadsMedia(url) {
    const shortcode = extractShortcode(url);
    const postID = shortcodeToId(shortcode);

    const { data: res } = await axios.get(`https://i.instagram.com/api/v1/media/${postID}/info/`, {
        headers: {
            'User-Agent': THREADS_UA,
            'Cookie': THREADS_COOKIE,
            'x-ig-app-id': THREADS_APP_ID
        },
        timeout: 20000
    });

    const info = res.items?.[0];
    if (!info) throw new Error("Không tìm thấy dữ liệu media.");

    const medias = [];

    if (info.carousel_media && info.carousel_media.length > 0) {
        for (const item of info.carousel_media) {
            if (item.media_type === 2 && item.video_versions?.length > 0) {
                medias.push({ url: item.video_versions[0].url, type: 'video' });
            } else if (item.image_versions2?.candidates?.length > 0) {
                medias.push({ url: item.image_versions2.candidates[0].url, type: 'image' });
            }
        }
    } else if (info.media_type === 2 && info.video_versions?.length > 0) {
        medias.push({ url: info.video_versions[0].url, type: 'video' });
    } else if (info.image_versions2?.candidates?.length > 0) {
        medias.push({ url: info.image_versions2.candidates[0].url, type: 'image' });
    }

    return medias;
}

/**
 * Tải file từ media item về máy (dùng trong autodown)
 * @param {{ url: string, type: string }} mediaItem
 * @param {number} index
 * @returns {{ filePath: string, ext: string }}
 */
export async function downloadThreadsFile(mediaItem, index) {
    const ext = mediaItem.type === 'video' ? 'mp4' : 'jpg';
    const filePath = path.join(CACHE_DIR, `threads_${Date.now()}_${index}.${ext}`);

    const resp = await axios({
        url: mediaItem.url,
        method: 'GET',
        responseType: 'stream',
        timeout: 120000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const writer = fs.createWriteStream(filePath);
    resp.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on('finish', resolve);
        writer.on('error', reject);
    });

    return { filePath, ext };
}

/**
 * Tải đầy đủ thông tin bài đăng Threads (dùng cho lệnh !thread hoặc tương tự)
 */
export async function downloadThreads(url) {
    try {
        const shortcode = extractShortcode(url);
        const postID = shortcodeToId(shortcode);

        const { data: res } = await axios.get(`https://i.instagram.com/api/v1/media/${postID}/info/`, {
            headers: {
                'User-Agent': THREADS_UA,
                'Cookie': THREADS_COOKIE,
                'x-ig-app-id': THREADS_APP_ID
            },
            timeout: 20000
        });

        const info = res.items?.[0];
        if (!info) throw new Error("Không tìm thấy dữ liệu media cho bài viết này.");

        const attachments = [];
        const caption = info.caption?.text || "";
        const author = `${info.user?.full_name || info.user?.username} (@${info.user?.username})`;

        if (info.carousel_media?.length > 0) {
            info.carousel_media.forEach(item => {
                if (item.media_type === 2 && item.video_versions?.length > 0) {
                    attachments.push({ type: "Video", url: item.video_versions[0].url });
                } else if (item.image_versions2?.candidates?.length > 0) {
                    attachments.push({ type: "Photo", url: item.image_versions2.candidates[0].url });
                }
            });
        } else if (info.media_type === 2 && info.video_versions?.length > 0) {
            attachments.push({ type: "Video", url: info.video_versions[0].url });
        } else if (info.image_versions2?.candidates?.length > 0) {
            attachments.push({ type: "Photo", url: info.image_versions2.candidates[0].url });
        }

        return {
            id: postID,
            message: caption,
            author: author,
            like: info.like_count?.toLocaleString() || "0",
            comment: info.text_post_app_info?.direct_reply_count?.toLocaleString() || "0",
            repost: info.text_post_app_info?.repost_count?.toLocaleString() || "0",
            reshare: info.text_post_app_info?.reshare_count?.toLocaleString() || "0",
            cover: info.image_versions2?.candidates?.[0]?.url || null,
            attachments: attachments,
            source: "Threads"
        };

    } catch (error) {
        log.error("Lỗi tại threadsDownloader:", error.message);
        throw error;
    }
}
