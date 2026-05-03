import { fs, path, axios, log } from "../globals.js";

export const name = "vuatiengviet";
export const description = "Trò chơi Vua Tiếng Việt - Sắp xếp chữ cái (Vòng Nhận Diện)";

if (!global._vtvGame) {
    global._vtvGame = {};
}

// Hàm xáo trộn chữ cái chuyên nghiệp
function jumbleWord(word) {
    // Loại bỏ dấu cách và tách thành mảng ký tự (bao gồm cả dấu)
    const letters = word.replace(/\s+/g, "").split("");
    
    // Fisher-Yates shuffle
    for (let i = letters.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    
    return letters.join(" / ");
}

async function sendNewChallenge(ctx, game, isFirst = false) {
    const { api, threadId, threadType } = ctx;
    
    try {
        // Lấy từ ngẫu nhiên từ API noitu.fun hoặc dictionary
        const res = await axios.get("https://api.noitu.fun/api/v1/word-link/init");
        if (!res.data || !res.data.word) throw new Error("API Error");

        const word = res.data.word.toLowerCase();
        game.currentWord = word;
        game.jumbled = jumbleWord(word);
        game.timeLeft = 35; // Tăng lên 35s cho thoải mái

        const buffer = await drawVtv({
            jumbled: game.jumbled,
            points: game.points,
            timeLeft: game.timeLeft,
            round: game.points + 1,
            userName: "Người chơi"
        });

        let msg = isFirst ? "🎮 [ BẮT ĐẦU VUA TIẾNG VIỆT ]\n" : "✨ [ CÂU TIẾP THEO ]\n";
        msg += `\n🧩 Sắp xếp các chữ: ${game.jumbled.toUpperCase()}\n\n💡 Gợi ý: Từ này có ${word.split(" ").length} từ, ${word.replace(/\s/g, "").length} chữ cái.\n⏳ Thời gian: 35 giây!`;

        if (buffer && Buffer.isBuffer(buffer)) {
            const tmpPath = path.join(process.cwd(), `vtv_${threadId}_${Date.now()}.png`);
            fs.writeFileSync(tmpPath, buffer);
            await api.sendMessage({ msg, attachments: [tmpPath] }, threadId, threadType);
            if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } else {
            await api.sendMessage({ msg }, threadId, threadType);
        }
    } catch (e) {
        log.error("VTV Error:", e.message);
        api.sendMessage({ msg: "⚠️ Lỗi hệ thống khi tạo câu hỏi. Vui lòng gõ lại lệnh !vtv" }, threadId, threadType);
        if (game.timer) clearInterval(game.timer);
        delete global._vtvGame[threadId];
    }
}

export const commands = {
    vtv: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;

        if (args[0] === "stop" || args[0] === "off") {
            if (global._vtvGame[threadId] && global._vtvGame[threadId].isPlaying) {
                const game = global._vtvGame[threadId];
                clearInterval(game.timer);
                await api.sendMessage({ msg: `⏹️ Đã dừng trò chơi.\n🏅 Tổng điểm của bạn: ${game.points}` }, threadId, threadType);
                delete global._vtvGame[threadId];
                return;
            }
            return api.sendMessage({ msg: "⚠️ Hiện không có trò chơi nào đang diễn ra." }, threadId, threadType);
        }

        if (global._vtvGame[threadId] && global._vtvGame[threadId].isPlaying) {
            return api.sendMessage({ msg: `⚠️ Trò chơi đang diễn ra!\n🧩 Chữ cái: ${global._vtvGame[threadId].jumbled.toUpperCase()}` }, threadId, threadType);
        }

        const game = {
            isPlaying: true,
            points: 0,
            currentWord: "",
            jumbled: "",
            timeLeft: 35,
            timer: null
        };

        global._vtvGame[threadId] = game;

        // Bắt đầu bộ đếm thời gian
        game.timer = setInterval(async () => {
            game.timeLeft--;
            if (game.timeLeft <= 0) {
                clearInterval(game.timer);
                await api.sendMessage({ msg: `⏰ HẾT GIỜ!\n📝 Đáp án đúng là: ${game.currentWord.toUpperCase()}\n🎮 Trò chơi kết thúc. Tổng điểm: ${game.points}` }, threadId, threadType);
                delete global._vtvGame[threadId];
            }
        }, 1000);

        await sendNewChallenge(ctx, game, true);
    },
    vuatiengviet: async (ctx) => {
        return commands.vtv(ctx);
    }
};

// Handler để bắt tin nhắn trả lời
export async function handle(ctx) {
    const { api, threadId, threadType, content, senderName } = ctx;
    
    if (!global._vtvGame[threadId] || !global._vtvGame[threadId].isPlaying) return false;
    if (!content || typeof content !== "string") return false;

    const game = global._vtvGame[threadId];
    const userMsg = content.trim().toLowerCase();

    // Nếu tin nhắn trùng khớp với đáp án
    if (userMsg === game.currentWord) {
        if (game.timer) clearInterval(game.timer); // Dừng timer cũ để tạo timer mới
        game.points++;
        await api.sendMessage({ msg: `✅ CHÍNH XÁC! Chúc mừng ${senderName}.\n🌟 Điểm hiện tại: ${game.points}` }, threadId, threadType);
        
        // Reset timer cho câu tiếp theo
        game.timeLeft = 35;
        game.timer = setInterval(async () => {
            game.timeLeft--;
            if (game.timeLeft <= 0) {
                clearInterval(game.timer);
                await api.sendMessage({ msg: `⏰ HẾT GIỜ!\n📝 Đáp án đúng là: ${game.currentWord.toUpperCase()}\n🎮 Trò chơi kết thúc. Tổng điểm: ${game.points}` }, threadId, threadType);
                delete global._vtvGame[threadId];
            }
        }, 1000);

        // Tạo câu hỏi mới
        await sendNewChallenge(ctx, game);
        return true; // Chặn không cho các module khác xử lý tin nhắn này
    }

    return false;
}
