import axios from "axios";
import * as cheerio from "cheerio";
import { getDesktopUA } from "../utils/core/userAgents.js";
import { drawXSMB } from "../utils/canvas/canvasHelper.js";
import { uploadToTmpFiles } from "../utils/core/tmpFiles.js";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";
import { readJSON, writeJSON } from "../utils/core/io-json.js";

const DATA_PATH = path.join(process.cwd(), "src/modules/data/xsmb_auto.json");

if (!fs.existsSync(path.dirname(DATA_PATH))) fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
if (!fs.existsSync(DATA_PATH)) writeJSON(DATA_PATH, { groups: [], lastNotified: "" });

export const name = "xsmb";
export const description = "Cập nhật và tự động thông báo kết quả XSMB lúc 18h15";

export const commands = {
    xsmb: async (ctx) => {
        const { api, threadId, threadType, args, adminIds } = ctx;
        const isAdmin = adminIds.includes(ctx.senderId);

        if (args[0] === "auto") {
            if (!isAdmin) return api.sendMessage({ msg: "⚠️ Chỉ admin mới có thể cài đặt thông báo tự động." }, threadId, threadType);
            
            const state = readJSON(DATA_PATH);
            if (args[1] === "on") {
                if (!state.groups.includes(threadId)) {
                    state.groups.push(threadId);
                    writeJSON(DATA_PATH, state);
                }
                return api.sendMessage({ msg: "✅ Đã bật tự động thông báo XSMB (18h15-18h40) cho nhóm này." }, threadId, threadType);
            } else if (args[1] === "off") {
                state.groups = state.groups.filter(id => id !== threadId);
                writeJSON(DATA_PATH, state);
                return api.sendMessage({ msg: "❌ Đã tắt tự động thông báo XSMB cho nhóm này." }, threadId, threadType);
            } else {
                return api.sendMessage({ msg: "❓ Sử dụng: !xsmb auto on/off" }, threadId, threadType);
            }
        }

        try {
            const res = await axios.get("https://xosodaiphat.com/xsmb-xo-so-mien-bac.html", {
                headers: { "User-Agent": getDesktopUA() },
                timeout: 10000
            });
            const $ = cheerio.load(res.data);
            const latestBlock = $(".block").first();
            const dateStr = latestBlock.find(".class-title-list-link a").last().text().trim();

            const results = {
                code: latestBlock.find("#mb_prizeCode").text().trim().replace(/\s+/g, " "),
                db: latestBlock.find(".special-prize-lg").first().text().trim(),
                g1: latestBlock.find(".number-black-bold").first().text().trim(),
                g2: latestBlock.find('span[id^="mb_prize_2"]').map((i, el) => $(el).text().trim()).get(),
                g3: latestBlock.find('span[id^="mb_prize_3"]').map((i, el) => $(el).text().trim()).get(),
                g4: latestBlock.find('span[id^="mb_prize_4"]').map((i, el) => $(el).text().trim()).get(),
                g5: latestBlock.find('span[id^="mb_prize_5"]').map((i, el) => $(el).text().trim()).get(),
                g6: latestBlock.find('span[id^="mb_prize_6"]').map((i, el) => $(el).text().trim()).get(),
                g7: latestBlock.find('span[id^="mb_prize_7"]').map((i, el) => $(el).text().trim()).get(),
            };

            if (!results.db && !results.g7.length) {
                return api.sendMessage({ msg: "⚠️ Chưa có kết quả XSMB hôm nay. Vui lòng quay lại lúc 18h15." }, threadId, threadType);
            }

            const buffer = await drawXSMB(results, dateStr);
            const tempPath = path.join(process.cwd(), `src/modules/cache/xsmb_${Date.now()}.png`);
            if (!fs.existsSync(path.dirname(tempPath))) fs.mkdirSync(path.dirname(tempPath), { recursive: true });
            fs.writeFileSync(tempPath, buffer);

            const remoteUrl = await uploadToTmpFiles(tempPath, api, threadId, threadType);
            const statusMsg = `[ 🎲 KẾT QUẢ XỔ SỐ MIỀN BẮC ]\n─────────────────\n📅 Ngày: ${dateStr}\n✨ Soi cầu ngay - Đổi vận may!`;

            if (remoteUrl) {
                await api.sendImageEnhanced({
                    imageUrl: remoteUrl,
                    threadId, threadType,
                    width: 800, height: 150 + (9 * 65) + 80,
                    msg: statusMsg
                });
            } else {
                await api.sendMessage({ msg: statusMsg, attachments: [tempPath] }, threadId, threadType);
            }

            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        } catch (err) {
            log.error("XSMB error:", err.message);
            api.sendMessage({ msg: "⚠️ Lỗi khi kết nối tới máy chủ XS Đại Phát!" }, threadId, threadType);
        }
    }
};

export async function startXSMBTracker(api) {
    log.system("Bắt đầu khởi chạy trình theo dõi XSMB tự động...");
    
    setInterval(async () => {
        const now = new Date();
        const hour = now.getHours();
        const min = now.getMinutes();
        const todayStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()}`;

        // Kiểm tra từ 18:25 đến 18:50 mỗi ngày
        if (hour === 18 && min >= 25 && min <= 50) {
            const state = readJSON(DATA_PATH);
            if (state.lastNotified === todayStr) return; // Đã thông báo hôm nay

            try {
                const res = await axios.get("https://xosodaiphat.com/xsmb-xo-so-mien-bac.html", { timeout: 10000 });
                const $ = cheerio.load(res.data);
                const latestBlock = $(".block").first();
                const dateStr = latestBlock.find(".class-title-list-link a").last().text().trim();

                // Nếu ngày hiển thị trùng với hôm nay và đã có giải Đặc biệt (là xong kết quả)
                if (dateStr === todayStr && latestBlock.find(".special-prize-lg").first().text().trim()) {
                    log.info("Phát hiện kết quả XSMB hôm nay. Đang gửi thông báo...");
                    
                    const results = {
                        code: latestBlock.find("#mb_prizeCode").text().trim().replace(/\s+/g, " "),
                        db: latestBlock.find(".special-prize-lg").first().text().trim(),
                        g1: latestBlock.find(".number-black-bold").first().text().trim(),
                        g2: latestBlock.find('span[id^="mb_prize_2"]').map((i, el) => $(el).text().trim()).get(),
                        g3: latestBlock.find('span[id^="mb_prize_3"]').map((i, el) => $(el).text().trim()).get(),
                        g4: latestBlock.find('span[id^="mb_prize_4"]').map((i, el) => $(el).text().trim()).get(),
                        g5: latestBlock.find('span[id^="mb_prize_5"]').map((i, el) => $(el).text().trim()).get(),
                        g6: latestBlock.find('span[id^="mb_prize_6"]').map((i, el) => $(el).text().trim()).get(),
                        g7: latestBlock.find('span[id^="mb_prize_7"]').map((i, el) => $(el).text().trim()).get(),
                    };

                    const buffer = await drawXSMB(results, dateStr);
                    const tempPath = path.join(process.cwd(), `src/modules/cache/auto_xsmb.png`);
                    fs.writeFileSync(tempPath, buffer);

                    const statusMsg = `[ 🎲 TỰ ĐỘNG THÔNG BÁO XSMB ]\n─────────────────\n📅 Ngày mở thưởng: ${dateStr}\n🌈 Kết quả đã về! Chúc cả nhà may mắn!`;
                    
                    for (const threadId of state.groups) {
                        try {
                            const remoteUrl = await uploadToTmpFiles(tempPath, api, threadId, 2); // Giả định là Group
                            if (remoteUrl) {
                                await api.sendImageEnhanced({ imageUrl: remoteUrl, threadId, threadType: 2, width: 800, height: 800, msg: statusMsg });
                            } else {
                                await api.sendMessage({ msg: statusMsg, attachments: [tempPath] }, threadId, 2);
                            }
                        } catch (e) { log.error(`Lỗi gửi XSMB cho nhóm ${threadId}:`, e.message); }
                    }

                    state.lastNotified = todayStr;
                    writeJSON(DATA_PATH, state);
                    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
                }
            } catch (err) {
                log.error("Lỗi tracker XSMB:", err.message);
            }
        }
    }, 120000); // Check mỗi 2 phút
}
