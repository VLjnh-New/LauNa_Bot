import axios from "axios";
import FormData from "form-data";
import fs from "node:fs";
import path from "node:path";
import { log } from "../../logger.js";
import { getDesktopUA } from "./userAgents.js";

function getCloudinaryCfg() {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "tokens.json"), "utf-8"));
        return cfg.cloudinary || {};
    } catch { return {}; }
}

async function cloudinaryUpload(filePath, resourceType = "auto") {
    const { cloud = "dhbw0ivzj", preset = "bot_upload", apiKey } = getCloudinaryCfg();
    const url = `https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/upload`;
    const form = new FormData();
    form.append("file", fs.createReadStream(filePath));
    form.append("upload_preset", preset);
    if (apiKey) form.append("api_key", apiKey);
    const res = await axios.post(url, form, {
        headers: form.getHeaders(),
        timeout: 300000,
        maxBodyLength: Infinity
    });
    return res.data;
}

/**
 * Upload file từ URL lên Cloudinary
 */
export async function uploadFromUrl(url, headers = {}) {
    const ext = (url.split("?")[0].split(".").pop() || "mp4").slice(0, 5);
    const tempPath = path.join(process.cwd(), `cld_tmp_${Date.now()}.${ext}`);
    try {
        const response = await axios({
            method: "GET",
            url,
            responseType: "stream",
            timeout: 60000,
            headers: {
                "User-Agent": getDesktopUA(),
                ...headers
            }
        });
        const writer = fs.createWriteStream(tempPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
        });
        const data = await cloudinaryUpload(tempPath);
        return data?.secure_url || null;
    } catch (e) {
        log.error("Lỗi uploadFromUrl (Cloudinary):", e.message);
        throw e;
    } finally {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    }
}

/**
 * Upload file từ máy lên Cloudinary
 */
export async function uploadFromFile(filePath) {
    try {
        const data = await cloudinaryUpload(filePath);
        return data?.secure_url || null;
    } catch (e) {
        log.error("Lỗi uploadFromFile (Cloudinary):", e.message);
        throw e;
    }
}

/**
 * Upload video lên Cloudinary và trả về URL đã nén với q_auto/vc_auto
 * @param {string} filePath - Đường dẫn file video local
 * @returns {{ originalUrl: string, compressedUrl: string, publicId: string }}
 */
export async function uploadVideoAndCompress(filePath) {
    const { cloud = "dhbw0ivzj" } = getCloudinaryCfg();
    const data = await cloudinaryUpload(filePath, "video");
    if (!data?.secure_url || !data?.public_id) {
        throw new Error("Cloudinary upload thất bại hoặc không trả về URL");
    }
    const publicId = data.public_id;
    const compressedUrl = `https://res.cloudinary.com/${cloud}/video/upload/q_auto,vc_auto,f_mp4/${publicId}.mp4`;
    return {
        originalUrl: data.secure_url,
        compressedUrl,
        publicId,
        width: data.width || 1280,
        height: data.height || 720,
        duration: data.duration ? Math.round(data.duration * 1000) : 0,
        bytes: data.bytes || 0,
    };
}

/**
 * Kiểm tra Cloudinary đã cấu hình chưa
 */
export function isCloudinaryConfigured() {
    const { cloud, preset } = getCloudinaryCfg();
    return !!(cloud && preset);
}
