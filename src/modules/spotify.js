import { fs, path, axios, uploadToTmpFiles } from "../globals.js";
import { sendMusicSticker } from "../utils/core/stickerHelper.js";

const tempDir = path.join(process.cwd(), "src", "modules", "cache", "temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

export const name = "spotify";
export const description = "Tải nhạc từ Spotify đẹp rực rỡ";

const searchCache = new Map();

async function sendBeautifulPlayerCard(api, threadId, threadType, songInfo) {
    try {
        const thumb = songInfo.thumbnail || "https://developer.spotify.com/images/guidelines/design/icon3@2x.png";
        await sendMusicSticker(api, thumb, threadId, threadType);
    } catch (e) {
        console.error("Lỗi vẽ card Spotify:", e.message);
    }
}

export const commands = {
    spt: async (ctx) => {
        const { api, threadId, threadType, senderId, args, message } = ctx;
        const input = args.join(" ").trim();
        if (!input) return api.sendMessage({ msg: "⚠️ Nhập tên bài hát hoặc link Spotify!" }, threadId, threadType);

        await api.addReaction("🔍", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });

        const linkMatch = input.match(/track\/([a-zA-Z0-9]+)/);
        if (linkMatch) {
            try {
                const dl = await spotify.download(linkMatch[1]);
                if (!dl.primaryUrl) throw new Error("Không lấy được link tải MP3.");

                const tempPath = path.join(tempDir, `spt_${Date.now()}.mp3`);
                const res = await axios({ method: "get", url: dl.primaryUrl, responseType: "stream" });
                const writer = fs.createWriteStream(tempPath);
                res.data.pipe(writer);
                await new Promise((r, j) => { writer.on("finish", r); writer.on("error", j); });

                await api.addReaction("🎵", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });

                await api.sendVoiceUnified({ filePath: tempPath, threadId, threadType });
                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

                await sendBeautifulPlayerCard(api, threadId, threadType, dl);
                await api.addReaction("✅", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });
            } catch (e) {
                api.addReaction("❌", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });
                api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
            }
            return;
        }

        try {
            const results = await spotify.search(input);
            if (results.length === 0) {
                await api.addReaction("❌", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });
                return api.sendMessage({ msg: "⚠️ Không tìm thấy bài hát này." }, threadId, threadType);
            }
            const searchImgBuffer = await drawZingSearch(results, input, "SPOTIFY");
            const searchImgPath = path.join(tempDir, `spt_search_${Date.now()}.png`);
            fs.writeFileSync(searchImgPath, searchImgBuffer);

            const remoteUrl = await uploadToTmpFiles(searchImgPath, api, threadId, threadType);
            const caption = `🔍 Kết quả tìm kiếm cho: "${input}"\n💡 Phản hồi STT hoặc "STT mp3/lyric" để tải.`;

            let sent;
            if (remoteUrl) {
                sent = await api.sendImageEnhanced({ imageUrl: remoteUrl, threadId, threadType, width: 1280, height: 720, msg: caption });
            } else {
                sent = await api.sendMessage({ msg: caption }, threadId, threadType);
            }

            if (fs.existsSync(searchImgPath)) fs.unlinkSync(searchImgPath);
            await api.addReaction("✅", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });

            const msgId = sent?.message?.msgId || sent?.msgId || sent?.globalMsgId;
            const session = {
                results: results,
                senderId: senderId,
                undoData: { msgId: msgId, cliMsgId: sent?.message?.cliMsgId },
                timeout: setTimeout(() => {
                    if (session.undoData.msgId) {
                        api.undo(session.undoData, threadId, threadType).catch(() => { });
                    }
                    searchCache.delete(msgId);
                    searchCache.delete(`${threadId}_${senderId}`);
                }, 60000)
            };
            if (msgId) searchCache.set(msgId, session);
            searchCache.set(`${threadId}_${senderId}`, session);
        } catch (e) {
            await api.addReaction("❌", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });
            api.sendMessage({ msg: "⚠️ Có lỗi xảy ra khi tìm kiếm." }, threadId, threadType);
        }
    }
};

export async function handle(ctx) {
    const { api, threadId, threadType, senderId, content, message } = ctx;
    if (!content || message.isSelf) return false;

    const quoteId = message.data.quote?.msgId || message.data.quote?.globalMsgId;
    let session = quoteId ? searchCache.get(quoteId) : (/^[1-8](\s+(mp3|lyric))?$/i.test(content) ? searchCache.get(`${threadId}_${senderId}`) : null);

    if (!session || senderId !== session.senderId) return false;

    const lowerContent = content.toLowerCase();
    const isMp3 = lowerContent.includes("mp3");
    const isLyric = lowerContent.includes("lyric");
    const num = parseInt(content);
    if (isNaN(num) || num < 1 || num > session.results.length) return false;

    if (session.undoData.msgId) {
        api.undo(session.undoData, threadId, threadType).catch(() => { });
    }
    clearTimeout(session.timeout);
    searchCache.delete(`${threadId}_${senderId}`);

    const track = session.results[num - 1];
    await api.addReaction("🎵", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });

    try {
        const dl = await spotify.download(track.id, track.title, track.artist);
        if (!dl.primaryUrl) throw new Error("Nguồn này hiện không khả dụng.");

        const tempPath = path.join(tempDir, `spt_h_${Date.now()}.mp3`);
        const res = await axios({ method: "get", url: dl.primaryUrl, responseType: "stream" });
        const writer = fs.createWriteStream(tempPath);
        res.data.pipe(writer);
        await new Promise((r, j) => { writer.on("finish", r); writer.on("error", j); });

        if (isMp3) {
            const fileUrl = await uploadToTmpFiles(tempPath, api, threadId, threadType);
            if (fileUrl) {
                await api.sendLink({ link: fileUrl }, threadId, threadType);
            } else {
                await api.sendVoiceUnified({ filePath: tempPath, threadId, threadType });
            }
        } else {
            await api.sendVoiceUnified({ filePath: tempPath, threadId, threadType });
        }

        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        await sendBeautifulPlayerCard(api, threadId, threadType, {
            title: track.title,
            artist: track.artist,
            thumbnail: track.thumbnail,
            duration: track.duration
        });

        if (isLyric) {
            const lyrics = await spotify.getLyrics(dl.id || track.id, track.thumbnail, track.title, track.artist);
            if (lyrics) {
                await api.sendMessage({ msg: `[ 📝 LYRICS: ${track.title.toUpperCase()} ]\n─────────────────\n${lyrics}` }, threadId, threadType);
            } else {
                await api.sendMessage({ msg: `⚠️ Rất tiếc, không tìm lời bài hát cho bài này.` }, threadId, threadType);
            }
        }

        await api.addReaction("✅", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });
    } catch (e) {
        await api.addReaction("❌", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => { });
        api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
    }
    return true;
}
