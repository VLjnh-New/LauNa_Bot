import axios from "axios";
import * as cheerio from "cheerio";
import { drawFuelPrice } from "../utils/canvas/canvasHelper.js";
import { uploadToTmpFiles } from "../utils/core/tmpFiles.js";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";
import { getDesktopUA } from "../utils/core/userAgents.js";

export const name = "giaxang";
export const description = "Cập nhật giá xăng dầu hôm nay (PVOIL)";

export const commands = {
    giaxang: async (ctx) => {
        const { api, threadId, threadType } = ctx;

        try {
            const res = await axios.get("https://www.pvoil.com.vn/tin-gia-xang-dau", {
                headers: {
                    "User-Agent": getDesktopUA()
                },
                timeout: 10000
            });
            
            const $ = cheerio.load(res.data);
            const fuelItems = [];
            
            // Lấy thời gian cập nhật
            const updateTitle = $(".oilpricescontainer strong").first().text().trim();
            const updateTime = updateTitle.match(/\d{2}:\d{2} ngày \d{2}\/\d{2}\/\d{4}/)?.[0] || "";

            $(".oilpricescontainer tbody tr").each((i, el) => {
                const name = $(el).find("td").eq(1).text().trim();
                const price = $(el).find("td").eq(2).text().trim();
                const change = $(el).find("td").eq(3).text().trim();
                
                if (name && price) {
                    fuelItems.push({ name, price, change });
                }
            });

            if (fuelItems.length === 0) {
                return api.sendMessage({ msg: "⚠️ Không thể lấy dữ liệu giá xăng dầu lúc này." }, threadId, threadType);
            }

            const buffer = await drawFuelPrice(fuelItems, updateTime);
            const tempPath = path.join(process.cwd(), `src/modules/cache/fuel_${Date.now()}.png`);
            if (!fs.existsSync(path.dirname(tempPath))) fs.mkdirSync(path.dirname(tempPath), { recursive: true });
            fs.writeFileSync(tempPath, buffer);

            const remoteUrl = await uploadToTmpFiles(tempPath, api, threadId, threadType);
            const statusMsg = `[ ⛽ GIÁ XĂNG DẦU PVOIL ]\n─────────────────\n🕒 ${updateTime ? "Cập nhật lúc: " + updateTime : "Cập nhật hôm nay"}\n⛽ Đơn vị: VNĐ/Lít`;

            if (remoteUrl) {
                await api.sendImageEnhanced({
                    imageUrl: remoteUrl,
                    threadId, threadType,
                    width: 800, height: 180 + (fuelItems.length * 92) + 120,
                    msg: statusMsg
                });
            } else {
                await api.sendMessage({ msg: statusMsg, attachments: [tempPath] }, threadId, threadType);
            }

            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

        } catch (err) {
            log.error("Fuel price error:", err.message);
            api.sendMessage({ msg: "⚠️ Lỗi khi kết nối tới hệ thống PVOIL!" }, threadId, threadType);
        }
    }
};
