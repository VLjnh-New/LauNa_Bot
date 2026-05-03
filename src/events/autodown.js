import { fs, path, axios, log, rentalManager } from "../globals.js";
import { compressIfNeeded } from "../utils/core/videoCompress.js";
import { download as downloadSoundCloud } from "../utils/music/soundcloud.js";
import { downloadAll as vidsDownloader, pickBestVideo as vidsPickVideo } from "../utils/downloaders/VidsSave.js";
import { downloadAll as snapsaveDownloader, pickBestVideo as snapsavePickVideo } from "../utils/downloaders/snapsaveDownloader.js";
import { downloadCapCutV3 as downloadCapCut } from "../utils/downloaders/capcutDownloader.js";
import { downloadYoutubeVideo, downloadYoutubeAudio } from "../utils/music/youtube.js";
import { downloadTikTok } from "../utils/downloaders/tiktokDownloader.js";
import { downloadDouyin } from "../utils/downloaders/douyinDownloader.js";
import { downloadInstagram } from "../utils/downloaders/instagram.js";
import { downloadMixcloud } from "../utils/downloaders/mixcloudDownloader.js";
import { downloadThreadsFile, downloadThreads } from "../utils/downloaders/threadsDownloader.js";
import * as spotify from "../utils/music/spotify.js";

export const name = "autodown";
export const description = "Tự động tải video/ảnh TikTok/Instagram/SoundCloud/YouTube/FB/Douyin/CapCut/Mixcloud/Threads/Spotify";


const REGEX = {
    tiktok: /https?:\/\/(?:www\.tiktok\.com\/@[\w.-]+\/(?:video|photo)\/\d+|vt\.tiktok\.com\/[\w-]+|vm\.tiktok\.com\/[\w-]+|www\.tiktok\.com\/t\/[\w-]+)/i,
    douyin: /https?:\/\/(?:v\.douyin\.com\/\w+|www\.douyin\.com\/video\/\d+)/i,
    instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?:p|tv|reel|stories)\/([^/?#&]+)/i,
    soundcloud: /https?:\/\/(?:soundcloud\.com|on\.soundcloud\.com)\/[a-zA-Z0-9._\-\/]+/i,
    youtube: /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/i,
    facebook: /https?:\/\/(?:www\.|web\.|m\.)?(?:facebook\.com|fb\.watch)\/[a-zA-Z0-9._\-\/]+/i,
    capcut: /https?:\/\/(?:www\.)?capcut\.com\/(?:t|tv2|template-detail)\/[a-zA-Z0-9_-]+/i,
    mixcloud: /https?:\/\/(?:www\.)?mixcloud\.com\/[^/]+\/[^/]+\/?/i,
    spotify: /https?:\/\/(?:open\.spotify\.com\/(?:track|album|playlist)\/|spotify:track:)([a-zA-Z0-9]+)/i,
    threads: /https?:\/\/(?:www\.)?threads\.(?:net|com)\/@[\w.-]+\/post\/[\w-]+/i,
};

const PLATFORM = {
    tiktok: { name: "TikTok", icon: "🎵", color: "c_010101" },
    douyin: { name: "Douyin", icon: "🎬", color: "c_db342e" },
    facebook: { name: "Facebook", icon: "📘", color: "c_1877f2" },
    instagram: { name: "Instagram", icon: "📸", color: "c_c13584" },
    youtube: { name: "YouTube", icon: "▶️", color: "c_db342e" },
    soundcloud: { name: "SoundCloud", icon: "🎧", color: "c_f27806" },
    capcut: { name: "CapCut", icon: "✂️", color: "c_010101" },
    mixcloud: { name: "Mixcloud", icon: "☁️", color: "c_7b2fbe" },
    spotify: { name: "Spotify", icon: "🎧", color: "c_15a85f" },
    threads: { name: "Threads", icon: "🧵", color: "c_010101" },
};

const OK_ICON = "✅";
const FAIL_ICON = ":-((";
const CLEANUP_DELAY = 20_000;
const THUMB_DEFAULT = "https://drive.google.com/uc?id=1pCQPRic8xPxbgUaPSIczb94S4RDdWDHK&export=download";
const WAIT_REACTIONS = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];

const fmt = (n) => n ? String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "0";
const badResult = (data) => data?.error || !Array.isArray(data?.medias) || data.medias.length === 0;

function react(api, message, threadId, threadType, icon) {
    if (!message?.data?.msgId && !message?.data?.globalMsgId) return;
    api.addReaction(icon, {
        msgId: message.data.msgId || message.data.globalMsgId,
        cliMsgId: message.data.cliMsgId
    }, threadId, threadType).catch(() => {});
}

function cleanupFiles(files, delay = CLEANUP_DELAY) {
    const list = Array.isArray(files) ? files.filter(Boolean) : [files].filter(Boolean);
    if (!list.length) return;
    setTimeout(() => list.forEach(file => { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} }), delay);
}

function extractText(content, message) {
    if (typeof content === "string") return content;
    const c = message?.data?.content;
    if (typeof c === "string") return c;
    if (c && typeof c === "object") return [c.text, c.href, c.title, c.description].filter(v => typeof v === "string").join(" ");
    return "";
}

function findPlatform(text) {
    for (const [platform, regex] of Object.entries(REGEX)) {
        const match = text.match(regex);
        if (match) return { platform, match, url: match[0] };
    }
    return null;
}

function firstUrl(value) {
    if (Array.isArray(value)) return value.filter(Boolean)[0] || null;
    if (typeof value !== "string") return null;
    return value.split(",").map(v => v.trim()).filter(Boolean)[0] || null;
}

function allUrls(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (typeof value !== "string") return [];
    return value.split(",").map(v => v.trim()).filter(Boolean);
}

function splitMedias(medias = []) {
    const images = [];
    const videos = [];
    let audio = null;

    for (const media of medias) {
        const urls = allUrls(media?.url);
        if (!urls.length) continue;
        if (media.type === "image") images.push(...urls);
        else if (media.type === "video") videos.push(...urls.map(url => ({ ...media, url })));
        else if (media.type === "audio" && !audio) audio = { ...media, url: urls[0] };
    }

    return { images, videos, audio };
}

function pickVideo(medias, picker) {
    const picked = picker?.(medias);
    const url = firstUrl(picked?.url);
    return url ? { ...picked, url } : null;
}

function makeCaption(platform, title, author, extra = "") {
    const p = PLATFORM[platform];
    const header = `${p.icon} ${p.name}`;
    let msg = `${header}\n`;
    if (title) msg += `📝 ${title}\n`;
    if (author && author !== "Unknown") msg += `👤 ${author}\n`;
    if (extra) msg += extra;
    return { msg, styles: [{ start: 0, len: header.length, st: "b" }, { start: 0, len: header.length, st: p.color }] };
}

function makeThreadsCaption(data) {
    const header = "🧵 THREADS";
    let msg = `${header}\n─────────────────\n`;
    if (data.message) msg += `📝 ${data.message.slice(0, 300)}\n`;
    if (data.author) msg += `👤 ${data.author}\n`;
    const stats = [
        data.like && data.like !== "0" ? `❤️ ${data.like}` : null,
        data.comment && data.comment !== "0" ? `💬 ${data.comment}` : null,
        data.repost && data.repost !== "0" ? `🔁 ${data.repost}` : null,
    ].filter(Boolean);
    if (stats.length) msg += stats.join(" · ") + "\n";
    msg += "─────────────────";
    return { msg, styles: [{ start: 0, len: header.length, st: "b" }, { start: 0, len: header.length, st: "c_010101" }] };
}

async function followRedirect(url) {
    try {
        const r = await axios.get(url, {
            maxRedirects: 8,
            timeout: 8000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
            },
            validateStatus: s => s < 400,
        });
        // Lấy URL cuối cùng sau redirect (nhiều cách để tương thích các phiên bản axios)
        const finalUrl = r.request?.res?.responseUrl
            || r.request?._redirectable?._currentUrl
            || r.request?.responseURL
            || r.config?.url
            || url;
        return finalUrl !== url ? finalUrl : url;
    } catch (e) {
        // Nếu axios throw (vd: 3xx không tự follow), thử lấy từ Location header
        if (e.response?.headers?.location) {
            try {
                const loc = e.response.headers.location;
                return loc.startsWith("http") ? loc : new URL(loc, url).href;
            } catch {}
        }
        return url;
    }
}

async function dlStream(url, filePath, headers = {}) {
    const r = await axios({ url, method: "GET", responseType: "stream", timeout: 300000, maxContentLength: Infinity, maxBodyLength: Infinity, headers: { "User-Agent": "Mozilla/5.0", ...headers } });
    const w = fs.createWriteStream(filePath);
    r.data.pipe(w);
    await new Promise((res, rej) => { w.on("finish", res); w.on("error", rej); });
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    if (size === 0) throw new Error("File tải về rỗng (0 bytes)");
}

function getUploadedUrl(upload) {
    return upload?.fileUrl || upload?.url || upload?.href || (typeof upload === "string" ? upload : null);
}

async function uploadVideoFile(api, { filePath, thumbUrl, caption, threadId, threadType, width = 720, height = 1280 }) {
    if (fs.statSync(filePath).size === 0) throw new Error("File video rỗng");
    const { path: uploadPath, cleanup } = await compressIfNeeded(filePath, {
        onStatus: (mb) => log.warn(`[autodown] Video ${mb.toFixed(0)}MB > 900MB — đang nén trước khi gửi...`)
    });
    try {
        const uploads = await api.uploadAttachment(uploadPath, threadId, threadType);
        const zaloUrl = getUploadedUrl(uploads?.[0]);
        if (!zaloUrl) throw new Error("Không lấy được URL Zalo.");
        await api.sendVideoEnhanced({
            videoUrl: zaloUrl,
            thumbnailUrl: thumbUrl || THUMB_DEFAULT,
            duration: 10000,
            width,
            height,
            fileSize: fs.statSync(uploadPath).size,
            msg: caption?.msg || caption || "",
            styles: caption?.styles,
            threadId,
            threadType
        });
    } finally {
        cleanup();
    }
}

async function sendVideoPlayer(api, { videoUrl, thumbUrl, caption, threadId, threadType, headers = {} }) {
    if (!videoUrl) return false;
    const tmp = path.join(process.cwd(), `dl_vid_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
    try {
        await dlStream(videoUrl, tmp, { Referer: "https://www.tiktok.com/", ...headers });
        await uploadVideoFile(api, { filePath: tmp, thumbUrl, caption, threadId, threadType });
        return true;
    } catch (e) {
        log.error(`[autodown] video: ${e.message}`);
        try {
            if (fs.existsSync(tmp) && fs.statSync(tmp).size > 0) await api.sendMessage({ msg: caption?.msg || caption || "", styles: caption?.styles, attachments: [tmp] }, threadId, threadType);
        } catch {}
        return false;
    } finally {
        cleanupFiles(tmp);
    }
}

async function sendImages(api, urls, caption, threadId, threadType, headers = {}) {
    const uniqueUrls = [...new Set((urls || []).filter(Boolean))];
    if (!uniqueUrls.length) return false;
    const ts = Date.now();
    const paths = (await Promise.all(uniqueUrls.map(async (url, i) => {
        const file = path.join(process.cwd(), `dl_img_${ts}_${i}.jpg`);
        try {
            const r = await axios({ url, method: "GET", responseType: "arraybuffer", timeout: 15000, headers: { "User-Agent": "Mozilla/5.0", ...headers } });
            fs.writeFileSync(file, Buffer.from(r.data));
            return file;
        } catch {
            return null;
        }
    }))).filter(Boolean);

    try {
        if (paths.length) await api.sendMessage({ msg: caption?.msg || caption || "", styles: caption?.styles, attachments: paths }, threadId, threadType);
        return paths.length > 0;
    } finally {
        cleanupFiles(paths);
    }
}

export async function sendAudio(api, audioUrl, threadId, threadType) {
    if (!audioUrl) return false;
    const tmp = path.join(process.cwd(), `dl_audio_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`);
    try {
        await dlStream(audioUrl, tmp, { Referer: "https://www.mixcloud.com/" });
        const { size } = fs.statSync(tmp);
        if (size > 60 * 1024 * 1024) await api.sendMessage({ msg: "", attachments: [tmp] }, threadId, threadType);
        else await api.sendVoiceUnified({ filePath: tmp, threadId, threadType });
        return true;
    } catch (e) {
        log.warn(`[autodown] audio: ${e.message}`);
        return false;
    } finally {
        cleanupFiles(tmp);
    }
}

async function sendDownloaderResult(api, { platform, data, threadId, threadType, picker = vidsPickVideo, sendAllVideos = false, extra = "" }) {
    if (badResult(data)) return false;
    const cap = makeCaption(platform, data.title, data.author, extra);
    const { images, videos, audio } = splitMedias(data.medias);
    const selected = sendAllVideos ? videos : [pickVideo(data.medias, picker) || videos[0]].filter(Boolean);
    let sent = false;

    if (images.length) sent = await sendImages(api, images, cap, threadId, threadType) || sent;
    for (const video of selected) sent = await sendVideoPlayer(api, { videoUrl: video.url, thumbUrl: data.thumbnail, caption: images.length ? null : cap, threadId, threadType }) || sent;
    if (audio?.url) sent = await sendAudio(api, audio.url, threadId, threadType) || sent;

    return sent;
}

const TOGGLE_FILE = path.join(process.cwd(), "src", "modules", "cache", "autodown_toggle.json");
let _toggleCache = null;

function loadToggle() {
    if (_toggleCache) return _toggleCache;
    try {
        if (fs.existsSync(TOGGLE_FILE)) _toggleCache = JSON.parse(fs.readFileSync(TOGGLE_FILE, "utf8"));
    } catch {}
    return (_toggleCache = _toggleCache || {});
}

function saveToggle(data) {
    _toggleCache = data;
    fs.mkdirSync(path.dirname(TOGGLE_FILE), { recursive: true });
    fs.writeFileSync(TOGGLE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function isAutodownEnabled(threadId) { return loadToggle()[threadId] === true; }
function setAutodown(threadId, val) { const d = loadToggle(); d[threadId] = val; saveToggle(d); }

export const commands = {
    autodown: async (ctx) => {
        const { api, args, threadId, threadType, isGroup } = ctx;
        if (!isGroup) return api.sendMessage({ msg: "⚠️ Lệnh này chỉ dùng trong nhóm." }, threadId, threadType);

        const sub = (args[0] || "").toLowerCase();
        if (sub === "on" || sub === "bật") {
            setAutodown(threadId, true);
            return api.sendMessage({ msg: "✅ Đã bật Auto Download trong nhóm này", styles: [{ start: 0, len: 38, st: "b" }, { start: 0, len: 38, st: "c_15a85f" }] }, threadId, threadType);
        }
        if (sub === "off" || sub === "tắt") {
            setAutodown(threadId, false);
            return api.sendMessage({ msg: "❌ Đã tắt Auto Download trong nhóm này", styles: [{ start: 0, len: 38, st: "b" }, { start: 0, len: 38, st: "c_db342e" }] }, threadId, threadType);
        }
        const enabled = isAutodownEnabled(threadId);
        const status = enabled ? "BẬT" : "TẮT";
        const color = enabled ? "c_15a85f" : "c_db342e";
        const hdr = "[ 📥 AUTO DOWNLOAD ]";
        await api.sendMessage({
            msg: `${hdr}\n─────────────────\n◈ Trạng thái: ${status}\n─────────────────\n💡 Dùng: !autodown on/off`,
            styles: [{ start: 0, len: hdr.length, st: "b" }, { start: 0, len: hdr.length, st: "c_f27806" }, { start: hdr.length + 18, len: status.length, st: color }]
        }, threadId, threadType);
    }
};

const _seen = new Map();
function isDuplicate(msgId) {
    if (!msgId) return false;
    const now = Date.now();
    if (_seen.has(msgId)) return true;
    _seen.set(msgId, now);
    for (const [id, ts] of _seen) if (now - ts > 120_000) _seen.delete(id);
    return false;
}

async function handleTikTok(api, url, threadId, threadType) {
    // downloadTikTok tự xử lý short URL bên trong (resolveShortUrl có validation đúng)
    // KHÔNG dùng followRedirect ở đây vì TikTok hay redirect về /about khi phát hiện bot
    const isPhoto = /\/photo\//i.test(url);
    let tkData = null;
    try {
        tkData = await downloadTikTok(url);
    } catch (e) {
        log.warn(`[autodown] downloadTikTok lỗi: ${e.message}`);
    }

    if (tkData) {
        const cap = makeCaption("tiktok", tkData.title, tkData.author);
        const looksImg = tkData.videoUrl && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(tkData.videoUrl);
        if ((isPhoto || looksImg) && tkData.videoUrl && !tkData.images?.length) {
            tkData.images = [tkData.videoUrl];
            tkData.videoUrl = null;
        }
        let sent = false;
        if (tkData.images?.length) sent = await sendImages(api, tkData.images, cap, threadId, threadType) || sent;
        if (tkData.videoUrl) sent = await sendVideoPlayer(api, { videoUrl: tkData.videoUrl, thumbUrl: tkData.cover, caption: tkData.images?.length ? null : cap, threadId, threadType }) || sent;
        if (tkData.audioUrl) sent = await sendAudio(api, tkData.audioUrl, threadId, threadType) || sent;
        return sent;
    }

    // Fallback VidsSave — dùng URL gốc (VidsSave tự xử lý short URL)
    log.warn("[autodown] TikTok dedicated fail → VidsSave");
    const data = await vidsDownloader(url);
    return sendDownloaderResult(api, { platform: "tiktok", data, threadId, threadType });
}

async function handleFacebook(api, url, threadId, threadType) {
    let data = await snapsaveDownloader(url);
    if (await sendDownloaderResult(api, { platform: "facebook", data, threadId, threadType, picker: snapsavePickVideo })) return true;

    log.warn(`[autodown] FB SnapSave fail → VidsSave: ${data?.message || "unknown"}`);
    data = await vidsDownloader(url);
    return sendDownloaderResult(api, { platform: "facebook", data, threadId, threadType });
}

async function handleInstagram(api, url, threadId, threadType) {
    const ig = await downloadInstagram(url);
    if (ig?.attachments?.length) {
        const cap = makeCaption("instagram", ig.message, ig.author, `❤️ ${fmt(ig.like)} · 💬 ${fmt(ig.comment)}`);
        const images = ig.attachments.filter(a => a.type !== "Video").map(a => a.url).filter(Boolean);
        const videos = ig.attachments.filter(a => a.type === "Video").map(a => a.url).filter(Boolean);
        let sent = false;
        if (images.length) sent = await sendImages(api, images, cap, threadId, threadType) || sent;
        for (const videoUrl of videos) sent = await sendVideoPlayer(api, { videoUrl, thumbUrl: ig.cover, caption: images.length ? null : cap, threadId, threadType }) || sent;
        return sent;
    }

    log.warn("[autodown] Instagram dedicated fail → VidsSave");
    const data = await vidsDownloader(url);
    return sendDownloaderResult(api, { platform: "instagram", data, threadId, threadType, sendAllVideos: true });
}

async function handleYoutube(api, url, videoId, threadId, threadType) {
    const ytTmp    = path.join(process.cwd(), `dl_ytv_${Date.now()}.mp4`);
    const audioTmp = path.join(process.cwd(), `dl_yta_${Date.now()}.m4a`);
    try {
        const meta  = await downloadYoutubeVideo(url, ytTmp);
        const cap   = makeCaption("youtube", meta.title, meta.author);
        const thumb = meta.thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        try {
            await uploadVideoFile(api, { filePath: ytTmp, thumbUrl: thumb, caption: cap, threadId, threadType, width: 1280, height: 720 });
        } catch (e) {
            log.error(`[autodown] YouTube upload: ${e.message}`);
            if (fs.existsSync(ytTmp) && fs.statSync(ytTmp).size > 0)
                await api.sendMessage({ msg: cap.msg, styles: cap.styles, attachments: [ytTmp] }, threadId, threadType);
            else return false;
        }
        return true;
    } catch (e) {
        log.warn(`[autodown] YouTube download fail: ${e.message}`);
        try {
            const meta = await downloadYoutubeAudio(url, audioTmp);
            const cap  = makeCaption("youtube", meta.title, meta.author, "🎧 Gửi dạng âm thanh vì video không tải được.");
            await api.sendMessage({ msg: cap.msg, styles: cap.styles }, threadId, threadType);
            await api.sendVoiceUnified({ filePath: audioTmp, threadId, threadType });
            return true;
        } catch (ae) {
            log.warn(`[autodown] YouTube audio fallback fail: ${ae.message}`);
            return false;
        }
    } finally {
        cleanupFiles([ytTmp, audioTmp]);
    }
}

async function handleThreads(api, url, threadId, threadType) {
    let postData = null;
    try {
        postData = await downloadThreads(url);
    } catch (e) {
        log.warn(`[autodown] Threads primary fail: ${e.message}`);
        return false;
    }

    if (!postData) return false;
    const attachments = postData.attachments || [];
    const cap = makeThreadsCaption(postData);
    if (!attachments.length) {
        await api.sendMessage({ msg: cap.msg, styles: cap.styles }, threadId, threadType);
        return true;
    }

    const downloaded = (await Promise.all(attachments.map(async (a, i) => {
        try {
            const { filePath } = await downloadThreadsFile({ url: a.url, type: a.type === "Video" ? "video" : "image" }, i);
            return { filePath, isVideo: a.type === "Video" };
        } catch (e) {
            log.warn(`[threads] file ${i + 1}: ${e.message}`);
            return null;
        }
    }))).filter(Boolean);

    if (!downloaded.length) return false;
    try {
        const images = downloaded.filter(d => !d.isVideo).map(d => d.filePath);
        const videos = downloaded.filter(d => d.isVideo);
        let sent = false;
        if (images.length) {
            await api.sendMessage({ msg: cap.msg, styles: cap.styles, attachments: images }, threadId, threadType);
            sent = true;
        }
        for (const video of videos) {
            try {
                await uploadVideoFile(api, { filePath: video.filePath, thumbUrl: postData.cover, caption: images.length ? "" : cap, threadId, threadType });
                sent = true;
            } catch (e) {
                log.warn(`[threads] video: ${e.message}`);
                try {
                    await api.sendMessage({ msg: images.length ? "" : cap.msg, styles: images.length ? undefined : cap.styles, attachments: [video.filePath] }, threadId, threadType);
                    sent = true;
                } catch {}
            }
        }
        return sent;
    } finally {
        cleanupFiles(downloaded.map(d => d.filePath));
    }
}

async function handlePlatform({ platform, match, url, api, threadId, threadType }) {
    switch (platform) {
        case "tiktok":
            return handleTikTok(api, url, threadId, threadType);
        case "facebook":
            return handleFacebook(api, url, threadId, threadType);
        case "instagram":
            return handleInstagram(api, url, threadId, threadType);
        case "youtube":
            return handleYoutube(api, url, match[1], threadId, threadType);
        case "douyin": {
            const dy = await downloadDouyin(url);
            if (!dy) return false;
            const cap = makeCaption("douyin", dy.title, dy.author);
            let sent = false;
            if (dy.images?.length) sent = await sendImages(api, dy.images, cap, threadId, threadType) || sent;
            if (dy.videoUrl) sent = await sendVideoPlayer(api, { videoUrl: dy.videoUrl, thumbUrl: dy.cover, caption: dy.images?.length ? null : cap, threadId, threadType }) || sent;
            if (dy.audioUrl) sent = await sendAudio(api, dy.audioUrl, threadId, threadType) || sent;
            return sent;
        }
        case "soundcloud": {
            const sc = await downloadSoundCloud(url);
            if (!sc?.url) return false;
            const cap = makeCaption("soundcloud", sc.title, sc.author, `⏳ ${sc.duration} · ▶️ ${sc.playback} · ❤️ ${sc.likes}`);
            await sendAudio(api, sc.url, threadId, threadType);
            await api.sendMessage({ msg: cap.msg, styles: cap.styles }, threadId, threadType);
            return true;
        }
        case "capcut": {
            const cp = await downloadCapCut(url);
            if (!cp?.videoUrl) return false;
            return sendVideoPlayer(api, { videoUrl: cp.videoUrl, thumbUrl: null, caption: makeCaption("capcut", cp.title, cp.author?.name), threadId, threadType });
        }
        case "mixcloud": {
            const mc = await downloadMixcloud(url);
            if (!mc?.streamUrl) return false;
            const cap = makeCaption("mixcloud", mc.title, mc.author, `⏳ ${Math.floor(mc.duration / 60)} phút`);
            await api.sendMessage({ msg: cap.msg, styles: cap.styles }, threadId, threadType);
            await sendAudio(api, mc.streamUrl, threadId, threadType);
            return true;
        }
        case "threads":
            return handleThreads(api, url, threadId, threadType);
        case "spotify": {
            const data = await spotify.download(match[1]);
            if (!data?.primaryUrl) return false;
            const cap = makeCaption("spotify", data.title, data.artist);
            if (data.thumbnail) await sendImages(api, [data.thumbnail], cap, threadId, threadType);
            else await api.sendMessage({ msg: cap.msg, styles: cap.styles }, threadId, threadType);
            await sendAudio(api, data.primaryUrl, threadId, threadType);
            return true;
        }
        default:
            return false;
    }
}

export async function handle(ctx) {
    const { content, api, message, threadId, threadType, senderId, adminIds } = ctx;
    const msgId = message?.data?.msgId || message?.data?.globalMsgId || message?.msgId;
    if (isDuplicate(msgId)) return false;

    const text = extractText(content, message);
    if (!text) return false;

    const found = findPlatform(text);
    if (!found) return false;
    if (!isAutodownEnabled(threadId)) return false;

    const admins = Array.isArray(adminIds) ? adminIds.map(String) : [];
    if (!admins.includes(String(senderId)) && !rentalManager.isRented(threadId)) return false;

    react(api, message, threadId, threadType, "chờ 1 chút");
    let ci = 0;
    const ri = setInterval(() => react(api, message, threadId, threadType, WAIT_REACTIONS[ci++ % WAIT_REACTIONS.length]), 2000);

    try {
        react(api, message, threadId, threadType, "⏳");
        const ok = await handlePlatform({ ...found, api, threadId, threadType });
        react(api, message, threadId, threadType, ok ? OK_ICON : FAIL_ICON);
    } catch (e) {
        log.error(`[autodown/${PLATFORM[found.platform]?.name || found.platform}] ${e.message}`);
        react(api, message, threadId, threadType, FAIL_ICON);
    } finally {
        clearInterval(ri);
    }
    return false;
}
