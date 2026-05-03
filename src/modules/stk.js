import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { spawn } from "node:child_process";
import { log } from "../logger.js";
import { removeBackground } from "../utils/core/removebg.js";
import { pollinationsImage, getPollinationsKey, translateToEnglish } from "../utils/api/apiai.js";
import { FFMPEG_BIN as ffmpegPath, FFPROBE_BIN } from "../utils/core/ffmpegHelper.js";
import {
    convertImageFileToPng as ffmpegToPng,
    normalizeImageToPng,
    isVideoFile,
    isJxlFile as _isJxl,
    isAvifFile as _isAvif,
    circleRotateImageToWebp as ffmpegCircleRotateToWebp,
    circleRotateVideoToWebp as ffmpegVideoCircleRotateToWebp,
    circleVideoToWebp as ffmpegVideoCircleToWebp,
    uploadStickerToZalo,
} from "../utils/core/stickerHelper.js";

export const name = "stk";
export const version = "2.5.1";
export const credits = "VLjnh";

// ─── Bo tròn góc (giống Pillow rounded_rectangle radius=50) ──────────────────
// Dùng ffmpeg geq filter để tạo alpha mask hình chữ nhật bo góc.
const ROUND_R = 40;
const _RND_A = `if(lte(pow(X-min(max(X\\,${ROUND_R})\\,W-${ROUND_R})\\,2)+pow(Y-min(max(Y\\,${ROUND_R})\\,H-${ROUND_R})\\,2)\\,${ROUND_R * ROUND_R})\\,255\\,0)`;
const ROUNDED_FILTER = `format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${_RND_A}'`;

// Filter dùng cho ảnh đã có alpha (remove.bg): giữ nguyên alpha gốc, chỉ cắt góc tròn
const _RND_A_PRESERVE = `min(alpha(X\\,Y)\\,${_RND_A})`;
const ROUNDED_FILTER_ALPHA = `format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${_RND_A_PRESERVE}'`;

function buildCreditFilter(scaleFilter) {
    return `${scaleFilter},${ROUNDED_FILTER}`;
}

// Filter cho xóa nền: bảo toàn alpha remove.bg + cắt góc tròn
function buildRemoveBgFilter(scaleFilter) {
    return `format=rgba,${scaleFilter},${ROUNDED_FILTER_ALPHA}`;
}

export const description = "Tạo sticker từ ảnh/GIF/video. Sub: xoay [tốc độ] [thời gian] (xoay), tron (crop tròn), xt [tốc độ] [thời gian] (xoay+tròn, hỗ trợ video), xn (xóa nền), ai (vẽ AI). VD: .stk xt 2 8s (nhanh x2, 8 giây)";

const BOT_NAME = "LauNa";

// Upload sticker (.webp) lên CDN Zalo qua api.uploadAttachment.
// Trả URL hoặc null nếu fail (đã log).
async function uploadStickerSafe(api, filePath, threadId, threadType) {
    try {
        return await uploadStickerToZalo(api, filePath, threadId, threadType);
    } catch (e) {
        log.error(`STK: upload sticker lỗi — ${e.message}`);
        return null;
    }
}


const ZALO_DL_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Referer": "https://chat.zalo.me/",
    "Accept": "image/jpeg,image/png,image/webp,image/*,*/*;q=0.8",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
};

async function downloadWithRetry(mediaUrl, dest, retries = 4, extraHeaders = {}) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(mediaUrl, {
                responseType: "arraybuffer",
                headers: { ...ZALO_DL_HEADERS, ...extraHeaders },
                timeout: 40000,
                maxRedirects: 5,
            });
            fs.writeFileSync(dest, Buffer.from(response.data));
            return true;
        } catch (e) {
            if (attempt === retries) throw e;
            await new Promise(r => setTimeout(r, 1500 * attempt));
        }
    }
}

// _isJxl, _magickJxlToPng được import từ stickerHelper.js (isJxlFile, magick xử lý nội bộ)

async function convertToWebp(mediaUrl, uniqueId) {
    const tempDir = path.join(process.cwd(), "src/modules/cache/");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const tIn    = path.join(tempDir, `in_${uniqueId}`);
    const tInPng = path.join(tempDir, `in_${uniqueId}_jxl.png`); // fallback nếu JXL
    const tOut   = path.join(tempDir, `out_${uniqueId}.webp`);

    try {
        await downloadWithRetry(mediaUrl, tIn);

        if (!fs.existsSync(tIn)) {
            log.error(`STK: tải ảnh thất bại — file không tồn tại`);
            return null;
        }
        const inSize = fs.statSync(tIn).size;
        if (inSize < 100) {
            log.error(`STK: file ảnh quá nhỏ (${inSize} bytes) — có thể tải bị lỗi`);
            return null;
        }

        // ── Nếu là JXL → dùng thư viện convert sang PNG (magick/ffmpeg fallback) ─
        let ffInput = tIn;
        if (_isJxl(tIn)) {
            log.info(`STK: phát hiện JXL — convert sang PNG qua thư viện`);
            await ffmpegToPng(tIn, tInPng);
            ffInput = tInPng;
        }

        const scaleVf = "scale='if(gt(iw,ih),min(iw,512),-1)':'if(gt(iw,ih),-1,min(ih,512))'";
        const cmdArgs = [
            "-y",
            "-threads", "1",
            "-i", ffInput,
            "-vf", buildCreditFilter(scaleVf),
            "-c:v", "libwebp",
            "-lossless", "0",
            "-compression_level", "2",
            "-q:v", "75",
            "-loop", "0",
            "-an",
            "-vsync", "0",
            tOut
        ];

        const ffmpegStderr = [];
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn(ffmpegPath, cmdArgs);
            ffmpeg.stderr.on("data", d => ffmpegStderr.push(String(d)));
            ffmpeg.on("close", (code) => {
                if (code === 0) resolve();
                else {
                    const errLog = ffmpegStderr.join("").slice(-500);
                    log.error(`STK: ffmpeg code=${code}\n${errLog}`);
                    reject(new Error(`ffmpeg code ${code}`));
                }
            });
            ffmpeg.on("error", (e) => {
                log.error(`STK: ffmpeg spawn lỗi — ${e?.code || e?.message}`);
                reject(e);
            });
        });

        if (fs.existsSync(tOut) && fs.statSync(tOut).size > 0) {
            return tOut;
        }
        log.error(`STK: file webp không tồn tại sau convert`);
        return null;
    } catch (e) {
        log.error(`STK: lỗi convert — ${e?.message || e?.code || String(e)}`);
        return null;
    } finally {
        for (const f of [tIn, tInPng]) {
            if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch { }
        }
    }
}

async function sendCustomStickerWithRetry(api, payload, retries = 3) {
    for (let i = 1; i <= retries; i++) {
        try {
            await api.sendCustomerSticker(payload.staticImgUrl, payload.animationImgUrl || payload.staticImgUrl, payload.threadId, payload.type ?? payload.threadType ?? 0, { width: payload.width, height: payload.height, ttl: payload.ttl, noAI: payload.noAI });
            return true;
        } catch (e) {
            const msg = e?.message || String(e);
            log.warn(`STK: gửi sticker lần ${i} thất bại — ${msg}`);
            if (i < retries) await new Promise(r => setTimeout(r, 2000 * i));
            else throw e;
        }
    }
}

export async function convertAndSendSticker(api, mediaUrl, threadId, threadType, senderId) {
    const uniqueId = `${senderId}_${Date.now()}`;
    const webpPath = await convertToWebp(mediaUrl, uniqueId);

    if (!webpPath) {
        log.error(`STK: convertToWebp trả null — ảnh không được chuyển đổi`);
        return false;
    }

    try {
        const webpUrl = await uploadStickerSafe(api, webpPath, threadId, threadType);
        if (!webpUrl) return false;

        await sendCustomStickerWithRetry(api, {
            animationImgUrl: webpUrl,
            staticImgUrl: webpUrl,
            threadId,
            type: threadType,
            width: 512,
            height: 512,
            ai: true,
        });
        return true;
    } finally {
        if (fs.existsSync(webpPath)) try { fs.unlinkSync(webpPath); } catch { }
    }
}

function extractMediaUrlFromAttach(attachData) {
    if (!attachData) return null;
    let data = attachData;
    if (typeof data === "string") {
        try { data = JSON.parse(data); } catch { return null; }
    }
    const url = data.hdUrl || data.url || data.href || data.thumbUrl;
    if (!url) return null;
    const final = Array.isArray(url) ? url[0] : url;
    return decodeURIComponent(String(final).replace(/\\\//g, "/"));
}

function extractMediaUrlFromMessage(message) {
    const raw = message?.data || {};

    const attachments = raw.attachments || [];
    for (const att of attachments) {
        const url = att?.hdUrl || att?.fileUrl || att?.url || att?.href;
        if (url && typeof url === "string" && url.startsWith("http")) {
            return decodeURIComponent(String(url).replace(/\\\//g, "/"));
        }
    }

    const msgAttach = raw.msgAttach || raw.attach;
    if (msgAttach) {
        const url = extractMediaUrlFromAttach(msgAttach);
        if (url) return url;
    }

    return null;
}

// ─── XÓA NỀN — dùng global.removeBackground (src/utils/core/removebg.js) ────
// Các helper _isAvif, normalizeImageToPng được import từ stickerHelper.js

async function convertPngToWebpSticker(pngPath, uniqueId) {
    const tempDir = path.dirname(pngPath);
    const outPath = path.join(tempDir, `stk_xn_${uniqueId}.webp`);

    const scaleVf = "scale='if(gt(iw,ih),min(iw,512),-1)':'if(gt(iw,ih),-1,min(ih,512))'";
    const cmdArgs = [
        "-y", "-threads", "1", "-i", pngPath,
        "-vf", buildRemoveBgFilter(scaleVf),
        "-c:v", "libwebp",
        "-lossless", "1",
        "-compression_level", "4",
        "-loop", "0",
        "-an", "-vsync", "0",
        outPath
    ];

    await new Promise((resolve, reject) => {
        const ff = spawn(ffmpegPath, cmdArgs);
        const errs = [];
        ff.stderr.on("data", d => errs.push(String(d)));
        ff.on("close", code => {
            if (code === 0) return resolve();
            log.error(`[convertPngToWebp] ffmpeg code=${code}\n${errs.join("").slice(-400)}`);
            reject(new Error(`ffmpeg code ${code}`));
        });
        ff.on("error", reject);
    });

    return fs.existsSync(outPath) && fs.statSync(outPath).size > 0 ? outPath : null;
}

async function getMediaUrl(message) {
    const raw = message?.data || {};
    let url = extractMediaUrlFromMessage(message);
    if (!url && raw.quote?.attach) url = extractMediaUrlFromAttach(raw.quote.attach);
    return url;
}

async function xoaNenHandler(ctx, makeSticker = false) {
    const { api, threadId, threadType, message, senderId, senderName } = ctx;
    const tag = `@${senderName} `;

    const mediaUrl = await getMediaUrl(message);
    if (!mediaUrl) {
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Reply vào ảnh hoặc đính kèm ảnh để tớ xóa nền nhé!` },
            threadId, threadType
        );
    }

    const VIDEO_URL_RE = /\.(mp4|m4v|avi|mov|mkv|webm|flv|wmv|3gp|ts)(\?.*)?$/i;
    if (VIDEO_URL_RE.test(mediaUrl)) {
        return api.sendMessage(
            { msg: `➜ ❌ ${BOT_NAME}: Đây là video, không thể xóa nền!\n💡 Reply vào ảnh (jpg/png/webp) để xóa nền nhé~` },
            threadId, threadType
        );
    }

    const action = makeSticker ? "Đang xóa nền + tạo sticker" : "Đang xóa nền ảnh";
    await api.sendMessage({
        msg: tag + `${BOT_NAME}: ${action}, chờ xíu nha~ ✨`,
        mentions: [{ uid: senderId, pos: 0, len: tag.length }]
    }, threadId, threadType);

    const tempDir = path.join(process.cwd(), "src/modules/cache/");
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const ts = Date.now();
    const pngPath = path.join(tempDir, `rmbg_${ts}.png`);
    let webpPath = null;

    const rawImgPath = path.join(tempDir, `rmbg_raw_${ts}`);

    // Lấy Zalo session cookie từ api context (CDN Zalo cần cookie để download)
    let sessionHeaders = {};
    try {
        const zaloCtx = api.getContext?.() || {};
        const jar = zaloCtx.cookie;
        if (jar) {
            let cookieStr = "";
            if (typeof jar.getCookieStringSync === "function") {
                // Thử các domain CDN phổ biến của Zalo
                const domains = [
                    "https://zalo.me",
                    "https://chat.zalo.me",
                    "https://cover-talk.zadn.vn",
                    "https://zmp3-attach.zadn.vn",
                ];
                for (const d of domains) {
                    const s = jar.getCookieStringSync(d);
                    if (s) { cookieStr = s; break; }
                }
            } else if (typeof jar === "string") {
                cookieStr = jar;
            }
            if (cookieStr) sessionHeaders = { "Cookie": cookieStr };
        }
    } catch (_) {}

    try {
        try {
            await downloadWithRetry(mediaUrl, rawImgPath, 4, sessionHeaders);
        } catch (dlErr) {
            const status = dlErr?.response?.status;
            if (status === 410 || status === 404) {
                throw new Error("Link ảnh đã hết hạn. Cậu gửi lại ảnh mới rồi thử lại nhé!");
            }
            const code = dlErr?.code || dlErr?.message || String(dlErr);
            throw new Error(`Tải ảnh thất bại (${status || code})`);
        }
        const normalizedBuf = await normalizeImageToPng(rawImgPath);
        const resultBuf = await removeBackground(normalizedBuf);
        fs.writeFileSync(pngPath, resultBuf);

        if (makeSticker) {
            // Xóa nền → WebP sticker → upload Zalo → gửi sticker
            webpPath = await convertPngToWebpSticker(pngPath, ts);
            if (!webpPath) throw new Error("Chuyển đổi WebP thất bại.");

            const webpUrl = await uploadStickerSafe(api, webpPath, threadId, threadType);
            if (!webpUrl) throw new Error("Upload sticker thất bại.");

            await api.sendCustomerSticker(webpUrl, webpUrl, threadId, threadType, { width: 512, height: 512 });
        } else {
            // Chỉ xóa nền → gửi PNG
            await api.sendMessage(
                { msg: `✅ ${BOT_NAME}: Xóa nền xong!`, attachments: [pngPath] },
                threadId, threadType
            );
        }
    } catch (e) {
        let errMsg;
        if (e instanceof AggregateError) {
            const inner = e.errors?.[0];
            errMsg = `Lỗi kết nối mạng (${inner?.code || inner?.message || "network error"})`;
        } else {
            errMsg = e?.message || String(e) || "Lỗi không xác định";
        }
        log.error(`Lỗi XóaNền: ${errMsg}`);
        await api.sendMessage(
            { msg: `➜ ❌ ${BOT_NAME}: Xóa nền lỗi rồi! ${errMsg}` },
            threadId, threadType
        );
    } finally {
        try { if (fs.existsSync(rawImgPath)) fs.unlinkSync(rawImgPath); } catch {}
        try { if (fs.existsSync(pngPath)) fs.unlinkSync(pngPath); } catch {}
        try { if (webpPath && fs.existsSync(webpPath)) fs.unlinkSync(webpPath); } catch {}
    }
}

async function stkHandler(ctx) {
    const { api, threadId, threadType, message, senderId, senderName } = ctx;
    const raw = message?.data || {};
    const quote = raw.quote;

    if (!quote || !quote.attach) {
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Hãy reply vào ảnh hoặc GIF để tớ làm sticker nhé!` },
            threadId, threadType
        );
    }

    const tag = `@${senderName} `;
    try {
        const mediaUrl = extractMediaUrlFromAttach(quote.attach);
        if (!mediaUrl) {
            return api.sendMessage(
                { msg: `➜ ❌ ${BOT_NAME}: Hông lấy được link ảnh rồi. Cậu thử lại với ảnh khác nhé!` },
                threadId, threadType
            );
        }

        await api.sendMessage({
            msg: tag + `${BOT_NAME}: Đang làm sticker cho cậu, chờ xíu nha~ ✨`,
            mentions: [{ uid: senderId, pos: 0, len: tag.length }]
        }, threadId, threadType);

        const ok = await convertAndSendSticker(api, mediaUrl, threadId, threadType, senderId, senderName);
        if (!ok) {
            api.sendMessage(
                { msg: `➜ ❌ ${BOT_NAME}: Làm sticker lỗi rồi! Có thể do ảnh không đúng định dạng đó.` },
                threadId, threadType
            );
        }
    } catch (e) {
        const errMsg = e?.message || String(e);
        log.error(`Lỗi STK: ${errMsg}`);
        api.sendMessage(
            { msg: `➜ ❌ ${BOT_NAME}: Lỗi hệ thống: ${errMsg}` },
            threadId, threadType
        );
    }
}

async function taostkHandler(ctx) {
    const { api, threadId, threadType, message, senderId, senderName } = ctx;
    const tag = `@${senderName} `;

    const mediaUrl = extractMediaUrlFromMessage(message);

    if (!mediaUrl) {
        const raw = message?.data || {};
        const quote = raw.quote;
        if (quote?.attach) {
            return stkHandler(ctx);
        }
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Cậu đính kèm ảnh/GIF vào tin nhắn hoặc reply vào ảnh để tớ tạo sticker nhé!` },
            threadId, threadType
        );
    }

    try {
        await api.sendMessage({
            msg: tag + `${BOT_NAME}: Đang tạo sticker từ ảnh cậu gửi, chờ xíu nha~ ✨`,
            mentions: [{ uid: senderId, pos: 0, len: tag.length }]
        }, threadId, threadType);

        const ok = await convertAndSendSticker(api, mediaUrl, threadId, threadType, senderId, senderName);
        if (!ok) {
            api.sendMessage(
                { msg: `➜ ❌ ${BOT_NAME}: Không tạo được sticker. Cậu thử ảnh khác xem sao nha!` },
                threadId, threadType
            );
        }
    } catch (e) {
        const errMsg = e?.message || String(e);
        log.error(`Lỗi TAOSTK: ${errMsg}`);
        api.sendMessage(
            { msg: `➜ ❌ ${BOT_NAME}: Lỗi: ${errMsg}` },
            threadId, threadType
        );
    }
}

// ─── AI STICKER ───────────────────────────────────────────────────────────────
const POLLINATIONS_FALLBACK_URL = (prompt) =>
    `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&enhance=true&model=flux&seed=${Date.now()}`;

async function stkiaHandler(ctx) {
    const { api, threadId, threadType, senderId, senderName, args } = ctx;
    const tag = `@${senderName} `;
    const prompt = args.join(" ").trim();

    if (!prompt) {
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Cậu nhập mô tả để tớ vẽ sticker nhé!\nVD: .stk ai mèo cute chibi nền trắng` },
            threadId, threadType
        );
    }

    await api.sendMessage({ msg: `🌐 Đang phát hiện ngôn ngữ và dịch mô tả sang tiếng Anh...` }, threadId, threadType).catch(() => {});
    const translatedPrompt = await translateToEnglish(prompt).catch(() => prompt);
    const finalPrompt = translatedPrompt || prompt;

    const loadMsg = await api.sendMessage({
        msg: tag + `${BOT_NAME}: Đang vẽ sticker AI cho cậu: "${prompt}" ⏳`,
        mentions: [{ uid: senderId, pos: 0, len: tag.length }]
    }, threadId, threadType).catch(() => null);

    const tempDir = path.join(process.cwd(), "src/modules/cache/");
    fs.mkdirSync(tempDir, { recursive: true });
    const uniqueId = `${senderId}_${Date.now()}`;
    const pngPath  = path.join(tempDir, `stkia_${uniqueId}.png`);
    let   webpPath = null;

    try {
        // ── Primary: Pollinations (apiai) ─────────────────────────────────────
        const pollKey = getPollinationsKey();
        let drew = false;
        if (pollKey) {
            try {
                const imgBuf = await pollinationsImage(pollKey, finalPrompt, "flux", 512, 512);
                fs.writeFileSync(pngPath, imgBuf);
                drew = true;
            } catch (e) {
                log.warn(`[stkia] Pollinations lỗi: ${e.message} — fallback URL`);
            }
        }

        // ── Fallback 1: Duck.ai image generation (global.duckGenerateImage) ──
        if (!drew && global.duckGenerateImage) {
            try {
                const duckResult = await global.duckGenerateImage(finalPrompt);
                const src = duckResult?.imageUrls?.[0];
                if (src) {
                    if (src.startsWith("data:image")) {
                        const base64 = src.split(",")[1];
                        fs.writeFileSync(pngPath, Buffer.from(base64, "base64"));
                    } else {
                        await downloadWithRetry(src, pngPath, 3);
                    }
                    drew = true;
                }
            } catch (e) {
                log.warn(`[stkia] duckGenerateImage lỗi: ${e.message} — fallback URL`);
            }
        }

        // ── Fallback 2: Pollinations URL trực tiếp (không cần key) ───────────
        if (!drew) {
            await downloadWithRetry(POLLINATIONS_FALLBACK_URL(finalPrompt), pngPath, 3);
        }

        webpPath = await convertPngToWebpSticker(pngPath, uniqueId);
        if (!webpPath) throw new Error("Chuyển WebP thất bại");

        const webpUrl = await uploadStickerSafe(api, webpPath, threadId, threadType);
        if (!webpUrl) throw new Error("Upload sticker thất bại");

        await sendCustomStickerWithRetry(api, {
            staticImgUrl: webpUrl,
            animationImgUrl: webpUrl,
            threadId,
            type: threadType,
            width: 512,
            height: 512,
            ai: true,
        });

        if (loadMsg?.message?.msgId) {
            api.undo({ msgId: loadMsg.message.msgId, cliMsgId: loadMsg.message.cliMsgId }, threadId, threadType).catch(() => {});
        }
    } catch (e) {
        log.error(`[stkia] Lỗi: ${e.message}`);
        api.sendMessage(
            { msg: `➜ ❌ ${BOT_NAME}: Tạo sticker AI lỗi: ${e.message}` },
            threadId, threadType
        );
    } finally {
        for (const f of [pngPath, webpPath]) {
            if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
        }
    }
}

// ffmpegToPng, normalizeImageToPng, isVideoFile, ffmpegCircleRotateToWebp,
// ffmpegVideoCircleRotateToWebp, ffmpegVideoCircleToWebp được import từ stickerHelper.js

// ─── HELPER: CROP TRÒN bằng skia-canvas (nhận path file, tự xử lý JXL) ──────
async function cropCircleFromPath(rawPath, pngPath) {
    // Đảm bảo là PNG trước khi đưa vào skia-canvas
    await ffmpegToPng(rawPath, pngPath);
    const { Canvas, loadImage } = await import("skia-canvas");
    const img = await loadImage(pngPath);
    const size = Math.min(img.width, img.height, 512);
    const canvas = new Canvas(size, size);
    const ctx = canvas.getContext("2d");
    const scale = size / Math.min(img.width, img.height);
    const sx = (img.width * scale - size) / 2;
    const sy = (img.height * scale - size) / 2;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(img, -sx, -sy, img.width * scale, img.height * scale);
    return await canvas.toBuffer("png");
}

// ─── HELPER: VIDEO → xoay animated webp (không dùng -loop 1) ─────────────────
function ffmpegVideoRotateToWebp(inputPath, outputPath, duration = 4, fps = 15, speed = 1) {
    return new Promise((resolve, reject) => {
        const args = [
            "-y", "-threads", "1",
            "-i", inputPath,
            "-vf", buildCreditFilter([
                "scale=360:360:force_original_aspect_ratio=decrease",
                "pad=360:360:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
                `rotate=2*PI*t*${speed}:c=0x00000000:ow=512:oh=512`,
                "format=rgba"
            ].join(",")),
            "-t", String(duration),
            "-r", String(fps),
            "-c:v", "libwebp",
            "-lossless", "0",
            "-compression_level", "2",
            "-q:v", "75",
            "-loop", "0",
            "-an",
            outputPath
        ];
        const ff = spawn(ffmpegPath, args);
        const errs = [];
        ff.stderr.on("data", d => errs.push(String(d)));
        ff.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg video-rotate code ${code}\n${errs.join("").slice(-300)}`)));
        ff.on("error", reject);
    });
}

// ─── HELPER: FFMPEG XOAY → webp animated ─────────────────────────────────────
function ffmpegRotateToWebp(inputPath, outputPath, duration = 2, fps = 20, speed = 1) {
    return new Promise((resolve, reject) => {
        const args = [
            "-y", "-threads", "1",
            "-loop", "1", "-i", inputPath,
            "-vf", buildCreditFilter([
                "scale=360:360:force_original_aspect_ratio=decrease",
                "pad=360:360:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
                `rotate=2*PI*t*${speed}:c=0x00000000:ow=512:oh=512`,
                "format=rgba"
            ].join(",")),
            "-t", String(duration),
            "-r", String(fps),
            "-c:v", "libwebp",
            "-lossless", "0",
            "-compression_level", "2",
            "-q:v", "75",
            "-loop", "0",
            "-an",
            outputPath
        ];
        const ff = spawn(ffmpegPath, args);
        const errs = [];
        ff.stderr.on("data", d => errs.push(String(d)));
        ff.on("close", code => code === 0 ? resolve() : reject(new Error(`ffmpeg rotate code ${code}\n${errs.join("").slice(-300)}`)));
        ff.on("error", reject);
    });
}

// ─── STK TRÒN ─────────────────────────────────────────────────────────────────
async function stkTronHandler(ctx) {
    const { api, threadId, threadType, message, senderId, senderName } = ctx;
    const tag = `@${senderName} `;
    const mediaUrl = await getMediaUrl(message);
    if (!mediaUrl) {
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Reply vào ảnh hoặc đính kèm ảnh để tớ crop tròn nhé!` },
            threadId, threadType
        );
    }

    await api.sendMessage({
        msg: tag + `${BOT_NAME}: Đang crop tròn sticker, chờ xíu nha~ ✨`,
        mentions: [{ uid: senderId, pos: 0, len: tag.length }]
    }, threadId, threadType);

    const tempDir = path.join(process.cwd(), "src/modules/cache/stk_temp");
    fs.mkdirSync(tempDir, { recursive: true });
    const uid = `${senderId}_${Date.now()}`;
    const rawPath  = path.join(tempDir, `tron_raw_${uid}`);
    const pngPath  = path.join(tempDir, `tron_${uid}.png`);
    const circlePath = path.join(tempDir, `tron_circle_${uid}.png`);
    let   webpPath = null;

    try {
        await downloadWithRetry(mediaUrl, rawPath);

        const isVideo = await isVideoFile(rawPath);
        if (isVideo) {
            // Video input: circle crop toàn bộ frames → animated webp
            webpPath = path.join(tempDir, `tron_vid_${uid}.webp`);
            await ffmpegVideoCircleToWebp(rawPath, webpPath);
        } else {
            // Ảnh: crop tròn qua skia-canvas → static webp
            const circleBuf = await cropCircleFromPath(rawPath, pngPath);
            fs.writeFileSync(circlePath, circleBuf);
            webpPath = await convertPngToWebpSticker(circlePath, uid);
        }

        if (!webpPath || !fs.existsSync(webpPath) || fs.statSync(webpPath).size === 0)
            throw new Error("Chuyển WebP thất bại");

        const webpUrl = await uploadStickerSafe(api, webpPath, threadId, threadType);
        if (!webpUrl) throw new Error("Upload sticker thất bại");

        await sendCustomStickerWithRetry(api, {
            animationImgUrl: webpUrl, staticImgUrl: webpUrl,
            threadId, type: threadType, width: 512, height: 512, ai: true,
        });
    } catch (e) {
        log.error(`[stk tron] ${e.message}`);
        api.sendMessage({ msg: `➜ ❌ ${BOT_NAME}: Lỗi crop tròn: ${e.message}` }, threadId, threadType);
    } finally {
        for (const f of [rawPath, pngPath, circlePath, webpPath]) {
            if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
        }
    }
}

// ─── HELPER: parse tốc độ xoay từ args ───────────────────────────────────────
function parseSpeed(args) {
    const speedMap = { cham: 0.5, chậm: 0.5, slow: 0.5, nhanh: 2, fast: 2, rtnhanh: 3, "rất nhanh": 3 };
    for (const a of args) {
        const lc = a.toLowerCase();
        if (speedMap[lc] !== undefined) return speedMap[lc];
        // chỉ parse số thuần (không có 's') làm tốc độ
        if (!/s$/.test(lc)) {
            const n = parseFloat(lc);
            if (!isNaN(n) && n > 0 && n <= 10) return n;
        }
    }
    return 1;
}

// ─── HELPER: parse thời lượng từ args (VD: 5s, 8s) ──────────────────────────
function parseDuration(args, defaultDur) {
    for (const a of args) {
        const lc = a.toLowerCase();
        const m = lc.match(/^(\d+(?:\.\d+)?)s$/);
        if (m) {
            const n = parseFloat(m[1]);
            if (n >= 1 && n <= 30) return n;
        }
    }
    return defaultDur;
}

// ─── STK XOAY ─────────────────────────────────────────────────────────────────
async function stkXoayHandler(ctx) {
    const { api, threadId, threadType, message, senderId, senderName, args } = ctx;
    const tag = `@${senderName} `;
    const speed = parseSpeed(args || []);
    const duration = parseDuration(args || [], 5);
    const mediaUrl = await getMediaUrl(message);
    if (!mediaUrl) {
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Reply vào ảnh/video hoặc đính kèm ảnh/video để tớ làm sticker xoay nhé!\nVD: .stk xoay 2 (nhanh x2), .stk xoay 8s (8 giây), .stk xoay 2 8s (nhanh x2, 8 giây)` },
            threadId, threadType
        );
    }

    const extraTxt = [speed !== 1 ? `tốc độ x${speed}` : "", duration !== 5 ? `${duration}s` : ""].filter(Boolean).join(", ");
    await api.sendMessage({
        msg: tag + `${BOT_NAME}: Đang tạo sticker xoay${extraTxt ? ` (${extraTxt})` : ""}, chờ xíu nha~ ✨`,
        mentions: [{ uid: senderId, pos: 0, len: tag.length }]
    }, threadId, threadType);

    const tempDir = path.join(process.cwd(), "src/modules/cache/stk_temp");
    fs.mkdirSync(tempDir, { recursive: true });
    const uid = `${senderId}_${Date.now()}`;
    const rawPath  = path.join(tempDir, `xoay_raw_${uid}`);
    const pngPath  = path.join(tempDir, `xoay_${uid}.png`);
    const webpPath = path.join(tempDir, `xoay_${uid}.webp`);

    try {
        await downloadWithRetry(mediaUrl, rawPath);

        const isVideo = await isVideoFile(rawPath);
        if (isVideo) {
            await ffmpegVideoRotateToWebp(rawPath, webpPath, duration, 15, speed);
        } else {
            await ffmpegToPng(rawPath, pngPath);
            await ffmpegRotateToWebp(pngPath, webpPath, duration, 20, speed);
        }

        if (!fs.existsSync(webpPath) || fs.statSync(webpPath).size === 0)
            throw new Error("ffmpeg không tạo được file webp");

        const webpUrl = await uploadStickerSafe(api, webpPath, threadId, threadType);
        if (!webpUrl) throw new Error("Upload sticker thất bại");

        await sendCustomStickerWithRetry(api, {
            animationImgUrl: webpUrl, staticImgUrl: webpUrl,
            threadId, type: threadType, width: 512, height: 512, ai: true,
        });
    } catch (e) {
        log.error(`[stk xoay] ${e.message}`);
        api.sendMessage({ msg: `➜ ❌ ${BOT_NAME}: Lỗi sticker xoay: ${e.message}` }, threadId, threadType);
    } finally {
        for (const f of [rawPath, pngPath, webpPath]) {
            if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
        }
    }
}

// ─── STK XOAY + TRÒN (kết hợp) — hỗ trợ ảnh + video + tốc độ ───────────────
async function stkXoayTronHandler(ctx) {
    const { api, threadId, threadType, message, senderId, senderName, args } = ctx;
    const tag = `@${senderName} `;
    const speed = parseSpeed(args || []);
    const duration = parseDuration(args || [], 5);
    const mediaUrl = await getMediaUrl(message);
    if (!mediaUrl) {
        return api.sendMessage(
            { msg: `➜ 💡 ${BOT_NAME}: Reply vào ảnh/video hoặc đính kèm ảnh/video để tớ làm sticker xoay tròn nhé!\nVD: .stk xt 2 (nhanh x2), .stk xt 8s (8 giây), .stk xt 2 8s (nhanh x2, 8 giây)` },
            threadId, threadType
        );
    }

    const extraTxt = [speed !== 1 ? `tốc độ x${speed}` : "", duration !== 5 ? `${duration}s` : ""].filter(Boolean).join(", ");
    await api.sendMessage({
        msg: tag + `${BOT_NAME}: Đang tạo sticker xoay tròn${extraTxt ? ` (${extraTxt})` : ""}, chờ xíu nha~ ✨`,
        mentions: [{ uid: senderId, pos: 0, len: tag.length }]
    }, threadId, threadType);

    const tempDir = path.join(process.cwd(), "src/modules/cache/stk_temp");
    fs.mkdirSync(tempDir, { recursive: true });
    const uid = `${senderId}_${Date.now()}`;
    const rawPath  = path.join(tempDir, `xt_raw_${uid}`);
    const pngPath  = path.join(tempDir, `xt_${uid}.png`);
    const webpPath = path.join(tempDir, `xt_${uid}.webp`);

    try {
        await downloadWithRetry(mediaUrl, rawPath);

        const isVideo = await isVideoFile(rawPath);
        if (isVideo) {
            // Video: circle mask + xoay trong 1 pipeline, không cần chuyển PNG
            await ffmpegVideoCircleRotateToWebp(rawPath, webpPath, duration, 15, speed);
        } else {
            // Ảnh: chuyển PNG trước (xử lý JXL, AVIF, WEBP...) → circle + xoay
            await ffmpegToPng(rawPath, pngPath);
            await ffmpegCircleRotateToWebp(pngPath, webpPath, duration, 20, speed);
        }

        if (!fs.existsSync(webpPath) || fs.statSync(webpPath).size === 0)
            throw new Error("ffmpeg không tạo được file webp");

        const webpUrl = await uploadStickerSafe(api, webpPath, threadId, threadType);
        if (!webpUrl) throw new Error("Upload sticker thất bại");

        await sendCustomStickerWithRetry(api, {
            animationImgUrl: webpUrl, staticImgUrl: webpUrl,
            threadId, type: threadType, width: 512, height: 512, ai: true,
        });
    } catch (e) {
        log.error(`[stk xt] ${e.message}`);
        api.sendMessage({ msg: `➜ ❌ ${BOT_NAME}: Lỗi sticker xoay tròn: ${e.message}` }, threadId, threadType);
    } finally {
        for (const f of [rawPath, pngPath, webpPath]) {
            if (f && fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
        }
    }
}

export const commands = {
    stk: async (ctx) => {
        const sub = (ctx.args?.[0] || "").toLowerCase();
        if (sub === "xn" || sub === "xoanen") return xoaNenHandler(ctx, true);
        if (sub === "ai") return stkiaHandler({ ...ctx, args: ctx.args.slice(1) });
        if (sub === "tron" || sub === "tròn") return stkTronHandler({ ...ctx, args: ctx.args.slice(1) });
        if (sub === "xoay") return stkXoayHandler({ ...ctx, args: ctx.args.slice(1) });
        if (sub === "xt" || sub === "xoaytron") return stkXoayTronHandler({ ...ctx, args: ctx.args.slice(1) });
        if (sub === "tao") return taostkHandler({ ...ctx, args: ctx.args.slice(1) });
        await stkHandler(ctx);
    },
};
