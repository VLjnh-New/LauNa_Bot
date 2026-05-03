import { fs, path, axios, log, uploadToTmpFiles } from "../globals.js";

export const name = "capcut";
export const description = "Các lệnh liên quan đến CapCut (search, download)";
export const pendingCapCutSearches = new Map();

async function performDownload(url, api, threadId, threadType) {
    try {
        const { downloadCapCutV1, downloadCapCutV2 } = await import("../utils/downloaders/capcutDownloader.js");
        const fs = await import("node:fs");
        const path = await import("node:path");
        const axios = (await import("axios")).default;
        let cpData = await downloadCapCutV2(url);

        if (!cpData || !cpData.videoUrl) {
            const v1Data = await downloadCapCutV1(url);
            if (v1Data && v1Data.attachments?.[0]?.url) {
                cpData = {
                    title: v1Data.message || "CapCut Video",
                    videoUrl: v1Data.attachments[0].url,
                    author: { name: "Ẩn" }
                };
            }
        }

        if (!cpData || !cpData.videoUrl) return api.sendMessage({ msg: " Không lấy được link tải video. Có thể link đã hết hạn hoặc bị chặn." }, threadId, threadType);

        let msg = ` CAPCUT\n`;
        msg += `─────────────────\n`;
        msg += `◈ Tiêu đề: ${cpData.title}\n`;
        msg += `👤 Tác giả: ${cpData.author?.name || "Ẩn"}\n`;
        if (cpData.duration) msg += `⏱️ Thời lượng: ${typeof cpData.duration === 'number' ? (cpData.duration / 1000).toFixed(1) + 's' : cpData.duration}\n`;
        if (cpData.usage_amount) msg += `🔥 Lượt dùng: ${cpData.usage_amount.toLocaleString()}\n`;
        if (cpData.play_amount) msg += `👀 Lượt xem: ${cpData.play_amount.toLocaleString()}\n`;
        if (cpData.like_count) msg += `❤️ Tim: ${cpData.like_count.toLocaleString()}\n`;
        if (cpData.comment_count) msg += `💬 Comment: ${cpData.comment_count.toLocaleString()}\n`;
        msg += `─────────────────\n`;
        msg += `🔗 Link mẫu: ${url}`;

        // Tải video về máy và gửi qua Zalo
        const tempPath = path.join(process.cwd(), `capcut_${Date.now()}.mp4`);
        try {
            const downloadResponse = await axios({
                method: 'get',
                url: cpData.videoUrl,
                responseType: 'stream'
            });
            const writer = fs.createWriteStream(tempPath);
            downloadResponse.data.pipe(writer);

            await new Promise((resolve, reject) => {
                writer.on('finish', resolve);
                writer.on('error', reject);
            });

            await api.sendVideoUnified({
                videoPath: tempPath,
                msg: msg,
                threadId,
                threadType
            });
        } catch (downloadErr) {
            console.error("[CapCut] Lỗi gửi video:", downloadErr.message);
            // Fallback gửi tin nhắn text nếu gửi video lỗi
            await api.sendMessage({ msg }, threadId, threadType);
        } finally {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }

    } catch (e) {
        await api.sendMessage({ msg: "⚠️ Lỗi khi tải: " + e.message }, threadId, threadType);
    }
}

export const commands = {
    capcut: async (ctx) => {
        const { api, args, threadId, threadType, senderId, log } = ctx;
        const sub = (args[0] || "").toLowerCase();

        const { searchCapCut } = await import("../utils/downloaders/capcutDownloader.js");
        const { drawCapCutSearch } = await import("../utils/canvas/canvasHelper.js");
        const { uploadToTmpFiles } = await import("../utils/core/tmpFiles.js");
        const fs = await import("node:fs");
        const path = await import("node:path");

        if (sub === "search") {
            const query = args.slice(1).join(" ");
            if (!query) return api.sendMessage({ msg: "⚠️ Vui lòng nhập từ khóa tìm kiếm!" }, threadId, threadType);

            try {
                const data = await searchCapCut(query);
                const templates = data?.video_templates || data?.templates || [];

                if (templates.length === 0) {
                    return api.sendMessage({ msg: " Không tìm thấy kết quả nào với từ khóa: " + query }, threadId, threadType);
                }

                const sliced = templates.slice(0, 10);
                const key = `${threadId}-${senderId}`;
                pendingCapCutSearches.set(key, sliced);
                setTimeout(() => { if (pendingCapCutSearches.get(key) === sliced) pendingCapCutSearches.delete(key); }, 120000);

                try {
                    const buffer = await drawCapCutSearch(sliced, query);
                    if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("canvas unavailable");
                    const imagePath = path.join(process.cwd(), `capcut_s_${Date.now()}.png`);
                    fs.writeFileSync(imagePath, buffer);

                    const statusMsg = `🔍 KẾT QUẢ TÌM KIẾM CAPCUT\n─────────────────\n✨ Phản hồi số 𝟭-${sliced.length} để tải video nhé!`;

                    await api.sendImageEnhanced({
                        imageUrl: await uploadToTmpFiles(imagePath, api, threadId, threadType),
                        threadId, threadType,
                        width: 800, height: 150 + (sliced.length * 160) + 100,
                        msg: statusMsg
                    });

                    if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
                } catch (canvasErr) {
                    let msg = `🔍 KẾT QUẢ TÌM KIẾM CAPCUT\n`;
                    msg += `─────────────────\n`;
                    sliced.forEach((t, i) => {
                        const templateId = t.web_id || String(t.id);
                        msg += `${i + 1}. ${t.title}\n👤 Tác giả: ${t.author?.name || "Không rõ"}\n🔗 ID: ${templateId}\n\n`;
                    });
                    msg += `─────────────────\n💡 Phản hồi số 𝟭-${sliced.length} để tải!`;
                    await api.sendMessage({ msg }, threadId, threadType);
                }
            } catch (e) {
                await api.sendMessage({ msg: "⚠️ Có lỗi xảy ra khi tìm kiếm: " + e.message }, threadId, threadType);
            }
        }
        else if (sub === "download" || sub === "dl") {
            let url = args[1];
            if (!url) return api.sendMessage({ msg: "⚠️ Vui lòng nhập link video hoặc ID mẫu CapCut!" }, threadId, threadType);

            // Nếu là ID (toàn số), convert sang link template
            if (/^\d+$/.test(url)) {
                url = `https://www.capcut.com/template-detail/${url}`;
            }

            await performDownload(url, api, threadId, threadType);
        }
        else {
            let msg = `[ 🎬 CAPCUT MODULE ]\n`;
            msg += `─────────────────\n`;
            msg += `◈ !capcut search [từ khóa]\n`;
            msg += `◈ !capcut download [link mẫu]\n`;
            msg += `─────────────────\n💡 Link mẫu CapCut gửi trực tiếp sẽ tự động tải (nếu bật autodown).`;
            await api.sendMessage({ msg }, threadId, threadType);
        }
    }
};

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType, log } = ctx;

    // Check if content is a number between 1 and 10
    const choice = parseInt(content);
    if (isNaN(choice) || choice < 1 || choice > 10) return false;

    const key = `${threadId}-${senderId}`;
    const templates = pendingCapCutSearches.get(key);
    if (!templates || !templates[choice - 1]) return false;

    const template = templates[choice - 1];
    pendingCapCutSearches.delete(key);

    const templateId = template.web_id || template.id || String(template.video_template?.id || "");
    if (!templateId) return false;

    const url = `https://www.capcut.com/template-detail/${templateId}`;

    await performDownload(url, api, threadId, threadType);
    return true;
}
