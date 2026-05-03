import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";

const TOKEN_PATH = path.resolve(process.cwd(), "tokens.json");

function getApiKey() {
    try {
        const t = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
        return t?.removebg?.apiKey || null;
    } catch { return null; }
}

function detectFileType(buf) {
    if (!buf || buf.length < 12) return { ext: "jpg", mime: "image/jpeg" };
    // JPEG
    if (buf[0] === 0xFF && buf[1] === 0xD8) return { ext: "jpg", mime: "image/jpeg" };
    // PNG
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)
        return { ext: "png", mime: "image/png" };
    // WebP (RIFF....WEBP)
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)
        return { ext: "webp", mime: "image/webp" };
    // GIF
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)
        return { ext: "gif", mime: "image/gif" };
    // MP4 / video (ftyp box — có thể ở offset 4 hoặc offset khác)
    if (buf.length >= 12) {
        for (let offset = 0; offset <= Math.min(buf.length - 8, 64); offset += 4) {
            const box = buf.slice(offset + 4, offset + 8).toString("ascii");
            if (box === "ftyp" || box === "moov" || box === "mdat" || box === "free" || box === "skip") {
                return { ext: "mp4", mime: "video/mp4" };
            }
        }
    }
    // AVI (RIFF....AVI )
    if (buf.length >= 12 &&
        buf.slice(0, 4).toString("ascii") === "RIFF" &&
        buf.slice(8, 12).toString("ascii") === "AVI ")
        return { ext: "avi", mime: "video/avi" };
    // MKV / WebM
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3)
        return { ext: "mkv", mime: "video/webm" };
    return { ext: "jpg", mime: "image/jpeg" };
}

export async function removeBackground(inputBuffer) {
    const apiKey = getApiKey();

    const { ext, mime } = detectFileType(inputBuffer);
    if (mime.startsWith("video/") || ["mp4","avi","mkv","webm","mov","flv"].includes(ext)) {
        throw new Error(`File này là video (${ext.toUpperCase()}), không thể xóa nền!\n💡 Hãy reply vào ảnh (jpg/png/webp) nhé~`);
    }

    const filename = `image.${ext}`;
    const form = new FormData();
    form.append("image_file", inputBuffer, { filename, contentType: mime });
    form.append("size", "auto");

    const headers = {
        ...form.getHeaders(),
    };

    if (apiKey) {
        headers["X-Api-Key"] = apiKey;
    } else {
        throw new Error(
            "Chưa cấu hình removebg.apiKey trong tokens.json!\n" +
            "→ Lấy API key miễn phí tại: https://www.remove.bg/api\n" +
            "→ Thêm vào tokens.json: \"removebg\": { \"apiKey\": \"your-key\" }"
        );
    }

    let response;
    try {
        response = await axios.post(
            "https://api.remove.bg/v1.0/removebg",
            form,
            {
                headers,
                responseType: "arraybuffer",
                timeout: 60000,
            }
        );
    } catch (e) {
        const status = e?.response?.status;
        const body = e?.response?.data
            ? Buffer.from(e.response.data).toString("utf8").slice(0, 300)
            : "";
        if (status === 402) throw new Error("Remove.bg hết credit! Mua thêm tại remove.bg");
        if (status === 403) throw new Error("Remove.bg: API key không hợp lệ hoặc hết hạn!");
        if (status === 429) throw new Error("Remove.bg: gửi quá nhiều, thử lại sau nhé!");
        throw new Error(`Remove.bg lỗi HTTP ${status || e?.code || e?.message}${body ? `: ${body}` : ""}`);
    }

    if (response.status === 200 && response.data?.byteLength > 500) {
        return Buffer.from(response.data);
    }
    throw new Error(`Remove.bg trả về status ${response.status}`);
}

export async function scanWebProviders() {
    const apiKey = getApiKey();
    return [
        {
            provider: "Remove.bg",
            status: apiKey ? "ok" : "no_key",
            credits: apiKey
                ? "Production mode (có API key)"
                : "Chưa cấu hình apiKey",
        },
    ];
}
