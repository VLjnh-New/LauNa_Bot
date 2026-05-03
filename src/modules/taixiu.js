import { fs, path, statsManager } from "../globals.js";
import { bankManager } from "../utils/managers/bankManager.js";
import { registerReplySession, renewReplySession } from "../utils/managers/replySessionManager.js";
import { drawTaiXiu } from "../utils/canvas/canvasHelper.js";

export const name = "taixiu";
export const description = "Trò chơi Tài Xỉu Luxury - cá cược bằng xu";

// ─── Parse lựa chọn (hỗ trợ số và chữ có/không dấu) ──────────────────────────
function parseChoice(raw) {
    const s = (raw || "").toLowerCase().trim();
    if (s === "1" || s === "tai" || s === "tài") return "tai";
    if (s === "2" || s === "xiu" || s === "xỉu") return "xiu";
    return null;
}

// ─── Parse số tiền ("all", số nguyên, hoặc chuỗi hỗn hợp) ────────────────────
function parseBet(raw, balance) {
    const s = (raw || "").toLowerCase().trim();
    if (s === "all") return balance;
    const n = parseInt(s);
    return isNaN(n) ? NaN : n;
}

// ─── Logic đặt cược chính ─────────────────────────────────────────────────────
async function executeBet(ctx, choice, betAmount) {
    const { api, senderId, senderName, threadId, threadType } = ctx;

    const balance = bankManager.getBalance(senderId);
    if (betAmount > balance)
        return api.sendMessage({ msg: `⚠️ Không đủ xu. Số dư: ${balance.toLocaleString()} xu.` }, threadId, threadType);

    try {
        await api.sendMessage({ msg: `🎲 Đang lắc xúc xắc... Chờ 3 giây nhé, ${senderName}!` }, threadId, threadType);
    } catch {}

    await new Promise(r => setTimeout(r, 3000));

    const dices = [
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
    ];
    const total  = dices.reduce((a, b) => a + b, 0);
    const result = total >= 11 ? "tai" : "xiu";
    const isWin  = choice === result;

    const diff      = isWin ? betAmount : -betAmount;
    const endBalance = isWin
        ? bankManager.add(senderId, betAmount)
        : bankManager.subtract(senderId, betAmount);

    const choiceLabel  = choice === "tai" ? "TÀI" : "XỈU";
    const resultLabel  = result === "tai" ? "TÀI" : "XỈU";
    const replyHint    =
        `💬 Reply để cược tiếp:\n` +
        `  1 [số] — Tài  |  2 [số] — Xỉu\n` +
        `  Ví dụ: 1 ${betAmount.toLocaleString()} hoặc 2 all`;

    const betInfoText =
        `${senderName} cược ${betAmount.toLocaleString()} ➜ ${isWin ? "THẮNG" : "THUA"} ` +
        `(${isWin ? "+" : ""}${diff.toLocaleString()} xu)\n💰 Số dư: ${endBalance.toLocaleString()} xu`;

    let resultMsg =
        `[ 🎲 KẾT QUẢ TÀI XỈU ]\n─────────────────\n` +
        `👤 ${senderName} chọn: ${choiceLabel}\n` +
        `🎲 ${dices.join(" - ")} = ${total} → ${resultLabel}\n` +
        `💰 ${isWin ? `Thắng +${betAmount.toLocaleString()}` : `Thua -${betAmount.toLocaleString()}`} xu\n` +
        `🌟 Số dư: ${endBalance.toLocaleString()} xu\n─────────────────\n` +
        replyHint;

    try {
        const resultImg = await drawTaiXiu(dices, total, result, betInfoText);
        const tmpPath   = path.join(process.cwd(), `tx_${Date.now()}.png`);
        fs.writeFileSync(tmpPath, resultImg);
        await api.sendMessage({ msg: resultMsg, attachments: [tmpPath] }, threadId, threadType);
        setTimeout(() => { try { fs.unlinkSync(tmpPath); } catch {} }, 10000);
    } catch {
        await api.sendMessage({ msg: resultMsg }, threadId, threadType);
    }

    // ─── Đăng ký reply session ─────────────────────────────────────────────────
    const txReplyHandler = async (input, rCtx) => {
        const parts      = input.trim().split(/\s+/);
        const nextChoice = parseChoice(parts[0]);
        const nextBet    = parseBet(parts[1] || "", bankManager.getBalance(senderId));

        if (!nextChoice) {
            await api.sendMessage({ msg: `⚠️ Gõ: 1 [số] = Tài | 2 [số] = Xỉu\nVí dụ: 1 ${betAmount.toLocaleString()}` }, threadId, threadType);
            renewReplySession(senderId, threadId, txReplyHandler);
            return;
        }
        if (isNaN(nextBet) || nextBet <= 0) {
            await api.sendMessage({ msg: `⚠️ Số tiền không hợp lệ. Ví dụ: 1 ${betAmount.toLocaleString()}` }, threadId, threadType);
            renewReplySession(senderId, threadId, txReplyHandler);
            return;
        }
        await executeBet({ ...ctx, ...rCtx }, nextChoice, nextBet);
    };
    registerReplySession(senderId, threadId, txReplyHandler, 3 * 60 * 1000);
}

// ─── Commands ──────────────────────────────────────────────────────────────────
export const commands = {
    taixiu: async (ctx) => {
        const { api, args, senderId, senderName, threadId, threadType, prefix } = ctx;

        if (args.length < 2) {
            const balance = bankManager.getBalance(senderId);
            return api.sendMessage({
                msg:
                    `[ 🎲 TÀI XỈU LUXURY ]\n─────────────────\n` +
                    `👉 Cách chơi:\n` +
                    `  ${prefix}taixiu 1 [số] — Đặt Tài\n` +
                    `  ${prefix}taixiu 2 [số] — Đặt Xỉu\n` +
                    `  (cũng chấp nhận: tai/tài/xiu/xỉu)\n` +
                    `─────────────────\n` +
                    `💰 Số dư: ${balance.toLocaleString()} xu\n` +
                    `💡 Sau mỗi lượt, reply số để đặt tiếp nhanh hơn!`,
            }, threadId, threadType);
        }

        const choice = parseChoice(args[0]);
        if (!choice)
            return api.sendMessage({ msg: "⚠️ Chọn: 1/tai/tài (Tài) hoặc 2/xiu/xỉu (Xỉu)." }, threadId, threadType);

        const balance   = bankManager.getBalance(senderId);
        const betAmount = parseBet(args[1], balance);
        if (isNaN(betAmount) || betAmount <= 0)
            return api.sendMessage({ msg: "⚠️ Số tiền cược không hợp lệ." }, threadId, threadType);
        if (betAmount > balance)
            return api.sendMessage({ msg: `⚠️ Không đủ xu. Số dư: ${balance.toLocaleString()} xu.` }, threadId, threadType);

        await executeBet(ctx, choice, betAmount);
    },

    xu: async (ctx) => {
        const { api, senderId, senderName, threadId, threadType } = ctx;
        const balance = bankManager.getBalance(senderId);
        return api.sendMessage({ msg: `💰 Tài khoản của ${senderName}:\n📊 Số dư: ${balance.toLocaleString()} xu` }, threadId, threadType);
    },

    topxu: async (ctx) => {
        const { api, threadId, threadType } = ctx;

        bankManager.load();
        const top = Object.entries(bankManager._data)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        if (top.length === 0)
            return api.sendMessage({ msg: "⚠️ Hiện chưa có dữ liệu tài khoản nào." }, threadId, threadType);

        let msg = `[ 🏆 TOP PHÚ HỘ XU ]\n─────────────────\n`;
        const uids = top.map(u => u[0]);
        let userProfiles = {};
        try { userProfiles = await api.getUserInfo(uids); } catch {}

        top.forEach(([uid, bal], i) => {
            const user = userProfiles[uid] || Object.values(userProfiles).find(p => String(p.userId || p.uid) === String(uid));
            const name = user?.displayName || user?.zaloName || (statsManager.getStats(null, uid)?.name) || `UID ${uid}`;
            msg += `${i + 1}. ${name}: ${bal.toLocaleString()} xu\n`;
        });
        msg += `─────────────────`;
        return api.sendMessage({ msg }, threadId, threadType);
    },
};
