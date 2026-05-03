import fs from "node:fs";
import path from "node:path";
import { ffmpegRun, ffprobeAsync } from "./ffmpegHelper.js";
import { log } from "../../logger.js";
import { tempDir } from "./io-json.js";

const VIDEO_EXTS = new Set([".mp4", ".mkv", ".avi", ".mov", ".webm", ".flv", ".wmv", ".m4v", ".ts", ".3gp"]);

const ZALO_LIMIT_MB      = 1024;
const COMPRESS_THRESHOLD = 900;

function fileMB(p) {
    try { return fs.statSync(p).size / (1024 * 1024); } catch { return 0; }
}

export function isVideoFile(filePath) {
    return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

async function _crf(input, output, crf) {
    await ffmpegRun([
        "-y", "-i", input,
        "-c:v", "libx264",
        "-crf", String(crf),
        "-preset", "veryfast",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        output
    ], 30 * 60 * 1000);
}

async function _bitrate(input, output, targetMB) {
    const meta = await ffprobeAsync(input).catch(() => null);
    const duration = meta?.format?.duration || 60;
    const targetBits = targetMB * 1024 * 1024 * 8;
    const audioBps   = 192 * 1000;
    const videoBps   = Math.max(500, Math.floor((targetBits / duration - audioBps) / 1000));
    await ffmpegRun([
        "-y", "-i", input,
        "-c:v", "libx264", "-b:v", `${videoBps}k`,
        "-c:a", "aac", "-b:a", "192k",
        "-preset", "veryfast", "-movflags", "+faststart",
        output
    ], 30 * 60 * 1000);
}

/**
 * Nén video nếu vượt ngưỡng Zalo.
 *
 * @param {string} filePath - Đường dẫn file gốc
 * @param {object} [opts]
 * @param {(msg: string) => void} [opts.onStatus] - Callback thông báo trạng thái khi bắt đầu nén
 * @returns {Promise<{ path: string, cleanup: () => void }>}
 *   path    = đường dẫn file cần upload (gốc hoặc file nén tạm)
 *   cleanup = gọi để xoá file nén tạm (nếu có)
 */
export async function compressIfNeeded(filePath, { onStatus } = {}) {
    if (!fs.existsSync(filePath) || !isVideoFile(filePath)) {
        return { path: filePath, cleanup: () => {} };
    }

    const sizeMB = fileMB(filePath);
    if (sizeMB <= COMPRESS_THRESHOLD) {
        return { path: filePath, cleanup: () => {} };
    }

    const outPath = path.join(tempDir, `zcomp_${Date.now()}.mp4`);
    const cleanup = () => { if (fs.existsSync(outPath)) try { fs.unlinkSync(outPath); } catch {} };

    if (onStatus) onStatus(sizeMB);
    log.warn(`[videoCompress] ${path.basename(filePath)} là ${sizeMB.toFixed(0)}MB — đang nén...`);

    try {
        await _crf(filePath, outPath, 28);
        const after = fileMB(outPath);
        log.info(`[videoCompress] CRF28 → ${after.toFixed(0)}MB`);

        if (after > ZALO_LIMIT_MB) {
            log.warn(`[videoCompress] Vẫn còn ${after.toFixed(0)}MB — nén mạnh hơn (bitrate target)...`);
            await _bitrate(filePath, outPath, ZALO_LIMIT_MB * 0.85);
            log.info(`[videoCompress] Bitrate → ${fileMB(outPath).toFixed(0)}MB`);
        }

        if (!fs.existsSync(outPath) || fileMB(outPath) === 0) {
            log.warn("[videoCompress] File nén rỗng — dùng file gốc");
            cleanup();
            return { path: filePath, cleanup: () => {} };
        }

        return { path: outPath, cleanup };
    } catch (e) {
        log.error(`[videoCompress] Lỗi nén: ${e.message}`);
        cleanup();
        return { path: filePath, cleanup: () => {} };
    }
}
