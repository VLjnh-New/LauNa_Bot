import { log } from "../globals.js";

export const name = "ghichu";
export const description = "Quản lý ghi chú nhóm và nhắc nhở Zalo";

function send(ctx, msg) {
    return ctx.api.sendMessage({ msg, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

export const commands = {

    note: async (ctx) => {
        const { api, args, threadId, threadType, adminIds, senderId, prefix } = ctx;
        if (!ctx.isGroup) return send(ctx, "⚠️ Ghi chú chỉ dùng được trong nhóm!");
        if (!adminIds.includes(String(senderId))) return send(ctx, "⚠️ Chỉ Admin Bot mới được dùng lệnh này!");
        const sub = args[0]?.toLowerCase();
        const helpMsg =
            `[ 📝 GHI CHÚ NHÓM ]\n─────────────────\n` +
            `◈ ${prefix}note add [tiêu đề] | [nội dung]  — Tạo ghi chú\n` +
            `◈ ${prefix}note edit [noteId] | [nội dung]  — Sửa ghi chú\n` +
            `─────────────────`;
        if (!sub || sub === "help") return send(ctx, helpMsg);
        if (sub === "add") {
            const input = args.slice(1).join(" ").split("|").map(s => s.trim());
            const title = input[0] || "Ghi chú";
            const content = input[1] || "";
            if (!title) return send(ctx, helpMsg);
            try {
                await api.createNote({ title, content }, threadId);
                await send(ctx, `✅ Đã tạo ghi chú: "${title}"`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        if (sub === "edit") {
            const noteId = args[1];
            const content = args.slice(2).join(" ").trim();
            if (!noteId || !content) return send(ctx, `◈ Cú pháp: ${prefix}note edit [noteId] [nội dung mới]`);
            try {
                await api.editNote({ noteId, content }, threadId);
                await send(ctx, `✅ Đã cập nhật ghi chú ID: ${noteId}`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        return send(ctx, helpMsg);
    },

    reminder: async (ctx) => {
        const { api, args, threadId, threadType, adminIds, senderId, prefix } = ctx;
        if (!adminIds.includes(String(senderId))) return send(ctx, "⚠️ Chỉ Admin Bot mới được dùng lệnh này!");
        const sub = args[0]?.toLowerCase();
        const helpMsg =
            `[ ⏰ NHẮC NHỞ ]\n─────────────────\n` +
            `◈ ${prefix}reminder list                   — Xem danh sách\n` +
            `◈ ${prefix}reminder add [nội dung]         — Tạo nhắc nhở\n` +
            `◈ ${prefix}reminder del [reminderId]       — Xóa nhắc nhở\n` +
            `─────────────────`;
        if (!sub || sub === "help") return send(ctx, helpMsg);
        if (sub === "list") {
            try {
                const res = await api.getListReminder({}, threadId, threadType);
                const list = res?.reminders || res?.data || res || [];
                if (!list.length) return send(ctx, "📭 Chưa có nhắc nhở nào.");
                let msg = `[ ⏰ DANH SÁCH NHẮC NHỞ ]\n─────────────────\n`;
                list.slice(0, 20).forEach((r, i) => {
                    const content = r.content || r.title || r.message || "N/A";
                    const id = r.reminderId || r.id || "N/A";
                    msg += `${i + 1}. ${content}\n   ID: ${id}\n`;
                });
                msg += `─────────────────`;
                return send(ctx, msg);
            } catch (e) { return send(ctx, `⚠️ Lỗi: ${e.message}`); }
        }
        if (sub === "add") {
            const content = args.slice(1).join(" ").trim();
            if (!content) return send(ctx, `◈ Cú pháp: ${prefix}reminder add [nội dung]`);
            try {
                await api.createReminder({ content }, threadId, threadType);
                await send(ctx, `✅ Đã tạo nhắc nhở: "${content}"`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        if (sub === "del" || sub === "xoa") {
            const id = args[1];
            if (!id) return send(ctx, `◈ Cú pháp: ${prefix}reminder del [reminderId]`);
            try {
                await api.removeReminder(id, threadId, threadType);
                await send(ctx, `✅ Đã xóa nhắc nhở ID: ${id}`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        if (sub === "edit") {
            const id = args[1];
            const content = args.slice(2).join(" ").trim();
            if (!id || !content) return send(ctx, `◈ Cú pháp: ${prefix}reminder edit [id] [nội dung mới]`);
            try {
                await api.editReminder({ reminderId: id, content }, threadId, threadType);
                await send(ctx, `✅ Đã cập nhật nhắc nhở ID: ${id}`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }
        return send(ctx, helpMsg);
    },
};
