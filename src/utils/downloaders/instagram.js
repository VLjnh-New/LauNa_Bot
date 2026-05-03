import axios from 'axios';
import https from 'https';
import { log } from '../../logger.js';
import { getDesktopUA } from '../core/userAgents.js';

const INSTAGRAM_COOKIE = 'datr=4GzRaIwO7qAboM0PWdLJYoU4; ig_did=41D9C615-692D-4E94-8965-515119EB77B2; ig_nrcb=1; mid=aNFs4QALAAH6zG0Nq46FXgaeU96s; csrftoken=1pDK2S0plkOAayvcmC9IEcOmnKrNIHtv; ds_user_id=77366906452; sessionid=77366906452%3AbM8Mi7f0xzy6Xx%3A12%3AAYgW97_-mStINmAYcoyNqay6e1IKNUd_GSfcP9t7vg; ps_l=1; ps_n=1; wd=600x1181; rur=EAG\x2c77366906452\x2c1790147356:01fe9127636f7cf521c252b32251a47bffd8fec1fdf1f6fcc6583f8ac2d1ae41561d0c93';

function formatNumber(number) {
    if (isNaN(number) || number === null) return "0";
    return number.toLocaleString('de-DE');
}


async function getPost(url, cookie) {
    const headers = {
        "accept": "*/*",
        "accept-language": "vi,en-US;q=0.9,en;q=0.8",
        "sec-ch-ua": "\"Chromium\";v=\"106\", \"Microsoft Edge\";v=\"106\", \"Not;A=Brand\";v=\"99\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "x-asbd-id": "198387",
        "x-csrftoken": "tJk2tDhaeYfUeJRImgbH75Vp6CV6PjtW",
        "x-ig-app-id": "936619743392459",
        "x-ig-www-claim": "hmac.AR1NFmgjJtkM68KRAAwpbEV2G73bqDP45PvNfY8stbZcFiRA",
        "x-instagram-ajax": "1006400422",
        "Referer": "https://www.instagram.com/",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "cookie": cookie
    };

    if (!url || !url.match(/https:\/\/www\.instagram\.com\/(p|tv|reel)\/[a-zA-Z0-9]+/)) {
        throw new Error("Invalid or missing URL");
    }

    const shortcode = url.match(/\/(?:p|tv|reel)\/([a-zA-Z0-9_-]+)/)?.[1];
    const { data } = await axios.get(url, { headers });

    let postId = data.match(/instagram:\/\/media\?id=(\d+)/)?.[1] ||
        data.match(/"media_id":"(\d+)"/)?.[1] ||
        data.match(/"id":"(\d+)"/)?.[1];

    if (!postId) throw new Error("Post not found (ID extraction failed)");

    const { data: postInfo } = await axios.get(`https://i.instagram.com/api/v1/media/${postId}/info/`, {
        headers: { ...headers, "Host": "i.instagram.com" }
    });
    const info = postInfo.items?.[0] || {};
    const coverUrl = info.image_versions2?.candidates?.[0]?.url || "";
    const dataReturn = { images: [], videos: [], cover: coverUrl };

    if (info.video_versions) {
        dataReturn.videos = [info.video_versions[info.video_versions.length - 1].url];
    } else {
        const allImage = info.carousel_media || [{ image_versions2: info.image_versions2 }];
        dataReturn.images = allImage.map(item => item.image_versions2.candidates[0].url);
    }

    const postData = {
        ...dataReturn,
        caption: info.caption?.text || "",
        owner: {
            id: info.user.pk,
            username: info.user.username,
            full_name: info.user.full_name,
            profile_pic_url: info.user.profile_pic_url
        },
        like_count: info.like_count,
        comment_count: info.comment_count,
        created_at: info.taken_at,
        media_type: info.media_type,
        originalData: info
    };

    const attachments = [];
    if (postData.images?.length > 0) {
        attachments.push(...postData.images.map(imageUrl => ({ type: "Photo", url: imageUrl })));
    } else if (postData.videos?.length > 0) {
        attachments.push(...postData.videos.map(videoUrl => ({ type: "Video", url: videoUrl })));
    }

    return {
        id: postData.originalData.id,
        message: postData?.caption || null,
        author: postData ? `${postData.owner.full_name} (${postData.owner.username})` : null,
        like: formatNumber(postData?.like_count) || null,
        comment: formatNumber(postData?.comment_count) || null,
        play: formatNumber(postData.originalData.play_count) || null,
        cover: postData.cover,
        attachments
    };
}

async function getStories(url, cookie) {
    const headers = {
        "accept": "*/*",
        "accept-language": "vi,en-US;q=0.9,en;q=0.8",
        "sec-ch-ua": "\"Chromium\";v=\"106\", \"Microsoft Edge\";v=\"106\", \"Not;A=Brand\";v=\"99\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-site",
        "x-asbd-id": "198387",
        "x-csrftoken": "tJk2tDhaeYfUeJRImgbH75Vp6CV6PjtW",
        "x-ig-app-id": "936619743392459",
        "x-ig-www-claim": "hmac.AR1NFmgjJtkM68KRAAwpbEV2G73bqDP45PvNfY8stbZcFiRA",
        "x-instagram-ajax": "1006400422",
        "referer": "https://www.instagram.com/",
        "referrer-policy": "strict-origin-when-cross-origin",
        "cookie": cookie
    };

    async function getUserId(username) {
        const userRes = await axios.get(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`, { headers });
        return userRes.data.data.user.id;
    }

    const username = url.match(/instagram\.com\/stories\/([^/]+)\//)?.[1] || null;
    const userId = await getUserId(username);
    const getId = url.match(/\/stories\/[^\/]+\/(\d+)/)?.[1] || null;

    const storiesRes = await axios.get(`https://www.instagram.com/graphql/query/?query_hash=de8017ee0a7c9c45ec4260733d81ea31&variables={"reel_ids":["${userId}"],"tag_names":[],"location_ids":[],"highlight_reel_ids":[],"precomposed_overlay":false,"show_story_viewer_list":true}`, { headers });
    const data = storiesRes.data.data.reels_media[0].items;
    const res = data.find(item => item.id === getId);
    let attachments = [];
    if (res.video_resources?.length > 0) {
        attachments.push({ type: "Video", url: res.video_resources[0].src });
    } else if (res.display_resources?.length > 0) {
        attachments.push({ type: "Photo", url: res.display_resources[0].src });
    }
    return {
        id: res.id, message: null, author: null, like: null, comment: null, play: null,
        cover: res.display_resources?.[0]?.src || null, attachments
    };
}

async function getHighlight(url, cookie) {
    try {
        const headers = {
            "accept": "*/*",
            "accept-language": "vi,en-US;q=0.9,en;q=0.8",
            "x-asbd-id": "198387",
            "x-csrftoken": "tJk2tDhaeYfUeJRImgbH75Vp6CV6PjtW",
            "x-ig-app-id": "936619743392459",
            "x-ig-www-claim": "hmac.AR1NFmgjJtkM68KRAAwpbEV2G73bqDP45PvNfY8stbZcFiRA",
            "x-instagram-ajax": "1006400422",
            "referer": "https://www.instagram.com/",
            "cookie": cookie
        };
        const storyId = url.match(/story_media_id=([^&]+)/)?.[1];
        const res = await axios.get(`https://i.instagram.com/api/v1/media/${storyId}/info/`, { headers });
        const data = res.data.items;
        const resp = data.find(item => item.id === storyId);
        let attachments = [];
        if (resp.video_versions?.length > 0) {
            attachments.push({ type: "Video", url: resp.video_versions[0].url });
        } else if (resp.image_versions2?.candidates?.length > 0) {
            attachments.push({ type: "Photo", url: resp.image_versions2.candidates[0].url });
        }
        return {
            id: resp.id, message: resp.caption?.text || null,
            author: `${resp.user.full_name} (${resp.user.username})`,
            like: null, comment: null, play: null,
            cover: resp.image_versions2?.candidates?.[0]?.url || null, attachments
        };
    } catch (error) {
        log.warn(`[Instagram] getHighlight lỗi: ${error.message}`);
        return null;
    }
}

/**
 * Download Instagram — cookie-based
 */
export async function downloadInstagram(link) {
    const cookie = INSTAGRAM_COOKIE;
    try {
        if (/https:\/\/www\.instagram\.com\/(p|tv|reel)\/[a-zA-Z0-9]+/.test(link)) {
            return await getPost(link, cookie);
        } else if (/https:\/\/www\.instagram\.com\/stories\/[\w.]+\/\d+(\?[^\s]*)?/.test(link)) {
            return await getStories(link, cookie);
        } else {
            return await getHighlight(link, cookie);
        }
    } catch (err) {
        log.error(`[Instagram] Lỗi: ${err.message}`);
        return null;
    }
}

export async function getInstagramProfile(username) {
    try {
        const BASE_URL = `https://www.instagram.com/api/v1/users/web_profile_info/?username=${username}`;
        const headers = {
            "user-agent": getDesktopUA(),
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "x-ig-app-id": "936619743392459",
            "cookie": "csrftoken=MmWyMFr7j6h05DE0ZIhbHVGvmKIBwsn1; mid=Y8jCyAALAAGuxvSb_XxKIqDPDRTA; ig_did=46113657-2712-42E0-AB3A-9FAF79C51B8C; ig_nrcb=1"
        };
        const response = await axios.get(BASE_URL, { headers });
        return response.data;
    } catch (e) {
        log.error(`[Instagram] getProfile lỗi: ${e.message}`);
        throw e;
    }
}
