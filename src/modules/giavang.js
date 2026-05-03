import axios from "axios";
import * as cheerio from "cheerio";
import { drawGoldPrice } from "../utils/canvas/canvasHelper.js";
import { uploadToTmpFiles } from "../utils/core/tmpFiles.js";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";

export const name = "giavang";
export const description = "Cập nhật giá vàng hôm nay (Phú Quý Group)";

export const commands = {
    giavang: async (ctx) => {
        const { api, threadId, threadType, prefix } = ctx;
        const query = ctx.args.join(" ");

        try {
            const res = await axios.get("https://phuquygroup.vn/", {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                },
                timeout: 10000
            });
            
            const $ = cheerio.load(res.data);
            const goldItems = [];
            const updateTime = $(".update-time").first().text().replace("Giá vàng cập nhật lần cuối lúc", "").trim();

            $(".table-area tbody tr").each((i, el) => {
                const type = $(el).find("td").eq(0).text().trim();
                const buy = $(el).find("td").eq(1).text().trim();
                const sell = $(el).find("td").eq(2).text().trim();
                
                if (type && (buy || sell)) {
                    goldItems.push({ type, buy, sell });
                }
            });

            if (goldItems.length === 0) {
                return api.sendMessage({ msg: "⚠️ Không thể lấy dữ liệu giá vàng lúc này. Có thể website Phú Quý đã thay đổi cấu trúc." }, threadId, threadType);
            }

            // Chỉ lấy top 12 nếu quá dài
            const displayItems = goldItems.slice(0, 12);

            const buffer = await drawGoldPrice(displayItems, updateTime);
            const tempPath = path.join(process.cwd(), `src/modules/cache/gold_${Date.now()}.png`);
            if (!fs.existsSync(path.dirname(tempPath))) fs.mkdirSync(path.dirname(tempPath), { recursive: true });
            fs.writeFileSync(tempPath, buffer);

            const remoteUrl = await uploadToTmpFiles(tempPath, api, threadId, threadType);
            const statusMsg = `[ 💰 BẢNG GIÁ VÀNG PHÚ QUÝ ]\n─────────────────\n🕒 Cập nhật: ${updateTime}\n✨ Đơn vị: VNĐ/Chỉ\n🚀 Click vào ảnh để xem chi tiết!`;

            if (remoteUrl) {
                await api.sendImageEnhanced({
                    imageUrl: remoteUrl,
                    threadId, threadType,
                    width: 800, height: 160 + (displayItems.length * 87) + 120, // Tăng nhẹ height padding
                    msg: statusMsg
                });
            } else {
                await api.sendMessage({ msg: statusMsg, attachments: [tempPath] }, threadId, threadType);
            }

            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        } catch (err) {
            log.error("Gold price error:", err.message);
            api.sendMessage({ msg: "⚠️ Hệ thống không thể kết nối tới website Phú Quý. Vui lòng thử lại sau!" }, threadId, threadType);
        }
    }
};
