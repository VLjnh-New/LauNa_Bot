import axios from "axios";
import fs from "node:fs";
import { pipeline } from "stream/promises";
import { ffmpegRun } from "../core/ffmpegHelper.js";
import { getMobileUA, getDesktopUA } from "../core/userAgents.js";

// ── ytdown.to ─────────────────────────────────────────────────────────────────
const YTDOWN_PROXY = "https://app.ytdown.to/proxy.php";
const YTDOWN_HEADERS = {
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9,vi;q=0.8",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "X-Requested-With": "XMLHttpRequest",
    "Origin": "https://app.ytdown.to",
    "Referer": "https://app.ytdown.to/en12/",
    "User-Agent": getMobileUA()
};

async function _ytdownSearch(ytUrl) {
    const r = await axios.post(YTDOWN_PROXY, `url=${encodeURIComponent(ytUrl)}`,
        { headers: YTDOWN_HEADERS, timeout: 20000 });
    let data = r.data;
    if (typeof data === "string") data = JSON.parse(data);
    const status = data.status || data.api?.status;
    if (status !== "ok") throw new Error(data?.message || data?.api?.message || "ytdown: status không OK");
    const meta = data.api || data.result?.video || {};
    const mediaItems = data.result?.video?.mediaItems || data.api?.mediaItems || data.mediaItems || [];
    return { meta, mediaItems };
}

async function _ytdownFinalUrl(mediaUrl) {
    const r = await axios.post(YTDOWN_PROXY, `url=${encodeURIComponent(mediaUrl)}`,
        { headers: YTDOWN_HEADERS, timeout: 15000 });
    let d = r.data;
    if (typeof d === "string") try { d = JSON.parse(d); } catch {}
    const url = d.fileUrl || d.api?.fileUrl || d.result?.video?.fileUrl || d.url;
    if (!url) throw new Error("ytdown: không lấy được fileUrl");
    return url;
}

// ── vgasoft (fallback) ────────────────────────────────────────────────────────
const VGASOFT_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJQVUJMSUNfQVBJX1RPS0VOIjoicGRtc1NEIzc4OUAxMyIsImlhdCI6MTc3MzY3MTY5NywiZXhwIjoxNzczNjcxNzg5fQ.h9vkDCIMzcvX37n_HpvCr8GwPX0yT9y07zT5SDBomuQ";
const VGASOFT_HEADERS = {
    "User-Agent": getMobileUA(),
    "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
    "OS": "webSite",
    "Origin": "https://downloadvideo.vn",
    "PUBLIC_API_TOKEN": VGASOFT_TOKEN,
    "Referer": "https://downloadvideo.vn/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "sec-ch-ua": '"Chromium";v="107", "Not=A?Brand";v="24"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"'
};

export async function downloadYoutube(link) {
    try {
        const url = `https://download.vgasoft.vn/web/c/youtube/getVideo?link=${encodeURIComponent(link)}`;
        const res = await axios.get(url, { headers: VGASOFT_HEADERS, timeout: 20000 });
        return res.data;
    } catch (e) {
        return { error: true, message: e.message };
    }
}

// ── Download helper ───────────────────────────────────────────────────────────
async function _dlStream(url, dest) {
    const isYtdown = url.includes("ytdown.to") || url.includes("dl.ytdown");
    const headers = {
        "User-Agent": getMobileUA(),
        "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
        "Referer": isYtdown ? "https://app.ytdown.to/" : "https://www.youtube.com/",
        "Origin": isYtdown ? "https://app.ytdown.to" : "https://www.youtube.com",
    };
    let r;
    try {
        r = await axios({ method: "GET", url, responseType: "stream", timeout: 120000, maxRedirects: 10, headers });
    } catch (e) {
        const status = e.response?.status;
        let body = "";
        if (e.response?.data) {
            try { const c = []; for await (const ch of e.response.data) c.push(ch); body = Buffer.concat(c).toString().slice(0, 150); } catch {}
        }
        throw new Error(`HTTP ${status || "?"} khi tải: ${e.message}${body ? ` | ${body}` : ""}`);
    }
    await pipeline(r.data, fs.createWriteStream(dest));
    const size = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
    if (size < 1000) throw new Error(`File quá nhỏ (${size} bytes)`);
}

// ── Public exports ────────────────────────────────────────────────────────────

/**
 * Tải video YouTube ra file.
 * Primary: ytdown.to | Fallback: vgasoft
 */
export async function downloadYoutubeVideo(ytUrl, outputPath) {
    const videoId = ytUrl.match(/[?&]v=([^&]+)/)?.[1] || ytUrl.match(/youtu\.be\/([^?&]+)/)?.[1]
        || ytUrl.match(/shorts\/([^?&]+)/)?.[1] || "";

    // ── Primary: ytdown.to ───────────────────────────────────────────────────
    try {
        const { meta, mediaItems } = await _ytdownSearch(ytUrl);

        const videoItems = mediaItems.filter(i => i.type === "Video");
        if (!videoItems.length) throw new Error("ytdown: không có Video format");

        const best = videoItems.find(v => v.mediaQuality === "HD") || videoItems[0];

        const fileUrl = await _ytdownFinalUrl(best.mediaUrl);

        await _dlStream(fileUrl, outputPath);
        const size = fs.statSync(outputPath).size;

        const thumb = meta.imagePreviewUrl || meta.thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        return { title: meta.title || "YouTube Video", author: meta.author || "YouTube", thumbnail: thumb, duration: meta.duration || "0:00" };
    } catch (e) {
        // ytdown fail → vgasoft fallback
    }

    // ── Fallback: vgasoft ─────────────────────────────────────────────────────
    const data = await downloadYoutube(ytUrl);
    if (data.error || !data.result?.video?.videos?.length)
        throw new Error(data.message || "Không lấy được dữ liệu video (vgasoft).");

    const v = data.result.video;
    const videos = v.videos || [];
    const music  = v.music  || [];

    const videoTmp = outputPath + ".vid.tmp";
    const audioTmp = outputPath + ".aud.tmp";
    let lastErr;

    const bestAudio = music.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];

    for (const q of ["HD", "SD", "360p", "any"]) {
        for (const f of [outputPath, videoTmp, audioTmp]) if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
        try {
            let sel;
            if (q === "HD") sel = videos.find(v => /FHD|HD/i.test(v.qualityLabel)) || videos[0];
            else if (q === "SD") sel = videos.find(v => /SD/i.test(v.qualityLabel)) || videos[0];
            else if (q === "360p") sel = videos.find(v => /360/i.test(v.qualityLabel)) || videos[0];
            else sel = videos[0];

            if (!sel?.url) { lastErr = new Error(`Không có URL (${q})`); continue; }
            await _dlStream(sel.url, videoTmp);

            let merged = false;
            if (bestAudio?.url) {
                try {
                    await _dlStream(bestAudio.url, audioTmp);
                    await ffmpegRun(["-y", "-i", videoTmp, "-i", audioTmp, "-c:v", "copy", "-c:a", "aac", "-movflags", "+faststart", outputPath], 300000);
                    merged = true;
                } catch (me) { }
            }
            if (!merged) fs.copyFileSync(videoTmp, outputPath);

            const finalSize = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
            if (finalSize < 10000) { lastErr = new Error(`File quá nhỏ (${finalSize} B)`); continue; }

            return { title: v.content, author: v.author || "YouTube", thumbnail: v.cover || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, duration: v.duration || "0:00" };
        } catch (e) {
            lastErr = e;
            if (!/403|429|5\d\d/.test(e.message)) throw e;
        } finally {
            for (const f of [videoTmp, audioTmp]) if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
        }
    }
    throw lastErr || new Error("Không tải được video sau tất cả API.");
}

/**
 * Tải audio YouTube ra file.
 * Primary: ytdown.to | Fallback: vgasoft
 */
export async function downloadYoutubeAudio(ytUrl, outputPath) {
    const videoId = ytUrl.match(/[?&]v=([^&]+)/)?.[1] || ytUrl.match(/youtu\.be\/([^?&]+)/)?.[1]
        || ytUrl.match(/shorts\/([^?&]+)/)?.[1] || "";

    // ── Primary: ytdown.to ────────────────────────────────────────────────────
    try {
        const { meta, mediaItems } = await _ytdownSearch(ytUrl);

        const audioItems = mediaItems.filter(i => i.type === "Audio");
        if (!audioItems.length) throw new Error("ytdown: không có Audio format");

        const best = audioItems.find(a => a.mediaQuality === "128K" || a.name?.includes("128"))
            || audioItems[audioItems.length - 1];

        const fileUrl = await _ytdownFinalUrl(best.mediaUrl);
        await _dlStream(fileUrl, outputPath);
        const size = fs.statSync(outputPath).size;
        if (size < 10000) throw new Error(`ytdown: audio quá nhỏ (${size} bytes)`);

        const thumb = meta.imagePreviewUrl || meta.thumb || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        return { title: meta.title || "YouTube", author: meta.author || "YouTube", thumbnail: thumb, thumb,
            duration: meta.duration || "0:00", views: "0", date: new Date().toISOString().split("T")[0] };
    } catch (e) {
        // ytdown fail → vgasoft fallback
    }

    // ── Fallback: vgasoft ─────────────────────────────────────────────────────
    const data = await downloadYoutube(ytUrl);
    if (data.error || !data.result?.video) throw new Error(data.message || "Không lấy được dữ liệu audio (vgasoft).");

    const v = data.result.video;
    const music = v.music || [];
    const best = music.slice().sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
    if (!best?.url) throw new Error("vgasoft: không có stream audio.");

    await _dlStream(best.url, outputPath);
    const size = fs.existsSync(outputPath) ? fs.statSync(outputPath).size : 0;
    if (size < 10000) throw new Error(`Audio quá nhỏ (${size} bytes).`);

    const thumb = v.cover || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
    return { title: v.content, author: v.author || "YouTube", thumbnail: thumb, thumb,
        duration: v.duration || "0:00", views: v.views || "0", date: v.date || new Date().toISOString().split("T")[0] };
}

/**
 * Lấy stream URL (không tải về disk) — dùng vgasoft.
 */
export async function getYoutubeStreamUrl(ytUrl) {
    const data = await downloadYoutube(ytUrl);
    if (data.error || !data.result?.video) throw new Error(data.message || "Không lấy được dữ liệu.");
    const v = data.result.video;
    return {
        videoUrl:  (v.videos || [])[0]?.url || null,
        audioUrl:  (v.music  || [])[0]?.url || null,
        title:     v.content,
        author:    v.author || "YouTube",
        thumbnail: v.cover,
        duration:  v.duration || "0:00",
        views:     v.views || "0",
        date:      v.date  || new Date().toISOString().split("T")[0],
    };
}
