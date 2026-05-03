export const name = "block-manager";
export const description = "Quản lý danh sách chặn trong nhóm";

const blockSessions = new Map();

async function handleBlockList(ctx) {
    const { api, threadId, threadType, senderId, adminIds, isGroup, message } = ctx;
    if (!isGroup) return api.sendMessage({ msg: "⚠️ Lệnh này chỉ dùng trong nhóm!" }, threadId, threadType);
    if (!adminIds.includes(String(senderId)))
        return api.sendMessage({ msg: "⚠️ Chỉ Admin Bot hoặc QTV mới có quyền xem danh sách chặn!" }, threadId, threadType);

    try {
        const data        = await api.getBlockedUsers(threadId);
        const blockedList = data.list || [];

        if (blockedList.length === 0)
            return api.sendMessage({ msg: "✅ Nhóm hiện không có ai bị chặn." }, threadId, threadType);

        const ids      = blockedList.map(u => String(u.uid || u.userId || u.id));
        const usersInfo = await api.getUserInfo(ids);

        let msg = `[ 🚫 DANH SÁCH CHẶN ]\n─────────────────\n`;
        msg += `➥ Phản hồi số thứ tự (STT) để GỠ CHẶN.\n\n`;

        const sessionData = [];
        ids.forEach((id, index) => {
            const user = usersInfo[id] || {};
            const name = user.displayName || user.zaloName || `Người dùng Zalo (${id})`;
            msg += `${index + 1}. ${name}\n   🆔: ${id}\n\n`;
            sessionData.push({ index: index + 1, id, name });
        });

        msg += `─────────────────\n💡 Session hết hạn sau 60 giây.`;

        await api.sendMessage({ msg, quote: message.data }, threadId, threadType);
        const key = `${threadId}-${senderId}`;
        blockSessions.set(key, { items: sessionData, time: Date.now() });
        setTimeout(() => blockSessions.delete(key), 60000);
    } catch (e) {
        api.sendMessage({ msg: `⚠️ Lỗi khi lấy danh sách chặn: ${e.message}` }, threadId, threadType);
    }
}

async function handleUnblock(ctx) {
    const { api, threadId, threadType, senderId, adminIds, args, message, prefix } = ctx;
    if (!adminIds.includes(String(senderId))) return;

    let targetIds = [];
    const quote = message.data?.quote || message.data?.content?.quote;
    if (quote?.uidFrom || quote?.ownerId) targetIds.push(String(quote.uidFrom || quote.ownerId));
    if (message.data?.mentions?.length > 0)
        message.data.mentions.forEach(m => targetIds.push(String(m.uid)));
    args.forEach(arg => { if (/^\d+$/.test(arg)) targetIds.push(arg); });

    if (targetIds.length === 0)
        return api.sendMessage({ msg: `◈ Cú pháp: ${prefix}block del [@tag / reply / ID]` }, threadId, threadType);

    try {
        await api.unblockUsersInGroup(threadId, targetIds);
        api.sendMessage({ msg: `✅ Đã gỡ chặn thành công cho ${targetIds.length} đối tượng.` }, threadId, threadType);
    } catch (e) {
        api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
    }
}

export const commands = {
    block: async (ctx) => {
        const sub = ctx.args[0]?.toLowerCase();
        if (sub === "del" || sub === "remove" || sub === "rm") {
            return handleUnblock({ ...ctx, args: ctx.args.slice(1) });
        }
        return handleBlockList(ctx);
    },
};

export async function handle(ctx) {
    const { api, threadId, threadType, senderId, content, adminIds } = ctx;
    const key     = `${threadId}-${senderId}`;
    const session = blockSessions.get(key);
    if (!session) return false;

    const choice = parseInt(content.trim());
    if (isNaN(choice)) return false;
    if (!adminIds.includes(String(senderId))) return false;

    const target = session.items.find(item => item.index === choice);
    if (target) {
        try {
            blockSessions.delete(key);
            await api.unblockUsersInGroup(threadId, [target.id]);
            await api.sendMessage({ msg: `✅ Đã gỡ chặn thành công cho: ${target.name}\n🆔: ${target.id}` }, threadId, threadType);
            return true;
        } catch (e) {
            await api.sendMessage({ msg: `⚠️ Lỗi khi gỡ chặn: ${e.message}` }, threadId, threadType);
            return true;
        }
    }
    return false;
}
