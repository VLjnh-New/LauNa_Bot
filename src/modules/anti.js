import { log, axios, fs, path } from "../globals.js";
import https from "node:https";
import http from "node:http";
import { spawn } from "node:child_process";
import { getFFmpegBin } from "../utils/core/ffmpegHelper.js";
import { nsfwDetector } from "../utils/moderation/nsfwDetector.js";

export const name = "anti-protections";
export const description = "Bảo vệ nhóm: Link, Spam, Photo, Sticker, Tag, Nude, Call + lệnh bật/tắt";
export const alwaysRun = true;

// ─── Regex ───────────────────────────────────────────────────────────────────

const ZALO_GROUP_LINK_REGEX = /zalo\.me\/g\/[a-zA-Z0-9_\-]+/i;
const STICKER_URL_REGEX = /zfcloud\.zdn\.vn.*StickerBy|sticker.*\.webp/i;
const PHOTO_URL_REGEX = /https?:\/\/[^\s]+(\.jpg|\.jpeg|\.png|\.webp|\.gif)(\?[^\s]*)?/i;
const ZALO_PHOTO_URL_REGEX = /https?:\/\/(photo|cover|thumb|avatar|zalo)[^\s]*\.(zdn\.vn|cloudfront\.net|zadn\.vn)[^\s]*/i;
// Regex tìm tất cả URL ảnh/video trong văn bản (dùng cho anti-nude link check)
const ALL_HTTP_URL_REGEX = /https?:\/\/[^\s<>"']+/gi;
// Regex lọc audio — bỏ qua không check NSFW
const AUDIO_URL_SKIP_REGEX = /\.(aac|mp3|m4a|ogg|wav|flac|opus|wma|amr)(\?.*)?$/i;
const IMAGE_LINK_EXT_REGEX = /\.(jpg|jpeg|png|webp|gif|bmp|avif)(\?[^\s]*)?$/i;

// ─── NSFW Backend ─────────────────────────────────────────────────────────────

const NSFW_THRESHOLD     = 0.15;
const NSFW_BACKEND_LABEL = "OpenRouter Gemma-3";

// Phát hiện MP4/video qua magic bytes: ftyp box tại offset 4
function _isMp4Buffer(buf) {
    if (!buf || buf.length < 8) return false;
    const ftyp = buf.slice(4, 8).toString("ascii");
    return ftyp === "ftyp" || ftyp === "moov" || ftyp === "mdat";
}

// Nếu URL Zalo là JXL (có /jxl/ hoặc .jxl), thử đổi sang JPG
function _tryJxlToJpgUrl(url) {
    if (!url) return null;
    if (url.includes("/jxl/") || url.endsWith(".jxl")) {
        return url.replace("/jxl/", "/jpg/").replace(/\.jxl(\?.*)?$/, ".jpg$1");
    }
    return null;
}

// Phát hiện JXL qua magic bytes
function _isJxlBuffer(buf) {
    if (!buf || buf.length < 4) return false;
    // JXL container: bytes 4-7 = "jXL "
    if (buf.length >= 8) {
        const boxType = buf.slice(4, 8).toString("ascii");
        if (boxType === "jXL ") return true;
    }
    // JXL codestream: bắt đầu bằng FF 0A
    if (buf[0] === 0xFF && buf[1] === 0x0A) return true;
    return false;
}

// Convert buffer (JXL/WebP/format lạ) → JPEG bằng ffmpeg
async function _toJpegBuffer(buf) {
    const cacheDir = path.join(process.cwd(), ".cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const ts      = Date.now() + Math.random().toString(36).slice(2);
    const inPath  = path.join(cacheDir, `conv_in_${ts}`);
    const outPath = path.join(cacheDir, `conv_out_${ts}.jpg`);
    try {
        fs.writeFileSync(inPath, buf);
        await new Promise((resolve, reject) => {
            const proc = spawn(getFFmpegBin(), ["-y", "-i", inPath, "-q:v", "2", "-f", "image2", outPath], { stdio: "ignore" });
            const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("ffmpeg conv timeout")); }, 15000);
            proc.on("close", code => {
                clearTimeout(timer);
                if (code === 0 && fs.existsSync(outPath)) resolve();
                else reject(new Error(`ffmpeg conv exit ${code}`));
            });
            proc.on("error", e => { clearTimeout(timer); reject(e); });
        });
        const result = fs.readFileSync(outPath);
        return result;
    } catch {
        return buf; // fallback: trả nguyên nếu không convert được
    } finally {
        try { fs.unlinkSync(inPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
    }
}

// Download ảnh từ Zalo CDN. Nếu URL là JXL → thử JPG trước; nếu vẫn JXL → convert sharp
async function _downloadMedia(url) {
    const doGet = (u) => axios({
        method: "get", url: u,
        responseType: "arraybuffer",
        timeout: 20000,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer":    "https://chat.zalo.me/",
            "Accept":     "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
        },
    });

    // Thử JPG thay thế trước nếu URL là JXL
    const jpgUrl = _tryJxlToJpgUrl(url);
    if (jpgUrl) {
        try {
            const r = await doGet(jpgUrl);
            const buf = Buffer.from(r.data);
            if (!_isMp4Buffer(buf) && buf.length > 100) return buf;
        } catch {}
    }

    const res = await doGet(url);
    const buf = Buffer.from(res.data);

    // Nếu là JXL → convert sang JPEG trước khi gửi lên backend
    if (_isJxlBuffer(buf)) {
        return await _toJpegBuffer(buf);
    }

    return buf;
}

// ─── Kiểm tra NSFW từ URL ─────────────────────────────────────────────────────

async function checkNsfw(mediaUrl, api) {
    if (!mediaUrl) return false;
    try {
        // 1. Sightengine URL check (nhanh, không cần tải ảnh)
        const result = await nsfwDetector.checkUrl(mediaUrl, api);
        if (result !== null) return (result.score || 0) >= NSFW_THRESHOLD;

        // 2. Fallback: tải với Zalo headers → convert nếu cần → upload buffer
        const buf = await _downloadMedia(mediaUrl).catch(() => null);
        if (!buf || buf.length < 100) return false;
        const rb = await nsfwDetector.checkBuffer(buf, api);
        if (rb !== null) return (rb.score || 0) >= NSFW_THRESHOLD;
        return false;
    } catch (e) {
        log.warn(`[Anti-Nude] checkNsfw lỗi: ${e.message}`);
        return false;
    }
}

// ─── Lấy URL video thực (không phải thumbnail) ────────────────────────────────

function getVideoActualUrl(data) {
    const c      = _parseContentObj(data?.content);
    const attach = _parseContentObj(data?.attach);
    const extras = [c?.extra, attach?.extra, c, attach].filter(Boolean);
    for (const o of extras) {
        const u = o?.videoUrl || o?.href;
        if (u && typeof u === "string") return u;
    }
    return null;
}

// ─── Trích xuất frame ảnh từ video URL bằng ffmpeg ────────────────────────────

async function extractFrameFromVideo(videoUrl) {
    const cacheDir = path.join(process.cwd(), ".cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

    const ts      = Date.now();
    const outPath = path.join(cacheDir, `frame_${ts}.jpg`);

    // Chạy ffmpeg với inputSrc cho trước (URL hoặc local path)
    const runFfmpeg = (inputSrc, extraInputArgs = []) => new Promise((resolve, reject) => {
        const args = [
            ...extraInputArgs,
            "-i", inputSrc,
            "-vframes", "1",
            "-f", "image2",
            "-q:v", "2",
            "-y", outPath,
        ];
        const proc  = spawn(getFFmpegBin(), args, { stdio: "ignore" });
        const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("ffmpeg timeout")); }, 25000);
        proc.on("close", (code) => {
            clearTimeout(timer);
            if (code === 0 && fs.existsSync(outPath)) resolve();
            else reject(new Error(`ffmpeg exit ${code}`));
        });
        proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    });

    // ── Attempt 1: ffmpeg trực tiếp URL với Zalo headers (tốt cho Zalo CDN) ────
    try {
        await runFfmpeg(videoUrl, [
            "-headers", "Referer: https://chat.zalo.me/\r\nUser-Agent: Mozilla/5.0\r\n",
            "-ss", "1",
        ]);
        const buf = fs.readFileSync(outPath);
        try { fs.unlinkSync(outPath); } catch {}
        return buf;
    } catch {
        // Attempt 1 thất bại, thử tải video về local
    }

    // ── Attempt 2: Tải thông minh — xử lý JSON API / redirect / stream ─────────
    const tmpVideo = path.join(cacheDir, `vid_${ts}.tmp`);

    // Helper: stream URL vào file tạm (tối đa maxBytes)
    const streamToFile = async (srcUrl, destPath, maxBytes = 8 * 1024 * 1024) => {
        const r = await axios.get(srcUrl, {
            responseType: "stream",
            timeout: 30000,
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                "Accept": "video/*,*/*;q=0.8",
                "Referer": (() => { try { return new URL(srcUrl).origin + "/"; } catch { return ""; } })(),
            },
            maxRedirects: 10,
            validateStatus: s => s < 500,
        });
        const ct = (r.headers?.["content-type"] || "").toLowerCase();
        await new Promise((resolve, reject) => {
            const out = fs.createWriteStream(destPath);
            let received = 0;
            r.data.on("data", (chunk) => {
                received += chunk.length;
                out.write(chunk);
                if (received >= maxBytes) { r.data.destroy(); out.end(); }
            });
            r.data.on("end", () => out.end());
            r.data.on("error", (e) => { out.destroy(); reject(e); });
            out.on("finish", resolve);
            out.on("error", reject);
        });
        return ct;
    };

    try {
        // — Bước 1: GET để xem content-type thực sự và resolve URL thật ─────────
        const probeResp = await axios.get(videoUrl, {
            responseType: "arraybuffer",
            timeout: 10000,
            maxContentLength: 300_000, // tối đa 300 KB cho probe
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
                "Accept": "*/*",
            },
            maxRedirects: 10,
            validateStatus: s => s < 500,
        }).catch(e => {
            // maxContentLength exceeded → vẫn OK nếu có partial data
            if (e.response) return e.response;
            throw e;
        });

        const ct2 = (probeResp.headers?.["content-type"] || "").toLowerCase();

        // — Bước 2: Xử lý theo content-type ──────────────────────────────────────
        let realVideoUrl = null;

        if (ct2.startsWith("video/") || ct2.includes("octet-stream")) {
            // Server trả thẳng video bytes → ghi tiếp phần đã tải, rồi stream thêm
            const partial = Buffer.from(probeResp.data || []);
            if (partial.length > 200) {
                fs.writeFileSync(tmpVideo, partial);
                // Thử ffmpeg trên partial buffer ngay (có thể đủ giây đầu)
                try {
                    await runFfmpeg(tmpVideo, ["-ss", "0"]);
                    const buf = fs.readFileSync(outPath);
                    try { fs.unlinkSync(outPath); } catch {}
                    try { fs.unlinkSync(tmpVideo); } catch {}
                    return buf;
                } catch { /* fallthrough → stream đủ */ }
            }
            realVideoUrl = videoUrl;

        } else if (ct2.includes("application/json")) {
            // API trả JSON → parse → tìm URL video trong object
            try {
                const json = JSON.parse(Buffer.from(probeResp.data).toString("utf-8"));
                realVideoUrl = _findVideoUrlInValue(json);
            } catch { /* JSON parse fail */ }

        } else if (ct2.includes("text/html")) {
            // HTML → tìm og:video hoặc <source src=...>
            const html = Buffer.from(probeResp.data).toString("utf-8");
            const ogMatch = html.match(/<meta[^>]+property=["']og:video["'][^>]+content=["']([^"']+\.(?:mp4|mov|m3u8|webm))[^"']*["']/i)
                || html.match(/content=["']([^"']+\.(?:mp4|mov|m3u8|webm))[^"']*["'][^>]+property=["']og:video["']/i)
                || html.match(/<source[^>]+src=["']([^"']+\.(?:mp4|mov|m3u8|webm))[^"']*["']/i);
            if (ogMatch) {
                realVideoUrl = ogMatch[1];
            }

        } else if (ct2.startsWith("image/")) {
            // URL trả về ảnh (không phải video) → trả thẳng buffer làm "frame"
            try { fs.unlinkSync(tmpVideo); } catch {}
            try { fs.unlinkSync(outPath); } catch {}
            let imgBuf = Buffer.from(probeResp.data || []);
            if (imgBuf.length < 500) {
                const fullResp = await axios.get(videoUrl, {
                    responseType: "arraybuffer", timeout: 20000,
                    headers: {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Referer": "https://chat.zalo.me/",
                    },
                    maxRedirects: 5,
                });
                imgBuf = Buffer.from(fullResp.data);
            }
            imgBuf = await _toJpegBuffer(imgBuf);
            return imgBuf;
        }

        // — Bước 3: Nếu tìm được URL video thực → download + ffmpeg ─────────────
        if (realVideoUrl) {
            const ctFile = await streamToFile(realVideoUrl, tmpVideo);
            const stat = fs.statSync(tmpVideo);
            if (stat.size < 200) throw new Error(`File tải về quá nhỏ (${stat.size} bytes)`);
            await runFfmpeg(tmpVideo, ["-ss", "1"]);
            const buf = fs.readFileSync(outPath);
            try { fs.unlinkSync(outPath); } catch {}
            try { fs.unlinkSync(tmpVideo); } catch {}
            return buf;
        }

        throw new Error(`Không tìm được URL video trong response (ct=${ct2.slice(0,40)})`);
    } catch (e2) {
        try { fs.unlinkSync(tmpVideo); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
        throw new Error(`Không thể trích frame: ${e2.message}`);
    }
}

// Đệ quy tìm URL video trong JSON object/array
function _findVideoUrlInValue(val, depth = 0) {
    if (depth > 6) return null;
    if (typeof val === "string") {
        if (/^https?:\/\/.+\.(mp4|mov|avi|mkv|webm|m3u8|flv)(\?[^\s]*)?$/i.test(val)) return val;
        return null;
    }
    if (Array.isArray(val)) {
        for (const item of val) {
            const r = _findVideoUrlInValue(item, depth + 1);
            if (r) return r;
        }
    }
    if (val && typeof val === "object") {
        // Thử các key ưu tiên trước
        for (const key of ["url", "videoUrl", "video_url", "src", "source", "link", "stream", "href", "download", "path", "file"]) {
            if (val[key]) {
                const r = _findVideoUrlInValue(val[key], depth + 1);
                if (r) return r;
            }
        }
        // Rồi quét toàn bộ
        for (const v of Object.values(val)) {
            const r = _findVideoUrlInValue(v, depth + 1);
            if (r) return r;
        }
    }
    return null;
}

// ─── Kiểm tra NSFW từ Buffer (sau khi extract frame video) ───────────────────

async function checkNsfwOnBuffer(buf, api) {
    try {
        if (_isJxlBuffer(buf)) buf = await _toJpegBuffer(buf);
        const result = await nsfwDetector.checkBuffer(buf, api);
        if (result !== null) return result.isNSFW ? result.score : 0;
        return null;
    } catch {
        return null;
    }
}

// ─── Tải video về local temp path (đơn giản, dùng cho multi-frame check) ─────

async function downloadVideoToLocal(videoUrl, maxBytes = 8 * 1024 * 1024) {
    const cacheDir = path.join(process.cwd(), ".cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const tmpPath = path.join(cacheDir, `vid_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);

    const r = await axios.get(videoUrl, {
        responseType: "stream",
        timeout: 30000,
        headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
            "Accept": "video/*,*/*;q=0.8",
            "Referer": "https://chat.zalo.me/",
        },
        maxRedirects: 10,
        validateStatus: s => s < 500,
    });

    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(tmpPath);
        let received = 0;
        r.data.on("data", (chunk) => {
            received += chunk.length;
            out.write(chunk);
            if (received >= maxBytes) { r.data.destroy(); out.end(); }
        });
        r.data.on("end", () => out.end());
        r.data.on("error", (e) => { out.destroy(); reject(e); });
        out.on("finish", resolve);
        out.on("error", reject);
    });

    return tmpPath;
}

// ─── Kiểm tra RAM hiện tại của tiến trình (MB) ────────────────────────────────
function _heapUsedMB() {
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
}

// ─── Kiểm tra NSFW video: thumbnail → Cloudinary frame → local ffmpeg (nhẹ) ──

async function checkNsfwVideo(thumbUrl, videoUrl, { interval = 3 } = {}, api) {
    // 1. Check thumbnail (dùng checkNsfw để có fallback Zalo headers)
    if (thumbUrl) {
        try {
            const isNude = await checkNsfw(thumbUrl, api);
            if (isNude) return 1.0;
        } catch { }
    }

    if (!videoUrl) return null;

    // 2. Cloudinary cắt frame qua web (không cần tải video, không tốn RAM)
    try {
        const cloudBuf = await nsfwDetector.extractFrameFromUrl(videoUrl, [1, 3, 5]);
        if (cloudBuf) {
            const cloudResult = await nsfwDetector.checkBuffer(cloudBuf, api);
            if (cloudResult?.isNSFW) return cloudResult.score;
        }
    } catch (e) {
        log.warn(`[Anti-Nude] 🎬 Cloudinary lỗi: ${e.message}`);
    }

    // 3. Fallback: tải một phần nhỏ video + scan tối đa 5 frame
    const heapMB = _heapUsedMB();
    if (heapMB > 400) return null;

    let localPath = null;
    try {
        localPath = await downloadVideoToLocal(videoUrl);
        const result = await nsfwDetector.checkVideo(localPath, { interval, maxFrames: 5 }, api);
        return result ? result.score : null;
    } catch (e) {
        log.warn(`[Anti-Nude] 🎬 Local video lỗi: ${e.message} — thử ffmpeg frame...`);
        try {
            const frameBuf = await extractFrameFromVideo(videoUrl);
            return await checkNsfwOnBuffer(frameBuf, api);
        } catch (e2) {
            log.warn(`[Anti-Nude] 🎬 ffmpeg frame lỗi: ${e2.message}`);
        }
        return null;
    } finally {
        if (localPath) try { fs.unlinkSync(localPath); } catch {}
    }
}

// ─── Kiểm tra NSFW từ URL — trả về score (0-1) hoặc null nếu không check được ─

async function checkNsfwViaBackend(mediaUrl, api) {
    try {
        const isJxlUrl = /\.jxl(\?|$)/i.test(mediaUrl) || mediaUrl.includes("/jxl/");
        if (isJxlUrl) {
            const buf = await _downloadMedia(mediaUrl);
            const r = await nsfwDetector.checkBuffer(buf, api);
            return r ? r.score : null;
        }
        const r = await nsfwDetector.checkUrl(mediaUrl, api);
        if (r !== null) return r.score;
        const buf = await _downloadMedia(mediaUrl).catch(() => null);
        if (!buf || buf.length < 100) return null;
        const rb = await nsfwDetector.checkBuffer(buf, api);
        return rb ? rb.score : null;
    } catch {
        return null;
    }
}

// ─── Trích URL ảnh từ văn bản (dùng cho anti-nude link check) ────────────────

function extractImageUrlsFromText(text) {
    if (!text || typeof text !== "string") return [];
    const matches = [];
    let m;
    const re = new RegExp(ALL_HTTP_URL_REGEX.source, "gi");
    while ((m = re.exec(text)) !== null) {
        const url = m[0].replace(/[.,!?)>]+$/, ""); // bỏ dấu câu cuối
        if (IMAGE_LINK_EXT_REGEX.test(url) || ZALO_PHOTO_URL_REGEX.test(url)) {
            matches.push(url);
        }
    }
    return [...new Set(matches)]; // loại trùng
}

// Regex nhanh để nhận dạng URL video theo đuôi file
const VIDEO_LINK_EXT_REGEX = /\.(mp4|mov|avi|mkv|webm|flv|m4v|3gp)(\?[^\s]*)?$/i;

/**
 * Trích toàn bộ URL từ text, trả về mảng { url, hint: "image"|"video"|"unknown" }.
 * Giới hạn tối đa maxUrls phần tử (mặc định 5).
 */
function extractAllUrlsFromText(text, maxUrls = 5) {
    if (!text || typeof text !== "string") return [];
    const seen = new Set();
    const result = [];
    const re = new RegExp(ALL_HTTP_URL_REGEX.source, "gi");
    let m;
    while ((m = re.exec(text)) !== null && result.length < maxUrls) {
        const url = m[0].replace(/[.,!?)>]+$/, "");
        if (seen.has(url)) continue;
        seen.add(url);
        let hint = "unknown";
        if (IMAGE_LINK_EXT_REGEX.test(url) || ZALO_PHOTO_URL_REGEX.test(url)) hint = "image";
        else if (VIDEO_LINK_EXT_REGEX.test(url)) hint = "video";
        result.push({ url, hint });
    }
    return result;
}

/**
 * HEAD request để xác định loại nội dung thực sự (image/video/other).
 * Trả về "image" | "video" | "unknown".
 * Timeout ngắn (4 s) để không làm chậm bot.
 */
async function probeUrlContentType(url) {
    try {
        const resp = await axios.head(url, {
            timeout: 4000,
            maxRedirects: 5,
            validateStatus: s => s < 500,
            headers: { "User-Agent": "Mozilla/5.0" },
        });
        const ct = (resp.headers?.["content-type"] || "").toLowerCase();
        if (ct.startsWith("image/")) return "image";
        if (ct.startsWith("video/") || ct.includes("octet-stream")) return "video";
        return "unknown";
    } catch {
        return "unknown";
    }
}

// ─── Phát hiện loại media ─────────────────────────────────────────────────────

function isSticker(data, content) {
    if (data.stickerId || data.sticker_id) return true;
    if (data.msgType === "chat.sticker" || data.msgType === 36 || data.msgType === "36") return true;
    if (typeof data.msgType === "string" && data.msgType.includes("sticker")) return true;
    if (typeof content === "string" && (content === "[STICKER]" || STICKER_URL_REGEX.test(content))) return true;
    const sc = _parseContentObj(data?.content);
    if (sc && typeof sc === "object") {
        if ((sc.id || sc.stickerId) && (sc.catId || sc.cateId || sc.categoryId)) return true;
    }
    return false;
}

// Nhận diện URL thuộc CDN video Zalo (video-stal-*.dlmd.me, video.zadn.vn, v.v.)
function isVideoCdnUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
        const host = new URL(url).hostname.toLowerCase();
        if (/^video[-.]/.test(host)) return true;
        if (host.includes("dlmd.me") && host.startsWith("video")) return true;
        if (/\.(mp4|mov|avi|mkv|webm|flv|m4v|3gp)(\?|$)/i.test(url)) return true;
    } catch {}
    return false;
}

function isVideo(data, content) {
    if (data.type === "video") return true;
    if (data.msgType === "chat.video") return true;
    if (typeof data.msgType === "string" && data.msgType.includes("video")) return true;
    if (typeof content === "string" && /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(content)) return true;
    if (typeof content === "string" && isVideoCdnUrl(content)) return true;
    if (data?.content && typeof data.content === "object") {
        const c = data.content;
        // duration tồn tại → video
        if (c.duration !== undefined) return true;
        // Content chứa URL file mp4/mov/mkv hoặc CDN video
        const urlFields = [c.url, c.hdUrl, c.normalUrl, c.href, c?.extra?.url, c?.extra?.hdUrl];
        for (const u of urlFields) {
            if (typeof u === "string" && (/\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(u) || isVideoCdnUrl(u))) return true;
        }
    }
    // Kiểm tra các trường attach/media nếu có
    if (data?.attach && typeof data.attach === "object") {
        if (data.attach.duration !== undefined) return true;
    }
    return false;
}

function isPhoto(data, content) {
    if (isSticker(data, content)) return false;
    if (isVideo(data, content)) return false;
    if (data.mediaType === 1 || data.type === "photo"
        || data.msgType === "chat.photo"
        || data.msgType === 2 || data.msgType === "2"
        || data.msgType === 32 || data.msgType === "32") return true;
    if (typeof data.msgType === "string" && data.msgType.includes("photo")) return true;
    if (typeof content === "string" && content.startsWith("http")) {
        if (ZALO_PHOTO_URL_REGEX.test(content) || PHOTO_URL_REGEX.test(content)) return true;
    }
    const parsedContent = _parseContentObj(data?.content);
    if (parsedContent && typeof parsedContent === "object") {
        const c = parsedContent;
        if (c.hdUrl || c.url || c.normalUrl || c.thumbUrl || c?.extra?.hdUrl || c?.extra?.url) return true;
    }
    return false;
}

function getPhotoUrl(data, content) {
    const c = _parseContentObj(data?.content);
    if (c && typeof c === "object") {
        const extra = c?.extra || {};
        const url = extra?.hdUrl || extra?.url || extra?.normalUrl || extra?.thumbUrl
            || c?.href || c?.hdUrl || c?.url || c?.normalUrl || c?.thumbUrl || null;
        if (url) return url;
    }
    if (typeof data?.content === "string" && data.content.startsWith("http")) return data.content;
    if (typeof content === "string" && content.startsWith("http")) return content;
    return null;
}

function _parseContentObj(raw) {
    if (!raw) return null;
    if (typeof raw === "object") return raw;
    if (typeof raw === "string") {
        try { return JSON.parse(raw); } catch { return null; }
    }
    return null;
}

function getVideoThumbnailUrl(data) {
    // Kiểm tra trực tiếp trên object (quote thường có thumbUrl/thumb ở top-level)
    if (data?.thumbUrl) return data.thumbUrl;
    if (data?.thumb)    return data.thumb;

    const c      = _parseContentObj(data?.content);
    const attach = _parseContentObj(data?.attach);
    if (c && typeof c === "object") {
        const extra = c.extra || {};
        const url = extra.thumbUrl || extra.thumb || c.thumbUrl || c.thumb || c.thumbnail || null;
        if (url) return url;
    }
    if (attach && typeof attach === "object") {
        const extra = attach.extra || {};
        const url = extra.thumbUrl || extra.thumb || attach.thumbUrl || attach.thumb || null;
        if (url) return url;
    }
    return null;
}

// Kiểm tra URL có phải Zalo video CDN không
function _isVideoCdnUrl(url) {
    if (!url) return false;
    return url.includes("video-stal") || url.includes("dlmd.me") || /\.(mp4|mov|avi|mkv|webm)(\?|$)/i.test(url);
}

// ─── Phát hiện cuộc gọi Zalo ─────────────────────────────────────────────────

function isCall(data) {
    const msgType = String(data?.msgType || "").toLowerCase();
    if (msgType.includes("call")) {
        if (ANTICALL_DEBUG) log.info(`[AntiCall-DEBUG] isCall=true via msgType="${data?.msgType}"`);
        return true;
    }
    // Kiểm tra top-level data
    if (data?.callId !== undefined || data?.call_id !== undefined) {
        if (ANTICALL_DEBUG) log.info(`[AntiCall-DEBUG] isCall=true via top-level callId="${data?.callId ?? data?.call_id}"`);
        return true;
    }
    if (data?.callType !== undefined || data?.call_type !== undefined) {
        if (ANTICALL_DEBUG) log.info(`[AntiCall-DEBUG] isCall=true via top-level callType="${data?.callType ?? data?.call_type}"`);
        return true;
    }
    // Kiểm tra trong content
    const c = _parseContentObj(data?.content);
    if (c && typeof c === "object") {
        if (c.callType !== undefined || c.callId !== undefined) {
            if (ANTICALL_DEBUG) log.info(`[AntiCall-DEBUG] isCall=true via content.callId/callType`);
            return true;
        }
        const act = String(c.action || c.act || "").toLowerCase();
        if (act.includes("call")) {
            if (ANTICALL_DEBUG) log.info(`[AntiCall-DEBUG] isCall=true via content.action="${act}"`);
            return true;
        }
        const desc = String(c.describe || c.content || "").toLowerCase();
        if (desc.includes("cuộc gọi") || desc.includes("gọi video") || desc.includes("gọi thoại")) {
            if (ANTICALL_DEBUG) log.info(`[AntiCall-DEBUG] isCall=true via content text description`);
            return true;
        }
    }
    // Kiểm tra trong attach
    const a = _parseContentObj(data?.attach);
    if (a && typeof a === "object") {
        if (a.callType !== undefined || a.callId !== undefined) {
            if (ANTICALL_DEBUG) log.info(`[AntiCall-DEBUG] isCall=true via attach.callId/callType`);
            return true;
        }
    }
    return false;
}

/**
 * Trích xuất callId/sessionKey từ data của call event
 * Để dùng với API reject call
 */
function extractCallMeta(data) {
    const c = _parseContentObj(data?.content);
    const a = _parseContentObj(data?.attach);
    const meta = {
        callId:     data?.callId     || data?.call_id     || c?.callId     || a?.callId     || c?.call_id     || a?.call_id     || null,
        sessionKey: data?.sessionKey || data?.session_key || c?.sessionKey || a?.sessionKey || c?.session_key || a?.session_key || null,
        callType:   data?.callType   || data?.call_type   || c?.callType   || a?.callType   || c?.call_type   || a?.call_type   || null,
        convKey:    data?.convKey    || data?.conv_key    || c?.convKey    || a?.convKey    || c?.conv_key    || a?.conv_key    || null,
    };

    if (ANTICALL_DEBUG) {
        const fullRaw = { msgType: data?.msgType, fromId: data?.fromId, toId: data?.toId, content: data?.content, attach: data?.attach, params: data?.params, extra: data?.extra };
        const rawStr = JSON.stringify(fullRaw, null, 2);
        const chunkSize = 1500;
        log.info(`[AntiCall-DEBUG] ══ CALL EVENT DETECTED ══ meta=${JSON.stringify(meta)}`);
        for (let i = 0; i < rawStr.length; i += chunkSize) {
            log.info(`[AntiCall-DEBUG] RAW[${Math.floor(i / chunkSize)}]: ${rawStr.slice(i, i + chunkSize)}`);
        }
        if (!meta.callId) {
            log.warn("[AntiCall-DEBUG] ⚠️  callId=null — kiểm tra lại cấu trúc data bên trên để tìm field callId đúng.");
            log.warn(`[AntiCall-DEBUG] Top-level keys: ${Object.keys(data || {}).join(", ")}`);
        }
    }
    return meta;
}

function getStickerIdFromData(data) {
    if (data?.stickerId) return String(data.stickerId);
    if (data?.sticker_id) return String(data.sticker_id);
    const c = _parseContentObj(data?.content);
    if (c) return String(c.id || c.stickerId || c.stickerID || "") || null;
    const a = _parseContentObj(data?.attach);
    if (a) return String(a.id || a.stickerId || a.stickerID || "") || null;
    return null;
}

// Lấy URL ảnh sticker trực tiếp từ dữ liệu tin nhắn (không cần gọi API)
function getStickerUrlFromData(data) {
    const fields = ["animationImgUrl", "staticImgUrl", "hdUrl", "oriUrl", "thumbUrl", "thumb", "url", "imageUrl", "spriteUrl"];
    // Thử top-level
    for (const f of fields) {
        if (data?.[f] && typeof data[f] === "string") return data[f];
    }
    // Thử trường webp (custom sticker qua photo_url): là JSON string { url, width, height }
    if (data?.webp) {
        try {
            const webp = typeof data.webp === "string" ? JSON.parse(data.webp) : data.webp;
            if (webp?.url && typeof webp.url === "string") return webp.url;
        } catch {}
    }
    // Thử content object
    const c = _parseContentObj(data?.content);
    if (c && typeof c === "object") {
        for (const f of fields) {
            if (c[f] && typeof c[f] === "string") return c[f];
        }
        // Thử webp lồng trong content
        if (c.webp) {
            try {
                const webp = typeof c.webp === "string" ? JSON.parse(c.webp) : c.webp;
                if (webp?.url && typeof webp.url === "string") return webp.url;
            } catch {}
        }
        const extra = c.extra || {};
        for (const f of fields) {
            if (extra[f] && typeof extra[f] === "string") return extra[f];
        }
    }
    // Thử attach object
    const a = _parseContentObj(data?.attach);
    if (a && typeof a === "object") {
        for (const f of fields) {
            if (a[f] && typeof a[f] === "string") return a[f];
        }
        if (a.webp) {
            try {
                const webp = typeof a.webp === "string" ? JSON.parse(a.webp) : a.webp;
                if (webp?.url && typeof webp.url === "string") return webp.url;
            } catch {}
        }
    }
    return null;
}

// ─── Spam tracker ─────────────────────────────────────────────────────────────

const spamData = new Map();
const kickHistoryMap = new Map(); // per-thread: threadId → number[]
const MSG_LIMIT = 7;
const TIME_LIMIT = 5000;
const MAX_KICKS_PER_MIN = 5;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getDisplayName(api, uid) {
    try {
        const info = await api.getUserInfo(uid);
        const u = info?.[uid] || info?.[String(uid)] || info;
        return u?.displayName || u?.zaloName || u?.name || String(uid || "Thành viên");
    } catch { return String(uid || "Thành viên"); }
}

async function kickUser(api, threadId, senderId) {
    await api.removeUserFromGroup(String(threadId), [senderId]);
}

async function handleDeleteAndReport(ctx, type, count) {
    const { api, message, threadId, threadType, senderId } = ctx;
    const config = protectionManager.CONFIG[type];
    const msgId = message.data.globalMsgId || message.data.msgId;
    const cliMsgId = message.data.cliMsgId;
    if (msgId) {
        try {
            await api.deleteMessage({
                msgId: String(msgId), cliMsgId: cliMsgId ? String(cliMsgId) : String(Date.now()), ownerId: senderId
            }, threadId, threadType);
        } catch (e) {
            const code = e.code ?? e.errorCode ?? 'N/A';
            // code 112 = không có quyền hoặc tin đã bị xóa — chỉ log warn
            if (code === 112 || code === '112' || code === 2 || code === '2') {
                log.warn(`[Anti-${type}] Không thể xóa tin (msgId=${msgId}, code=${code}) — bỏ qua.`);
            } else {
                log.warn(`[Anti-${type}] Lỗi xóa tin (msgId=${msgId}, code=${code}): ${e.message}`);
            }
        }
    } else {
        log.warn(`[Anti-${type}] Không tìm được msgId để xóa.`);
    }

    const name = await getDisplayName(api, senderId);
    const headers = {
        photo: "📷 ANTI-PHOTO", video: "🎬 ANTI-VIDEO", sticker: "🎨 ANTI-STICKER",
        tag: "🏷️ ANTI-TAG", link: "🔗 ANTI-LINK", spam: "⚡ ANTI-SPAM", nude: "🔞 ANTI-NUDE",
    };
    const reasons = {
        photo: "không cho gửi ảnh", video: "không cho gửi video", sticker: "không cho gửi sticker",
        tag: "không được tag @Tất cả/spam tag", link: "không được gửi link nhóm Zalo",
        spam: "không cho phép gửi tin nhắn dồn dập", nude: "không cho phép gửi ảnh/video nhạy cảm (18+)",
        call: "không được gọi điện/gây nhiễu trong nhóm"
    };
    const headerLabel = headers[type] || `ANTI-${type.toUpperCase()}`;
    const headerLine = `➜ [ ${headerLabel} ]`;
    const nameStart = headerLine.length + 1;
    let msg = "";
    if (type === "link_del") {
        msg = `➜ [ 🔗 ANTI-LINK ]\n${name}\n➜ 🚫 Link nhóm Zalo hổng có tốt cho nhóm mình đâu. Bé gỡ giúp rồi nhé, đừng gửi nữa nha! 🌸`;
    } else if (config && count >= config.kick) {
        try {
            await kickUser(api, threadId, senderId);
            msg = `${headerLine}\n${name}\n➜ 📣 Đã thẳng tay tiễn bạn rời khỏi nhóm do cố ý vi phạm quá nhiều lần (${count}/${config.kick}). Tạm biệt nhé! 👋`;
            protectionManager.resetViolation(threadId, senderId, type);
        } catch {
            msg = `${headerLine}\n${name}\n➜ ⚠️ Định "kick" bạn rồi nhưng mà bot hổng có đủ quyền nè. Ad ơi xử lý giúp bé với! 🥺`;
            protectionManager.resetViolation(threadId, senderId, type);
        }
    } else if (config && count === config.warn) {
        msg = `${headerLine}\n${name}\n➜ 😡 CẢNH BÁO CUỐI CÙNG! Bạn đã vi phạm ${count} lần rồi đó. Thêm 1 lần nữa là "bay màu" khỏi nhóm luôn nhé! 💣`;
    } else if (config && count === 1) {
        msg = `${headerLine}\n${name}\n➜ 🎀 Nhẹ nhàng nhắc nhở: Nhóm mình ${reasons[type] || "đang có bảo vệ"}. Đừng tái phạm nha, thương lắm nè! ✨`;
    }
    if (msg) {
        await api.sendMessage({
            msg,
            styles: [
                { start: 2, len: headerLabel.length + 4, st: "b" },
                { start: 2, len: headerLabel.length + 4, st: "c_db342e" },
                { start: nameStart, len: name.length, st: "b" }
            ]
        }, threadId, threadType);
    }
}

// ─── Lệnh bật/tắt ────────────────────────────────────────────────────────────

const menuSessions = new Map();

const PROTECTION_TYPES = [
    { id: "1", type: "link",    name: "Anti-Link (Chặn link nhóm)",    emoji: "🔗" },
    { id: "2", type: "spam",    name: "Anti-Spam (Chặn tin dồn dập)",  emoji: "⚡" },
    { id: "3", type: "photo",   name: "Anti-Photo (Chặn gửi ảnh)",     emoji: "📸" },
    { id: "4", type: "sticker", name: "Anti-Sticker (Chặn sticker)",   emoji: "🎨" },
    { id: "5", type: "tag",     name: "Anti-Tag (Chặn tag @all)",       emoji: "🔔" },
    { id: "6", type: "undo",    name: "Anti-Undo (Chống thu hồi tin)", emoji: "🔒" },
    { id: "7", type: "nude",    name: "Anti-Nude (Chặn ảnh 18+)",      emoji: "🔞" }
];

function buildHeaderStyles(header, senderName) {
    const prefixLen = 2;
    const headerLen = header.length;
    const senderStart = prefixLen + headerLen + 1;
    return [
        { start: prefixLen, len: headerLen, st: "b" },
        { start: prefixLen, len: headerLen, st: "c_db342e" },
        { start: senderStart, len: senderName.length, st: "b" }
    ];
}

async function toggleProtection(api, threadId, threadType, senderId, items) {
    const senderName = await getDisplayName(api, senderId);
    const results = [];
    for (const item of items) {
        const nextState = !protectionManager.isEnabled(threadId, item.type);
        protectionManager.setEnabled(threadId, item.type, nextState);
        results.push(`${item.emoji} ${item.name}: ${nextState ? "BẬT ✅" : "TẮT ❌"}`);
    }
    const HEADER = "[ SETTINGS PROTECTION ]";
    const msg = `➜ ${HEADER}\n${senderName}\n─────────────────\n${results.join("\n")}\n─────────────────\n✨ Đã cập nhật trạng thái mới cho bạn nè!`;
    await api.sendMessage({ msg, styles: buildHeaderStyles(HEADER, senderName) }, threadId, threadType);
}

async function handleShortcut(ctx, type) {
    const { api, args, threadId, threadType, senderId, isGroup, adminIds } = ctx;
    if (!isGroup) return api.sendMessage({ msg: "⚠️ Bé chỉ hỗ trợ bảo vệ trong nhóm thôi nha!" }, threadId, threadType);
    const senderName = await getDisplayName(api, senderId);
    if (!adminIds.includes(String(senderId))) {
        return api.sendMessage({
            msg: `${senderName}\n➜ ⚠️ Lệnh này chỉ dành cho Admin Bot hoặc QTV thôi nè! 🌸`,
            styles: [{ start: 0, len: senderName.length, st: "b" }]
        }, threadId, threadType);
    }
    const target = PROTECTION_TYPES.find(p => p.type === type);
    if (!target) return;
    const action = (args[0] || "").toLowerCase();
    let newState;
    if (action === "on") newState = true;
    else if (action === "off") newState = false;
    else newState = !protectionManager.isEnabled(threadId, type);
    protectionManager.setEnabled(threadId, type, newState);
    const stateText = newState ? "BẬT ✅" : "TẮT ❌";
    const HEADER = "[ PROTECTION ]";
    const msg = `➜ ${HEADER}\n${senderName}\n➜ ${target.emoji} ${target.name} đã được ${stateText}! ✨`;
    return api.sendMessage({ msg, styles: buildHeaderStyles(HEADER, senderName) }, threadId, threadType);
}


async function _handleNsfw(ctx, subArgs) {
    const { api, threadId, threadType, message } = ctx;
    const data  = message?.data || {};
    const quote = data?.quote;

    const firstArg = (subArgs[0] || "").trim();
    if (firstArg.startsWith("http://") || firstArg.startsWith("https://")) {
        const directUrl = firstArg;
        await api.sendMessage({ msg: "🔍 Đang phân tích link..." }, threadId, threadType);
        try {
            let score = await checkNsfwViaBackend(directUrl, api);
            if (score === null) {
                await api.sendMessage({ msg: "🎬 Link trỏ đến video, đang trích khung hình..." }, threadId, threadType);
                try {
                    const frameBuf = await extractFrameFromVideo(directUrl);
                    score = await checkNsfwOnBuffer(frameBuf, api);
                } catch (fe) {
                    return api.sendMessage({ msg: `⚠️ Không thể phân tích video: ${fe.message}` }, threadId, threadType);
                }
            }
            if (score === null) return api.sendMessage({ msg: "⚠️ Không thể phân tích nội dung này." }, threadId, threadType);
            const percent = (score * 100).toFixed(1);
            const isNsfw  = score >= NSFW_THRESHOLD;
            const verdict = isNsfw ? "🔞 NSFW — Nội dung không phù hợp!" : "✅ SAFE — Nội dung an toàn";
            const bar     = "█".repeat(Math.round(score * 10)) + "░".repeat(10 - Math.round(score * 10));
            return api.sendMessage({
                msg: [
                    `[ 🔍 NSFW DETECTOR ]`,
                    `─────────────────`,
                    verdict,
                    `📊 Điểm NSFW: ${percent}%`,
                    `[${bar}] ${percent}%`,
                    `🧠 Backend: ${NSFW_BACKEND_LABEL}`,
                    `─────────────────`,
                    `🔗 Link: ${directUrl.slice(0, 80)}${directUrl.length > 80 ? "..." : ""}`,
                    `Ngưỡng phát hiện: ${(NSFW_THRESHOLD * 100).toFixed(0)}%`
                ].join("\n")
            }, threadId, threadType);
        } catch (e) {
            return api.sendMessage({ msg: `⚠️ Lỗi khi kiểm tra link: ${e.message}` }, threadId, threadType);
        }
    }

    async function resolveMedia(d) {
        if (!d) return null;
        const rawContent = d.content;
        const msgType    = String(d.msgType || d.type || "");
        if (msgType.includes("voice") || d.type === "voice") return { kind: "voice" };
        if (isVideo(d, rawContent)) {
            const url      = getVideoThumbnailUrl(d);
            const videoUrl = getVideoActualUrl(d);
            return { kind: "video", url, videoUrl };
        }
        if (isSticker(d, rawContent)) {
            // Thử lấy URL trực tiếp từ dữ liệu trước (bắt cả custom sticker)
            const directUrl = getStickerUrlFromData(d);
            if (directUrl) return { kind: "sticker", url: directUrl };
            // Fallback: sticker thư viện → gọi API lấy chi tiết
            const stickerId = getStickerIdFromData(d);
            if (stickerId) {
                try {
                    const details = await api.getStickersDetail([stickerId]);
                    const s = Array.isArray(details) ? details[0] : details;
                    const url = s?.thumbUrl || s?.thumb || s?.url || s?.imageUrl || s?.staticImgUrl || null;
                    return { kind: "sticker", url };
                } catch { return { kind: "sticker", url: null }; }
            }
            return { kind: "sticker", url: null };
        }
        if (isPhoto(d, rawContent)) {
            const url = getPhotoUrl(d, rawContent);
            return { kind: "photo", url };
        }
        const att = _parseContentObj(d.attach);
        if (att) {
            const url = att.hdUrl || att.href || att.url || att.normalUrl || att.thumbUrl || null;
            if (url) return { kind: isVideoCdnUrl(url) ? "video" : "photo", url };
        }
        const cnt = _parseContentObj(d.content);
        if (cnt && typeof cnt === "object") {
            const extra = cnt.extra || {};
            const url = extra.hdUrl || extra.url || cnt.hdUrl || cnt.normalUrl || cnt.thumbUrl || null;
            if (url) return { kind: isVideoCdnUrl(url) ? "video" : "photo", url };
        }
        return null;
    }

    const media = (quote ? await resolveMedia(quote) : null) || await resolveMedia(data);

    if (!media) {
        return api.sendMessage({
            msg: "📌 Hãy reply một ảnh / video / sticker rồi dùng !anti nsfw để kiểm tra nhé!"
        }, threadId, threadType);
    }
    if (media.kind === "voice") {
        return api.sendMessage({ msg: "🎤 Tin nhắn thoại không thể kiểm tra nội dung NSFW!" }, threadId, threadType);
    }
    if (!media.url) {
        if ((media.kind === "video" || media.kind === "photo") && media.videoUrl) {
            media.url = media.videoUrl;
        } else {
            const typeLabel = media.kind === "video" ? "video (không tìm được thumbnail)"
                : media.kind === "sticker" ? "sticker (không lấy được URL)" : "ảnh";
            return api.sendMessage({
                msg: `⚠️ Không tìm được URL của ${typeLabel}.\nThử reply trực tiếp vào tin nhắn rồi dùng !anti nsfw nhé!`
            }, threadId, threadType);
        }
    }

    const kindLabel = media.kind === "video" ? "🎬 Đang phân tích video..."
        : media.kind === "sticker" ? "🎨 Đang phân tích sticker..."
        : "🔍 Đang phân tích ảnh...";
    await api.sendMessage({ msg: kindLabel }, threadId, threadType);

    try {
        let score = await checkNsfwViaBackend(media.url, api);
        let videoNote = "";
        if (score === null && media.kind === "video") {
            const vidSrc = media.videoUrl || media.url;
            await api.sendMessage({ msg: "🎬 Đang trích khung hình từ video..." }, threadId, threadType);
            try {
                const frameBuf = await extractFrameFromVideo(vidSrc);
                score     = await checkNsfwOnBuffer(frameBuf, api);
                videoNote = "\n🎬 Phân tích qua frame trích từ video";
            } catch (fe) {
                return api.sendMessage({
                    msg: [`[ 🔍 NSFW DETECTOR ]`, `─────────────────`, `⚠️ Không thể trích khung hình video.`, `─────────────────`, `💡 Thử dùng !anti nsfw <link_thumbnail> nhé!`].join("\n")
                }, threadId, threadType);
            }
        }
        if (score === null) {
            return api.sendMessage({
                msg: [`[ 🔍 NSFW DETECTOR ]`, `─────────────────`, `⚠️ Không thể phân tích nội dung này.`, `─────────────────`, `💡 Ảnh từ Zalo CDN có thể bị chặn. Thử copy link ảnh rồi dùng !anti nsfw <link> nhé!`].join("\n")
            }, threadId, threadType);
        }
        const percent = (score * 100).toFixed(1);
        const isNsfw  = score >= NSFW_THRESHOLD;
        const verdict = isNsfw ? "🔞 NSFW — Nội dung không phù hợp!" : "✅ SAFE — Nội dung an toàn";
        const bar     = "█".repeat(Math.round(score * 10)) + "░".repeat(10 - Math.round(score * 10));
        const mediaNote = videoNote || (media.kind === "video" ? "\n🎬 Đã kiểm tra thumbnail video"
            : media.kind === "sticker" ? "\n🎨 Đã kiểm tra sticker" : "");
        await api.sendMessage({
            msg: [`[ 🔍 NSFW DETECTOR ]`, `─────────────────`, verdict, `📊 Điểm NSFW: ${percent}%`, `[${bar}] ${percent}%`, `🧠 Backend: ${NSFW_BACKEND_LABEL}`, `─────────────────`, `Ngưỡng phát hiện: ${(NSFW_THRESHOLD * 100).toFixed(0)}%` + mediaNote].join("\n")
        }, threadId, threadType);
    } catch (e) {
        await api.sendMessage({ msg: `⚠️ Lỗi khi kiểm tra: ${e.message}` }, threadId, threadType);
    }
}

export const commands = {
    anti: async (ctx) => {
        const { api, args, threadId, threadType, senderId, isGroup, message, adminIds } = ctx;
        if (!isGroup) return api.sendMessage({ msg: "⚠️ Bé chỉ hỗ trợ bảo vệ trong nhóm thôi nha!" }, threadId, threadType);
        const senderName = await getDisplayName(api, senderId);
        if (!adminIds.includes(String(senderId))) {
            return api.sendMessage({
                msg: `${senderName}\n➜ ⚠️ Menu này chỉ dành cho Admin Bot hoặc QTV thôi nè! 🌸`,
                styles: [{ start: 0, len: senderName.length, st: "b" }]
            }, threadId, threadType);
        }
        if (args.length > 0) {
            const firstArg = args[0].toLowerCase();


            // !anti nsfw [url] | reply ảnh/video
            if (firstArg === "nsfw") {
                return _handleNsfw(ctx, args.slice(1));
            }

            // !anti <type> [on/off] — toggle các loại bảo vệ
            const target = PROTECTION_TYPES.find(p => p.type === firstArg || p.id === firstArg);
            if (target) {
                const action = (args[1] || "").toLowerCase();
                const newState = (action === "on") ? true : (action === "off") ? false : !protectionManager.isEnabled(threadId, target.type);
                protectionManager.setEnabled(threadId, target.type, newState);
                const HEADER = "[ PROTECTION ]";
                const msg = `➜ ${HEADER}\n${senderName}\n➜ ${target.emoji} ${target.name} đã được ${newState ? "BẬT ✅" : "TẮT ❌"}! ✨`;
                return api.sendMessage({ msg, styles: buildHeaderStyles(HEADER, senderName) }, threadId, threadType);
            }
        }

        // Hiển thị menu
        const HEADER = "🛡️ [ SETTINGS PROTECTION ]";
        let help = `➜ ${HEADER}\n${senderName}\n─────────────────\n`;
        PROTECTION_TYPES.forEach(p => {
            const status = protectionManager.isEnabled(threadId, p.type) ? "ON ✅" : "OFF ❌";
            help += `${p.id}. ${p.emoji} ${p.name} [${status}]\n`;
        });
        help += `─────────────────\n`;
        help += `💡 Dùng: !anti <tên/số> [on/off]\n`;
        help += `🔍 Kiểm tra NSFW: !anti nsfw [url]\n`;
        help += `─────────────────\n`;
        help += `💡 Hoặc reply số (ví dụ: 1 hoặc 137) để bật/tắt nhanh! 🎀`;
        await api.sendMessage({
            msg: help,
            quote: message?.data,
            styles: [
                { start: 2, len: HEADER.length, st: "b" },
                { start: 2, len: HEADER.length, st: "c_db342e" },
                { start: 2 + HEADER.length + 1, len: senderName.length, st: "b" }
            ]
        }, threadId, threadType);
        const key = `${threadId}_${senderId}`;
        const sessionTime = Date.now();
        menuSessions.set(key, { time: sessionTime });
        setTimeout(() => {
            const current = menuSessions.get(key);
            if (current && current.time === sessionTime) menuSessions.delete(key);
        }, 60000);
    },
};

// ─── AntiUndo helpers ─────────────────────────────────────────────────────────

function _auDownloadFile(url, destPath) {
    return new Promise((resolve) => {
        try {
            const proto = url.startsWith("https") ? https : http;
            const file = fs.createWriteStream(destPath);
            proto.get(url, (res) => {
                if (res.statusCode !== 200) { file.close(); resolve(null); return; }
                res.pipe(file);
                file.on("finish", () => { file.close(); resolve(destPath); });
            }).on("error", () => { file.close(); resolve(null); });
        } catch { resolve(null); }
    });
}

function _auParseParams(params) {
    if (!params) return {};
    if (typeof params === "object") return params;
    try { return JSON.parse(params); } catch { }
    try { return Object.fromEntries(new URLSearchParams(params)); } catch { }
    return {};
}

function _auBuildNotify(label, authorName, _authorId, extra = "") {
    const safeName = (authorName && authorName !== "undefined" && authorName !== "0")
        ? authorName : "Ai đó";
    const header = `UNDO ${label}`;
    const authorTag = `@${safeName}`;
    const line1 = `➜ [ ${header} ]`;
    const line2 = `${authorTag} vừa thu hồi một ${label.toLowerCase()}.`;
    const text = extra ? `${line1}\n${line2}\n${extra}` : `${line1}\n${line2}`;

    const headerStart = 2;
    const nameStart = line1.length + 1;
    const styles = [
        { start: headerStart, len: header.length + 4, st: "b,c_db342e,f_18" },
        { start: nameStart, len: authorTag.length, st: "b" }
    ];
    return { text, styles, mentions: [] };
}

function _auCacheGet(key) {
    if (!key && key !== 0) return null;
    return messageCache.get(key) || messageCache.get(Number(key)) || messageCache.get(String(key)) || null;
}

// ─── AntiUndo handler ─────────────────────────────────────────────────────────

export async function handleUndo(ctx) {
    const { api, threadId, threadType, senderId: authorId, senderName: eventSenderName, msgId, cliMsgId } = ctx;

    if (!protectionManager.isEnabled(threadId, "undo")) return;

    const ownId = api.getOwnId();
    const { adminIds = [] } = ctx;
    if (String(authorId) === String(ownId) || adminIds.includes(String(authorId))) return;

    const cached = (msgId ? _auCacheGet(msgId) : null)
        || (cliMsgId ? _auCacheGet(cliMsgId) : null);

    const safeAuthorId = (authorId && authorId !== "0") ? authorId : "";
    let authorName = (eventSenderName && eventSenderName !== "undefined" && eventSenderName !== "0")
        ? eventSenderName : null;

    if (!cached) {
        log.warn(`[AntiUndo] ❌ Không tìm thấy tin gốc trong cache. msgId=${msgId}, cliMsgId=${cliMsgId}`);
        try {
            if (!authorName) {
                authorName = safeAuthorId ? await getDisplayName(api, safeAuthorId).catch(() => null) : null;
            }
            authorName = authorName || "Ai đó";
            const { text, styles, mentions } = _auBuildNotify("TIN NHẮN", authorName, safeAuthorId,
                "➜ (Không có trong cache - tin nhắn quá cũ hoặc bot chưa thấy)");
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
        } catch (e) {
            log.error(`[AntiUndo] Lỗi gửi thông báo fallback: ${e.message}`);
        }
        return;
    }

    const { senderId: cachedSenderId, senderName: rawName, content: originalText, data: originalData } = cached;
    const resolvedSenderId = (cachedSenderId && cachedSenderId !== "0") ? cachedSenderId
        : safeAuthorId || "";

    if (!authorName) {
        authorName = (rawName && rawName !== "0" && rawName !== "undefined") ? rawName : null;
    }
    if (!authorName && resolvedSenderId) {
        try { authorName = await getDisplayName(api, resolvedSenderId) || null; } catch { }
    }
    authorName = authorName || "Ai đó";

    const msgType    = originalData?.msgType || "";
    const rawContent = originalData?.content;
    const rawAttach  = originalData?.attach;

    let c = {};
    if (typeof rawContent === "object" && rawContent !== null) {
        c = rawContent;
    } else if (typeof rawContent === "string") {
        try { c = JSON.parse(rawContent); } catch { c = {}; }
    }

    let attach = {};
    if (typeof rawAttach === "object" && rawAttach !== null) {
        attach = rawAttach;
    } else if (typeof rawAttach === "string") {
        try { attach = JSON.parse(rawAttach); } catch { attach = {}; }
    }

    const stickerId  = c?.id  || attach?.id  || c?.stickerID  || attach?.stickerID;
    const stickerCat = c?.catId || attach?.catId || c?.catID || attach?.catID;

    const extra      = c?.extra || attach?.extra || {};
    const rawParams  = c?.params || attach?.params || originalData?.params || "";
    const parsedParams = _auParseParams(rawParams);

    // ── VIDEO ──
    const isVideoMsg = msgType.startsWith("chat.video")
        || !!extra?.videoUrl || !!c?.videoUrl
        || ("video_width" in parsedParams);

    if (isVideoMsg) {
        const videoUrl = extra?.videoUrl || c?.videoUrl || c?.href;
        const thumbUrl = extra?.thumbUrl  || c?.thumb   || videoUrl;
        const duration = Number(parsedParams?.duration || extra?.duration || 0);
        const width    = Number(parsedParams?.video_width  || extra?.width  || 720);
        const height   = Number(parsedParams?.video_height || extra?.height || 1280);

        if (videoUrl) {
            try {
                const { text, styles, mentions } = _auBuildNotify("VIDEO", authorName, resolvedSenderId);
                await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
                await api.sendVideoEnhanced({ videoUrl, thumbnailUrl: thumbUrl, duration: Math.floor(duration), width: Math.floor(width), height: Math.floor(height), msg: "", threadId, threadType });
                log.success(`[AntiUndo] ✅ Đã tóm VIDEO của ${authorName}`);
            } catch (e) { log.error(`[AntiUndo] Lỗi VIDEO: ${e.message}`); }
            return;
        }
    }

    // ── VOICE ──
    const isVoice = msgType.startsWith("chat.voice")
        || msgType.startsWith("chat.audio")
        || (typeof c?.href === "string" && (c.href.includes(".aac") || c.href.includes(".m4a")));

    if (isVoice && c?.href) {
        try {
            const fileSize = Number(parsedParams?.fileSize || 0);
            const duration = Number(parsedParams?.duration || 0);
            const { text, styles, mentions } = _auBuildNotify("VOICE", authorName, resolvedSenderId);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            await api.sendVoiceNative({
                voiceUrl: c.href, duration, fileSize, threadId, threadType, ttl: 1800000
            }).catch(async (e) => {
                log.warn(`[AntiUndo] sendVoiceNative thất bại (${e.message}), thử fallback...`);
                const tmpPath = path.join(process.cwd(), `tmp_voice_${Date.now()}.aac`);
                const downloaded = await _auDownloadFile(c.href, tmpPath);
                if (downloaded) {
                    await api.sendVoiceUnified({ filePath: downloaded, threadId, threadType })
                        .finally(() => fs.unlink(downloaded, () => {}));
                } else {
                    await api.sendMessage({ msg: `🎵 Voice: ${c.href}` }, threadId, threadType);
                }
            });
            log.success(`[AntiUndo] ✅ Đã tóm VOICE của ${authorName}`);
        } catch (e) { log.error(`[AntiUndo] Lỗi VOICE: ${e.message}`); }
        return;
    }

    // ── FILE ──
    if (msgType === "share.file" || msgType.includes("file")) {
        try {
            const fileUrl   = c?.href || "";
            const fileName  = parsedParams?.fileName  || "Tệp_đính_kèm";
            const fileExt   = parsedParams?.fileExt   || "";
            const fullName  = fileExt ? `${fileName}.${fileExt}` : fileName;
            const extra_str = `➜ Tên tệp: ${fullName}` + (fileUrl ? `\n➜ Link: ${fileUrl}` : "");
            const { text, styles, mentions } = _auBuildNotify("TỆP", authorName, resolvedSenderId, extra_str);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            if (fileUrl) {
                await api.sendLink({ link: fileUrl, msg: fullName }, threadId, threadType).catch(() => { });
            }
            log.success(`[AntiUndo] ✅ Đã tóm FILE của ${authorName}: ${fullName}`);
        } catch (e) { log.error(`[AntiUndo] Lỗi FILE: ${e.message}`); }
        return;
    }

    // ── ẢNH ──
    const isPhotoMsg = msgType.startsWith("chat.photo")
        || !!(extra?.hdUrl || extra?.url || extra?.thumbUrl || extra?.normalUrl);

    if (isPhotoMsg) {
        const imgUrl = extra?.hdUrl || extra?.url || extra?.normalUrl || extra?.thumbUrl || c?.href;
        if (imgUrl) {
            try {
                const tmpPath = path.join(process.cwd(), `tmp_undo_${Date.now()}.jpg`);
                await _auDownloadFile(imgUrl, tmpPath);
                const { text, styles, mentions } = _auBuildNotify("ẢNH", authorName, resolvedSenderId);
                await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
                await api.sendImageEnhanced({
                    imageUrl: imgUrl, msg: "", threadId, threadType,
                    width:  Math.floor(Number(extra?.width  || 720)),
                    height: Math.floor(Number(extra?.height || 1280))
                }).catch(() => { });
                fs.unlink(tmpPath, () => { });
                log.success(`[AntiUndo] ✅ Đã tóm ẢNH của ${authorName}`);
            } catch (e) { log.error(`[AntiUndo] Lỗi ẢNH: ${e.message}`); }
            return;
        }
    }

    // ── STICKER ──
    const isStickerMsg = msgType.startsWith("chat.sticker")
        || !!(stickerId && stickerCat);

    if (isStickerMsg && stickerId && stickerCat) {
        try {
            const stickerObj = { id: String(stickerId), cateId: String(stickerCat), type: 1 };
            const { text, styles, mentions } = _auBuildNotify("STICKER", authorName, resolvedSenderId);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            await api.sendSticker(stickerObj, threadId, threadType === 1 ? 1 : 0).catch((e) => {
                log.error(`[AntiUndo] sendSticker API Error: ${e.message}`);
                api.sendSticker(stickerObj, threadId, threadType).catch(() => { });
            });
            log.success(`[AntiUndo] ✅ Đã tóm STICKER id=${stickerId} cat=${stickerCat} của ${authorName}`);
        } catch (e) { log.error(`[AntiUndo] Lỗi STICKER: ${e.message}`); }
        return;
    }

    // ── VĂN BẢN ──
    const displayText = originalText
        || (typeof rawContent === "string" ? rawContent : null)
        || c?.text || c?.title || c?.desc || "";

    if (displayText) {
        try {
            const { text, styles, mentions } = _auBuildNotify("TIN NHẮN", authorName, resolvedSenderId,
                `➜ Nội dung: "${displayText}"`);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            log.success(`[AntiUndo] ✅ Đã tóm TEXT của ${authorName}: "${displayText.slice(0, 50)}"`);
        } catch (e) { log.error(`[AntiUndo] Lỗi TEXT: ${e.message}`); }
        return;
    }

    log.warn(`[AntiUndo] ⚠️ Không xử lý được. msgType="${msgType}" | content=${JSON.stringify(c).slice(0, 100)}`);
    try {
        const { text, styles, mentions } = _auBuildNotify("TIN NHẮN", authorName, resolvedSenderId,
            "➜ (Không thể khôi phục nội dung tin nhắn này)");
        await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
    } catch { }
}

// ─── Handle: bảo vệ nhóm + reply số menu ─────────────────────────────────────

export async function handle(ctx) {
    const { message, threadId, threadType, senderId, adminIds, isGroup, api, content, isSelf } = ctx;
    if (isSelf) return false;
    if (!isGroup) return false;

    const { data } = message;
    const now = Date.now();

    // Bảo vệ nhóm (chỉ áp dụng với non-admin)
    if (!adminIds.includes(String(senderId))) {
        // 1. Anti-Link
        if (protectionManager.isEnabled(threadId, "link")) {
            let textToCheck = content || "";
            if (!textToCheck && data?.content) {
                textToCheck = typeof data.content === "string" ? data.content : (data.content.href || data.content.text || "");
            }
            if (textToCheck && ZALO_GROUP_LINK_REGEX.test(textToCheck)) {
                await handleDeleteAndReport(ctx, "link_del", 0);
                return true;
            }
        }

        // 2. Anti-Spam
        if (protectionManager.isEnabled(threadId, "spam")) {
            const key = `${threadId}_${senderId}`;
            const oneMinuteAgo = now - 60000;
            if (!kickHistoryMap.has(threadId)) kickHistoryMap.set(threadId, []);
            const kickHistory = kickHistoryMap.get(threadId);
            while (kickHistory.length > 0 && kickHistory[0] < oneMinuteAgo) kickHistory.shift();
            if (!spamData.has(key)) {
                spamData.set(key, [now]);
            } else {
                const timestamps = spamData.get(key);
                const recentMsgs = timestamps.filter(t => now - t < TIME_LIMIT);
                recentMsgs.push(now);
                spamData.set(key, recentMsgs);
                if (recentMsgs.length >= MSG_LIMIT && kickHistory.length < MAX_KICKS_PER_MIN) {
                    spamData.set(key, []);
                    const count = protectionManager.addViolation(threadId, senderId, "spam");
                    await handleDeleteAndReport(ctx, "spam", count);
                    kickHistory.push(now);
                    return true;
                }
            }
        }

        // 3. Anti-Tag
        if (protectionManager.isEnabled(threadId, "tag")) {
            const mentions = data.mentions || [];
            if (mentions.some(m => m.uid === "-1" || m.uid === -1)) {
                const count = protectionManager.addViolation(threadId, senderId, "tag");
                await handleDeleteAndReport(ctx, "tag", count);
                return true;
            }
        }

        // 4. Anti-Sticker + Anti-Nude (sticker) — kiểm tra nude TRƯỚC khi block sticker
        const detectedSticker = isSticker(data, content);
        if (detectedSticker) {
            // Nếu Anti-Nude bật → check nude sticker trước
            if (protectionManager.isEnabled(threadId, "nude")) {
                let stickerUrl = getStickerUrlFromData(data);
                if (!stickerUrl) {
                    const stickerId = getStickerIdFromData(data);
                    if (stickerId) {
                        try {
                            const details = await api.getStickersDetail([stickerId]);
                            const d = Array.isArray(details) ? details[0] : details;
                            stickerUrl = d?.animationImgUrl || d?.staticImgUrl || d?.hdUrl || d?.thumbUrl || d?.thumb || d?.url || d?.imageUrl || null;
                        } catch (e) {
                            log.warn(`[Anti-Nude] getStickersDetail lỗi: ${e.message}`);
                        }
                    }
                }
                if (stickerUrl) {
                    const nude = await checkNsfw(stickerUrl, api).catch(() => false);
                    if (nude) {
                        const count = protectionManager.addViolation(threadId, senderId, "nude");
                        await handleDeleteAndReport(ctx, "nude", count);
                        return true;
                    }
                } else {
                    log.warn(`[Anti-Nude] 🎨 Không lấy được URL sticker — bỏ qua nude check`);
                }
            }
            // Nếu không nude (hoặc không check được) và Anti-Sticker bật → block sticker
            if (protectionManager.isEnabled(threadId, "sticker")) {
                const count = protectionManager.addViolation(threadId, senderId, "sticker");
                await handleDeleteAndReport(ctx, "sticker", count);
                return true;
            }
        }

        // 5. Anti-Nude (ảnh/video + link ảnh trong text)
        if (protectionManager.isEnabled(threadId, "nude")) {
            const mediaIsPhoto   = isPhoto(data, content);
            const mediaIsVideo   = !mediaIsPhoto && isVideo(data, content);

            // ── 5a. Kiểm tra media đính kèm (ảnh/video) ──────────────────────
            if (mediaIsPhoto || mediaIsVideo) {
                let nude = false;
                if (mediaIsPhoto) {
                    const url = getPhotoUrl(data, content);
                    if (url) nude = await checkNsfw(url, api).catch(() => false);
                } else if (mediaIsVideo) {
                    const thumbUrl = getVideoThumbnailUrl(data);
                    const videoUrl = getVideoActualUrl(data);
                    const score = await Promise.race([
                        checkNsfwVideo(thumbUrl, videoUrl, {}, api).catch(() => null),
                        new Promise(r => setTimeout(() => r(null), 90000))
                    ]);
                    nude = score !== null && score >= NSFW_THRESHOLD;
                }
                if (nude) {
                    const count = protectionManager.addViolation(threadId, senderId, "nude");
                    await handleDeleteAndReport(ctx, "nude", count);
                    return true;
                }
            }

            // ── 5b. Kiểm tra link trong văn bản (ảnh + video URL) ────────────
            if (!mediaIsPhoto && !mediaIsVideo && !detectedSticker) {
                const textToScan = content
                    || (typeof data?.content === "string" ? data.content : null)
                    || data?.content?.text || "";
                const links = extractAllUrlsFromText(textToScan, 5);
                for (const { url, hint: hintExt } of links) {
                    try {
                        // Bỏ qua audio — không phải ảnh/video
                        if (AUDIO_URL_SKIP_REGEX.test(url)) continue;
                        // Xác định loại thực sự qua HEAD nếu chưa rõ
                        const kind = hintExt !== "unknown" ? hintExt : await probeUrlContentType(url);
                        let nude = false;
                        if (kind === "image") {
                            nude = await checkNsfw(url, api).catch(() => false);
                        } else if (kind === "video") {
                            try {
                                const score = await Promise.race([
                                    checkNsfwVideo(null, url, {}, api).catch(() => null),
                                    new Promise(r => setTimeout(() => r(null), 90000))
                                ]);
                                nude = score !== null && score >= NSFW_THRESHOLD;
                            } catch { /* video không trích được */ }
                        } else if (kind !== "unknown") {
                            const score = await checkNsfwViaBackend(url, api).catch(() => null);
                            nude = score !== null && score >= NSFW_THRESHOLD;
                        }
                        if (nude) {
                            const count = protectionManager.addViolation(threadId, senderId, "nude");
                            await handleDeleteAndReport(ctx, "nude", count);
                            return true;
                        }
                    } catch { /* bỏ qua lỗi từng link */ }
                }
            }
        }

        // 6. Anti-Photo
        if (protectionManager.isEnabled(threadId, "photo")) {
            if (isPhoto(data, content)) {
                const count = protectionManager.addViolation(threadId, senderId, "photo");
                await handleDeleteAndReport(ctx, "photo", count);
                return true;
            }
        }

    }

    // Reply số từ menu .anti
    if (!content || isSelf) return false;
    const key = `${threadId}_${senderId}`;
    if (!menuSessions.has(key)) return false;
    const cleanContent = content.trim();
    if (/^[1-8]+$/.test(cleanContent)) {
        menuSessions.delete(key);
        if (!adminIds.includes(String(senderId))) return false;
        const ids = [...new Set(cleanContent.split(""))];
        const selectedItems = PROTECTION_TYPES.filter(p => ids.includes(p.id));
        if (selectedItems.length > 0) {
            await toggleProtection(api, threadId, threadType, senderId, selectedItems);
            return true;
        }
    }

    return false;
}
