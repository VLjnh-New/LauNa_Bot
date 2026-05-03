import axios from "axios";
import { log } from "../../globals.js";
import { getPollinationsKey } from "./apiai.js";

const POLL_CHAT = "https://text.pollinations.ai/openai";

/**
 * Suy nghĩ sâu multi-step bằng Pollinations (miễn phí)
 * Bước 1: phân tích vấn đề
 * Bước 2: lập luận từng bước
 * Bước 3: tổng hợp câu trả lời
 */
async function pollinationsDeepThink(prompt, apiKey) {
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    async function call(systemPrompt, userPrompt, model = "openai-reasoning") {
        const res = await axios.post(POLL_CHAT, {
            model,
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user",   content: userPrompt },
            ],
            temperature: 0.5,
            max_tokens:  1500,
            private:     true,
        }, { headers, timeout: 60000 });
        return res.data?.choices?.[0]?.message?.content?.trim() || "";
    }

    const step1 = await call(
        "Bạn là chuyên gia phân tích. Hãy xác định: (1) câu hỏi cốt lõi, (2) các khía cạnh quan trọng cần xem xét, (3) thông tin cần thiết. Trả lời ngắn gọn bằng tiếng Việt.",
        prompt
    );

    const step2 = await call(
        "Bạn là chuyên gia lập luận. Dựa vào phân tích sau đây, hãy suy luận từng bước một cách logic và chi tiết bằng tiếng Việt.",
        `Câu hỏi gốc: ${prompt}\n\nPhân tích ban đầu:\n${step1}`
    );

    const step3 = await call(
        "Bạn là chuyên gia tổng hợp. Dựa vào quá trình suy nghĩ bên dưới, hãy đưa ra câu trả lời CUỐI CÙNG rõ ràng, súc tích, chính xác bằng tiếng Việt. Chỉ trả lời câu trả lời tổng hợp, không lặp lại quá trình.",
        `Câu hỏi: ${prompt}\n\nPhân tích:\n${step1}\n\nSuy luận:\n${step2}`
    );

    return { step1, answer: step3 };
}

export const name = "deepthink";
export const description = "Chế độ suy nghĩ sâu (UltraThink) — phân tích đa bước bằng Pollinations (miễn phí)";

export const commands = {
    think: async (ctx) => {
        const { api, args, threadId, threadType, raw, prefix } = ctx;

        let prompt = args.join(" ").trim();
        if (!prompt && raw?.quote?.msg) prompt = raw.quote.msg.trim();
        if (!prompt) {
            return api.sendMessage({
                msg: [
                    `🧠 Deep Think — Suy nghĩ sâu đa bước`,
                    `Cú pháp: ${prefix}think <câu hỏi phức tạp>`,
                    ``,
                    `Bot sẽ:`,
                    `  1️⃣ Phân tích vấn đề`,
                    `  2️⃣ Lập luận từng bước`,
                    `  3️⃣ Tổng hợp câu trả lời`,
                    ``,
                    `Ví dụ:`,
                    `  ${prefix}think Tại sao kinh tế Việt Nam tăng trưởng nhanh?`,
                    `  ${prefix}think Cách thiết kế hệ thống phân tán chịu tải cao`,
                ].join("\n"),
            }, threadId, threadType);
        }

        const thinking = await api.sendMessage({
            msg: `🧠 Đang suy nghĩ sâu [Pollinations Multi-Step]...\n⏳ Quá trình này mất 20-60 giây`,
        }, threadId, threadType);

        try {
            const { step1, answer } = await pollinationsDeepThink(prompt, getPollinationsKey());
            await api.sendMessage({
                msg: [
                    `🧠 [Deep Think — Phân tích đa bước]`,
                    ``,
                    `📋 Phân tích:`,
                    step1,
                    ``,
                    `✅ Kết luận:`,
                    answer,
                ].join("\n"),
                quote: raw,
            }, threadId, threadType);
        } catch (e) {
            log.error("[DeepThink]", e.message);
            await api.sendMessage({ msg: `❌ Lỗi suy nghĩ sâu: ${e.message}` }, threadId, threadType);
        } finally {
            try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
        }
    },
};
