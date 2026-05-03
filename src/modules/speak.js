import axios from "axios";
import { writeFileSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import path from "node:path";
import { log } from "../logger.js";

export const name = "speak";
export const description = "Chuyển văn bản thành giọng nói (Voice Message)";

export const commands = {
    speak: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;
        const text = args.join(" ");
        if (!text) return api.sendMessage({ msg: "⚠️ Vui lòng nhập nội dung cần nói!" }, threadId, threadType);

        const cacheDir = path.join(process.cwd(), "src/modules/cache");
        if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });

        const tmpPath = path.join(cacheDir, `tts_${Date.now()}.mp3`);

        try {
            // Sử dụng Google TTS API (TW-OB client để không giới hạn độ dài ngắn)
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text.slice(0, 200))}&tl=vi&client=tw-ob`;
            const response = await axios.get(url, { 
                responseType: "arraybuffer",
                headers: {
                    'User-Agent': 'Mozilla/5.0'
                }
            });
            writeFileSync(tmpPath, response.data);

            // Gửi qua API tối ưu đã viết trong customApi.js
            await api.sendVoiceUnified({
                filePath: tmpPath,
                threadId,
                threadType
            });

        } catch (err) {
            log.error("[Speak] Error:", err.message);
            api.sendMessage({ msg: "❌ Lỗi chuyển đổi giọng nói: " + err.message }, threadId, threadType);
        } finally {
            if (existsSync(tmpPath)) {
                try { unlinkSync(tmpPath); } catch (e) {}
            }
        }
    }
};
