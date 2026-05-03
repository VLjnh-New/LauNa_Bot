import axios from "axios";

/**
 * TikTok Downloader
 * Primary  : TikWM  (POST API, hỗ trợ video HD / slideshow ảnh / nhạc)
 * Fallback1: SnapTik
 * Fallback2: MusicalDown
 * Hỗ trợ URL ngắn: vt.tiktok.com, vm.tiktok.com, tiktok.com/t/...
 */

const BASE_TIKWM   = "https://www.tikwm.com";
const SHORT_PATTERN = /vt\.tiktok\.com\/[\w-]+|vm\.tiktok\.com\/[\w-]+|tiktok\.com\/t\/[\w-]+/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Chuyển relative path của TikWM → URL đầy đủ */
function absUrl(path) {
    if (!path) return null;
    if (path.startsWith("http")) return path;
    return BASE_TIKWM + (path.startsWith("/") ? path : "/" + path);
}

/** Resolve URL ngắn TikTok → URL đầy đủ (chỉ trả về nếu đúng pattern video/photo) */
async function resolveShortUrl(url) {
    if (!SHORT_PATTERN.test(url)) return url;
    try {
        const res = await axios.get(url, {
            maxRedirects: 8,
            timeout: 8000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
            },
            validateStatus: s => s < 400,
        });
        const resolved = res.request?.res?.responseUrl
            || res.request?._redirectable?._currentUrl
            || res.config?.url
            || url;
        if (/tiktok\.com\/@[\w.-]+\/(?:video|photo)\/\d+/i.test(resolved)) return resolved;
    } catch {}
    return url;
}

// ── TikWM (primary) ──────────────────────────────────────────────────────────

async function downloadViaTikWM(url) {
    const params = new URLSearchParams({
        url,
        count:  "12",
        cursor: "0",
        web:    "1",
        hd:     "1",
    });

    const { data: res } = await axios.post(`${BASE_TIKWM}/api/`, params.toString(), {
        timeout: 20000,
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Referer":      `${BASE_TIKWM}/`,
            "Origin":       BASE_TIKWM,
            "Accept":       "application/json, text/plain, */*",
        },
    });

    if (!res || res.code !== 0 || !res.data) {
        const reason = res?.msg || res?.message || `code=${res?.code ?? "null"}`;
        console.error(`[TikTok] TikWM lỗi: ${reason} | url=${url.slice(0, 80)}`);
        return null;
    }

    const d = res.data;

    // ── Video thường ──────────────────────────────────────────────────────────
    let videoUrl = null;
    // hdplay → play (đều là relative path, cần absUrl)
    if (d.hdplay)  videoUrl = absUrl(d.hdplay);
    else if (d.play) videoUrl = absUrl(d.play);

    // ── Slideshow / ảnh ───────────────────────────────────────────────────────
    let images = [];
    if (Array.isArray(d.images) && d.images.length > 0) {
        // images có thể là array of string hoặc array of object { url }
        images = d.images
            .map(img => (typeof img === "string" ? img : img?.url || img?.download_url || null))
            .filter(Boolean)
            .map(absUrl);
        videoUrl = null; // ưu tiên ảnh
    }
    // image_post_info dạng mới của TikTok
    if (!images.length && d.image_post_info?.images?.length) {
        images = d.image_post_info.images
            .map(img => img?.display_image?.url_list?.[0] || img?.url || null)
            .filter(Boolean)
            .map(absUrl);
        videoUrl = null;
    }

    // ── Nhạc ─────────────────────────────────────────────────────────────────
    // music_info.play thường là CDN TikTok (absolute), music là relative
    const audioUrl = d.music_info?.play || absUrl(d.music) || null;

    // ── Cover ─────────────────────────────────────────────────────────────────
    const cover = absUrl(d.cover) || absUrl(d.origin_cover) || null;

    if (!videoUrl && !images.length && !audioUrl) return null;

    return {
        title:  d.title || "Video TikTok",
        author: d.author?.nickname || d.author?.unique_id || null,
        avatar: absUrl(d.author?.avatar),
        videoUrl,
        audioUrl,
        cover,
        images,
        duration: d.duration || 0,
        stats: {
            views:    d.play_count    || 0,
            likes:    d.digg_count    || 0,
            comments: d.comment_count || 0,
            shares:   d.share_count   || 0,
        },
    };
}

// ── SnapTik (fallback 1) ──────────────────────────────────────────────────────

async function downloadViaSnapTik(url) {
    const { data } = await axios.post("https://snaptik.fit/api/tiktok", { url }, {
        timeout: 15000,
        headers: {
            "accept":          "*/*",
            "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8",
            "cache-control":   "no-cache",
            "content-type":    "application/json",
            "origin":          "https://snaptik.fit",
            "referer":         "https://snaptik.fit/vi",
            "user-agent":      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
        },
    });

    if (!data || !data.download_link) return null;

    const links  = data.download_link;
    const stats  = data.statistics || {};
    const author = data.author || {};

    let images   = data.images || [];
    let videoUrl = links.no_watermark_hd || links.no_watermark || null;

    if (Array.isArray(videoUrl)) {
        if (videoUrl.length > 1) { images = images.concat(videoUrl); videoUrl = null; }
        else videoUrl = videoUrl[0] || null;
    } else if (typeof videoUrl === "string" && videoUrl.includes(",")) {
        const splitted = videoUrl.split(",").filter(u => u.trim());
        if (splitted.length > 1) { images = images.concat(splitted); videoUrl = null; }
    }

    if (videoUrl && typeof videoUrl === "string") {
        const isImg = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(videoUrl)
            || (/tiktokcdn\.com\/(?!.*\.mp4)/.test(videoUrl) && !/\bvideo\b/.test(videoUrl))
            || /\/photo\//i.test(videoUrl);
        if (isImg) { images = [videoUrl, ...images]; videoUrl = null; }
    }

    return {
        title:  data.description || "Video TikTok",
        author: author.nickname  || null,
        avatar: author.avatar    || null,
        videoUrl,
        audioUrl: links.mp3 || null,
        cover:    data.cover    || null,
        images,
        duration: 0,
        stats: {
            views:    stats.play_count   || 0,
            likes:    stats.digg_count   || 0,
            comments: stats.comment_count|| 0,
            shares:   stats.repost_count || 0,
        },
    };
}

// ── MusicalDown (fallback 2) ──────────────────────────────────────────────────

async function downloadViaMusicalDown(url) {
    const res = await axios.post("https://musicaldown.com/api/v2/media/downloader", { link: url }, {
        timeout: 15000,
        headers: {
            "accept":       "application/json",
            "content-type": "application/json",
            "origin":       "https://musicaldown.com",
            "referer":      "https://musicaldown.com/vi",
            "user-agent":   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        },
    });

    const d = res.data;
    if (!d || d.status !== "success") return null;

    const items     = d.medias || [];
    const videoItem = items.find(m => m.quality === "hd") || items.find(m => m.type === "video") || null;
    const audioItem = items.find(m => m.type === "audio") || null;
    const imgItems  = items.filter(m => m.type === "image") || [];

    if (!videoItem && !audioItem && !imgItems.length) return null;

    return {
        title:  d.title  || "Video TikTok",
        author: d.author?.name   || null,
        avatar: d.author?.avatar || null,
        videoUrl:  videoItem?.url || null,
        audioUrl:  audioItem?.url || null,
        cover:     d.thumbnail   || null,
        images:    imgItems.map(i => i.url).filter(Boolean).concat(d.images || []),
        duration:  0,
        stats:     {},
    };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Download TikTok — hỗ trợ video, slideshow ảnh, nhạc, URL ngắn.
 * Luồng: resolveShortUrl → TikWM (POST) → SnapTik → MusicalDown
 */
export async function downloadTikTok(url) {
    // Resolve URL ngắn trước — nếu resolve thất bại giữ nguyên URL gốc
    const resolved = await resolveShortUrl(url);
    const targets  = resolved !== url ? [resolved, url] : [url];

    // TikWM (primary)
    for (const target of targets) {
        try {
            const result = await downloadViaTikWM(target);
            if (result?.videoUrl || result?.images?.length || result?.audioUrl) return result;
        } catch (e) {
            console.error("[TikTok] TikWM lỗi:", e.message);
        }
    }

    // SnapTik (fallback 1)
    for (const target of targets) {
        try {
            const result = await downloadViaSnapTik(target);
            if (result?.videoUrl || result?.images?.length) return result;
        } catch (e) {
            console.error("[TikTok] SnapTik lỗi:", e.message);
        }
    }

    // MusicalDown (fallback 2)
    for (const target of targets) {
        try {
            const result = await downloadViaMusicalDown(target);
            if (result?.videoUrl || result?.images?.length || result?.audioUrl) return result;
        } catch (e) {
            console.error("[TikTok] MusicalDown lỗi:", e.message);
        }
    }

    return null;
}
