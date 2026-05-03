import axios from "axios";
import { fs, path } from "../globals.js";
import { pipeline } from "stream/promises";
import FormData from "form-data";
import { ffmpegRun } from "../utils/core/ffmpegHelper.js";

export const name = "findmusic";
export const description = "Nhận dạng bài hát từ file âm thanh hoặc video (reply hoặc gửi kèm)";

const CACHE_DIR = path.join(process.cwd(), "src/modules/cache");
const AUDD_API = "https://api.audd.io/";

function ensureCache() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function cleanFile(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
}

/**
 * Trích xuất URL media từ tin nhắn (attachment trực tiếp hoặc quote)
 */
function extractMediaUrl(message) {
    const data = message?.data || {};

    // 1. Attachment trực tiếp trong tin nhắn hiện tại
    const attachments = data.attachments || data.attach || [];
    if (Array.isArray(attachments)) {
        for (const a of attachments) {
            const url = a.hdUrl || a.fileUrl || a.url || a.href;
            const type = (a.type || "").toLowerCase();
            if (url && (type === "audio" || type === "voice" || type === "video" || url.match(/\.(mp3|mp4|m4a|ogg|wav|aac|webm|mkv|avi|mov|flac)(\?|$)/i))) {
                return { url, type: type || "audio" };
            }
        }
    }

    // 2. Từ quote (tin nhắn được reply)
    const quote = data.quote || data.msgContent?.quote;
    if (quote) {
        const qAttachments = quote.attachments || quote.attach || quote.msgContent?.attachments || [];
        const qArr = Array.isArray(qAttachments) ? qAttachments : [qAttachments].filter(Boolean);
        for (const a of qArr) {
            const url = a.hdUrl || a.fileUrl || a.url || a.href;
            const type = (a.type || "").toLowerCase();
            if (url && (type === "audio" || type === "voice" || type === "video" || url.match(/\.(mp3|mp4|m4a|ogg|wav|aac|webm|mkv|avi|mov|flac)(\?|$)/i))) {
                return { url, type: type || "audio" };
            }
        }
        // URL trực tiếp trong quote
        const qUrl = quote.hdUrl || quote.fileUrl || quote.url || quote.href;
        const qType = (quote.type || "").toLowerCase();
        if (qUrl && (qType === "audio" || qType === "voice" || qType === "video" || qUrl.match(/\.(mp3|mp4|m4a|ogg|wav|aac|webm|mkv|avi|mov|flac)(\?|$)/i))) {
            return { url: qUrl, type: qType || "audio" };
        }
    }

    return null;
}

/**
 * Tải file về local
 */
async function downloadToFile(url, destPath) {
    const resp = await axios({
        method: "GET",
        url,
        responseType: "stream",
        timeout: 60000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    await pipeline(resp.data, fs.createWriteStream(destPath));
    const size = fs.statSync(destPath).size;
    if (size < 1000) throw new Error("File tải về quá nhỏ hoặc rỗng.");
    return size;
}

/**
 * Trích xuất 20 giây âm thanh từ file (bỏ qua 30s đầu nếu file đủ dài)
 */
async function extractAudioClip(inputPath, outputPath) {
    // Dùng ffprobe để lấy thời lượng trước
    let startTime = 0;
    try {
        const { ffprobeAsync } = await import("../utils/core/ffmpegHelper.js");
        const info = await ffprobeAsync(inputPath);
        const duration = parseFloat(info?.format?.duration || 0);
        if (duration > 60) startTime = 30;
        else if (duration > 30) startTime = 10;
    } catch {}

    await ffmpegRun([
        "-y",
        "-ss", String(startTime),
        "-i", inputPath,
        "-t", "20",
        "-vn",
        "-ar", "44100",
        "-ac", "2",
        "-f", "mp3",
        outputPath
    ], 60000);
}

/**
 * Nhận dạng nhạc qua AudD API
 */
async function recognizeMusic(audioPath) {
    const form = new FormData();
    form.append("file", fs.createReadStream(audioPath), {
        filename: "audio.mp3",
        contentType: "audio/mpeg"
    });
    form.append("return", "spotify,apple_music,deezer");

    const auddToken = process.env.AUDD_API_TOKEN || "";
    if (auddToken) form.append("api_token", auddToken);

    const resp = await axios.post(AUDD_API, form, {
        headers: form.getHeaders(),
        timeout: 30000,
        maxContentLength: 10 * 1024 * 1024
    });

    if (resp.data?.status !== "success") {
        const errMsg = resp.data?.error?.error_message || "API trả về lỗi";
        throw new Error(errMsg);
    }

    return resp.data.result || null;
}

/**
 * Format kết quả nhận dạng thành tin nhắn đẹp
 */
function formatResult(result) {
    let msg = `🎵 NHẬN DẠNG NHẠC\n`;
    msg += `─────────────────\n`;
    msg += `🎤 Nghệ sĩ : ${result.artist || "Không rõ"}\n`;
    msg += `🎵 Bài hát : ${result.title || "Không rõ"}\n`;

    if (result.album) msg += `💿 Album   : ${result.album}\n`;
    if (result.release_date) msg += `📅 Phát hành: ${result.release_date}\n`;
    if (result.label) msg += `🏷️  Label   : ${result.label}\n`;

    if (result.timecode) msg += `⏱️  Vị trí  : ${result.timecode}\n`;

    msg += `─────────────────\n`;

    if (result.spotify?.external_urls?.spotify) {
        msg += `🟢 Spotify : ${result.spotify.external_urls.spotify}\n`;
    }
    if (result.apple_music?.url) {
        msg += `🍎 Apple Music : ${result.apple_music.url}\n`;
    }
    if (result.deezer?.link) {
        msg += `🎶 Deezer  : ${result.deezer.link}\n`;
    }
    if (result.song_link) {
        msg += `🔗 Song.link: ${result.song_link}\n`;
    }

    return msg.trim();
}

async function findMusicHandler(ctx) {
    const { api, threadId, threadType, message } = ctx;

    ensureCache();

    const media = extractMediaUrl(message);
    if (!media) {
        return api.sendMessage({
            msg: "⚠️ Vui lòng reply (trả lời) vào một tin nhắn chứa file âm thanh hoặc video để nhận dạng bài hát."
        }, threadId, threadType);
    }

    await api.sendMessage({ msg: "🎵 Đang phân tích âm thanh..." }, threadId, threadType);

    const id = Date.now();
    const rawPath = path.join(CACHE_DIR, `fm_raw_${id}`);
    const clipPath = path.join(CACHE_DIR, `fm_clip_${id}.mp3`);

    try {
        // Tải file
        await downloadToFile(media.url, rawPath);

        // Trích 20 giây âm thanh
        await extractAudioClip(rawPath, clipPath);

        // Nhận dạng
        const result = await recognizeMusic(clipPath);

        if (!result) {
            return api.sendMessage({
                msg: "❌ Không nhận dạng được bài hát này.\n💡 Thử gửi đoạn nhạc rõ hơn hoặc ít tiếng ồn hơn."
            }, threadId, threadType);
        }

        const msg = formatResult(result);

        // Gửi kèm thumbnail nếu có
        const thumbUrl = result.spotify?.album?.images?.[0]?.url
            || result.apple_music?.artwork?.url?.replace("{w}x{h}", "600x600")
            || null;

        if (thumbUrl) {
            const thumbPath = path.join(CACHE_DIR, `fm_thumb_${id}.jpg`);
            try {
                const tResp = await axios({ method: "GET", url: thumbUrl, responseType: "stream", timeout: 10000 });
                await pipeline(tResp.data, fs.createWriteStream(thumbPath));
                if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 1000) {
                    await api.sendMessage({ msg, attachments: [thumbPath] }, threadId, threadType);
                    cleanFile(thumbPath);
                    return;
                }
            } catch {}
        }

        await api.sendMessage({ msg }, threadId, threadType);

    } catch (err) {
        await api.sendMessage({
            msg: `❌ Lỗi nhận dạng: ${err.message}`
        }, threadId, threadType);
    } finally {
        cleanFile(rawPath, clipPath);
    }
}

export const commands = {
    findmusic: findMusicHandler,
    fm: findMusicHandler
};
