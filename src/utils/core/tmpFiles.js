import fs from "node:fs";
import { log } from "../../logger.js";
import { uploadToFileIo } from "./fileio.js";

/**
 * Upload file lên Zalo CDN (ưu tiên) hoặc file.io (fallback, link 1 lần)
 */
export async function uploadToTmpFiles(filePath, api = null, threadId = null, threadType = null) {
    try {
        if (!fs.existsSync(filePath)) return null;

        if (api && threadId) {
            const results = await api.uploadAttachment(filePath, threadId, threadType);
            if (results && results.length > 0) {
                const url = results[0].fileUrl || results[0].url || results[0].hdUrl;
                if (url) return url;
            }
        }

        return await uploadToFileIo(filePath);
    } catch (e) {
        log.error("Lỗi upload file:", e.message);
        return null;
    }
}
