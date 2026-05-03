import { fs, path, axios, log, rentalManager } from "../globals.js";
import { sendSpinningSticker } from "../utils/core/stickerHelper.js";
import { downloadTikTok } from "../utils/downloaders/tiktokDownloader.js";

export const name = "tiktok";
export const description = "Tải video, nhạc, hoặc xem thông tin từ TikTok";

export const pendingTikTokSelections = new Map();

async function reply(ctx, text, ttl = 0) {
    return await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data, ttl },
        ctx.threadId,
        ctx.threadType
    );
}

const localeStr = (n) => (+n).toLocaleString("vi-VN").replace(/,/g, ".");

export const commands = {
    tiktok: async (ctx) => {
        const { args, threadId, senderId, prefix } = ctx;
        const command = args[0]?.toLowerCase();
        const keyword = args.slice(1).join(" ");

        if (!command) {
            let help = `[ 🎬 TIKTOK DOWNLOADER ]\n`;
            help += `─────────────────\n`;
            help += ` ❯ ${prefix}tiktok info <id>       ➥ Info user\n`;
            help += ` ❯ ${prefix}tiktok video <url>     ➥ Tải Video\n`;
            help += ` ❯ ${prefix}tiktok music <url>     ➥ Tải Nhạc\n`;
            help += ` ❯ ${prefix}tiktok search <key>    ➥ Tìm Video\n`;
            help += ` ❯ ${prefix}tiktok post <id>       ➥ Video của user\n`;
            help += ` ❯ ${prefix}tiktok trending        ➥ Video xu hướng\n`;
            help += ` ❯ ${prefix}tiktok catbox <id>     ➥ Tải & upload Catbox\n`;
            help += `─────────────────\n`;
            help += `💡 Hỗ trợ cả link ngắn: vt.tiktok.com, vm.tiktok.com\n`;
            help += `✨ Tiện ích TikTok đa năng cho bạn!`;
            return reply(ctx, help);
        }

        try {
            switch (command) {
                case "info": {
                    if (!keyword) return reply(ctx, `⚠️ Vui lòng nhập ID người dùng. (VD: ${prefix}tiktok info @theanh28)`);
                    const res = await axios.get(`https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(keyword)}`);
                    if (res.data.code !== 0) return reply(ctx, "⚠️ Không tìm thấy người dùng này.");

                    const { user, stats } = res.data.data;
                    const thumb = user.avatarMedium;
                    const infoMsg = `[ 👤 TIKTOK USER INFO ]\n─────────────────\n◈ Name: ${user.nickname}\n◈ ID: ${user.uniqueId}\n◈ Followers: ${localeStr(stats.followerCount)}\n◈ Following: ${localeStr(stats.followingCount)}\n◈ Videos: ${localeStr(stats.videoCount)}\n◈ Tim: ${localeStr(stats.heartCount)}\n◈ Sign: ${user.signature || "Không có"}\n─────────────────\n🔗 https://www.tiktok.com/@${user.uniqueId}`;

                    const tempImg = path.join(process.cwd(), `tiktok_avt_${Date.now()}.jpg`);
                    await downloadFile(thumb, tempImg);
                    await ctx.api.sendMessage({
                        msg: infoMsg,
                        file: fs.createReadStream(tempImg)
                    }, threadId, ctx.threadType);
                    try { fs.unlinkSync(tempImg); } catch {}
                    break;
                }

                case "v":
                case "video": {
                    if (!keyword) return reply(ctx, `⚠️ Vui lòng nhập link video TikTok.\n✏️ VD: ${prefix}tiktok video https://vt.tiktok.com/...`);

                    const icons = ["akoi", "lỏ r hihi", "ok", "Đang tải...", "Chờ tí nha", "Xong rùi ✨"];
                    let iconIdx = 0;
                    const reactionInterval = setInterval(() => {
                        if (ctx.message && ctx.message.data) {
                            ctx.api.addReaction(icons[iconIdx % icons.length], {msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId}, ctx.threadId, ctx.threadType).catch(() => { });
                            iconIdx++;
                        }
                    }, 2000);

                    try {
                        const data = await downloadTikTok(keyword);
                        if (!data) return reply(ctx, "⚠️ Không thể tải video TikTok này.");

                        if (data.images?.length) {
                            const msg = `[ 🖼️ TIKTOK PHOTO ]\n─────────────────\n📝 ${data.title || "Không tiêu đề"}\n👤 ${data.author || "N/A"}`;
                            for (const imgUrl of data.images) {
                                try {
                                    const tempImg = path.join(process.cwd(), `tiktok_img_${Date.now()}.jpg`);
                                    await downloadFile(imgUrl, tempImg);
                                    await ctx.api.sendMessage({ msg, attachments: [tempImg] }, threadId, ctx.threadType);
                                    try { fs.unlinkSync(tempImg); } catch {}
                                } catch {}
                            }
                        } else if (data.videoUrl) {
                            const tempPath = path.join(process.cwd(), `tiktok_video_${Date.now()}.mp4`);
                            await downloadFile(data.videoUrl, tempPath);
                            const msg = `[ 🎬 TIKTOK DOWNLOAD ]\n─────────────────\n✨ Tải thành công:\n📝 ${data.title || "Không tiêu đề"}\n👤 ${data.author || "N/A"}\n❤️ ${localeStr(data.stats?.likes || 0)} · 👁️ ${localeStr(data.stats?.views || 0)}`;
                            await ctx.api.sendVideoUnified({ videoPath: tempPath, thumbnailUrl: data.cover, msg, threadId, threadType: ctx.threadType });
                            try { fs.unlinkSync(tempPath); } catch {}
                        } else {
                            return reply(ctx, "⚠️ Không tìm thấy video trong link này.");
                        }
                    } finally {
                        clearInterval(reactionInterval);
                    }
                    break;
                }

                case "m":
                case "music": {
                    if (!keyword) return reply(ctx, `⚠️ Vui lòng nhập link video TikTok.\n✏️ VD: ${prefix}tiktok music https://vt.tiktok.com/...`);

                    const icons = ["akoi", "lỏ r hihi", "ok", "Đang tải...", "Chờ tí nha", "Xong rùi ✨"];
                    let iconIdx = 0;
                    const reactionInterval = setInterval(() => {
                        if (ctx.message && ctx.message.data) {
                            ctx.api.addReaction(icons[iconIdx % icons.length], {msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId}, ctx.threadId, ctx.threadType).catch(() => { });
                            iconIdx++;
                        }
                    }, 2000);

                    try {
                        const data = await downloadTikTok(keyword);
                        if (!data?.audioUrl) return reply(ctx, "⚠️ Không lấy được nhạc từ video này.");

                        const tempPath = path.join(process.cwd(), `tiktok_music_${Date.now()}.mp3`);
                        await downloadFile(data.audioUrl, tempPath);
                        await ctx.api.sendVoiceUnified({ filePath: tempPath, threadId, threadType: ctx.threadType });
                        await sendSpinningSticker(ctx.api, data.cover || data.avatar, threadId, ctx.threadType, "tiktok_spin");
                        try { fs.unlinkSync(tempPath); } catch {}
                    } finally {
                        clearInterval(reactionInterval);
                    }
                    break;
                }

                case "search": {
                    if (!keyword) return reply(ctx, `⚠️ Vui lòng nhập từ khóa tìm kiếm.`);
                    const icons = ["akoi", "lỏ r hihi", "ok", "Đang tải...", "Chờ tí nha", "Xong rùi ✨"];
                    let iconIdx = 0;
                    const reactionInterval = setInterval(() => {
                        if (ctx.message && ctx.message.data) {
                            ctx.api.addReaction(icons[iconIdx % icons.length], {msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId}, ctx.threadId, ctx.threadType).catch(() => { });
                            iconIdx++;
                        }
                    }, 2000);

                    try {
                        const res = await axios.get(`https://www.tikwm.com/api/feed/search?keywords=${encodeURIComponent(keyword)}&region=VN`);
                        const videos = res.data.data.videos;
                        if (!videos || videos.length === 0) return reply(ctx, "⚠️ Không tìm thấy video nào.");

                        const buffer = await drawTikTokSearch(videos.slice(0, 6), `KẾT QUẢ TÌM KIẾM: ${keyword}`);
                        const searchMsg = { msg: `[ 🎬 TIKTOK SEARCH ]\n─────────────────\n✨ Có sẵn 𝟭-${Math.min(videos.length, 6)} kết quả cho bạn.\n🔎 Từ khóa: "${keyword}"` };
                        if (buffer && Buffer.isBuffer(buffer)) searchMsg.file = buffer;
                        await ctx.api.sendMessage(searchMsg, threadId, ctx.threadType);

                        const selections = videos.slice(0, 6).map(v => ({
                            id: v.video_id,
                            play: v.play,
                            title: v.title,
                            author: v.author.nickname,
                            uniqueId: v.author.unique_id,
                            duration: v.duration,
                            digg: v.digg_count,
                            thumb: v.origin_cover || v.cover
                        }));
                        pendingTikTokSelections.set(`${ctx.threadId}-${ctx.senderId}`, { type: "search", data: selections });
                    } finally {
                        clearInterval(reactionInterval);
                    }
                    break;
                }

                case "post": {
                    if (!keyword) return reply(ctx, `⚠️ Vui lòng nhập ID người dùng.`);
                    const res = await axios.get(`https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(keyword)}`);
                    const videos = res.data.data.videos;
                    if (!videos || videos.length === 0) return reply(ctx, "⚠️ Không tìm thấy bài đăng nào.");

                    await showList(ctx, videos, 1, "post", true);
                    break;
                }

                case "trending": {
                    const res = await axios.get(`https://www.tikwm.com/api/feed/list?region=VN`);
                    const videos = res.data.data;
                    if (!videos || videos.length === 0) return reply(ctx, "⚠️ Không lấy được video xu hướng.");

                    await showList(ctx, videos, 1, "trending", true);
                    break;
                }

                case "catbox": {
                    if (!keyword) return reply(ctx, `⚠️ Vui lòng nhập ID người dùng. (VD: ${prefix}tiktok catbox @theanh28 20)`);
                    const argsData = keyword.split(" ");
                    const unique_id = argsData[0].replace("@", "");
                    const limit = parseInt(argsData[1]) || 20;

                    const waitMsg = await reply(ctx, `⏳ Đang lấy danh sách video, vui lòng đợi...`);

                    try {
                        const res = await axios.get(`https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(unique_id)}`);
                        if (res.data.code !== 0) return reply(ctx, "⚠️ Không tìm thấy người dùng này hoặc lỗi API.");

                        const videos = res.data.data.videos;
                        if (!videos || videos.length === 0) return reply(ctx, "⚠️ Không tìm thấy video nào.");

                        const toProcess = videos.slice(0, limit);
                        if (waitMsg?.message?.msgId) await ctx.api.deleteMessage({msgId: waitMsg.message.msgId, cliMsgId: waitMsg.message.cliMsgId}, threadId, ctx.threadType).catch(() => {});
                        const statusMsg = await reply(ctx, `⏳ Đang xử lý ${toProcess.length} video & upload Catbox...`);

                        const results = [];
                        for (let i = 0; i < toProcess.length; i++) {
                            const v = toProcess[i];
                            const tempPath = path.join(process.cwd(), `tmp_catbox_${Date.now()}_${i}.mp4`);
                            try {
                                await downloadFile(v.play, tempPath);
                                const catUrl = await uploadToCatbox(tempPath);
                                if (catUrl) {
                                    results.push(`[${i + 1}] ${catUrl}`);
                                }
                            } catch (err) {
                                log.error("Lỗi bulk catbox:", err.message);
                            } finally {
                                if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                            }
                        }

                        if (results.length === 0) return reply(ctx, "⚠️ Không tải được video nào lên Catbox.");

                        const finalMsg = `[ 🎬 TIKTOK CATBOX ]\n─────────────────\n👤 User: @${unique_id}\n📂 Đã tải ${results.length}/${toProcess.length} video lên Catbox:\n\n${results.join("\n")}`;
                        return reply(ctx, finalMsg);
                    } catch (err) {
                        return reply(ctx, `⚠️ Lỗi: ${err.message}`);
                    }
                }

                default:
                    return reply(ctx, "⚠️ Lệnh không hợp lệ.");
            }
        } catch (e) {
            log.error("Lỗi TikTok:", e.message);
            return reply(ctx, `⚠️ Lỗi: ${e.message}`);
        }
    }
};

export async function showList(ctx, data, page, type, isVideo) {
    const itemsPerPage = 6;
    const start = (page - 1) * itemsPerPage;
    const pagedData = data.slice(start, start + itemsPerPage);
    const totalPages = Math.ceil(data.length / itemsPerPage);

    let titleText = "";
    if (type === "trending") titleText = "🔥 TIKTOK TRENDING";
    else if (type === "post") titleText = isVideo ? "🎬 USER VIDEOS" : "🎶 USER MUSIC";
    else titleText = "📂 TIKTOK LIST";

    const buffer = await drawTikTokSearch(pagedData, titleText);

    let msg = `[ 🎬 TIKTOK SEARCH ]\n─────────────────\n`;
    msg += `✨ Trang [ ${page} / ${totalPages} ]\n`;
    msg += `👉 Phản hồi STT để tải.\n`;
    msg += `👉 Phản hồi "trang <số>" để chuyển.\n`;
    if (type === "post") {
        msg += `👉 Thả cảm xúc để chuyển Video ⇆ Nhạc.`;
    }

    const listMsg = { msg };
    if (buffer && Buffer.isBuffer(buffer)) listMsg.file = buffer;
    await ctx.api.sendMessage(listMsg, ctx.threadId, ctx.threadType);

    const selections = pagedData.map(v => ({
        id: v.video_id,
        play: v.play,
        music: v.music,
        title: v.title,
        author: v.author?.nickname,
        uniqueId: v.author?.unique_id,
        duration: v.duration,
        digg: v.digg_count,
        thumb: v.origin_cover || v.cover
    }));

    pendingTikTokSelections.set(`${ctx.threadId}-${ctx.senderId}`, {
        type,
        data,
        page,
        isVideo,
        currentChoices: selections
    });
}

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType, adminIds } = ctx;

    const isOwner = adminIds.includes(String(senderId));
    if (!isOwner && !rentalManager.isRented(threadId)) return false;

    const key = `${threadId}-${senderId}`;
    const selection = pendingTikTokSelections.get(key);
    if (!selection) return false;

    const body = content.trim().toLowerCase();

    if (body.startsWith("trang ")) {
        const pageNum = parseInt(body.split(" ")[1]);
        if (!isNaN(pageNum) && pageNum > 0) {
            const totalPages = Math.ceil(selection.data.length / 6);
            if (pageNum <= totalPages) {
                await showList(ctx, selection.data, pageNum, selection.type, selection.isVideo);
                return true;
            }
        }
    }

    const choice = parseInt(body);
    if (!isNaN(choice) && choice >= 1 && choice <= 6) {
        const choices = selection.currentChoices || selection.data;
        const item = choices[choice - 1];
        if (!item) return false;

        const icons = ["akoi", "lỏ r hihi", "ok", "Đang tải...", "Chờ tí nha", "Xong rùi ✨"];
        let iconIdx = 0;
        const reactionInterval = setInterval(() => {
            if (ctx.message && ctx.message.data) {
                api.addReaction(icons[iconIdx % icons.length], {msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId}, ctx.threadId, ctx.threadType).catch(() => { });
                iconIdx++;
            }
        }, 2000);

        try {
            if (selection.type === "search" || selection.isVideo) {
                const tempPath = path.join(process.cwd(), `tiktok_dl_${Date.now()}.mp4`);
                await downloadFile(item.play, tempPath);

                const msg = `[ 🎬 TIKTOK DOWNLOAD ]\n─────────────────\n✨ Tải thành công:\n📝 Tiêu đề: ${item.title || "Không tiêu đề"}\n👤 Tác giả: ${item.author || "N/A"} (@${item.uniqueId || "N/A"})\n❤️ Lượt tim: ${localeStr(item.digg || 0)}\n⏳ Thời gian: ${item.duration || 0} giây`;

                await api.sendVideoUnified({
                    videoPath: tempPath,
                    thumbnailUrl: item.thumb,
                    msg,
                    threadId,
                    threadType
                });
                try { fs.unlinkSync(tempPath); } catch {}
            } else {
                const tempPath = path.join(process.cwd(), `tiktok_dl_${Date.now()}.mp3`);
                await downloadFile(item.music, tempPath);

                await api.sendVoiceUnified({
                    filePath: tempPath,
                    threadId,
                    threadType
                });
                await sendSpinningSticker(api, item.thumb || item.cover || item.avatar, threadId, threadType, "tiktok_spin");
                try { fs.unlinkSync(tempPath); } catch {}
            }
            return true;
        } catch (e) {
            log.error("Lỗi TikTok Handler:", e.message);
            api.sendMessage({ msg: `⚠️ Lỗi khi tải file: ${e.message}` }, threadId, threadType);
        } finally {
            clearInterval(reactionInterval);
        }
    }
    return false;
}

export async function handleReaction(ctx) {
    const { event, threadId, log } = ctx;
    const senderId = event.userId;
    const key = `${threadId}-${senderId}`;
    const selection = pendingTikTokSelections.get(key);

    if (!selection || selection.type !== "post") return;

    try {
        await showList(ctx, selection.data, selection.page, selection.type, !selection.isVideo);
    } catch (e) {
        log.error("Lỗi Reaction TikTok:", e.message);
    }
}

