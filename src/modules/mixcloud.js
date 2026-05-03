import { fs, path, log, rentalManager, uploadToTmpFiles } from "../globals.js";
import { drawMcSearch, drawMcPlayer } from "../utils/canvas/canvasHelper.js";
import { downloadMixcloud, searchMixcloud } from "../utils/downloaders/mixcloudDownloader.js";
import { sendMusicSticker } from "../utils/core/stickerHelper.js";

export const name = "mixcloud";
export const description = "Tìm kiếm và tải nhạc từ Mixcloud";

export const pendingSearches = new Map();

async function mcHandler({ api, args, threadId, threadType, log, message }) {
    try {
        if (!args?.length) {
            return api.sendMessage({
                msg: `[ ☁️ MIXCLOUD ]\n◈ !mc [từ khóa] — tìm kiếm\n◈ !mc download [link] — tải trực tiếp`
            }, threadId, threadType);
        }

        const sub = args[0].toLowerCase();
        const clockEmojis = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
        let clockIdx = 0;
        let reactionInterval;

        const startReaction = () => {
            reactionInterval = setInterval(() => {
                if (message?.data) {
                    api.addReaction(clockEmojis[clockIdx % clockEmojis.length], {
                        msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId
                    }, threadId, threadType).catch(() => { });
                    clockIdx++;
                }
            }, 2000);
        };

        // Download trực tiếp qua link
        if (sub === "download" || sub.includes("mixcloud.com")) {
            const url = sub.includes("mixcloud.com") ? args[0] : args[1];
            if (!url) return api.sendMessage({ msg: "⚠️ Thiếu link Mixcloud." }, threadId, threadType);


            startReaction();

            try {
                const mc = await downloadMixcloud(url);
                if (mc?.error) return api.sendMessage({ msg: `❌ ${mc.error}` }, threadId, threadType);
                if (!mc?.streamUrl) return api.sendMessage({ msg: "❌ Lỗi: Không lấy được stream bản mix này." }, threadId, threadType);

                _sendPlayerCard(api, mc, threadId, threadType).catch(() => { });
                const { sendAudio } = await import("../events/autodown.js");
                await sendAudio(api, mc.streamUrl, threadId, threadType);

                if (mc.thumb) {
                    await sendMusicSticker(api, mc.thumb, threadId, threadType);
                }
            } finally {
                clearInterval(reactionInterval);
            }
            return;
        }

        // Search
        const query = sub === "search" ? args.slice(1).join(" ") : args.join(" ");
        if (!query) return api.sendMessage({ msg: "⚠️ Nhập từ khóa tìm kiếm." }, threadId, threadType);

        api.sendMessage({ msg: `🔍 Đang tìm "${query}"...` }, threadId, threadType);
        startReaction();

        let results = [];
        try {
            results = await searchMixcloud(query, 8);
            if (results === null) {
                return api.sendMessage({ msg: "⚠️ Lỗi kết nối tới Mixcloud (Timeout). Hãy thử lại sau ít giây." }, threadId, threadType);
            }
            if (!results.length) {
                return api.sendMessage({ msg: "❌ Không tìm thấy kết quả nào cho từ khóa này." }, threadId, threadType);
            }

            // Thu hồi tin nhắn tìm kiếm cũ nếu có
            const oldData = pendingSearches.get(threadId);
            if (oldData?.msgId) {
                api.deleteMessage({ msgId: oldData.msgId }, threadId, threadType).catch(() => { });
            }

            // Tạo text list làm fallback
            let textList = "";
            results.forEach((r, i) => {
                textList += `${i + 1}. ${r.name} (${Math.floor(r.duration / 60)}p)\n`;
            });

            // Vẽ canvas card
            const buf = await drawMcSearch(results, query);
            const tmpImg = path.join(process.cwd(), `src/modules/cache/mc_s_${Date.now()}.png`);
            fs.writeFileSync(tmpImg, buf);

            const remoteUrl = await uploadToTmpFiles(tmpImg, api, threadId, threadType);
            const caption = `[ ☁️ MIXCLOUD SEARCH ]\n${"─".repeat(15)}\n${textList}${"─".repeat(15)}\n✨ Trả lời 1-${results.length} để tải nhạc!`;

            let sent;
            if (remoteUrl) {
                const h = 150 + results.length * (130 + 18) + 90;
                sent = await api.sendImageEnhanced({ imageUrl: remoteUrl, threadId, threadType, width: 800, height: h, msg: caption });
            } else {
                sent = await api.sendMessage({ msg: caption, file: fs.createReadStream(tmpImg) }, threadId, threadType);
            }

            const msgId = sent?.data?.msgId || sent?.msgId;
            pendingSearches.set(threadId, { results, query, msgId });

            if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg);
        } catch (e) {
            log.error("Mixcloud Search Error:", e.message);
            // Fallback về text nếu canvas/upload lỗi
            let msg = `🔎 Mixcloud: "${query}"\n${"─".repeat(22)}\n`;
            results.forEach((r, i) => {
                msg += `${i + 1}. ${r.name}\n   👤 ${r.author}  ⏳ ${Math.floor(r.duration / 60)} phút\n\n`;
            });
            if (results.length) {
                msg += `💡 Trả lời số 1-${results.length} để tải`;
                const sent = await api.sendMessage({ msg }, threadId, threadType);
                pendingSearches.set(threadId, { results, query, msgId: sent?.data?.msgId || sent?.msgId });
            } else {
                await api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
            }
        } finally {
            clearInterval(reactionInterval);
        }
    } catch (e) {
        log.error("Lỗi Mixcloud:", e.message);
        return api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
    }
}

async function _sendPlayerCard(api, mc, threadId, threadType) {
    const tmpImg = path.join(process.cwd(), `src/modules/cache/mc_p_${Date.now()}.png`);
    try {
        const buf = await drawMcPlayer({ title: mc.title, author: mc.author, duration: mc.duration, thumb: mc.thumb });
        fs.writeFileSync(tmpImg, buf);

        const statusMsg = `[ ☁️ MIXCLOUD PLAYER ]\n─────────────────\n🎵 ${mc.title}\n👤 ${mc.author}\n⏳ ${Math.floor(mc.duration / 60)} phút\n─────────────────`;

        const remoteUrl = await uploadToTmpFiles(tmpImg, api, threadId, threadType);
        if (remoteUrl) {
            await api.sendImageEnhanced({ imageUrl: remoteUrl, threadId, threadType, width: 800, height: 260, msg: statusMsg });
        } else {
            await api.sendMessage({ msg: statusMsg, file: fs.createReadStream(tmpImg) }, threadId, threadType);
        }
    } catch (e) {
        log.error("Player Card Error:", e.message);
    } finally {
        if (fs.existsSync(tmpImg)) fs.unlinkSync(tmpImg);
    }
}

export async function handle(ctx) {
    const { content, threadId, threadType, api, log, adminIds, senderId, rentalManager, message } = ctx;
    if (!adminIds.includes(String(senderId)) && !rentalManager?.isRented(threadId)) return false;

    const choice = parseInt(content?.trim());
    if (isNaN(choice) || choice < 1 || choice > 8) return false;

    const pending = pendingSearches.get(threadId);
    if (!pending?.results?.[choice - 1]) return false;

    const track = pending.results[choice - 1];

    // Thu hồi tin nhắn tìm kiếm ngay khi chọn
    if (pending.msgId) {
        api.deleteMessage({ msgId: pending.msgId }, threadId, threadType).catch(() => { });
    }
    pendingSearches.delete(threadId);

    api.sendMessage({ msg: `⏳ Đang xử lý: ${track.name}...` }, threadId, threadType);

    const clockEmojis = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
    let clockIdx = 0;
    const reactionInterval = setInterval(() => {
        if (message?.data) {
            api.addReaction(clockEmojis[clockIdx % clockEmojis.length], {
                msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId
            }, threadId, threadType).catch(() => { });
            clockIdx++;
        }
    }, 2000);

    try {
        const mcUrl = track.url.startsWith("http") ? track.url : `https://www.mixcloud.com${track.url}`;
        const mc = await downloadMixcloud(mcUrl);
        if (mc?.error) {
            return api.sendMessage({ msg: `❌ ${mc.error}` }, threadId, threadType);
        }
        if (!mc?.streamUrl) {
            return api.sendMessage({ msg: "❌ Lỗi: Không lấy được stream bản mix này." }, threadId, threadType);
        }

        // Gửi player card (không đợi)
        _sendPlayerCard(api, mc, threadId, threadType).catch(() => { });

        const { sendAudio } = await import("../events/autodown.js");
        await sendAudio(api, mc.streamUrl, threadId, threadType);
        if (mc.thumb) await sendMusicSticker(api, mc.thumb, threadId, threadType);
    } catch (e) {
        log.error("Mixcloud handle error:", e.message);
        api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
    } finally {
        clearInterval(reactionInterval);
    }

    return true;
}

export const commands = { mixcloud: mcHandler, mc: mcHandler };
