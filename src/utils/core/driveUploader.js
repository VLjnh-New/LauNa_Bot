/**
 * driveUploader.js
 * Tiện ích trích xuất media từ tin nhắn Zalo và upload lên Google Drive
 * Hỗ trợ: Video, Audio (MP3/M4A...), Ảnh, File đính kèm, URL trực tiếp
 */
import { createWriteStream, existsSync, unlinkSync, statSync } from "node:fs";
import path from "node:path";
import axios from "axios";
import { ffmpegRun, ffprobeAsync } from "./ffmpegHelper.js";
import { log } from "../../logger.js";
import { getDesktopUA } from "./userAgents.js";
import { tempDir } from "./io-json.js";
import { uploadFile, ensureFolder, isDriveConfigured, getRootFolderId } from "./diver.js";

// ─── MIME TYPE MAP ───────────────────────────────────────────────────────────

const MIME_MAP = {
    mp4: "video/mp4", mkv: "video/x-matroska", avi: "video/x-msvideo",
    mov: "video/quicktime", webm: "video/webm", flv: "video/x-flv",
    mp3: "audio/mpeg", m4a: "audio/mp4", ogg: "audio/ogg",
    flac: "audio/flac", wav: "audio/wav", aac: "audio/aac",
    opus: "audio/opus", wma: "audio/x-ms-wma",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    gif: "image/gif", webp: "image/webp", bmp: "image/bmp",
    pdf: "application/pdf", zip: "application/zip",
    rar: "application/x-rar-compressed", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
};

function getMime(filename) {
    const ext = filename.split(".").pop().toLowerCase();
    return MIME_MAP[ext] || "application/octet-stream";
}

// ─── MEDIA TYPE DETECTION ────────────────────────────────────────────────────

const VIDEO_EXTS  = new Set(["mp4", "mkv", "avi", "mov", "webm", "flv", "3gp", "ts"]);
const AUDIO_EXTS  = new Set(["mp3", "m4a", "ogg", "flac", "wav", "aac", "opus", "wma", "amr"]);
const IMAGE_EXTS  = new Set(["jpg", "jpeg", "png", "gif", "webp", "bmp", "heic"]);

export function detectMediaType(filename = "") {
    const ext = filename.split(".").pop().toLowerCase();
    if (VIDEO_EXTS.has(ext)) return "video";
    if (AUDIO_EXTS.has(ext)) return "audio";
    if (IMAGE_EXTS.has(ext)) return "image";
    return "file";
}

const FOLDER_BY_TYPE = {
    video: "Videos",
    audio: "Audio",
    image: "Images",
    file:  "Files",
};

// ─── URL EXTRACTION FROM ZALO MESSAGE ───────────────────────────────────────

/**
 * Trích xuất tất cả URL media từ dữ liệu attach của Zalo
 * @param {any} attachData
 * @returns {{ url: string, name: string }[]}
 */
export function extractMediaFromAttach(attachData) {
    if (!attachData) return [];
    const results = [];

    function tryAdd(obj) {
        if (!obj) return;
        const url = obj.hdUrl || obj.fileUrl || obj.url || obj.href || obj.thumbUrl;
        const name = obj.title || obj.name || obj.fileName || null;
        if (url && typeof url === "string" && url.startsWith("http")) {
            results.push({ url: url.trim(), name });
        }
    }

    try {
        let data = attachData;
        if (typeof data === "string") {
            try { data = JSON.parse(data); } catch { return []; }
        }

        if (Array.isArray(data)) {
            for (const item of data) {
                tryAdd(item);
                if (item.params) tryAdd(typeof item.params === "string" ? JSON.parse(item.params) : item.params);
                if (item.attachments) for (const a of item.attachments) tryAdd(a);
            }
        } else {
            tryAdd(data);
            if (data.params) tryAdd(typeof data.params === "string" ? JSON.parse(data.params) : data.params);
            if (data.attachments) for (const a of data.attachments) tryAdd(a);
        }
    } catch {}

    return results;
}

/**
 * Lấy danh sách media từ tin nhắn (attachment trực tiếp + quote)
 * @param {object} msgData - message.data từ Zalo
 * @returns {{ url: string, name: string }[]}
 */
export function extractMediaFromMessage(msgData) {
    if (!msgData) return [];
    const items = [];

    const raw = msgData.msgContent || msgData;

    // 1. Attachment trực tiếp
    const attach = raw.attach || msgData.attach;
    if (attach) items.push(...extractMediaFromAttach(attach));

    // 2. Attachments array
    const attachments = raw.attachments || msgData.attachments || [];
    if (Array.isArray(attachments)) {
        for (const a of attachments) {
            const url = a.hdUrl || a.fileUrl || a.url || a.href;
            const name = a.title || a.name || a.fileName || null;
            if (url) items.push({ url, name });
        }
    }

    // 3. Từ quote
    const quote = msgData.quote || raw.quote;
    if (quote) {
        const qa = quote.attach || quote.msgContent?.attach;
        if (qa) items.push(...extractMediaFromAttach(qa));
        const qAtts = quote.attachments || quote.msgContent?.attachments || [];
        for (const a of qAtts) {
            const url = a.hdUrl || a.fileUrl || a.url || a.href;
            const name = a.title || a.name || null;
            if (url) items.push({ url, name });
        }
    }

    // Loại trùng
    const seen = new Set();
    return items.filter(i => {
        if (seen.has(i.url)) return false;
        seen.add(i.url);
        return true;
    });
}

// ─── FILTER SKIP ─────────────────────────────────────────────────────────────

// Chỉ bỏ qua nếu URL không phải media thực — không lọc theo tên để tránh false positive
// (Zalo đặt tên "[SYSTEM NOTIFICATION]" cho nhiều loại video thường)
function isNonMediaUrl(url) {
    if (!url) return true;
    // Chỉ bỏ qua URL hệ thống Zalo rõ ràng
    return /zalo\.me\/system/i.test(url);
}

// ─── DOWNLOAD ────────────────────────────────────────────────────────────────

/**
 * Download URL về file tạm, trả về đường dẫn file
 * @param {string} url
 * @param {string|null} suggestedName
 * @returns {Promise<{ filePath: string, fileName: string, sizeMB: string }>}
 */
function sanitizeFileName(name, ext = "") {
    // Xóa ký tự điều khiển, xuống dòng, trim khoảng trắng
    let base = name
        .replace(/[\r\n\t]+/g, " ")           // newline → space
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "") // ký tự không hợp lệ
        .trim()
        .slice(0, 60)                           // tối đa 60 ký tự
        .trim();
    if (!base) base = `file_${Date.now()}`;
    return base + ext;
}

export async function downloadToTemp(url, suggestedName = null) {
    const res = await axios.get(url, {
        responseType: "stream",
        timeout: 120000,
        maxContentLength: 500 * 1024 * 1024,
        headers: { "User-Agent": getDesktopUA() },
    });

    // Đoán extension từ Content-Type
    const ct = res.headers["content-type"] || "";
    const ctMap = {
        "video/mp4": ".mp4", "audio/mpeg": ".mp3", "audio/mp4": ".m4a",
        "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif",
        "image/webp": ".webp", "audio/ogg": ".ogg", "audio/flac": ".flac",
        "video/webm": ".webm", "video/quicktime": ".mov",
    };
    const ctExt = ctMap[ct.split(";")[0].trim()] || "";

    // Đoán tên file
    let rawName = suggestedName;
    if (!rawName) {
        const cd = res.headers["content-disposition"] || "";
        const m  = cd.match(/filename[^;=\n]*=([^;\n]*)/);
        if (m) rawName = m[1].replace(/['"]/g, "").trim();
    }
    if (!rawName) {
        rawName = path.basename(url.split("?")[0]) || `file_${Date.now()}`;
    }

    // Tách extension từ tên gốc, ưu tiên Content-Type nếu có
    let ext  = ctExt || path.extname(rawName) || ".bin";
    let base = path.basename(rawName, path.extname(rawName));

    const fileName = sanitizeFileName(base, ext);
    const safePart = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const filePath = path.join(tempDir, `drive_${Date.now()}_${safePart}`);

    await new Promise((resolve, reject) => {
        const ws = createWriteStream(filePath);
        res.data.pipe(ws);
        ws.on("finish", resolve);
        ws.on("error", reject);
    });

    const sizeMB = (statSync(filePath).size / 1024 / 1024).toFixed(2);
    return { filePath, fileName, sizeMB };
}

// ─── UPLOAD FILE LOCAL → DRIVE (TỰ PHÂN LOẠI) ───────────────────────────────

/**
 * Upload một file local lên Drive, tự phân loại vào subfolder theo loại file.
 * Không cần download trước — dùng trực tiếp từ đường dẫn local.
 * @param {string} filePath  - đường dẫn file local
 * @param {string} rootFolder - folder gốc trên Drive (default "LauNa_Bot")
 * @returns {Promise<{ id, name, rawLink, webViewLink, mimeType, sizeMB, mediaType, subFolder }>}
 */
export async function uploadFileWithAutoClassify(filePath, rootFolder = "LauNa_Bot") {
    if (!isDriveConfigured()) throw new Error("Google Drive chưa cấu hình");
    if (!existsSync(filePath)) throw new Error(`File không tồn tại: ${filePath}`);

    const fileName  = path.basename(filePath);
    const mediaType = detectMediaType(fileName);
    const subFolder = FOLDER_BY_TYPE[mediaType];

    // Ưu tiên dùng root_folder_id đã pin; nếu chưa có → tìm/tạo theo tên
    const rootId = getRootFolderId() || await ensureFolder(rootFolder);
    const subId  = await ensureFolder(subFolder, rootId);
    const result = await uploadFile(filePath, subId, fileName);

    return { ...result, mediaType, subFolder };
}

// ─── UPLOAD URL → DRIVE (TỰ PHÂN LOẠI) ──────────────────────────────────────

/**
 * Upload một URL lên Google Drive với tổ chức folder theo loại media
 * @param {string} url
 * @param {string|null} suggestedName
 * @param {string} rootFolder - tên folder gốc trên Drive
 * @returns {Promise<object>} kết quả upload
 */
export async function uploadUrlToDrive(url, suggestedName = null, rootFolder = "LauNa_Bot") {
    if (!isDriveConfigured()) throw new Error("Google Drive chưa được cấu hình! Cần GDRIVE_REFRESH_TOKEN.");

    const { filePath, fileName, sizeMB } = await downloadToTemp(url, suggestedName);
    const mediaType = detectMediaType(fileName);
    const subFolder = FOLDER_BY_TYPE[mediaType];

    try {
        const rootId = getRootFolderId() || await ensureFolder(rootFolder);
        const subId  = await ensureFolder(subFolder, rootId);
        const result = await uploadFile(filePath, subId, fileName);
        return { ...result, mediaType, subFolder, sizeMB };
    } finally {
        if (existsSync(filePath)) unlinkSync(filePath);
    }
}

/**
 * Upload nhiều URL cùng lúc lên Drive
 * @param {{ url: string, name: string|null }[]} items
 * @param {string} rootFolder
 * @param {Function} onProgress - callback(doneCount, totalCount, currentName)
 */
export async function uploadMultipleUrlsToDrive(items, rootFolder = "LauNa_Bot", onProgress = null) {
    const results = [];
    for (let i = 0; i < items.length; i++) {
        const { url, name } = items[i];
        if (onProgress) onProgress(i, items.length, name || url.split("/").pop());
        try {
            const r = await uploadUrlToDrive(url, name, rootFolder);
            results.push({ ok: true, ...r });
        } catch (e) {
            log.error("[DriveUploader] Lỗi upload:", e.message);
            results.push({ ok: false, name: name || "?", url, error: e.message });
        }
    }
    return results;
}

/**
 * Upload từ tin nhắn Zalo (tự động trích xuất attachment/quote)
 * @param {object} msgData - message.data
 * @param {string[]} extraUrls - URL bổ sung từ args
 * @param {string} rootFolder
 * @param {Function} onProgress
 */
export async function uploadFromZaloMessage(msgData, extraUrls = [], rootFolder = "LauNa_Bot", onProgress = null) {
    const rawItems = extractMediaFromMessage(msgData);

    // Thêm URL từ args nếu có
    for (const url of extraUrls) {
        if (url.startsWith("http") && !rawItems.some(i => i.url === url)) {
            rawItems.push({ url, name: null });
        }
    }

    // Chỉ bỏ qua URL trông rõ ràng là notification hệ thống — không lọc theo tên file
    const items = rawItems.filter(({ url }) => {
        if (isNonMediaUrl(url)) {
            log.info(`[DriveUploader] Bỏ qua URL hệ thống: ${(url || "").slice(0, 80)}`);
            return false;
        }
        return true;
    });

    if (items.length === 0) return { count: 0, results: [], skipped: rawItems.length };

    const results = await uploadMultipleUrlsToDrive(items, rootFolder, onProgress);
    return { count: items.length, results, skipped: rawItems.length - items.length };
}

// ─── NÉN VIDEO + UPLOAD DRIVE (THAY CLOUDINARY) ──────────────────────────────

/**
 * Nén video bằng FFmpeg CRF (chất lượng cố định, giữ độ nét) rồi upload lên Drive.
 * Link trả về dựa vào file ID — bền vĩnh, không phụ thuộc token.
 *
 * @param {string}  filePath   - đường dẫn video local
 * @param {string}  rootFolder - folder gốc Drive (default "LauNa_Bot")
 * @param {object}  options
 * @param {number}  options.crf          - Constant Rate Factor (0-51, càng nhỏ càng nét, default 22)
 * @param {string}  options.preset       - ffmpeg preset: ultrafast→veryslow (default "medium")
 * @param {string}  options.audioBitrate - bitrate âm thanh (default "128k")
 * @param {number}  options.maxWidthPx   - scale xuống nếu rộng hơn (default 1920, 0=không scale)
 * @returns {Promise<{ id, name, rawLink, webViewLink, mimeType, sizeMB, mediaType, origSizeMB }>}
 */
export async function uploadVideoWithCompress(filePath, rootFolder = "LauNa_Bot", options = {}) {
    if (!isDriveConfigured()) throw new Error("Google Drive chưa cấu hình");
    if (!existsSync(filePath)) throw new Error(`File không tồn tại: ${filePath}`);

    const {
        crf          = 23,
        preset       = "veryfast",
        audioBitrate = "192k",
        maxWidthPx   = 1920,
    } = options;

    const origSizeMBNum = statSync(filePath).size / 1024 / 1024;
    const ext      = path.extname(filePath).toLowerCase() || ".mp4";
    const baseName = path.basename(filePath, ext);
    const compressed = path.join(tempDir, `drv_cmp_${Date.now()}${ext}`);

    try {
        // Kiểm tra codec — nếu đã là H264 và nhỏ (< 100MB) → stream copy, nhanh hơn nhiều
        let usedStreamCopy = false;
        if (origSizeMBNum < 100) {
            try {
                const meta = await ffprobeAsync(filePath).catch(() => null);
                const vCodec = meta?.streams?.find(s => s.codec_type === "video")?.codec_name || "";
                if (vCodec === "h264") {
                    const copyArgs = [
                        "-y", "-i", filePath,
                        "-c:v", "copy",
                        "-c:a", "aac", "-b:a", audioBitrate,
                        "-movflags", "+faststart",
                        compressed
                    ];
                    await ffmpegRun(copyArgs, 120000);
                    log.info(`[driveUploader] Stream copy H264 — ${origSizeMBNum.toFixed(1)}MB (không re-encode)`);
                    usedStreamCopy = true;
                }
            } catch {}
        }

        if (!usedStreamCopy) {
            const args = ["-y", "-i", filePath, "-c:v", "libx264", "-crf", String(crf), "-preset", preset, "-movflags", "+faststart"];
            if (maxWidthPx > 0) args.push("-vf", `scale='min(${maxWidthPx},iw)':-2`);
            args.push("-c:a", "aac", "-b:a", audioBitrate, compressed);

            try {
                log.info(`[driveUploader] Re-encode libx264 CRF${crf} ${preset} — ${origSizeMBNum.toFixed(1)}MB`);
                await ffmpegRun(args, 600000);
            } catch (encodeErr) {
                // Fallback: stream copy khi codec không giải mã được (vd: bvc2, av1 custom...)
                log.warn(`[driveUploader] Encode thất bại (${String(encodeErr.message).slice(0, 80)}), thử stream copy...`);
                const copyArgs = ["-y", "-i", filePath, "-c:v", "copy", "-c:a", "aac", "-b:a", audioBitrate, "-movflags", "+faststart", compressed];
                await ffmpegRun(copyArgs, 600000);
            }
        }

        const rootId  = getRootFolderId() || await ensureFolder(rootFolder);
        const videoId = await ensureFolder("Videos", rootId);
        const compSizeMB = (statSync(compressed).size / 1024 / 1024).toFixed(1);
        log.info(`[driveUploader] Upload ${compSizeMB}MB → Drive`);
        const result  = await uploadFile(compressed, videoId, `${baseName}${ext}`);
        return { ...result, mediaType: "video", subFolder: "Videos", origSizeMB: origSizeMBNum.toFixed(2) };

    } finally {
        if (existsSync(compressed)) try { unlinkSync(compressed); } catch {}
    }
}
