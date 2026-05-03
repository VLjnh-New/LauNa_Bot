import { log } from "../globals.js";
/**
 * Module: Media
 * Minh họa gửi file, hình ảnh, sticker
 */


export const name = "media";
export const description = "Lệnh gửi sticker, ảnh, video...";

async function reply(ctx, text) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

export const commands = {
    // !sticker [từ khóa] - Gửi 1 sticker ngẫu nhiên theo từ khoá
    sticker: async (ctx) => {
        const keyword = ctx.args.join(" ") || "hello";

        const clockEmojis = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
        let clockIdx = 0;
        const reactionInterval = setInterval(() => {
            if (ctx.message && ctx.message.data) {
                ctx.api.addReaction(clockEmojis[clockIdx % clockEmojis.length], { msgId: ctx.message.data.msgId || ctx.message.data.globalMsgId, cliMsgId: ctx.message.data.cliMsgId }, ctx.threadId, ctx.threadType).catch(() => { });
                clockIdx++;
            }
        }, 2000);

        try {
            // 1. Tìm list ID sticker theo từ khóa
            const stickerIds = await ctx.api.getStickers(keyword);

            if (!stickerIds || stickerIds.length === 0) {
                return reply(ctx, `⚠️ Không tìm thấy sticker nào cho từ khoá: "${keyword}"`);
            }

            // Chọn random 1 id trong danh sách
            const randomId = stickerIds[Math.floor(Math.random() * stickerIds.length)];

            // 2. Lấy thông tin chi tiết của sticker này
            const stickerDetail = await ctx.api.getStickersDetail(randomId);

            // 3. Gửi sticker vào group/nhắn riêng
            await ctx.api.sendSticker(
                stickerDetail,
                ctx.threadId,
                ctx.threadType
            );

        } catch (e) {
            log.error("Lỗi sticker:", e);
            await reply(ctx, `⚠️ Lỗi gửi sticker: ${e.message}`);
        } finally {
            clearInterval(reactionInterval);
        }
    },

    // !undo - Bot thu hồi tất cả tin nhắn gần nhất của bot (nếu có message id đang quote)
    undo: async (ctx) => {
        // Nếu người dùng reply (quote) một tin nhắn của bot xong gõ !undo
        if (ctx.message.data.quote && ctx.message.data.quote.ownerId) {
            const q = ctx.message.data.quote;
            try {
                await ctx.api.undo({
                    msgId: q.globalMsgId,
                    cliMsgId: q.cliMsgId
                }, ctx.threadId, ctx.threadType);
                await reply(ctx, "✅ Đã thu hồi tin nhắn thành công.");
            } catch (e) {
                await reply(ctx, "⚠️ Lỗi: Tin nhắn này không phải của Bot hoặc đã quá hạn thu hồi.");
            }
        } else {
            let guide = `[ ↩️ THU HỒI TIN NHẮN ]\n`;
            guide += `─────────────────\n`;
            guide += `◈ Hãy phản hồi (reply) vào tin nhắn của Bot gõ !undo để thu hồi.\n`;
            guide += `─────────────────\n`;
            guide += `✨ Chỉ thu hồi được tin nhắn do chính Bot gửi!`;
            await reply(ctx, guide);
        }
    }
};
