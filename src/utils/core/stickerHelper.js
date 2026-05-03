import axios from "axios";
import path from "node:path";
import fs from "node:fs";
import { exec, spawn } from "node:child_process";
import { log } from "../../logger.js";
import { getFFmpegBin, FFPROBE_BIN } from "./ffmpegHelper.js";

const ffmpegBin = getFFmpegBin();
const tempDir = path.join(process.cwd(), "src", "modules", "cache");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

async function downloadImage(url, dest) {
    const res = await axios({
        url, method: "GET", responseType: "arraybuffer",
        timeout: 15000, maxRedirects: 5,
        headers: { "User-Agent": "Mozilla/5.0" },
    });
    fs.writeFileSync(dest, Buffer.from(res.data));
}

function runFfmpeg(cmd) {
    return new Promise((resolve, reject) =>
        exec(cmd, (err) => (err ? reject(err) : resolve()))
    );
}

export async function createSpinningSticker(imageUrl, outputPath) {
    const tempIn = path.join(tempDir, `spin_in_${Date.now()}.png`);
    try {
        await downloadImage(imageUrl, tempIn);
        const filter = "fps=20,scale=512:512:force_original_aspect_ratio=increase,crop=512:512,"
            + "rotate=PI*(1/3)*t:c=none:ow='iw':oh='ih',format=rgba,"
            + "geq=r='r(X,Y)':a='if(gt(hypot(X-256,Y-256),256),0,alpha(X,Y))'";
        await runFfmpeg(`"${ffmpegBin}" -y -loop 1 -t 6 -i "${tempIn}" -vf "${filter}" `
            + `-vcodec libwebp -loop 0 -lossless 0 -q:v 70 -an -vsync 0 "${outputPath}"`);
        return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
    } catch (e) {
        log.error("Lỗi tạo spinning sticker:", e.message);
        return false;
    } finally {
        if (fs.existsSync(tempIn)) try { fs.unlinkSync(tempIn); } catch {}
    }
}

// ─── Music disc sticker: square album art bên trái + đĩa than xoay bên phải ───
// Layout (canvas 512×512):
//   • Square 340×340 ở trái (x=20, y=86), bo góc 40, viền màu ngẫu nhiên 8px
//   • Đĩa than ở phải, tâm (360, 256), R_outer=147
//     - Vành ngoài màu (147→139), vành đen (139→73), lõi xoay (R=73)
// 4s × 20fps = 80 frames, render bằng @napi-rs/canvas, pipe RGBA vào ffmpeg.
export async function createMusicDiscSticker(imageUrl, outputPath, opts = {}) {
    const { Canvas, loadImage } = await import("@napi-rs/canvas");
    const tempIn = path.join(tempDir, `disc_in_${Date.now()}.png`);
    try {
        await downloadImage(imageUrl, tempIn);
        const img = await loadImage(tempIn);

        const SIZE = 512, FPS = opts.fps || 20, DUR = opts.duration || 4;
        const FRAMES = FPS * DUR;
        const SQ_SIZE = 340, SQ_X = 20, SQ_Y = (SIZE - SQ_SIZE) / 2, SQ_R = 40, BORDER = 8;
        const R_OUTER = 147, R_BLACK = R_OUTER - BORDER, R_INNER = 73;
        const CX = SQ_X + SQ_SIZE, CY = SIZE / 2;

        const rndColor = () => `rgb(${Math.floor(Math.random()*256)},${Math.floor(Math.random()*256)},${Math.floor(Math.random()*256)})`;
        const colorSquare = rndColor();
        const colorDisc = rndColor();

        // Crop ảnh nguồn về vuông (lấy giữa)
        const iw = img.width, ih = img.height;
        const side = Math.min(iw, ih);
        const sx = (iw - side) / 2, sy = (ih - side) / 2;

        // ── Layer A (tĩnh): chỉ vẽ vành đĩa (square sẽ vẽ sau cùng để đè lên đĩa) ──
        const layerA = new Canvas(SIZE, SIZE);
        const a = layerA.getContext("2d");
        // Vành ngoài đĩa (màu)
        a.fillStyle = colorDisc;
        a.beginPath();
        a.arc(CX, CY, R_OUTER, 0, Math.PI * 2);
        a.fill();
        // Vành đen
        a.fillStyle = "#000";
        a.beginPath();
        a.arc(CX, CY, R_BLACK, 0, Math.PI * 2);
        a.fill();

        // ── Layer Square (tĩnh): ô vuông ảnh + viền, vẽ đè lên đĩa ở mỗi frame ──
        const layerSq = new Canvas(SIZE, SIZE);
        const sq = layerSq.getContext("2d");
        sq.save();
        roundRectPath(sq, SQ_X, SQ_Y, SQ_SIZE, SQ_SIZE, SQ_R);
        sq.clip();
        sq.drawImage(img, sx, sy, side, side, SQ_X, SQ_Y, SQ_SIZE, SQ_SIZE);
        sq.restore();
        sq.strokeStyle = colorSquare;
        sq.lineWidth = BORDER;
        roundRectPath(sq, SQ_X, SQ_Y, SQ_SIZE, SQ_SIZE, SQ_R);
        sq.stroke();

        // ── Pre-render lõi đã clip tròn (để mỗi frame chỉ rotate + paste) ──
        const CORE = R_INNER * 2;
        const coreCanvas = new Canvas(CORE, CORE);
        const cc = coreCanvas.getContext("2d");
        cc.save();
        cc.beginPath();
        cc.arc(R_INNER, R_INNER, R_INNER, 0, Math.PI * 2);
        cc.clip();
        cc.drawImage(img, sx, sy, side, side, 0, 0, CORE, CORE);
        cc.restore();

        // ── Pipe từng frame RGBA vào ffmpeg ──
        const ff = spawn(ffmpegBin, [
            "-y",
            "-f", "rawvideo", "-pix_fmt", "rgba",
            "-s", `${SIZE}x${SIZE}`, "-r", String(FPS),
            "-i", "pipe:0",
            "-vcodec", "libwebp",
            "-loop", "0", "-lossless", "0", "-q:v", "75",
            "-compression_level", "2", "-an",
            outputPath
        ], { stdio: ["pipe", "ignore", "pipe"] });

        let stderr = "";
        ff.stderr.on("data", (d) => { stderr += d.toString(); });
        const done = new Promise((resolve, reject) => {
            ff.on("error", reject);
            ff.on("close", (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`)));
        });

        const frame = new Canvas(SIZE, SIZE);
        const f = frame.getContext("2d");
        for (let i = 0; i < FRAMES; i++) {
            f.clearRect(0, 0, SIZE, SIZE);
            // 1) Vành đĩa
            f.drawImage(layerA, 0, 0);
            // 2) Lõi xoay
            const angle = -(i / FRAMES) * Math.PI * 2;
            f.save();
            f.translate(CX, CY);
            f.rotate(angle);
            f.drawImage(coreCanvas, -R_INNER, -R_INNER);
            f.restore();
            // 3) Ô vuông ảnh đè lên trên cùng (che nửa trái của đĩa)
            f.drawImage(layerSq, 0, 0);

            const buf = Buffer.from(f.getImageData(0, 0, SIZE, SIZE).data.buffer);
            if (!ff.stdin.write(buf)) {
                await new Promise((r) => ff.stdin.once("drain", r));
            }
        }
        ff.stdin.end();
        await done;
        return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
    } catch (e) {
        log.error("Lỗi tạo music disc sticker:", e.message);
        return false;
    } finally {
        if (fs.existsSync(tempIn)) try { fs.unlinkSync(tempIn); } catch {}
    }
}

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

export async function createCircularSticker(imageUrl, outputPath) {
    const tempIn = path.join(tempDir, `circle_in_${Date.now()}.png`);
    try {
        await downloadImage(imageUrl, tempIn);
        const filter = "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=rgba,"
            + "geq=r='r(X,Y)':a='if(gt(hypot(X-256,Y-256),256),0,alpha(X,Y))'";
        await runFfmpeg(`"${ffmpegBin}" -y -i "${tempIn}" -vf "${filter}" `
            + `-frames:v 1 -vcodec libwebp -lossless 0 -q:v 75 "${outputPath}"`);
        return fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0;
    } catch (e) {
        log.error("Lỗi tạo circular sticker:", e.message);
        return false;
    } finally {
        if (fs.existsSync(tempIn)) try { fs.unlinkSync(tempIn); } catch {}
    }
}

// Upload file webp/png lên CDN Zalo qua api.uploadAttachment, trả URL public.
// threadId không bắt buộc — sẽ fallback về send2meId (thread chat với chính mình).
export async function uploadStickerToZalo(api, filePath, threadId = null, threadType = 0) {
    if (!api?.uploadAttachment) throw new Error("api.uploadAttachment không khả dụng");
    if (!fs.existsSync(filePath)) throw new Error(`File không tồn tại: ${filePath}`);

    let tid = threadId;
    let ttype = threadType;
    if (!tid) {
        const ctx = typeof api.getContext === "function" ? api.getContext() : null;
        tid = ctx?.send2meId;
        ttype = 0;
        if (!tid) throw new Error("Không có threadId và không lấy được send2meId");
    }

    const res = await api.uploadAttachment(filePath, tid, ttype);
    const item = Array.isArray(res) ? res[0] : res;
    const url = item?.hdUrl || item?.normalUrl || item?.fileUrl || item?.url;
    if (!url || !/^https?:\/\//.test(url)) {
        throw new Error("Upload Zalo không trả về URL hợp lệ");
    }
    return url;
}

// Backward-compat wrapper cho các module cũ (zing, tiktok, spotify, ...).
// Nếu thiếu api thì trả null thay vì throw để không vỡ chuỗi gọi cũ.
export async function uploadStickerFile(filePath, api = null, threadId = null, threadType = 0) {
    try {
        if (!api) {
            log.warn("uploadStickerFile: thiếu api, không upload được sticker");
            return null;
        }
        return await uploadStickerToZalo(api, filePath, threadId, threadType);
    } catch (e) {
        log.warn(`uploadStickerFile lỗi: ${e.message}`);
        return null;
    }
}

const ROUND_R = 40;
const _RND_A = `if(lte(pow(X-min(max(X\\,${ROUND_R})\\,W-${ROUND_R})\\,2)+pow(Y-min(max(Y\\,${ROUND_R})\\,H-${ROUND_R})\\,2)\\,${ROUND_R * ROUND_R})\\,255\\,0)`;
const ROUNDED_FILTER = `format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${_RND_A}'`;
const _RND_A_PRESERVE = `min(alpha(X\\,Y)\\,${_RND_A})`;
const ROUNDED_FILTER_ALPHA = `format=rgba,geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='${_RND_A_PRESERVE}'`;

export function buildRoundedFilter(scaleFilter) {
    return `${scaleFilter},${ROUNDED_FILTER}`;
}
export function buildRemoveBgFilter(scaleFilter) {
    return `format=rgba,${scaleFilter},${ROUNDED_FILTER_ALPHA}`;
}

export function isJxlFile(filePath) {
    try {
        const buf = Buffer.allocUnsafe(12);
        const fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);
        if (buf[0]===0x00 && buf[1]===0x00 && buf[2]===0x00 && buf[3]===0x0c &&
            buf[4]===0x4a && buf[5]===0x58 && buf[6]===0x4c && buf[7]===0x20) return true;
        if (buf[0]===0xff && buf[1]===0x0a) return true;
        return false;
    } catch { return false; }
}

export function isAvifFile(filePath) {
    try {
        const buf = Buffer.allocUnsafe(12);
        const fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);
        const brand = buf.slice(8, 12).toString("ascii");
        const box   = buf.slice(4, 8).toString("ascii");
        return box === "ftyp" && (brand === "avif" || brand === "avis");
    } catch { return false; }
}

function spawnMagick(bin, inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const errs = [];
        let settled = false;
        const mg = spawn(bin, [inputPath, "-flatten", outputPath]);
        mg.stderr.on("data", d => errs.push(String(d)));
        mg.on("error", err => {
            if (settled) return;
            settled = true;
            reject(err);
        });
        mg.on("close", code => {
            if (settled) return;
            settled = true;
            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return resolve();
            const e = new Error(`${bin} code ${code}`);
            e.stderr = errs.join("").slice(-300);
            e.code = code;
            reject(e);
        });
    });
}

let _jxlDecoder = null;        // cached decode function
let _jxlDecoderTried = false;
async function getJsJxlDecoder() {
    if (_jxlDecoderTried) return _jxlDecoder;
    _jxlDecoderTried = true;
    // Thử lần lượt vài thư viện JS thuần để decode JXL (không cần binary hệ thống)
    const candidates = [
        async () => {
            const mod = await import("jxl-oxide");
            const JxlImage = mod.JxlImage || mod.default?.JxlImage;
            if (!JxlImage) return null;
            return async (buf) => {
                const img = new JxlImage();
                await img.feedBytes(buf);
                const frame = await img.renderNextFrame();
                return { width: frame.width, height: frame.height, rgba: frame.data };
            };
        },
        async () => {
            const mod = await import("@jsquash/jxl/decode.js").catch(() => import("@jsquash/jxl"));
            const decode = mod.default || mod.decode;
            if (typeof decode !== "function") return null;
            return async (buf) => {
                const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
                const imgData = await decode(ab);
                return { width: imgData.width, height: imgData.height, rgba: Buffer.from(imgData.data) };
            };
        },
    ];
    for (const make of candidates) {
        try { const fn = await make(); if (fn) { _jxlDecoder = fn; return fn; } } catch {}
    }
    return null;
}

async function jsLibJxlToPng(inputPath, outputPath) {
    const decode = await getJsJxlDecoder();
    if (!decode) throw new Error("Không có thư viện JXL JS (cài 'jxl-oxide' hoặc '@jsquash/jxl')");
    const inBuf = fs.readFileSync(inputPath);
    const { width, height, rgba } = await decode(inBuf);
    const { Canvas, ImageData } = await import("skia-canvas");
    const canvas = new Canvas(width, height);
    const ctx = canvas.getContext("2d");
    const imgData = new ImageData(new Uint8ClampedArray(rgba), width, height);
    ctx.putImageData(imgData, 0, 0);
    const pngBuf = await canvas.toBuffer("png");
    fs.writeFileSync(outputPath, pngBuf);
}

async function magickJxlToPng(inputPath, outputPath) {
    const bins = ["magick", "convert"]; // IM7 → IM6
    let lastErr;
    for (const bin of bins) {
        try {
            await spawnMagick(bin, inputPath, outputPath);
            return;
        } catch (e) {
            lastErr = e;
            if (e?.code === "ENOENT") continue; // binary không có, thử cái kế
            log.warn(`stickerHelper: ${bin} JXL→PNG fail (code=${e.code})${e.stderr ? "\n" + e.stderr : ""}`);
        }
    }
    // Fallback cuối: thư viện JS thuần
    try {
        await jsLibJxlToPng(inputPath, outputPath);
        return;
    } catch (e2) {
        log.error(`stickerHelper: JXL→PNG fail toàn bộ — magick: ${lastErr?.message || "n/a"} | js: ${e2.message}`);
        throw new Error(`không có decoder JXL khả dụng (${e2.message})`);
    }
}

function ffmpegToPngAny(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const errs = [];
        const ff = spawn(ffmpegBin, ["-y", "-i", inputPath, "-frames:v", "1", "-f", "image2", outputPath]);
        ff.stderr.on("data", d => errs.push(String(d)));
        ff.on("close", code => {
            if (code === 0) return resolve();
            log.error(`stickerHelper: ffmpeg→PNG code=${code}\n${errs.join("").slice(-300)}`);
            reject(new Error(`ffmpeg→PNG code ${code}`));
        });
        ff.on("error", reject);
    });
}

export async function normalizeImageToPng(rawPath) {
    const buf12 = Buffer.allocUnsafe(12);
    const fd = fs.openSync(rawPath, "r");
    fs.readSync(fd, buf12, 0, 12, 0);
    fs.closeSync(fd);

    const isJpeg = buf12[0] === 0xFF && buf12[1] === 0xD8;
    const isPng  = buf12[0] === 0x89 && buf12[1] === 0x50;
    const isWebp = buf12[0] === 0x52 && buf12[1] === 0x49 && buf12[8] === 0x57 && buf12[9] === 0x45;
    const isGif  = buf12[0] === 0x47 && buf12[1] === 0x49 && buf12[2] === 0x46;
    if (isJpeg || isPng || isWebp || isGif) return fs.readFileSync(rawPath);

    if (isJxlFile(rawPath)) {
        const outPng = rawPath + "_norm.png";
        try {
            await magickJxlToPng(rawPath, outPng);
            const buf = fs.readFileSync(outPng);
            try { fs.unlinkSync(outPng); } catch {}
            return buf;
        } catch (e) { throw new Error(`Không thể convert JXL: ${e.message}`); }
    }

    const outPng = rawPath + "_norm.png";
    try {
        await ffmpegToPngAny(rawPath, outPng);
        if (!fs.existsSync(outPng) || fs.statSync(outPng).size === 0)
            throw new Error("ffmpeg không tạo được file PNG");
        const buf = fs.readFileSync(outPng);
        try { fs.unlinkSync(outPng); } catch {}
        return buf;
    } catch (e) { throw new Error(`Không thể convert ảnh sang PNG: ${e.message}`); }
}

function ffmpegToPngStrict(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const ff = spawn(ffmpegBin, [
            "-y", "-threads", "1",
            "-i", inputPath,
            "-vf", "select=eq(n\\,0),format=rgba",
            "-frames:v", "1",
            "-vcodec", "png",
            "-pix_fmt", "rgba",
            "-update", "1",
            "-f", "image2",
            outputPath
        ]);
        const errs = [];
        ff.stderr.on("data", d => errs.push(String(d)));
        ff.on("close", code => {
            if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return resolve();
            reject(new Error(`ffmpeg→png code ${code}: ${errs.join("").slice(-200)}`));
        });
        ff.on("error", reject);
    });
}

async function libraryToPng(inputPath, outputPath) {
    let pngBuf = await normalizeImageToPng(inputPath);
    if (!(pngBuf[0] === 0x89 && pngBuf[1] === 0x50)) {
        const tmpSrc = outputPath + ".src";
        fs.writeFileSync(tmpSrc, pngBuf);
        try {
            const { Canvas, loadImage } = await import("skia-canvas");
            const img = await loadImage(tmpSrc);
            const canvas = new Canvas(img.width, img.height);
            canvas.getContext("2d").drawImage(img, 0, 0);
            pngBuf = await canvas.toBuffer("png");
        } finally { try { fs.unlinkSync(tmpSrc); } catch {} }
    }
    fs.writeFileSync(outputPath, pngBuf);
}

export async function convertImageFileToPng(inputPath, outputPath) {
    try {
        await ffmpegToPngStrict(inputPath, outputPath);
        return;
    } catch (e) {
        log.warn(`stickerHelper: ffmpeg→png fail, fallback thư viện — ${e?.message?.slice(0, 160)}`);
        await libraryToPng(inputPath, outputPath);
        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0)
            throw new Error("Không decode được ảnh (ffmpeg + thư viện đều fail)");
    }
}

function isVideoFileMagic(filePath) {
    try {
        const buf = Buffer.alloc(12);
        const fd = fs.openSync(filePath, "r");
        fs.readSync(fd, buf, 0, 12, 0);
        fs.closeSync(fd);
        if (buf.slice(4, 8).toString("ascii") === "ftyp") return true;
        if (buf.slice(0, 4).toString("ascii") === "RIFF" &&
            buf.slice(8, 11).toString("ascii") === "AVI") return true;
        if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return true;
        if (buf.slice(0, 3).toString("ascii") === "FLV") return true;
    } catch {}
    return false;
}

function detectIsVideoWithFfprobe(filePath) {
    return new Promise((resolve) => {
        const ff = spawn(FFPROBE_BIN, ["-v", "quiet", "-print_format", "json", "-show_streams", filePath]);
        let out = "";
        ff.stdout.on("data", d => out += d);
        ff.on("close", () => {
            try {
                const info = JSON.parse(out);
                const hasAudio = info.streams?.some(s => s.codec_type === "audio");
                if (hasAudio) return resolve(true);
                const v = info.streams?.find(s => s.codec_type === "video");
                const dur = parseFloat(v?.duration || "0");
                const frames = parseInt(v?.nb_frames || "0", 10);
                resolve(frames > 30 || dur > 1);
            } catch { resolve(false); }
        });
        ff.on("error", () => resolve(false));
    });
}

export async function isVideoFile(filePath) {
    if (isVideoFileMagic(filePath)) return true;
    return detectIsVideoWithFfprobe(filePath);
}

const CIRCLE_GEQ = "geq=r='r(X\\,Y)':g='g(X\\,Y)':b='b(X\\,Y)':a='if(lte(pow(X-W/2\\,2)+pow(Y-H/2\\,2)\\,pow(min(W\\,H)/2\\,2))\\,alpha(X\\,Y)\\,0)'";

function runFfmpegArgs(args, label) {
    return new Promise((resolve, reject) => {
        const ff = spawn(ffmpegBin, args);
        const errs = [];
        ff.stderr.on("data", d => errs.push(String(d)));
        ff.on("close", code => code === 0 ? resolve() : reject(new Error(`${label} code ${code}\n${errs.join("").slice(-400)}`)));
        ff.on("error", reject);
    });
}

export function circleRotateImageToWebp(inputPath, outputPath, duration = 3, fps = 20, speed = 1) {
    const vf = [
        "scale=512:512:force_original_aspect_ratio=increase",
        "crop=512:512",
        "format=rgba",
        CIRCLE_GEQ,
        `rotate=2*PI*t*${speed}:c=0x00000000:ow=512:oh=512`,
        "format=rgba"
    ].join(",");
    return runFfmpegArgs([
        "-y", "-threads", "1", "-loop", "1", "-i", inputPath, "-vf", vf,
        "-t", String(duration), "-r", String(fps),
        "-c:v", "libwebp", "-lossless", "0", "-compression_level", "2",
        "-q:v", "75", "-loop", "0", "-an", outputPath
    ], "ffmpeg circle-rotate");
}

export function circleRotateVideoToWebp(inputPath, outputPath, duration = 4, fps = 15, speed = 1) {
    const vf = [
        "scale=512:512:force_original_aspect_ratio=increase",
        "crop=512:512",
        "format=rgba",
        CIRCLE_GEQ,
        `rotate=2*PI*t*${speed}:c=0x00000000:ow=512:oh=512`,
        "format=rgba"
    ].join(",");
    return runFfmpegArgs([
        "-y", "-threads", "1", "-i", inputPath, "-vf", vf,
        "-t", String(duration), "-r", String(fps),
        "-c:v", "libwebp", "-lossless", "0", "-compression_level", "2",
        "-q:v", "75", "-loop", "0", "-an", outputPath
    ], "ffmpeg video-circle-rotate");
}

export function circleVideoToWebp(inputPath, outputPath, duration = 4, fps = 15) {
    const vf = [
        "scale=512:512:force_original_aspect_ratio=increase",
        "crop=512:512",
        "format=rgba",
        CIRCLE_GEQ
    ].join(",");
    return runFfmpegArgs([
        "-y", "-threads", "1", "-i", inputPath, "-vf", vf,
        "-t", String(duration), "-r", String(fps),
        "-c:v", "libwebp", "-lossless", "0", "-compression_level", "2",
        "-q:v", "75", "-loop", "0", "-an", outputPath
    ], "ffmpeg video-circle");
}

export async function sendSpinningSticker(api, imageUrl, threadId, threadType, prefix = "spin") {
    if (!imageUrl) return false;
    const spinPath = path.join(tempDir, `${prefix}_${Date.now()}.webp`);
    try {
        if (!await createSpinningSticker(imageUrl, spinPath)) return false;
        const stickerUrl = await uploadStickerToZalo(api, spinPath, threadId, threadType);
        await api.sendCustomerSticker(stickerUrl, stickerUrl, threadId, threadType, { width: 512, height: 512 });
        return true;
    } catch (e) {
        log.warn(`Gửi sticker xoay lỗi: ${e.message}`);
        return false;
    } finally {
        if (fs.existsSync(spinPath)) try { fs.unlinkSync(spinPath); } catch {}
    }
}

// Helper dùng chung cho mọi module nhạc: nhận ctx + url ảnh bìa, tự lo phần còn lại.
// Hỗ trợ cả 2 dạng gọi: (ctx, imageUrl) hoặc (api, imageUrl, threadId, threadType).
export async function sendMusicSticker(ctxOrApi, imageUrl, threadId, threadType) {
    if (!imageUrl) return false;
    let api, tid, ttype;
    if (ctxOrApi && typeof ctxOrApi === "object" && ctxOrApi.api) {
        api = ctxOrApi.api;
        tid = ctxOrApi.threadId;
        ttype = ctxOrApi.threadType;
    } else {
        api = ctxOrApi;
        tid = threadId;
        ttype = threadType;
    }

    const discPath = path.join(tempDir, `music_disc_${Date.now()}.webp`);
    try {
        const ok = await createMusicDiscSticker(imageUrl, discPath);
        if (!ok) return sendSpinningSticker(api, imageUrl, tid, ttype, "music_spin");
        const url = await uploadStickerToZalo(api, discPath, tid, ttype);
        await api.sendCustomerSticker(url, url, tid, ttype, { width: 512, height: 512 });
        return true;
    } catch (e) {
        log.warn(`Gửi music disc sticker lỗi, fallback spinner: ${e.message}`);
        return sendSpinningSticker(api, imageUrl, tid, ttype, "music_spin");
    } finally {
        if (fs.existsSync(discPath)) try { fs.unlinkSync(discPath); } catch {}
    }
}
