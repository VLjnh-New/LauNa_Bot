import { fs, path, axios, log, rentalManager } from "../globals.js";
import { search, download } from "../utils/music/soundcloud.js";
import { sendMusicSticker } from "../utils/core/stickerHelper.js";
import { drawSoundCloudSearch } from "../utils/canvas/canvasHelper.js";

export const name = "scl";
export const description = "Tìm kiếm và nghe nhạc từ SoundCloud";

export const pendingScl = new Map();

export const commands = {
    soundcloud: async (ctx) => await handleScl(ctx),
    scl: async (ctx) => await handleScl(ctx),
    sc: async (ctx) => await handleScl(ctx)
};

async function handleScl(ctx) {
    const { api, threadId, threadType, senderId, args } = ctx;
    const query = args.join(" ");
    if (!query) return;

    try {
        const results = await search(query);
        const tracks = results.filter(item => item.kind === 'track').slice(0, 10);
        if (tracks.length === 0) return;

        pendingScl.set(`${threadId}-${senderId}`, tracks);

        const mapped = tracks.map(t => ({
            title: t.title,
            artistsNames: t.user?.username || "SoundCloud Artist",
            thumbnail: (t.artwork_url || t.user?.avatar_url || "").replace("-large", "-t500x500"),
            duration: Math.floor(t.duration / 1000)
        }));

        const buffer = await drawSoundCloudSearch(mapped, query);
        if (!buffer) return;
        const imagePath = path.join(process.cwd(), `src/modules/cache/scl_${Date.now()}.png`);
        fs.writeFileSync(imagePath, buffer);

        const infoMsg = `🎵 Kết quả tìm kiếm cho: "${query}"\n📌 Phản hồi STT (1-10) để tải nhạc.`;

        // Bọc text - Gửi ảnh kèm Caption bên dưới
        let sentMsg = await api.sendMessage({
            msg: infoMsg,
            attachments: [imagePath]
        }, threadId, threadType);
        if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

        setTimeout(() => pendingScl.delete(`${threadId}-${senderId}`), 120000);
    } catch (e) { log.error("SCL Error:", e.message); }
}

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType, adminIds } = ctx;
    if (!adminIds.includes(String(senderId)) && !rentalManager.isRented(threadId)) return false;

    const choice = parseInt(content);
    if (isNaN(choice) || choice < 1 || choice > 10) return false;

    const key = `${threadId}-${senderId}`;
    const tracks = pendingScl.get(key);
    if (!tracks || !tracks[choice - 1]) return false;

    const track = tracks[choice - 1];
    pendingScl.delete(key);

    try {
        const { url } = await download(track.permalink_url);
        if (!url) return true;

        const tempMp3 = path.join(process.cwd(), `src/modules/cache/scl_${Date.now()}.mp3`);
        const res = await axios({ method: 'get', url, responseType: 'stream' });
        const writer = fs.createWriteStream(tempMp3);
        res.data.pipe(writer);
        await new Promise((r, j) => { writer.on('finish', r); writer.on('error', j); });

        await api.sendVoiceUnified({ filePath: tempMp3, threadId, threadType });

        const stickerThumb = (track.artwork_url || track.user?.avatar_url || "").replace("-large", "-t500x500");
        if (stickerThumb) await sendMusicSticker(api, stickerThumb, threadId, threadType);
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
    } catch (e) { log.error("Scl Handle Error:", e.stack || e.message); }
    return true;
}
