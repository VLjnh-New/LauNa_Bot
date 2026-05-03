import { log } from "../globals.js";

export const name = "getlink";
export const description = "Trích xuất link và dữ liệu gốc từ tin nhắn (reply để dùng)";

export const commands = {
    getlink: async (ctx) => {
        const { api, message, threadId, threadType, log } = ctx;
        const quote = message.data.quote;

        if (!quote) {
            return await api.sendMessage({ msg: "➥ Vui lòng reply (trả lời) vào tin nhắn cần lấy link!" }, threadId, threadType);
        }

        try {
            const msgId = quote.globalMsgId || quote.msgId || quote.cliMsgId;

            // Mapping cliMsgType
            const typeMap = {
                1: "Text",
                2: "Image",
                3: "Voice",
                4: "Video",
                31: "Image/Photo",
                32: "Image/Photo",
                38: "Link/URL",
                44: "File",
                46: "Sticker"
            };
            const typeName = typeMap[quote.cliMsgType] || `Unknown (${quote.cliMsgType})`;

            // Xử lý dữ liệu từ quote.attach (JSON string)
            let rawContent = null;
            if (quote.attach) {
                try {
                    rawContent = JSON.parse(quote.attach);
                } catch {
                    rawContent = { msg: quote.msg };
                }
            } else {
                rawContent = { msg: quote.msg };
            }

            let info = `[ 🔍 MSG INFO ]\n`;
            info += `─────────────────\n`;
            info += `◈ ID   : ${msgId}\n`;
            info += `◈ Type : ${typeName}\n`;
            info += `◈ From : ${quote.fromD || "Unknown"}\n`;
            info += `─────────────────\n\n`;

            if (typeof rawContent === "object" && rawContent !== null) {
                if (rawContent.href) info += `❯ Href : ${rawContent.href}\n`;
                if (rawContent.thumb) info += `❯ Thumb: ${rawContent.thumb}\n`;
                if (rawContent.msg && rawContent.msg !== quote.msg) info += `❯ Text : ${rawContent.msg}\n`;

                // Xử lý params (link HD, videoUrl...)
                if (rawContent.params) {
                    try {
                        const params = typeof rawContent.params === "string" ? JSON.parse(rawContent.params) : rawContent.params;
                        info += `\n✦ METADATA ✦\n`;
                        if (params.hd) info += `❯ HD   : ${params.hd}\n`;
                        if (params.m4a) info += `❯ Voice: ${params.m4a}\n`;
                        if (params.voiceId) info += `❯ VoiceID: ${params.voiceId}\n`;
                        if (params.videoUrl || params.url) info += `❯ URL  : ${params.videoUrl || params.url}\n`;
                        if (params.m4aUrl) info += `❯ M4A  : ${params.m4aUrl}\n`;
                        if (params.fileSize) info += `❯ Size : ${(params.fileSize / 1024 / 1024).toFixed(2)} MB\n`;
                        if (params.duration) info += `❯ Time : ${Math.floor(params.duration / 1000)}s\n`;
                        if (params.width) info += `❯ Res  : ${params.width}x${params.height}\n`;
                    } catch (e) {
                        // Bỏ qua lỗi parse params
                    }
                }
            }

            if (quote.msg && !info.includes(quote.msg)) {
                info += `\n❯ Nội dung: ${quote.msg}\n`;
            }

            await api.sendMessage({ msg: info }, threadId, threadType);

        } catch (e) {
            log.error("Lỗi getlink:", e.message);
            await api.sendMessage({ msg: `⚠️ Lỗi trích xuất: ${e.message}` }, threadId, threadType);
        }
    }
};
