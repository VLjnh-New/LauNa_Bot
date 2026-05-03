import { fs, path, axios, log, rentalManager } from "../globals.js";
import { sendMusicSticker } from "../utils/core/stickerHelper.js";

export const name = "zing";
export const description = "Tìm kiếm và nghe nhạc từ ZingMP3";

export const pendingZing = new Map();

export const commands = {
    zing: async (ctx) => {
        const { api, threadId, threadType, senderId, args } = ctx;
        const query = args.join(" ");
        if (!query) return;

        try {
            const songs = await searchZing(query);
            if (!songs || songs.length === 0) return;

            const results = songs.slice(0, 10);
            pendingZing.set(`${threadId}-${senderId}`, results);

            const mapped = results.map(t => ({
                title: t.title,
                artistsNames: t.artistsNames,
                thumbnail: (t.thumbnail || t.thumb || "").replace("w94", "w500"),
                duration: t.duration
            }));

            const buffer = await drawZingSearch(mapped, query, "ZING MP3");
            const infoMsg = `🎵 Kết quả tìm kiếm cho: "${query}"\n📌 Phản hồi STT (1-10) để nghe nhạc.`;

            if (buffer) {
                const imagePath = path.join(process.cwd(), `src/modules/cache/z_${Date.now()}.png`);
                fs.writeFileSync(imagePath, buffer);
                await api.sendMessage({ msg: infoMsg, attachments: [imagePath] }, threadId, threadType);
                if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
            } else {
                const listText = results.map((t, i) => `${i + 1}. ${t.title} — ${t.artistsNames}`).join("\n");
                await api.sendMessage({ msg: `${infoMsg}\n${"─".repeat(28)}\n${listText}` }, threadId, threadType);
            }

            setTimeout(() => pendingZing.delete(`${threadId}-${senderId}`), 120000);
        } catch (e) { log.error("Zing Search Error:", e.message); }
    }
};

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType, adminIds } = ctx;
    if (!adminIds.includes(String(senderId)) && !rentalManager.isRented(threadId)) return false;

    const choice = parseInt(content);
    if (isNaN(choice) || choice < 1 || choice > 10) return false;

    const key = `${threadId}-${senderId}`;
    const songs = pendingZing.get(key);
    if (!songs || !songs[choice - 1]) return false;

    const song = songs[choice - 1];
    pendingZing.delete(key);

    try {
        const info = await getStreamZing(song.encodeId);
        const streamUrl = info?.["128"] || info?.["320"] || info?.default;
        if (!streamUrl || streamUrl === "VIP") {
            await api.sendMessage({ msg: "⚠️ Không tải được nhạc Zing (Bài hát VIP)." }, threadId, threadType);
            return true;
        }

        const tempMp3 = path.join(process.cwd(), `zing_${Date.now()}.mp3`);
        const res = await axios({ method: 'get', url: streamUrl, responseType: 'stream' });
        const writer = fs.createWriteStream(tempMp3);
        res.data.pipe(writer);
        await new Promise((r, j) => { writer.on('finish', r); writer.on('error', j); });

        await api.sendVoiceUnified({ filePath: tempMp3, threadId, threadType });

        const thumbnail = (song.thumbnail || "").replace("w94", "w500");
        if (thumbnail) {
            await sendMusicSticker(api, thumbnail, threadId, threadType);
        }
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
    } catch (e) { log.error("Zing Handle Error:", e.stack || e.message); }
    return true;
}
