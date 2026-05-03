import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";

export const name = "wiki";
export const description = "Tra cứu bách khoa toàn thư Wikipedia";

export const commands = {
    wiki: async (ctx) => {
        const { api, args, threadId, threadType, prefix } = ctx;
        const query = args.join(" ").trim();
        
        if (!query) {
            return api.sendMessage({ msg: `[ 💡 HƯỚNG DẪN ]\n─────────────────\n‣ Dùng: ${prefix}wiki [từ khóa]\n‣ Ví dụ: ${prefix}wiki trái đất` }, threadId, threadType);
        }

        try {
            const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
            
            const searchUrl = `https://vi.wikipedia.org/w/rest.php/v1/search/title?q=${encodeURIComponent(query)}&limit=10`;
            const searchRes = await axios.get(searchUrl, { headers });
            const pages = searchRes.data.pages;

            if (!pages || pages.length === 0) {
                return api.sendMessage({ msg: `⚠️ Không tìm thấy bài viết nào trên Wikipedia cho từ khóa: "${query}"` }, threadId, threadType);
            }

            const topPage = pages[0];
            const key = topPage.key;

            const summaryUrl = `https://vi.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(key)}`;
            const summaryRes = await axios.get(summaryUrl, { headers });
            const summaryData = summaryRes.data;

            const title = summaryData.title || topPage.title;
            const description = summaryData.description || topPage.description || "Không có mô tả cụ thể.";
            const extract = summaryData.extract || summaryData.extract_html?.replace(/<[^>]*>?/gm, '') || "Không có nội dung chi tiết.";
            const pageUrl = summaryData.content_urls?.desktop?.page || `https://vi.wikipedia.org/wiki/${key}`;
            const thumbnail = summaryData.thumbnail?.source || topPage.thumbnail?.url || null;

            let msgText = `[ 🌍 BÁCH KHOA TOÀN THƯ WIKIPEDIA ]\n─────────────────\n`;
            msgText += `📌 Từ khóa: ${title}\n`;
            msgText += `🏷️ Mô tả: ${description}\n\n`;
            
            let shortExtract = extract;
            if (shortExtract.length > 700) {
                shortExtract = shortExtract.substring(0, 700) + "...";
            }
            msgText += `📄 Thông tin:\n${shortExtract}\n\n`;
            msgText += `🔗 Nguồn: ${pageUrl}`;

            if (thumbnail) {
                const imgUrl = thumbnail.startsWith('//') ? 'https:' + thumbnail : thumbnail;
                try {
                    const tempPath = path.join(process.cwd(), `tmp_wiki_${Date.now()}.png`);
                    const response = await axios.get(imgUrl, { responseType: 'arraybuffer', headers });
                    fs.writeFileSync(tempPath, Buffer.from(response.data));

                    await api.sendMessage({
                        msg: msgText,
                        attachments: [tempPath]
                    }, threadId, threadType);

                    if (fs.existsSync(tempPath)) {
                        fs.unlinkSync(tempPath);
                    }
                } catch (e) {
                    await api.sendMessage({ msg: msgText }, threadId, threadType);
                }
            } else {
                await api.sendMessage({ msg: msgText }, threadId, threadType);
            }
        } catch (err) {
            log.error("Wiki Error:", err.message);
            await api.sendMessage({ msg: `⚠️ Đã xảy ra lỗi khi lấy dữ liệu từ Wikipedia. Vui lòng thử lại sau!` }, threadId, threadType);
        }
    }
};
