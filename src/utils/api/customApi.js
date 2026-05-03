import { statSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { ffprobeAsync, ffmpegRun } from "../core/ffmpegHelper.js";
import { tempDir } from "../core/io-json.js";
import { compressIfNeeded } from "../core/videoCompress.js";

// Các method thuần Zalo (sendVoiceNative / sendImageEnhanced / sendVideoEnhanced /
// uploadVoice) đã được đẩy thẳng vào thư viện api-custom/apis/media.js.
// File này chỉ còn 2 ORCHESTRATOR có dependency ngoài (ffmpeg local):
//   • sendVoiceUnified  – encode AAC chuẩn + upload zcloud + sendVoiceNative
//   • sendVideoUnified  – nén nếu cần + upload zcloud + sendVideoEnhanced
// Upload đi thẳng Zalo zcloud (api.uploadAttachment) — nhanh, ổn định, không cần
// service ngoài (Drive/Cloudinary).
export function registerCustomApi(api, log) {

    api.custom("sendVoiceUnified", async ({ props }) => {
        const { filePath, threadId, threadType } = props;
        let finalPath = filePath, tempFile = null;
        try {
            // Bypass /voice/upload (validate strict cho voice app ghi). Đặt đuôi
            // .dat → library tự định tuyến /asyncfile/upload (không validate).
            // Library vẫn nối /ljzi.aac vào URL → Zalo client nhận diện là voice.
            const srcExt = path.extname(filePath).toLowerCase();
            const srcSize = (() => { try { return statSync(filePath).size; } catch { return 0; } })();
            tempFile = path.join(tempDir, `voice_${Date.now()}.dat`);
            const t0 = Date.now();
            // Tối ưu tốc độ: chỉ .aac/.m4a (đã chứa AAC) mới REMUX được
            // sang ADTS bằng -c:a copy (gần như tức thì).
            // .mp3 và format khác phải re-encode sang AAC LC.
            if ([".aac", ".m4a"].includes(srcExt)) {
                await ffmpegRun([
                    "-y", "-i", filePath,
                    "-vn", "-c:a", "copy",
                    "-f", "adts",
                    tempFile
                ]);
                log.info(`[Voice] remux ${srcExt} (${(srcSize/1024/1024).toFixed(1)}MB) ${Date.now()-t0}ms`);
            } else {
                const targetBitrate = srcSize > 15 * 1024 * 1024 ? "128k" : "192k";
                await ffmpegRun([
                    "-y", "-i", filePath,
                    "-vn",
                    "-c:a", "aac", "-profile:a", "aac_low",
                    "-b:a", targetBitrate,
                    "-ar", "44100", "-ac", "2",
                    "-threads", "0",
                    "-f", "adts",
                    tempFile
                ]);
                log.info(`[Voice] encode AAC ${targetBitrate} (src ${(srcSize/1024/1024).toFixed(1)}MB) ${Date.now()-t0}ms`);
            }
            finalPath = tempFile;
            const metadata = await ffprobeAsync(finalPath);
            const duration = Math.round((metadata.format.duration || 0) * 1000);
            const fileSize = metadata.format.size || statSync(finalPath).size;
            const uploadResults = await api.uploadAttachment(finalPath, threadId, threadType);
            if (!uploadResults?.length) throw new Error("Upload lên Zalo thất bại.");
            let remoteUrl = uploadResults[0].fileUrl || uploadResults[0].url;
            if (!remoteUrl.endsWith(".aac")) remoteUrl += `/ljzi.aac`;
            return await api.sendVoiceNative({ voiceUrl: remoteUrl, duration, fileSize, threadId, threadType });
        } finally {
            if (tempFile && existsSync(tempFile)) try { unlinkSync(tempFile); } catch { }
        }
    });

    api.custom("sendVideoUnified", async ({ props }) => {
        const { videoPath, videoUrl, thumbnailUrl, msg, threadId, threadType } = props;
        let finalUrl = videoUrl;
        const finalThumb = thumbnailUrl || "https://drive.google.com/uc?id=1pCQPRic8xPxbgUaPSIczb94S4RDdWDHK&export=download";
        let duration = 0, width = 720, height = 1280, fileSize = 0;

        if (videoPath && existsSync(videoPath)) {
            try {
                const currentSize = statSync(videoPath).size;

                const metadata = await ffprobeAsync(videoPath);
                duration = Math.round((metadata.format.duration || 0) * 1000);
                fileSize = metadata.format.size || currentSize;
                const stream = metadata.streams.find(s => s.width && s.height);
                if (stream) { width = stream.width; height = stream.height; }

                // Upload thẳng Zalo zcloud (nhanh, ổn). Nén local nếu vượt giới hạn.
                const { path: uploadPath, cleanup: compCleanup } = await compressIfNeeded(videoPath, {
                    onStatus: (mb) => log.warn(`[Video] Nén local ${mb.toFixed(0)}MB trước khi upload zcloud...`)
                });
                try {
                    const uploadResults = await api.uploadAttachment(uploadPath, threadId, threadType);
                    if (!uploadResults?.length) throw new Error("Upload Zalo zcloud thất bại");
                    finalUrl = uploadResults[0].fileUrl || uploadResults[0].url;
                    fileSize = statSync(uploadPath).size;
                } finally {
                    compCleanup();
                }
            } finally {
                try { if (existsSync(videoPath)) unlinkSync(videoPath); } catch { }
            }
        }

        return await api.sendVideoEnhanced({
            videoUrl: finalUrl,
            thumbnailUrl: finalThumb,
            duration: Math.floor(Number(duration) || 0),
            width: Number(width) || 720,
            height: Number(height) || 1280,
            fileSize: Math.floor(Number(fileSize) || 0) || 1024,
            msg,
            threadId,
            threadType
        });
    });
}
