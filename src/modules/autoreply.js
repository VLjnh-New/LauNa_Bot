import { log } from "../globals.js";

export const name = "autoreply";
export const description = "Quản lý tự động trả lời và tin nhắn nhanh Zalo";

function send(ctx, msg) {
    return ctx.api.sendMessage({ msg, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

export const commands = {

    autoreply: async (ctx) => {
        const { api, args, adminIds, senderId, prefix } = ctx;
        if (!adminIds.includes(String(senderId))) return send(ctx, "⚠️ Chỉ Admin Bot mới được dùng lệnh này!");
        const sub = args[0]?.toLowerCase();
        const helpMsg =
            `[ 🤖 TỰ ĐỘNG TRẢ LỜI ]\n─────────────────\n` +
            `◈ ${prefix}autoreply list                   — Xem danh sách\n` +
            `◈ ${prefix}autoreply add [trigger] | [reply] — Tạo mới\n` +
            `◈ ${prefix}autoreply edit [id] | [reply]    — Sửa nội dung\n` +
            `◈ ${prefix}autoreply del [id]               — Xóa\n` +
            `─────────────────`;
        if (!sub || sub === "help") return send(ctx, helpMsg);
        if (sub === "list") {
            try {
                const res = await api.getAutoReplyList();
                const list = res?.data || res || [];
                if (!list.length) return send(ctx, "📭 Chưa có auto reply nào.");
                let msg = `[ 🤖 DANH SÁCH AUTO REPLY ]\n─────────────────\n`;
                list.slice(0, 20).forEach((r, i) => {
                    msg += `${i + 1}. Trigger: "${r.trigger || r.keyword || "N/A"}"\n   Reply: "${r.message || r.reply || "N/A"}"\n   ID: ${r.id || r.autoReplyId || "N/A"}\n\n`;
                });
                msg += `─────────────────`;
                return send(ctx, msg);
            } catch (e) { return send(ctx, `⚠️ Lỗi: ${e.message}`); }
        }
        if (sub === "add") {
            const input = args.slice(1).join(" ").split("|").map(s => s.trim());
            const trigger = input[0];
            const reply = input[1];
            if (!trigger || !reply) return send(ctx, `◈ Cú pháp: ${prefix}autoreply add [trigger] | [nội dung trả lời]`);
            try {
                await api.createAutoReply({ trigger, message: reply });
                await send(ctx, `✅ Đã tạo auto reply:\nTrigger: "${trigger}"\nReply: "${reply}"`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        if (sub === "edit") {
            const input = args.slice(1).join(" ").split("|").map(s => s.trim());
            const id = input[0];
            const reply = input[1];
            if (!id || !reply) return send(ctx, `◈ Cú pháp: ${prefix}autoreply edit [id] | [nội dung mới]`);
            try {
                await api.updateAutoReply({ id, message: reply });
                await send(ctx, `✅ Đã cập nhật auto reply ID: ${id}`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        if (sub === "del" || sub === "xoa") {
            const id = args[1];
            if (!id) return send(ctx, `◈ Cú pháp: ${prefix}autoreply del [id]`);
            try {
                await api.deleteAutoReply(id);
                await send(ctx, `✅ Đã xóa auto reply ID: ${id}`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        return send(ctx, helpMsg);
    },

    quickmsg: async (ctx) => {
        const { api, args, adminIds, senderId, prefix } = ctx;
        if (!adminIds.includes(String(senderId))) return send(ctx, "⚠️ Chỉ Admin Bot mới được dùng lệnh này!");
        const sub = args[0]?.toLowerCase();
        const helpMsg =
            `[ ⚡ TIN NHẮN NHANH ]\n─────────────────\n` +
            `◈ ${prefix}quickmsg list              — Xem danh sách\n` +
            `◈ ${prefix}quickmsg add [nội dung]    — Thêm mới\n` +
            `◈ ${prefix}quickmsg edit [id] [nội dung] — Sửa\n` +
            `◈ ${prefix}quickmsg del [id]          — Xóa\n` +
            `─────────────────`;
        if (!sub || sub === "help") return send(ctx, helpMsg);
        if (sub === "list") {
            try {
                const res = await api.getQuickMessageList();
                const list = res?.data || res || [];
                if (!list.length) return send(ctx, "📭 Chưa có tin nhắn nhanh nào.");
                let msg = `[ ⚡ TIN NHẮN NHANH ]\n─────────────────\n`;
                list.slice(0, 20).forEach((q, i) => {
                    msg += `${i + 1}. "${q.message || q.content || "N/A"}"  ID: ${q.itemId || q.id || "N/A"}\n`;
                });
                msg += `─────────────────`;
                return send(ctx, msg);
            } catch (e) { return send(ctx, `⚠️ Lỗi: ${e.message}`); }
        }
        if (sub === "add") {
            const content = args.slice(1).join(" ").trim();
            if (!content) return send(ctx, `◈ Cú pháp: ${prefix}quickmsg add [nội dung]`);
            try {
                await api.addQuickMessage({ message: content });
                await send(ctx, `✅ Đã thêm tin nhắn nhanh: "${content}"`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        if (sub === "edit") {
            const id = args[1];
            const content = args.slice(2).join(" ").trim();
            if (!id || !content) return send(ctx, `◈ Cú pháp: ${prefix}quickmsg edit [id] [nội dung mới]`);
            try {
                await api.updateQuickMessage({ message: content }, id);
                await send(ctx, `✅ Đã cập nhật tin nhắn nhanh ID: ${id}`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        if (sub === "del" || sub === "xoa") {
            const id = args[1];
            if (!id) return send(ctx, `◈ Cú pháp: ${prefix}quickmsg del [id]`);
            try {
                await api.removeQuickMessage([id]);
                await send(ctx, `✅ Đã xóa tin nhắn nhanh ID: ${id}`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        return send(ctx, helpMsg);
    },
};
