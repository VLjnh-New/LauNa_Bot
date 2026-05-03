import { fs, path, axios, log, rentalManager, uploadToTmpFiles } from "../globals.js";
import { drawZingSearch, drawZingPlayer } from "../utils/canvas/canvasHelper.js";
import { downloadYoutubeVideo } from "../utils/music/youtube.js";

export const name = "yt";
export const description = "Tìm kiếm và tải video YouTube";

const pendingDownloads = new Map();

async function reply(ctx, text) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

export const commands = {
    yt: async (ctx) => {
        const { api, args, threadId, threadType, prefix } = ctx;
        const query = args.join(" ").trim();
        if (!query) return reply(ctx, `[ 💡 HƯỚNG DẪN ]\n─────────────────\n‣ Dùng: ${prefix}yt [tên video]\n‣ Ví dụ: ${prefix}yt remix 2024`);

        try {
            const res = await axios.get(`https://aminul-youtube-api.vercel.app/search?query=${encodeURIComponent(query)}`);
            const data = res.data;

            if (!data || data.length === 0) {
                return reply(ctx, "⚠️ Rất tiếc, Bot không tìm thấy video nào phù hợp với từ khóa của bạn.");
            }

            const videos = data.slice(0, 10);
            pendingDownloads.set(`${threadId}-${ctx.senderId}`, videos);

            // Giao diện Canvas: Map full thông tin
            const mappedVideos = videos.map(v => ({
                title: v.title,
                artistsNames: v.author?.name || "YouTube Channel",
                thumbnail: v.thumbnail,
                duration: v.timestamp || v.duration || "0:00",
                views: v.views,
                uploaded: v.uploaded || v.ago
            }));

            const statusMsg = `[ 📺 YOUTUBE SEARCH ]\n─────────────────\n🔎 Tìm kiếm: "${query}"\n✨ Phản hồi số 𝟭-${videos.length} để tải video!\n🚀 Tốc độ tải cực nhanh (Full HD).`;

            // Vẽ Canvas Search (fallback text nếu canvas không khả dụng)
            const buffer = await drawZingSearch(mappedVideos, query, "YOUTUBE");
            if (buffer) {
                const tempImg = path.join(process.cwd(), `src/modules/cache/yt_s_${Date.now()}.png`);
                if (!fs.existsSync(path.dirname(tempImg))) fs.mkdirSync(path.dirname(tempImg), { recursive: true });
                fs.writeFileSync(tempImg, buffer);
                const remoteUrl = await uploadToTmpFiles(tempImg, api, threadId, threadType);
                if (remoteUrl) {
                    await api.sendImageEnhanced({
                        imageUrl: remoteUrl,
                        threadId, threadType,
                        width: 1280, height: 720,
                        msg: statusMsg
                    });
                } else {
                    await api.sendMessage({ msg: statusMsg, attachments: [tempImg] }, threadId, threadType);
                }
                if (fs.existsSync(tempImg)) try { fs.unlinkSync(tempImg); } catch {}
            } else {
                const listMsg = videos.slice(0, 10).map((v, i) =>
                    `${i + 1}. ${v.title} [${v.timestamp || v.duration || "?"}]`
                ).join("\n");
                await reply(ctx, `${statusMsg}\n─────────────────\n${listMsg}`);
            }

        } catch (err) {
            log.error("YT Search error:", err.message);
            reply(ctx, "⚠️ Hệ thống tìm kiếm YouTube đang bận. Vui lòng thử lại sau!");
        }
    },
    ytb: async (ctx) => commands.yt(ctx)
};

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType, adminIds } = ctx;
    if (!adminIds.includes(String(senderId)) && !rentalManager.isRented(threadId)) return false;

    const choice = parseInt(content);
    if (isNaN(choice) || choice < 1 || choice > 10) return false;

    const key = `${threadId}-${senderId}`;
    const videos = pendingDownloads.get(key);
    if (!videos || !videos[choice - 1]) return false;

    const video = videos[choice - 1];
    pendingDownloads.delete(key);

    const loadingMsg = await api.sendMessage(`⏳ [ Đang xử lý ]\n─────────────────\n‣ Video: "${video.title}"\n‣ Vui lòng chờ trong giây lát...`, threadId, threadType);

    const statusMsg = `✅ [ TẢI THÀNH CÔNG ]\n─────────────────\n📽️ Video: ${video.title}\n👤 Kênh: ${video.author?.name || video.author || ""}\n─────────────────\n✨ Chúc bạn xem video vui vẻ!`;
    const tempFile  = path.join(process.cwd(), `yt_vid_${Date.now()}.mp4`);

    try {
        await downloadYoutubeVideo(video.url, tempFile);

        // Player Card
        try {
            const mappedTrack = {
                title: video.title,
                artistsNames: video.author?.name || video.author || "YouTube",
                thumbnail: video.thumbnail,
                duration: video.timestamp || video.duration || "0:00",
                sourceName: "YouTube"
            };
            const cardBuffer = await drawZingPlayer(mappedTrack);
            if (cardBuffer && Buffer.isBuffer(cardBuffer)) {
                const cardPath = path.join(process.cwd(), `src/modules/cache/yt_p_${Date.now()}.png`);
                fs.writeFileSync(cardPath, cardBuffer);
                const cardUrl = await uploadToTmpFiles(cardPath, api, threadId, threadType);
                if (cardUrl) await api.sendImageEnhanced({ imageUrl: cardUrl, threadId, threadType, width: 1100, height: 500, msg: `🎬 Đang chuẩn bị trình phát...\n🎵 Title: ${video.title}` });
                if (fs.existsSync(cardPath)) try { fs.unlinkSync(cardPath); } catch {}
            }
        } catch {}

        // Dùng sendVideoUnified để tự động xử lý Drive → Cloudinary → Zalo CDN
        await api.sendVideoUnified({
            videoPath: tempFile,
            thumbnailUrl: video.thumbnail || "https://drive.google.com/uc?id=1pCQPRic8xPxbgUaPSIczb94S4RDdWDHK&export=download",
            msg: statusMsg,
            threadId,
            threadType
        });
        log.info(`[yt] video OK: ${video.title}`);
    } catch (e) {
        log.error(`[yt] lỗi: ${e.message}`);
        reply(ctx, `⚠️ Lỗi tải video: ${e.message}`);
    } finally {
        if (fs.existsSync(tempFile)) try { fs.unlinkSync(tempFile); } catch {}
    }

    try { await api.undo({ msgId: loadingMsg.message?.msgId, cliMsgId: loadingMsg.message?.cliMsgId }, threadId, threadType); } catch {}
    return true;
}
