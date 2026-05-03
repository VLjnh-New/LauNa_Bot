import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";
import { drawAltp } from "../utils/canvas/canvasHelper.js";

export const name = "gamevui";
export const description = "Trò chơi Ai Là Triệu Phú từ GameVui";

if (!global._altpGame) {
    global._altpGame = {};
}

const dataPath = path.join(process.cwd(), "src/modules/data/ailatriuphu.json");
let questions = [];
if (fs.existsSync(dataPath)) {
    questions = JSON.parse(fs.readFileSync(dataPath, "utf8"));
} else {
    log.error("Hệ thống: Không tìm thấy dữ liệu câu hỏi Ai Là Triệu Phú tại", dataPath);
}

const REWARDS = [
    0, 200, 400, 600, 1000, 2000, 3000, 6000, 10000, 14000, 22000, 30000, 40000, 60000, 85000, 150000
];

const SAFE_LEVELS = [0, 5, 10, 15];

function getQuestion(level) {
    const pool = questions.filter(q => q.level === level);
    if (!pool.length) {
        return questions[Math.floor(Math.random() * questions.length)];
    }
    return pool[Math.floor(Math.random() * pool.length)];
}

async function sendQuestion(ctx, game) {
    const { api, threadId, threadType } = ctx;
    
    // Withdraw previous question if exists
    if (game.lastMsgId) {
        api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType).catch(() => {});
        game.lastMsgId = null;
        game.lastCliMsgId = null;
    }

    const q = game.currentQuestion || getQuestion(game.level);
    game.currentQuestion = q;
    if (!game.timeLeft || game.timeLeft <= 0) game.timeLeft = 60; 

    try {
        const buffer = await drawAltp({
            question: q.question,
            options: q.options,
            level: game.level,
            reward: REWARDS[game.level],
            timeLeft: game.timeLeft,
            lifelines: game.lifelines,
            removedOptions: game.removedOptions || []
        });

        const tmpPath = path.join(process.cwd(), `altp_${threadId}_${Date.now()}.png`);
        fs.writeFileSync(tmpPath, buffer);

        let msg = `🌟 [ CUỘC ĐUA TRIỆU PHÚ ] /-showlove\n─────────────────\n💎 Câu số: ${game.level} :!\n💰 Thưởng: ${REWARDS[game.level].toLocaleString("vi-VN")} Đ :$\n─────────────────\n👉 Phản hồi A, B, C hoặc D để trả lời :))\n💡 Trợ giúp: 50:50, Gọi người thân, Khán giả ;d\n⏳ Gõ "DỪNG" để bảo toàn điểm! :;`;

        const res = await api.sendMessage({
            msg,
            attachments: [tmpPath]
        }, threadId, threadType);

        // Prefer attachment[0] for image responses (only has msgId), fallback to message for text
        const att = res.attachment?.[0];
        const msg_ = res.message;
        game.lastMsgId = att?.msgId || att?.globalMsgId || msg_?.msgId || msg_?.globalMsgId || null;
        game.lastCliMsgId = att?.cliMsgId || msg_?.cliMsgId || null;

        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (e) {
        log.error("ALTP Canvas Error:", e.message);
        // Fallback to text
        let msg = `🌟 [ AI LÀ TRIỆU PHÚ ] /-weak\n─────────────────\n❓ ${q.question} ;-s\n\nA. ${q.options.A}\nB. ${q.options.B}\nC. ${q.options.C}\nD. ${q.options.D}\n─────────────────\n👉 Chọn đáp án ngay nek! ;-a`;
        const res = await api.sendMessage({ msg }, threadId, threadType);
        const src2 = res.message || {};
        game.lastMsgId = src2.msgId || src2.globalMsgId || null;
        game.lastCliMsgId = src2.cliMsgId || null;
    }
}

const clockEmojis = ["🕛", "🕚", "🕙", "🕘", "🕗", "🕖", "🕕", "🕔", "🕓", "🕒", "🕑", "🕐"];

export const commands = {
    altp: async (ctx) => {
        const { api, threadId, threadType, senderId, args } = ctx;

        if (args[0] === "stop" || args[0] === "dừng" || args[0] === "off") {
            if (global._altpGame[threadId] && global._altpGame[threadId].isPlaying) {
                const game = global._altpGame[threadId];
                clearInterval(game.timer);
                const prize = REWARDS[game.level - 1];
                await api.sendMessage({ msg: `⏹️ Bạn đã quyết định dừng cuộc chơi. :l\n🏆 Phần thưởng mang về: ${prize.toLocaleString("vi-VN")} Đ :$` }, threadId, threadType);
                if (game.lastMsgId && game.lastCliMsgId) {
                    api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType).catch(() => {});
                    game.lastMsgId = null;
                    game.lastCliMsgId = null;
                }
                delete global._altpGame[threadId];
                return;
            }
            return api.sendMessage({ msg: "⚠️ Hiện không có trò chơi nào đang diễn ra. p-(" }, threadId, threadType);
        }

        if (global._altpGame[threadId] && global._altpGame[threadId].isPlaying) {
            return api.sendMessage({ msg: "⚠️ Trò chơi đang diễn ra! Hãy tập trung vào câu hỏi trên. :-(( " }, threadId, threadType);
        }

        const game = {
            isPlaying: true,
            level: 1,
            points: 0,
            lifelines: ["50:50", "Gọi người thân", "Khán giả"],
            threadId,
            senderId,
            timer: null,
            timeLeft: 60,
            lastMsgId: null,
            lastCliMsgId: null,
            removedOptions: []
        };

        global._altpGame[threadId] = game;

        game.timer = setInterval(async () => {
            game.timeLeft--;

            // Reaction countdown
            if (game.timeLeft % 5 === 0 && game.lastMsgId) {
                const iconIdx = Math.floor(game.timeLeft / 5);
                const icon = clockEmojis[iconIdx % clockEmojis.length];
                api.addReaction(icon, {
                    msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId
                }, threadId, threadType).catch(() => {});
            }

            if (game.timeLeft <= 0) {
                clearInterval(game.timer);
                const q = game.currentQuestion;
                await api.sendMessage({ msg: `⏰ HẾT GIỜ! :wipe\n📝 Đáp án đúng là: ${q.answer}. ${q.options[q.answer]}\n🎮 Trò chơi kết thúc.\n💰 Bạn nhận được mức thưởng an toàn: ${REWARDS[getSafeLevel(game.level)].toLocaleString("vi-VN")} Đ :$` }, threadId, threadType);
                if (game.lastMsgId && game.lastCliMsgId) {
                    api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType).catch(() => {});
                    game.lastMsgId = null;
                    game.lastCliMsgId = null;
                }
                delete global._altpGame[threadId];
            }
        }, 1000);

        await sendQuestion(ctx, game);
    },
};

commands.ailatriuphu = commands.altp;

function getSafeLevel(currentLevel) {
    let safe = 0;
    for (const lv of SAFE_LEVELS) {
        if (currentLevel > lv) safe = lv;
    }
    return safe;
}

export async function handle(ctx) {
    const { api, threadId, threadType, content, senderId, senderName, message } = ctx;
    if (!global._altpGame[threadId] || !global._altpGame[threadId].isPlaying) return false;
    
    const game = global._altpGame[threadId];
    const input = content.trim().toUpperCase();

    if (input === "DỪNG" || input === "STOP") {
        clearInterval(game.timer);
        const prize = REWARDS[game.level - 1];
        await api.sendMessage({ msg: `⏹️ Người chơi ${senderName} đã nhấn dừng cuộc chơi. :l\n🏆 Phần thưởng mang về: ${prize.toLocaleString("vi-VN")} Đ :$` }, threadId, threadType);
        if (game.lastMsgId) {
            api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType).catch(() => {});
            game.lastMsgId = null;
            game.lastCliMsgId = null;
        }
        delete global._altpGame[threadId];
        return true;
    }

    // Lifelines
    if (input === "50:50" || input === "5050") {
        if (!game.lifelines.includes("50:50")) {
            api.sendMessage({ msg: "⚠️ Bạn đã sử dụng quyền trợ giúp này rồi. ;-!" }, threadId, threadType);
            return true;
        }
        game.lifelines = game.lifelines.filter(l => l !== "50:50");
        const q = game.currentQuestion;
        const options = ["A", "B", "C", "D"].filter(o => o !== q.answer);
        const removed = options.sort(() => 0.5 - Math.random()).slice(0, 2);
        game.removedOptions = removed;
        
        await api.sendMessage({ msg: `💡 Trợ giúp 50:50: Đang loại bỏ 2 phương án sai... :v` }, threadId, threadType);
        // Redraw board
        await sendQuestion(ctx, game);
        return true;
    }

    if (input === "GỌI NGƯỜI THÂN" || input === "GOI NGUOI THAN") {
        if (!game.lifelines.includes("Gọi người thân")) return true;
        game.lifelines = game.lifelines.filter(l => l !== "Gọi người thân");
        const q = game.currentQuestion;
        const answers = ["A", "B", "C", "D"];
        const wisdom = Math.random();
        let advice = q.answer;
        if (wisdom < 0.2) advice = answers[Math.floor(Math.random() * 4)];
        await api.sendMessage({ msg: `☎️ Người thân nói: "Theo mình biết thì đáp án đúng có thể là ${advice}. Bạn hãy cân nhắc nhé!" ;d` }, threadId, threadType);
        return true;
    }

    if (input === "KHÁN GIẢ" || input === "KHAN GIA") {
        if (!game.lifelines.includes("Khán giả")) return true;
        game.lifelines = game.lifelines.filter(l => l !== "Khán giả");
        const q = game.currentQuestion;
        const dist = [0, 0, 0, 0];
        const correctIdx = ["A", "B", "C", "D"].indexOf(q.answer);
        dist[correctIdx] = 40 + Math.floor(Math.random() * 40);
        let remain = 100 - dist[correctIdx];
        for (let i = 0; i < 4; i++) {
            if (i === correctIdx) continue;
            const val = Math.floor(Math.random() * remain);
            dist[i] = val;
            remain -= val;
        }
        dist[dist.indexOf(Math.max(...dist))] += remain; 
        
        await api.sendMessage({ msg: `📊 Ý kiến khán giả trường quay: /-li\n- A: ${dist[0]}%\n- B: ${dist[1]}%\n- C: ${dist[2]}%\n- D: ${dist[3]}%` }, threadId, threadType);
        return true;
    }

    if (["A", "B", "C", "D"].includes(input)) {
        // ALWAYS undo the board message immediately when answering
        if (game.lastMsgId) {
            api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType)
                .then(() => log.debug("ALTP: Undo board success"))
                .catch(e => log.error("ALTP: Undo board failed:", e.message));
            game.lastMsgId = null;
            game.lastCliMsgId = null;
        }

        if (input === game.currentQuestion.answer) {
            clearInterval(game.timer);
            const wonAmount = REWARDS[game.level];
            game.level++;
            game.removedOptions = [];
            game.currentQuestion = null;
            
            if (game.level > 15) {
                await api.sendMessage({ msg: `🎊 CHÚC MỪNG ${senderName.toUpperCase()}! BẠN ĐÃ TRỞ THÀNH TRIỆU PHÚ! /-bd /-bd\n🏆 Bạn đã vượt qua tất cả 15 câu hỏi và nhận mức thưởng cao nhất: 150.000.000 Đ :$` }, threadId, threadType);
                delete global._altpGame[threadId];
                return true;
            }

            await api.sendMessage({ msg: `CHÍNH XÁC! Chúc mừng ${senderName}. :') ;-a\n💰 Mức thưởng hiện tại: ${wonAmount.toLocaleString("vi-VN")} Đ :$` }, threadId, threadType);
            
            setTimeout(async () => {
                game.timeLeft = 60;
                game.timer = setInterval(async () => {
                    game.timeLeft--;

                    if (game.timeLeft % 5 === 0 && game.lastMsgId) {
                        const iconIdx = Math.floor(game.timeLeft / 5);
                        const icon = clockEmojis[iconIdx % clockEmojis.length];
                        api.addReaction(icon, {
                            msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId
                        }, threadId, threadType).catch(() => {});
                    }

                    if (game.timeLeft <= 0) {
                        clearInterval(game.timer);
                        const q = game.currentQuestion;
                        await api.sendMessage({ msg: `⏰ HẾT GIỜ! :wipe\n📝 Đáp án đúng là: ${q.answer}. ${q.options[q.answer]}\n🎮 Trò chơi kết thúc.\n💰 Bạn nhận được mức thưởng an toàn: ${REWARDS[getSafeLevel(game.level)].toLocaleString("vi-VN")} Đ :$` }, threadId, threadType);
                        if (game.lastMsgId && game.lastCliMsgId) {
                            api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType).catch(() => {});
                            game.lastMsgId = null;
                            game.lastCliMsgId = null;
                        }
                        delete global._altpGame[threadId];
                    }
                }, 1000);
                await sendQuestion(ctx, game);
            }, 2000);
        } else {
            clearInterval(game.timer);
            const q = game.currentQuestion;
            const safePrize = REWARDS[getSafeLevel(game.level)];
            await api.sendMessage({ msg: `SAI RỒI! Rất tiếc ${senderName}. :-(( /-break\n📝 Đáp án đúng là: ${q.answer}. ${q.options[q.answer]}\n🎮 Trò chơi kết thúc.\n💰 Phần thưởng mang về: ${safePrize.toLocaleString("vi-VN")} Đ :$` }, threadId, threadType);
            delete global._altpGame[threadId];
        }

        // AUTO-UNDO USER ANSWER MESSAGE
        api.undo({ msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId }, threadId, threadType).catch(() => {});
        
        return true;
    }

    return false;
}
