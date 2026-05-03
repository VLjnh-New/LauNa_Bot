import { fs, path, axios, uploadToTmpFiles, log } from "../globals.js";
import yts from "youtube-search-api";
import { drawZingPlayer, drawZingSearch } from "../utils/canvas/canvasHelper.js";
import { downloadYoutubeAudio } from "../utils/music/youtube.js";
import { sendMusicSticker } from "../utils/core/stickerHelper.js";

export const name = "sing";
export const description = "Play YouTube voi card am nhac";

const pendingSing = new Map();

// Aggressive cache cleanup
async function cleanCache() {
    const dir = path.join(process.cwd(), "src/modules/cache");
    if (!fs.existsSync(dir)) return;
    try {
        const files = await fs.promises.readdir(dir);
        for (const file of files) {
            if (file.startsWith("sing-") || file.startsWith("card-") || file.startsWith("search-")) {
                try { await fs.promises.unlink(path.join(dir, file)); } catch (e) { }
            }
        }
    } catch (e) { }
}

export const commands = {
    sing: async (ctx) => {
        await singHandler(ctx);
    },
    music: async (ctx) => {
        await singHandler(ctx);
    }
};

async function singHandler(ctx) {
    const { api, threadId, threadType, args, senderId } = ctx;
    if (!args[0]) return api.sendMessage({ msg: "❎ Nhap tu khoa hoac link YouTube" }, threadId, threadType);

    await cleanCache();
    const q = args.join(" ").trim();
    const cacheDir = path.join(process.cwd(), "src/modules/cache");
    if (!fs.existsSync(cacheDir)) await fs.promises.mkdir(cacheDir, { recursive: true });

    // Handle Direct Link
    if (/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(q)) {
        try {
            await api.sendMessage({ msg: "⏳ Dang xu ly yeu cau, vui long doi..." }, threadId, threadType);
            const mp3Path = path.join(cacheDir, `sing-${senderId}-${Date.now()}.mp3`);
            const imgPath = path.join(cacheDir, `card-${senderId}-${Date.now()}.png`);

            const st = Date.now();
            const meta = await downloadYoutubeAudio(q, mp3Path);
            const processTime = Math.floor((Date.now() - st) / 1000);

            const songData = {
                title: meta.title,
                artistsNames: meta.author,
                thumbnail: meta.thumb,
                duration: meta.duration,
                views: meta.views,
                date: meta.date,
                processTime: processTime,
                sourceName: "YOUTUBE MUSIC"
            };

            const playerCardBuffer = await drawZingPlayer(songData);
            if (playerCardBuffer) await fs.promises.writeFile(imgPath, playerCardBuffer);

            await sendMusicResult(api, threadId, threadType, playerCardBuffer ? imgPath : null, mp3Path, meta);
        } catch (e) {
            log.error("[sing] Direct link error:", e.message);
            return api.sendMessage({ msg: "❎ Loi: " + e.message }, threadId, threadType);
        }
        return;
    }

    // Handle Search
    try {
        await api.sendMessage({ msg: `🔍 Dang tim kiem: ${q}...` }, threadId, threadType);
        const results = await yts.GetListByKeyword(q, false, 8);
        if (!results.items?.length) return api.sendMessage({ msg: "❎ Khong tim thay ket qua nao." }, threadId, threadType);

        const songs = results.items.map(v => ({
            id: v.id,
            title: v.title,
            artistsNames: v.channelTitle || "YouTube",
            thumbnail: v.thumbnail?.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
            duration: v.length?.simpleText || "00:00",
            views: v.viewCount?.shortBylineText || v.viewCount?.simpleText || "0"
        }));

        const infoMsg = `🎵 Ket qua tim kiem cho: "${q}"\n📌 Phan hoi so thu tu (1-${songs.length}) de tai nhac.`;
        const searchCardBuffer = await drawZingSearch(songs, q, "YOUTUBE MUSIC");

        let sentMsg;
        if (searchCardBuffer) {
            const searchCardPath = path.join(cacheDir, `search-${senderId}-${Date.now()}.png`);
            await fs.promises.writeFile(searchCardPath, searchCardBuffer);
            const remoteUrl = await uploadToTmpFiles(searchCardPath, api, threadId, threadType);
            if (remoteUrl && api.sendImageEnhanced) {
                sentMsg = await api.sendImageEnhanced({
                    imageUrl: remoteUrl,
                    threadId, threadType,
                    width: 1280, height: 720,
                    msg: infoMsg
                });
            } else {
                sentMsg = await api.sendMessage({
                    msg: infoMsg,
                    attachments: [searchCardPath]
                }, threadId, threadType);
            }
            if (fs.existsSync(searchCardPath)) await fs.promises.unlink(searchCardPath).catch(() => { });
        } else {
            const listMsg = songs.slice(0, 8).map((s, i) =>
                `${i + 1}. ${s.title} [${s.duration}]`
            ).join("\n");
            sentMsg = await api.sendMessage({
                msg: `${infoMsg}\n─────────────────\n${listMsg}`
            }, threadId, threadType);
        }

        const key = `${threadId}-${senderId}`;
        pendingSing.set(key, {
            links: songs.map(s => s.id),
            threadId,
            msgId: sentMsg?.message?.msgId || sentMsg?.msgId || null,
            cliMsgId: sentMsg?.message?.cliMsgId || sentMsg?.cliMsgId || null
        });

        setTimeout(() => pendingSing.delete(key), 120000);

    } catch (e) {
        log.error("[sing] Search error:", e.message);
        return api.sendMessage({ msg: "❎ Loi tim kiem: " + e.message }, threadId, threadType);
    }
}

// Interactive handler (for replies)
export async function handle(ctx) {
    const { api, threadId, threadType, senderId, content } = ctx;

    const key = `${threadId}-${senderId}`;
    if (!pendingSing.has(key)) return false;

    const session = pendingSing.get(key);

    const choice = parseInt((content || "").trim());
    if (isNaN(choice) || choice < 1 || choice > session.links.length) return false;

    const videoId = session.links[choice - 1];
    pendingSing.delete(key);

    await cleanCache();
    const cacheDir = path.join(process.cwd(), "src/modules/cache");
    const mp3Path = path.join(cacheDir, `sing-${senderId}-${Date.now()}.mp3`);
    const imgPath = path.join(cacheDir, `card-${senderId}-${Date.now()}.png`);

    try {
        await api.sendMessage({ msg: "⏳ Dang tai ban nhac ban chon..." }, threadId, threadType);
        const st = Date.now();
        const meta = await downloadYoutubeAudio(`https://www.youtube.com/watch?v=${videoId}`, mp3Path);
        const processTime = Math.floor((Date.now() - st) / 1000);

        const songData = {
            title: meta.title,
            artistsNames: meta.author,
            thumbnail: meta.thumb,
            duration: meta.duration,
            views: meta.views,
            date: meta.date,
            processTime: processTime,
            sourceName: "YOUTUBE MUSIC"
        };

        const playerCardBuffer = await drawZingPlayer(songData);
        if (playerCardBuffer) await fs.promises.writeFile(imgPath, playerCardBuffer);

        // Try to undo the search list message
        if (session.msgId) {
            api.undo({ msgId: session.msgId, cliMsgId: session.cliMsgId }, threadId, threadType).catch(() => { });
        }

        await sendMusicResult(api, threadId, threadType, playerCardBuffer ? imgPath : null, mp3Path, meta);
    } catch (e) {
        log.error("[sing] Handle error:", e.message);
        api.sendMessage({ msg: "❎ Loi: " + e.message }, threadId, threadType);
    }

    return true;
}



async function sendMusicResult(api, threadId, threadType, imgPath, mp3Path, meta) {
    try {
        const statusMsg =
            `[ 🎵 YOUTUBE PLAYER ]\n` +
            `─────────────────\n` +
            `✨ Dang phat nhac cho ban:\n` +
            `🎵 Title: ${meta.title}\n` +
            `👤 Artist: ${meta.author}\n` +
            `─────────────────`;

        if (imgPath) {
            const remoteImgUrl = await uploadToTmpFiles(imgPath, api, threadId, threadType);
            if (remoteImgUrl && api.sendImageEnhanced) {
                await api.sendImageEnhanced({
                    imageUrl: remoteImgUrl,
                    threadId, threadType,
                    msg: statusMsg,
                    width: 1100,
                    height: 500
                });
            } else {
                await api.sendMessage({ msg: statusMsg, attachments: [imgPath] }, threadId, threadType);
            }
        } else {
            await api.sendMessage({ msg: statusMsg }, threadId, threadType);
        }

        // Send audio
        if (api.sendVoiceUnified) {
            await api.sendVoiceUnified({ filePath: mp3Path, threadId, threadType });
        } else {
            await api.sendMessage({ msg: "🎧 Ban nhac cua ban", attachments: [mp3Path] }, threadId, threadType);
        }

        if (meta.thumb) {
            await sendMusicSticker(api, meta.thumb, threadId, threadType);
        }

        // Cleanup
        try { if (fs.existsSync(imgPath)) await fs.promises.unlink(imgPath); } catch (e) { }
        try { if (fs.existsSync(mp3Path)) await fs.promises.unlink(mp3Path); } catch (e) { }

    } catch (e) {
        log.error("[sing] Send music result error:", e.message);
    }
}
