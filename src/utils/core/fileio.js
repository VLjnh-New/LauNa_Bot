import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import { log } from "../../logger.js";

/**
 * Upload file lên file.io (link tự xóa sau 1 lần tải)
 */
export async function uploadToFileIo(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const form = new FormData();
        form.append("file", fs.createReadStream(filePath));
        const res = await axios.post("https://file.io", form, {
            headers: form.getHeaders(),
            timeout: 60000,
            maxBodyLength: Infinity
        });
        const link = res.data?.link;
        return typeof link === "string" ? link : null;
    } catch (e) {
        log.error("Lỗi uploadToFileIo:", e.message);
        return null;
    }
}
