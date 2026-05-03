import { fs, path, axios, log, rentalManager } from "../globals.js";
import { sendMusicSticker } from "../utils/core/stickerHelper.js";

export const name = "nct";
export const description = "Tìm kiếm và nghe nhạc từ NhacCuaTui (NCT)";

export const pendingNct = new Map();

export const commands = {
    nct: async (ctx) => {
        const { api, threadId, threadType, senderId, args } = ctx;
        const query = args.join(" ");
        if (!query) return;

        try {
            const songs = await searchNCT(query);
            if (!songs || songs.length === 0) return;

            const results = songs.slice(0, 10);
            pendingNct.set(`${threadId}-${senderId}`, results);

            const mapped = results.map(s => ({
                title: s.name,
                artistsNames: s.artistName || "NCT Artist",
                thumbnail: s.image || s.bgImage || s.artistImage || "https://stc-nct.nct.vn/v10/images/nct-logo-600x600.png",
                duration: s.duration || 0
            }));

            const buffer = await drawZingSearch(mapped, query, "NHACCUATUI");
            const infoMsg = `🎵 Kết quả tìm kiếm cho: "${query}"\n📌 Phản hồi STT (1-10) để tải nhạc.`;

            if (buffer && Buffer.isBuffer(buffer)) {
                const tempImg = path.join(process.cwd(), `src/modules/cache/nct_${Date.now()}.png`);
                fs.writeFileSync(tempImg, buffer);
                await api.sendMessage({ msg: infoMsg, attachments: [tempImg] }, threadId, threadType);
                if (fs.existsSync(tempImg)) fs.unlinkSync(tempImg);
            } else {
                const listText = mapped.slice(0, 10).map((s, i) => `${i + 1}. ${s.title} — ${s.artistsNames}`).join("\n");
                await api.sendMessage({ msg: `${infoMsg}\n\n${listText}` }, threadId, threadType);
            }

            setTimeout(() => pendingNct.delete(`${threadId}-${senderId}`), 120000);
        } catch (e) { log.error("NCT Error:", e.message); }
    }
};

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType, adminIds } = ctx;
    if (!adminIds.includes(String(senderId)) && !rentalManager.isRented(threadId)) return false;

    const choice = parseInt(content);
    if (isNaN(choice) || choice < 1 || choice > 10) return false;

    const key = `${threadId}-${senderId}`;
    const songs = pendingNct.get(key);
    if (!songs || !songs[choice - 1]) return false;

    const song = songs[choice - 1];
    pendingNct.delete(key);

    try {
        const streamObj = song.streamURL?.find(st => st.type === "320") || song.streamURL?.[0];
        const streamUrl = streamObj?.stream || streamObj?.download;
        if (!streamUrl) return true;

        const tempMp3 = path.join(process.cwd(), `nct_${Date.now()}.mp3`);
        const res = await axios({ method: 'get', url: streamUrl, responseType: 'stream' });
        const writer = fs.createWriteStream(tempMp3);
        res.data.pipe(writer);
        await new Promise((r, j) => { writer.on('finish', r); writer.on('error', j); });

        await api.sendVoiceUnified({ filePath: tempMp3, threadId, threadType });

        const thumbUrl = song.image || song.bgImage || song.artistImage;
        if (thumbUrl) {
            await sendMusicSticker(api, thumbUrl, threadId, threadType);
        }
        if (fs.existsSync(tempMp3)) fs.unlinkSync(tempMp3);
    } catch (e) { log.error("NCT Handle Error:", e.stack || e.message); }
    return true;
}
