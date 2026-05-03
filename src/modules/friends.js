import { log } from "../globals.js";

export const name = "friends";
export const description = "Quản lý bạn bè: chấp nhận/từ chối/hủy lời mời, biệt danh, bạn thân";

function send(ctx, msg) {
    return ctx.api.sendMessage({ msg, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

function requireAdmin(ctx) {
    if (!ctx.adminIds.includes(String(ctx.senderId))) {
        send(ctx, "⚠️ Chỉ Admin Bot mới được dùng lệnh này!");
        return false;
    }
    return true;
}

function getTarget(ctx) {
    const { args, message } = ctx;
    if (message.data?.mentions?.length) return String(message.data.mentions[0].uid);
    const q = message.data?.quote;
    if (q?.uidFrom || q?.ownerId) return String(q.uidFrom || q.ownerId);
    if (args[0] && /^\d+$/.test(args[0])) return args[0];
    return null;
}

export const commands = {
    friend: async (ctx) => {
        const { prefix } = ctx;
        const sub  = ctx.args[0]?.toLowerCase();
        const rest = { ...ctx, args: ctx.args.slice(1) };

        switch (sub) {
            // ── friend accept [@/ID] ──────────────────────────────────────────
            case "accept": {
                if (!requireAdmin(ctx)) return;
                const uid = getTarget(rest);
                if (!uid) return send(ctx, `◈ Cú pháp: ${prefix}friend accept [@tag/ID]`);
                try {
                    await ctx.api.acceptFriendRequest(uid);
                    await send(ctx, `✅ Đã chấp nhận lời mời kết bạn từ UID: ${uid}`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                return;
            }

            // ── friend reject [@/ID] ──────────────────────────────────────────
            case "reject": {
                if (!requireAdmin(ctx)) return;
                const uid = getTarget(rest);
                if (!uid) return send(ctx, `◈ Cú pháp: ${prefix}friend reject [@tag/ID]`);
                try {
                    await ctx.api.rejectFriendRequest(uid);
                    await send(ctx, `✅ Đã từ chối lời mời kết bạn từ UID: ${uid}`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                return;
            }

            // ── friend cancel [@/ID] ──────────────────────────────────────────
            case "cancel": {
                if (!requireAdmin(ctx)) return;
                const uid = getTarget(rest);
                if (!uid) return send(ctx, `◈ Cú pháp: ${prefix}friend cancel [@tag/ID]`);
                try {
                    await ctx.api.undoFriendRequest(uid);
                    await send(ctx, `✅ Đã hủy lời mời kết bạn đã gửi đến UID: ${uid}`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                return;
            }

            // ── friend alias list | friend alias [tên] [@/ID] ────────────────
            case "alias": {
                if (!requireAdmin(ctx)) return;
                const aliasSub = ctx.args[1]?.toLowerCase();
                if (aliasSub === "list") {
                    try {
                        const res  = await ctx.api.getAliasList();
                        const list = res?.data || res || [];
                        if (!list.length) return send(ctx, "📭 Chưa có biệt danh nào.");
                        let msg = `[ 📋 DANH SÁCH BIỆT DANH ]\n─────────────────\n`;
                        list.slice(0, 30).forEach((a, i) => {
                            msg += `${i + 1}. ${a.alias || a.name} — UID: ${a.uid || a.userId}\n`;
                        });
                        msg += `─────────────────`;
                        return send(ctx, msg);
                    } catch (e) { return send(ctx, `⚠️ Lỗi: ${e.message}`); }
                }
                const uid       = getTarget({ ...ctx, args: ctx.args.slice(1) });
                const aliasName = ctx.args.slice(1).filter(a => !/^\d+$/.test(a)).join(" ").trim();
                if (!uid || !aliasName) return send(ctx, `◈ Cú pháp:\n  ${prefix}friend alias list\n  ${prefix}friend alias [tên biệt danh] [@tag/ID]`);
                try {
                    await ctx.api.changeFriendAlias(uid, aliasName);
                    await send(ctx, `✅ Đã đặt biệt danh "${aliasName}" cho UID: ${uid}`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                return;
            }

            // ── friend rmalias [@/ID] ─────────────────────────────────────────
            case "rmalias": {
                if (!requireAdmin(ctx)) return;
                const uid = getTarget(rest);
                if (!uid) return send(ctx, `◈ Cú pháp: ${prefix}friend rmalias [@tag/ID]`);
                try {
                    await ctx.api.removeFriendAlias(uid);
                    await send(ctx, `✅ Đã xóa biệt danh của UID: ${uid}`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                return;
            }

            // ── friend close (danh sách bạn thân) ────────────────────────────
            case "close": {
                if (!requireAdmin(ctx)) return;
                try {
                    const res  = await ctx.api.getCloseFriends();
                    const list = res?.data || res || [];
                    if (!list.length) return send(ctx, "💔 Chưa có bạn thân nào.");
                    let msg = `[ 💛 DANH SÁCH BẠN THÂN ]\n─────────────────\n`;
                    list.slice(0, 30).forEach((f, i) => {
                        msg += `${i + 1}. ${f.displayName || f.zaloName || f.dName || `UID: ${f.uid}`}\n`;
                    });
                    msg += `─────────────────\nTổng: ${list.length} bạn thân`;
                    await send(ctx, msg);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                return;
            }

            // ── friend status [@/ID] ──────────────────────────────────────────
            case "status": {
                if (!requireAdmin(ctx)) return;
                const uid = getTarget(rest);
                if (!uid) return send(ctx, `◈ Cú pháp: ${prefix}friend status [@tag/ID]`);
                try {
                    const res       = await ctx.api.getFriendRequestStatus(uid);
                    const status    = res?.status ?? res;
                    const statusMap = { 0: "Chưa kết bạn", 1: "Đã kết bạn", 2: "Đã gửi lời mời", 3: "Có lời mời chờ xử lý" };
                    await send(ctx, `📌 Trạng thái kết bạn với UID ${uid}:\n${statusMap[status] || `Mã: ${status}`}`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                return;
            }

            // ── help ──────────────────────────────────────────────────────────
            default:
                return send(ctx, [
                    `[ 👥 QUẢN LÝ BẠN BÈ ]`,
                    `─────────────────`,
                    `${prefix}friend accept [@/ID]             — Chấp nhận lời mời`,
                    `${prefix}friend reject [@/ID]             — Từ chối lời mời`,
                    `${prefix}friend cancel [@/ID]             — Hủy lời mời đã gửi`,
                    `${prefix}friend alias [tên] [@/ID]        — Đặt biệt danh`,
                    `${prefix}friend alias list                — Xem danh sách biệt danh`,
                    `${prefix}friend rmalias [@/ID]            — Xóa biệt danh`,
                    `${prefix}friend close                     — Danh sách bạn thân`,
                    `${prefix}friend status [@/ID]             — Trạng thái kết bạn`,
                    `─────────────────`,
                ].join("\n"));
        }
    },
};
