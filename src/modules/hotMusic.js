import { fs, path, axios, log, rentalManager, statsManager, uploadToTmpFiles } from "../globals.js";
import { drawZingPlaylist, drawZingPlayer } from "../utils/canvas/canvasHelper.js";
import { sendSpinningSticker, createSpinningSticker, uploadStickerFile } from "../utils/core/stickerHelper.js";

export const description = "Tự động gửi nhạc Remix Thịnh Hành ngẫu nhiên mỗi giờ";

const REMIX_PLAYLIST_ID = "ZUAZ97OC"; // Remix Thịnh Hành

export const commands = {
    hotmusic: async (ctx) => {
        const { api, threadId, threadType } = ctx;
        const selected = PLAYLISTS[Math.floor(Math.random() * PLAYLISTS.length)];
        await api.sendMessage({ msg: `🔍 Đang lấy dữ liệu từ: ${selected.name}...` }, threadId, threadType);
        await sendHotMusicToThread(api, threadId, threadType, selected);
    }
};

/**
 * Gửi nhạc hot nhất đến một thread cụ thể
 */
async function sendHotMusicToThread(api, threadId, threadType, selectedPlaylist) {
    try {
        const selected = selectedPlaylist || PLAYLISTS[Math.floor(Math.random() * PLAYLISTS.length)];

        let playlistData = null;
        let songs = [];

        if (selected.id === "ZING_CHART") {
            const chartData = await getZingChart();
            if (!chartData || !chartData.RTChart?.items) return;
            songs = chartData.RTChart.items;
            playlistData = {
                title: "Zing Chart Realtime",
                thumbnail: "https://zjs.zmdcdn.me/zmp3-desktop/dev/static/images/charthome-bg.png",
                artistsNames: "Cập nhật từng giờ"
            };
        } else {
            playlistData = await getDetailPlaylist(selected.id);
            if (!playlistData || !playlistData.song?.items) return;
            songs = playlistData.song.items;
        }

        // 1. Gửi bảng xếp hạng Canvas (Top 10)
        const topMsg = `[ 🏆 REMIX THỊNH HÀNH ]\n─────────────────\n✨ Top những bản Remix bùng nổ nhất hôm nay!\n🔥 Đang chọn ngẫu nhiên bài hát để gửi cho bạn...`;
        const topImgBuffer = await drawZingPlaylist(playlistData, songs);
        if (topImgBuffer) {
            const topImgPath = path.join(process.cwd(), `src/modules/cache/top_remix_${Date.now()}.png`);
            fs.writeFileSync(topImgPath, topImgBuffer);
            const remoteTopUrl = await uploadToTmpFiles(topImgPath, api, threadId, threadType);
            if (remoteTopUrl) {
                await api.sendImageEnhanced({ imageUrl: remoteTopUrl, threadId, threadType, width: 800, height: 150 + (10 * 115) + 400, msg: topMsg });
            } else {
                await api.sendMessage({ msg: topMsg, file: fs.createReadStream(topImgPath) }, threadId, threadType);
            }
            if (fs.existsSync(topImgPath)) fs.unlinkSync(topImgPath);
        } else {
            const listLines = songs.slice(0, 10).map((s, i) => `${i + 1}. ${s.title} — ${s.artistsNames}`).join("\n");
            await api.sendMessage({ msg: `${topMsg}\n─────────────────\n${listLines}` }, threadId, threadType);
        }

        // 2. Chọn ngẫu nhiên 1 bài không VIP
        const freeSongs = songs.filter(s => s.streamingStatus !== 3 && !s.isVIP).slice(0, 20);
        if (freeSongs.length === 0) return;

        const song = freeSongs[Math.floor(Math.random() * freeSongs.length)];
        const info = await getStreamZing(song.encodeId);
        const streamUrl = info?.["128"] || info?.["320"] || info?.default;

        if (!streamUrl || streamUrl === "VIP") return;

        const tempFile = path.join(process.cwd(), `remix_${Date.now()}.mp3`);
        const response = await axios({ method: 'get', url: streamUrl, responseType: 'stream' });
        const writer = fs.createWriteStream(tempFile);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        // Gửi voice
        await api.sendVoiceUnified({ filePath: tempFile, threadId, threadType });

        // Gửi Player Card
        const thumbnail = (song.thumbnail || song.thumb || "").replace("w94", "w500");
        if (thumbnail) {
            await sendSpinningSticker(api, thumbnail, threadId, threadType, "hotmusic_spin");
        }

        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    } catch (e) {
        log.error("[RemixHot Error]:", e.message);
    }
}

const PLAYLISTS = [
    { id: "ZING_CHART", name: "ZING CHART REALTIME" },
    { id: "Z6CZO0F6", name: "BẢNG XẾP HẠNG V-POP" },
    { id: "ZUAZ97OC", name: "REMIX THỊNH HÀNH" }
];

/**
 * Hàm chạy tự động cho cron job mỗi giờ
 */
export async function autoSendHotMusic(api, log) {
    const { isAutosendEnabled } = await import("./autosend.js");
    const threads = statsManager.getAllThreads();
    const rentedThreads = threads.filter(id => rentalManager.isRented(id) && isAutosendEnabled(id));
    if (rentedThreads.length === 0) return;

    // Chọn ngẫu nhiên 1 trong các Playlist hoặc Zing Chart
    const selectedPlaylist = PLAYLISTS[Math.floor(Math.random() * PLAYLISTS.length)];
    let playlistData = null;
    let songs = [];

    if (selectedPlaylist.id === "ZING_CHART") {
        const chartData = await getZingChart();
        if (!chartData || !chartData.RTChart?.items) return;
        songs = chartData.RTChart.items;
        playlistData = {
            title: "Zing Chart Realtime",
            thumbnail: "https://zjs.zmdcdn.me/zmp3-desktop/dev/static/images/charthome-bg.png",
            artistsNames: "Cập nhật từng giờ"
        };
    } else {
        playlistData = await getDetailPlaylist(selectedPlaylist.id);
        if (!playlistData || !playlistData.song?.items) return;
        songs = playlistData.song.items;
    }

    const freeSongs = songs.filter(s => s.streamingStatus !== 3 && !s.isVIP).slice(0, 30);
    if (freeSongs.length === 0) return;

    // Chọn 1 bài ngẫu nhiên dùng chung cho tất cả nhóm
    const song = freeSongs[Math.floor(Math.random() * freeSongs.length)];
    const info = await getStreamZing(song.encodeId);
    const streamUrl = info?.["128"] || info?.["320"] || info?.default;
    if (!streamUrl || streamUrl === "VIP") return;

    const tempFile = path.join(process.cwd(), `auto_remix_${Date.now()}.mp3`);
    try {
        // Tải audio về máy
        const response = await axios({ method: 'get', url: streamUrl, responseType: 'stream' });
        const writer = fs.createWriteStream(tempFile);
        response.data.pipe(writer);
        await new Promise((r) => writer.on("finish", r));

        // Chuẩn bị các thành phần Canvas & Sticker dùng chung (upload CDN Zalo một lần)
        const anchorThread = rentedThreads[0];

        const playerImgBuffer = await drawZingPlayer(song);
        let remotePlayerUrl = null;
        if (playerImgBuffer) {
            const playerImgPath = path.join(process.cwd(), `src/modules/cache/auto_p_${Date.now()}.png`);
            fs.writeFileSync(playerImgPath, playerImgBuffer);
            remotePlayerUrl = await uploadToTmpFiles(playerImgPath, api, anchorThread, 1);
            if (fs.existsSync(playerImgPath)) fs.unlinkSync(playerImgPath);
        }

        const topImgBuffer = await drawZingPlaylist(playlistData, songs.slice(0, 10));
        let remoteTopUrl = null;
        if (topImgBuffer) {
            const topImgPath = path.join(process.cwd(), `src/modules/cache/auto_list_${Date.now()}.png`);
            fs.writeFileSync(topImgPath, topImgBuffer);
            remoteTopUrl = await uploadToTmpFiles(topImgPath, api, anchorThread, 1);
            if (fs.existsSync(topImgPath)) fs.unlinkSync(topImgPath);
        }

        let spinUrlGlobal = null;
        const thumbnailSrc = (song.thumbnail || song.thumb || "").replace("w94", "w500");
        const tempSpin = path.join(process.cwd(), `src/modules/cache/auto_spin_${Date.now()}.webp`);
        if (await createSpinningSticker(thumbnailSrc, tempSpin)) {
            spinUrlGlobal = await uploadStickerFile(tempSpin, api, anchorThread, 1);
            if (fs.existsSync(tempSpin)) fs.unlinkSync(tempSpin);
        }

        // Gửi tới tất cả các nhóm đã thuê
        for (const threadId of rentedThreads) {
            try {
                // 1. Gửi bảng xếp hạng
                const topMsg = `[ 🏆 ${selectedPlaylist.name} MỖI GIỜ ]\n─────────────────\n✨ Cập nhật bảng xếp hạng những bản nhạc đang hot nhất!`;
                if (remoteTopUrl) {
                    await api.sendImageEnhanced({ imageUrl: remoteTopUrl, threadId, threadType: 1, width: 800, height: 1550, msg: topMsg });
                }

                // 2. Gửi Voice
                await api.sendVoiceUnified({ filePath: tempFile, threadId, threadType: 1 });

                // 3. Gửi Player Card
                const playerMsg = `[ 🔥 RANDOM MUSIC ]\n─────────────────\n🎵 Title: ${song.title}\n👤 Artist: ${song.artistsNames}\n─────────────────\nChúc mọi người nghe nhạc vui vẻ! ❤️`;
                if (remotePlayerUrl) {
                    await api.sendImageEnhanced({ imageUrl: remotePlayerUrl, threadId, threadType: 1, width: 800, height: 260, msg: playerMsg });
                }

                // 4. Gửi Sticker xoay
                if (spinUrlGlobal) {
                    await api.sendCustomerSticker(spinUrlGlobal, spinUrlGlobal, threadId, 1, { width: 512, height: 512 });
                }
            } catch (err) {
                log.error(`Auto Remix Fail for ${threadId}:`, err.message);
            }
        }

        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);

    } catch (e) {
        log.error("Lỗi autoSendHotMusic (Remix):", e.message);
    }
}
