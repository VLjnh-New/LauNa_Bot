import { bankManager } from "../utils/managers/bankManager.js";
import { readJSON } from "../utils/core/io-json.js";
import { drawBatchuImage } from "../utils/canvas/canvasHelper.js";
import path from "node:path";
import fs from "node:fs";
import { log } from "../logger.js";

const DATA_PATH = path.join(process.cwd(), "src/modules/data/batchu.json");
const sessions = new Map();

/**
 * Hàm khởi tạo một ván chơi mới
 */
async function startGame(ctx) {
    const { api, threadId, threadType, prefix } = ctx;
    try {
        const questions = readJSON(DATA_PATH);
        if (!questions || !questions.length) return api.sendMessage({ msg: "⚠️ Dữ liệu câu hỏi đang gặp lỗi." }, threadId, threadType);

        const randomQ = questions[Math.floor(Math.random() * questions.length)];
        const answer = randomQ.answer.trim().toUpperCase();

        sessions.set(threadId, {
            answer,
            image: randomQ.image,
            startTime: Date.now(),
            hintLevel: 0
        });

        const buffer = await drawBatchuImage(randomQ.image);
        const tmpFile = path.join(process.cwd(), `src/modules/cache/batchu_${threadId}.png`);
        if (!fs.existsSync(path.dirname(tmpFile))) fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
        fs.writeFileSync(tmpFile, buffer);

        let statusMsg = `[ 🎮 ĐUỔI HÌNH BẮT CHỮ ]\n`;
        statusMsg += `─────────────────\n`;
        statusMsg += `📺 Hãy nhìn hình và đoán chữ!\n`;
        statusMsg += `📝 Đáp án có ${answer.replace(/\s/g, "").length} ký tự.\n`;
        statusMsg += `💡 Gợi ý: ${prefix}batchu hint\n`;
        statusMsg += `🛑 Dừng: ${prefix}batchu stop`;

        await api.sendMessage({ msg: statusMsg, attachments: [tmpFile] }, threadId, threadType);
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);

    } catch (err) {
        log.error("Batchu Start Error:", err.message);
    }
}

export const name = "batchu";
export const description = "Trò chơi Đuổi hình bắt chữ - Đoán đúng nhận xu!";

export const commands = {
    batchu: async (ctx) => {
        const { api, threadId, threadType, args, senderId, prefix } = ctx;

        if (args[0] === "stop" || args[0] === "end") {
            if (!sessions.has(threadId)) return api.sendMessage({ msg: "⚠️ Hiện không có trò chơi nào đang diễn ra ở đây." }, threadId, threadType);
            sessions.delete(threadId);
            return api.sendMessage({ msg: `🛑 Đã kết thúc trò chơi Đuổi hình bắt chữ.` }, threadId, threadType);
        }

        if (args[0] === "hint" || args[0] === "goiy") {
            const session = sessions.get(threadId);
            if (!session) return api.sendMessage({ msg: `⚠️ Hãy bắt đầu trò chơi bằng lệnh ${prefix}batchu trước.` }, threadId, threadType);
            
            const balance = bankManager.getBalance(senderId);
            const cost = 200;
            if (balance < cost) return api.sendMessage({ msg: `⚠️ Bạn cần ít nhất ${cost} xu để lấy gợi ý.` }, threadId, threadType);
            
            bankManager.subtract(senderId, cost);
            session.hintLevel = (session.hintLevel || 0) + 1;

            let hint = "";
            const ans = session.answer;
            if (session.hintLevel === 1) {
                hint = ans.slice(0, 2) + ans.slice(2).replace(/[^\s]/g, "*");
            } else if (session.hintLevel === 2) {
                hint = ans.slice(0, 4) + ans.slice(4).replace(/[^\s]/g, "*");
            } else {
                hint = ans.split("").map((c, idx) => (idx % 2 === 0 || c === " ") ? c : "*").join("");
            }

            return ctx.reply({ msg: `💡 @tag, Gợi ý cấp độ ${session.hintLevel} (tốn ${cost} xu):\n👉 ${hint}\n(Số dư: ${bankManager.getBalance(senderId)} xu)` }, [senderId]);
        }

        if (sessions.has(threadId)) {
            return api.sendMessage({ msg: "⚠️ Trò chơi đang diễn ra! Hãy trả lời hoặc gõ !batchu stop để dừng." }, threadId, threadType);
        }

        await startGame(ctx);
    }
};

/**
 * Xử lý tin nhắn đến để kiểm tra đáp án
 */
export async function handle(ctx) {
    const { api, threadId, threadType, senderId, senderName, content, prefix } = ctx;
    if (!content || !sessions.has(threadId) || content.startsWith(prefix)) return false;

    const session = sessions.get(threadId);
    const userAnswer = content.trim().toUpperCase();

    if (userAnswer === session.answer) {
        sessions.delete(threadId);
        
        const reward = 500;
        const newBalance = bankManager.add(senderId, reward);

        let msg = `🎉 CHÚC MỪNG @tag ĐÂY LÀ ĐÁP ÁN CHÍNH XÁC! 🎉\n`;
        msg += `─────────────────\n`;
        msg += `✅ Đáp án: ${session.answer}\n`;
        msg += `💰 Bạn nhận được: +${reward} xu\n`;
        msg += `🧸 Chuẩn bị câu tiếp theo sau 3 giây...`;

        await ctx.reply({ msg }, [senderId]);
        
        // Tự động chuyển câu tiếp theo sau 3s
        setTimeout(() => {
            startGame(ctx);
        }, 3000);

        return true; 
    } else {
        if (Math.abs(userAnswer.length - session.answer.length) <= 3) {
            api.addReaction("sad", {msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId}, ctx.threadId, ctx.threadType).catch(() => {});
        }
    }
    return false;
}
