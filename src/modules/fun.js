/**
 * Module: Fun
 * Các lệnh vui vẻ, giải trí
 */

export const name = "fun";
export const description = "Lệnh vui: rps, boi";

async function reply(ctx, text) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

const EIGHTBALL_YES = [
    "Chắc chắn rồi.", "Dĩ nhiên là vậy.", "Không còn nghi ngờ gì nữa.",
    "Có, chắc chắn.", "Bạn có thể tin điều đó.", "Theo tôi thấy, có.",
    "Rất có thể.", "Triển vọng tốt.", "Có.", "Các dấu hiệu cho thấy là có.",
];
const EIGHTBALL_MAYBE = [
    "Trả lời mơ hồ, thử lại.", "Hỏi lại sau.", "Tốt hơn là không nên nói bây giờ.",
    "Không thể đoán được.", "Tập trung rồi hỏi lại.",
];
const EIGHTBALL_NO = [
    "Đừng tính tới.", "Câu trả lời của tôi là không.", "Các nguồn tin nói không.",
    "Triển vọng không tốt.", "Rất đáng ngờ.",
];

export const commands = {

    // !rps [kéo|búa|bao] - Oẳn tù tì
    rps: async (ctx) => {
        const map = { kéo: 0, búa: 1, bao: 2, ko: 0, bu: 1, ba: 2 };
        const names = ["❂ Kéo", "❂ Búa", "❂ Bao"];
        const wins = [1, 2, 0];

        const userKey = ctx.args[0]?.toLowerCase();
        const userIdx = map[userKey];
        if (userIdx === undefined) {
            await reply(ctx, `◈ Dùng: ${ctx.prefix}rps kéo | búa | bao`);
            return;
        }

        const botIdx = Math.floor(Math.random() * 3);
        let result;
        if (userIdx === botIdx) result = "✧ Hoà!";
        else if (wins[userIdx] === botIdx) result = "✦ Bạn thắng!";
        else result = "⚠️ Bot thắng!";

        await reply(ctx,
            `[ 🎮 RPS GAME ]\n` +
            `─────────────────\n` +
            `❯ Bạn : ${names[userIdx]}\n` +
            `❯ Bot : ${names[botIdx]}\n` +
            `─────────────────\n` +
            `➥ ${result}`
        );
    },

    // !boi [câu hỏi] - Quả cầu ma thuật 8ball
    boi: async (ctx) => {
        const question = ctx.args.join(" ").trim();
        if (!question) {
            await reply(ctx, `◈ Dùng: ${ctx.prefix}boi [câu hỏi của bạn]\n💡 Ví dụ: ${ctx.prefix}boi Hôm nay tôi có gặp may không?`);
            return;
        }

        const roll = Math.random();
        let pool;
        if (roll < 0.5) pool = EIGHTBALL_YES;
        else if (roll < 0.75) pool = EIGHTBALL_MAYBE;
        else pool = EIGHTBALL_NO;

        const answer = pool[Math.floor(Math.random() * pool.length)];
        const emoji = roll < 0.5 ? "🟢" : roll < 0.75 ? "🟡" : "🔴";

        await reply(ctx,
            `[ 🎱 QUẢ CẦU MA THUẬT ]\n` +
            `─────────────────\n` +
            `❯ Câu hỏi: ${question}\n` +
            `─────────────────\n` +
            `${emoji} ${answer}`
        );
    },

    "8ball": async (ctx) => {
        ctx.args = [ctx.args.join(" ")];
        await commands.boi(ctx);
    },

};
