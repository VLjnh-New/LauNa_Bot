import { fs, path, axios, log } from "../globals.js";
import { drawNoitu } from "../utils/canvas/canvasHelper.js";

export const name = "noitu";
export const description = "Trò chơi nối từ với Bot (noitu.fun) có Timer & Skips";

if (!global._noituGame) {
    global._noituGame = {};
}

// Hàm gửi tin nhắn kèm Canvas
async function sendGameUpdate(ctx, game, word, desc, message = "") {
    const { api, threadId, threadType } = ctx;
    
    // Tính toán từ nối tiếp (chữ cái cuối)
    const syllables = word.split(" ");
    const lastSyllable = syllables[syllables.length - 1];

    try {
        const buffer = await drawNoitu({
            word,
            description: desc,
            points: game.points,
            timeLeft: game.timeLeft,
            historyCount: game.history.length,
            skipsLeft: game.skips,
            nextLetter: lastSyllable,
            userName: "Người chơi"
        });

        const tempPath = path.join(process.cwd(), `noitu_${threadId}_${Date.now()}.png`);
        fs.writeFileSync(tempPath, buffer);

        let msgContent = message ? message + "\n" : "";
        msgContent += `[ 🎮 NỐI TỪ - TỪ MỚI ]\n📝 TỪ: ${word.toUpperCase()}\n📖 Nguồn: ${desc}\n\n👉 Hãy nối từ bắt đầu bằng: "${lastSyllable.toUpperCase()}"\n⏳ Thời gian còn lại: ${game.timeLeft} giây`;

        await api.sendMessage({
            msg: msgContent,
            attachments: [tempPath]
        }, threadId, threadType);

        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) {
        log.error("Lỗi vẽ canvas noitu:", e.message);
        await api.sendMessage({ msg: (message ? message + "\n" : "") + `📝 TỪ: ${word.toUpperCase()}\n👉 Nối: ${lastSyllable.toUpperCase()}\n⏳: ${game.timeLeft}s` }, threadId, threadType);
    }
}

// Kết thúc game
async function endGame(ctx, game, reason = "Hết thời gian!") {
    const { api, threadId, threadType } = ctx;
    if (game.timer) clearInterval(game.timer);
    game.isPlaying = false;

    let resultMsg = `⏹️ [ KẾT THÚC TRÒ CHƠI ]\n─────────────────\n⚠️ Lý do: ${reason}\n🏅 Điểm đạt được: ${game.points}`;
    
    try {
        const res = await axios.get(`https://api.noitu.fun/api/v1/word-link/result?point=${game.points}&userCode=${game.userCode}`);
        if (res.data) {
            resultMsg += `\n✨ Kỷ lục nhóm: ${res.data.bestScore} ${res.data.isNewRecord ? "(Mới 🎉)" : ""}\n🌍 Hạng (Global): ${res.data.rank}`;
            
            // Lấy thêm ranking monthly nếu muốn
            const rankRes = await axios.get(`https://api.noitu.fun/api/v1/word-link/user-ranking?userCode=${game.userCode}&type=monthly`).catch(() => null);
            if (rankRes?.data?.rank) {
                resultMsg += `\n📅 Hạng tháng: ${rankRes.data.rank}`;
            }
        }
    } catch (e) { }

    await api.sendMessage({ msg: resultMsg }, threadId, threadType);
    delete global._noituGame[threadId];
}

export const commands = {
    noitu: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;
        
        if (args[0] === "stop") {
            if (global._noituGame[threadId] && global._noituGame[threadId].isPlaying) {
                return endGame(ctx, global._noituGame[threadId], "Người dùng chủ động dừng.");
            } else {
                return api.sendMessage({ msg: "⚠️ Hiện tại không có ván nối từ nào đang diễn ra." }, threadId, threadType);
            }
        }

        if (args[0] === "skip") {
            const game = global._noituGame[threadId];
            if (!game || !game.isPlaying) return api.sendMessage({ msg: "⚠️ Game chưa bắt đầu!" }, threadId, threadType);
            
            if (game.skips <= 0) return api.sendMessage({ msg: "❌ Bạn đã hết lượt bỏ qua (tối đa 3 lần)." }, threadId, threadType);
            
            game.skips--;
            try {
                const res = await axios.post("https://api.noitu.fun/api/v1/word-link/skip", {
                    currentWord: game.currentWord,
                    answeredList: game.history
                }, { headers: { 'Content-Type': 'application/json' } });
                
                if (res.data && res.data.wordDescription && res.data.wordDescription.word) {
                    const botWord = res.data.wordDescription.word.toLowerCase();
                    const botDesc = res.data.wordDescription.description || "";
                    game.currentWord = botWord;
                    game.history.push(botWord);
                    game.timeLeft = 30; // Reset timer
                    return sendGameUpdate(ctx, game, botWord, botDesc, `⏭️ Đã dùng lượt bỏ qua (Còn lại: ${game.skips}/3)`);
                } else {
                    return api.sendMessage({ msg: "❌ API không thể bỏ qua lúc này." }, threadId, threadType);
                }
            } catch (e) {
                return api.sendMessage({ msg: "❌ Lỗi khi bỏ qua: " + e.message }, threadId, threadType);
            }
        }

        if (global._noituGame[threadId] && global._noituGame[threadId].isPlaying) {
            return api.sendMessage({ msg: `⚠️ Game đang chạy! Từ: ${global._noituGame[threadId].currentWord.toUpperCase()}` }, threadId, threadType);
        }

        try {
            const initRes = await axios.get("https://api.noitu.fun/api/v1/word-link/init");
            const startWord = initRes.data.word.toLowerCase();
            const desc = initRes.data.description || "";
            const userCode = Date.now() + "_" + Math.random().toString(36).substring(2, 10);
            
            const game = {
                isPlaying: true,
                currentWord: startWord,
                history: [startWord],
                userCode: userCode,
                points: 0,
                skips: 3,
                timeLeft: 30, // 30 seconds
                timer: null
            };

            // Setup timer
            game.timer = setInterval(() => {
                game.timeLeft--;
                if (game.timeLeft <= 0) {
                    endGame(ctx, game, "Hết thời gian (30s)!");
                }
            }, 1000);

            global._noituGame[threadId] = game;
            await sendGameUpdate(ctx, game, startWord, desc, "🎮 [ TRÒ CHƠI BẮT ĐẦU ]");
        } catch (e) {
            api.sendMessage({ msg: "⚠️ Không thể khởi tạo game: " + e.message }, threadId, threadType);
        }
    }
};

export async function handle(ctx) {
    const { api, threadId, threadType, senderName, content } = ctx;
    
    if (!global._noituGame[threadId] || !global._noituGame[threadId].isPlaying) return false;
    if (!content || typeof content !== "string") return false;

    const game = global._noituGame[threadId];
    const text = content.toLowerCase().trim();
    const words = text.split(/\s+/);

    // Handle plain text 'skip' or 'bỏ qua'
    if (text === "skip" || text === "bỏ qua") {
        if (game.skips <= 0) {
            await api.sendMessage({ msg: "❌ Bạn đã hết lượt bỏ qua (tối đa 3 lần)." }, threadId, threadType);
            return true;
        }
        
        game.skips--;
        try {
            const res = await axios.post("https://api.noitu.fun/api/v1/word-link/skip", {
                currentWord: game.currentWord,
                answeredList: game.history
            }, { headers: { 'Content-Type': 'application/json' } });
            
            if (res.data && res.data.wordDescription && res.data.wordDescription.word) {
                const botWord = res.data.wordDescription.word.toLowerCase();
                const botDesc = res.data.wordDescription.description || "";
                game.currentWord = botWord;
                game.history.push(botWord);
                game.timeLeft = 30; // Reset timer
                await sendGameUpdate(ctx, game, botWord, botDesc, `⏭️ Đã dùng lượt bỏ qua (Còn lại: ${game.skips}/3)`);
                return true;
            }
        } catch (e) { 
            return false;
        }
    }
    
    // Nếu tin nhắn có 2 chữ cái và bắt đầu bằng âm tiết cuối của bot
    const syllables = game.currentWord.split(" ");
    const lastSyllable = syllables[syllables.length - 1];

    if (words.length === 2 && words[0] === lastSyllable) {
        try {
            const res = await axios.post('https://api.noitu.fun/api/v1/word-link/answer', {
                answer: text,
                answeredList: game.history
            }, { headers: { 'Content-Type': 'application/json' } });

            const data = res.data;

            if (!data.isSuccessful) {
                game.timeLeft -= 5; // Trừ 5s nếu trả lời sai mà vẫn đúng format nối từ
                await api.sendMessage({ msg: `❌ ${senderName}: ${data.message || "Từ không có trong từ điển!"} (-5s)` }, threadId, threadType);
                return true;
            }

            // Hợp lệ
            game.history.push(text);
            game.points++;
            game.timeLeft = 30; // Reset timer

            if (data.isFinished && (!data.wordDescription || !data.wordDescription.word)) {
                return endGame(ctx, game, `Bot chịu thua trước ${senderName}! 🎉`);
            }

            // Bot trả lời
            const botWord = data.wordDescription.word.toLowerCase();
            const botDesc = data.wordDescription.description || "";
            game.history.push(botWord);
            game.currentWord = botWord;

            await sendGameUpdate(ctx, game, botWord, botDesc, `✅ [ ${text.toUpperCase()} ] hợp lệ! (+1 điểm)`);
            return true;
        } catch (e) {
            log.error("Lỗi nối từ:", e.message);
            return false;
        }
    } else if (words.length === 2 && !content.startsWith("-") && !content.startsWith("!")) {
       // Nếu user nhắn gì đó 2 chữ nhưng ko khớp, có thể là nhầm, ko làm gì để tránh làm phiền chat thường
       return false;
    }

    return false;
}
