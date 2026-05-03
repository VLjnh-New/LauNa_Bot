import { statsManager, log } from "../globals.js";
import { groupAdminManager } from "../utils/managers/groupAdminManager.js";

export const name = "kick";
export const description = "Module quản lý thành viên và phân quyền Key Vàng/Bạc";

const ROLES = {
    "Admin": 100,
    "Vàng": 50,
    "Bạc": 20,
    "Thành viên": 0
};

async function reply(ctx, text) {
    const { api, threadId, threadType, message } = ctx;
    const quote = message.data?.quote || message.data?.content?.quote || message.data;
    const targetUid = String(quote?.uidFrom || quote?.ownerId || "");
    let mentions = [];
    if (text.includes("@tag") && targetUid) {
        const name = "@Thành viên";
        const pos = text.indexOf("@tag");
        text = text.replace("@tag", name);
        mentions.push({ uid: targetUid, pos, len: name.length });
    }
    await api.sendMessage({ msg: text, quote: message.data, mentions }, threadId, threadType);
}

function getLevel(uid, threadId, adminIds) {
    if (adminIds.includes(String(uid))) return ROLES["Admin"];
    const stats = statsManager.getStats(threadId, uid);
    return ROLES[stats?.role] || 0;
}

async function getTargetName(api, threadId, uid) {
    const stats = statsManager.getStats(threadId, uid);
    if (stats?.name && stats.name !== "Người dùng") return stats.name;
    try {
        const userInfo = await api.getUserInfo(uid);
        const profile = userInfo?.[uid] || Object.values(userInfo || {})[0];
        return profile?.displayName || profile?.zaloName || profile?.name || uid;
    } catch { return uid; }
}

async function _doKick(ctx) {
    const { api, threadId, senderId, adminIds, args, message, prefix } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng trong nhóm!");
    const senderLevel = getLevel(senderId, threadId, adminIds);
    let hasPermission = senderLevel >= ROLES["Bạc"];
    let isBoxAdmin = false;
    if (!hasPermission) {
        try {
            const groupInfo = await api.getGroupInfo(threadId);
            const groupData = groupInfo.gridInfoMap?.[threadId] || groupInfo[threadId] || groupInfo;
            if (groupData?.adminIds?.includes(String(senderId)) || groupData?.creatorId === String(senderId)) {
                isBoxAdmin = true;
                hasPermission = true;
            }
        } catch (e) { log.error("[Kick] Lỗi check quyền QTV:", e.message); }
    }
    if (!hasPermission) return reply(ctx, "⚠️ Bạn cần ít nhất Key Bạc hoặc là Quản trị viên nhóm để dùng lệnh này!");
    const quote = message.data?.quote || message.data?.content?.quote;
    let targetIds = [];
    if (quote?.uidFrom || quote?.ownerId) targetIds.push(String(quote.uidFrom || quote.ownerId));
    if (message.data?.mentions?.length > 0) {
        message.data.mentions.forEach(m => {
            const uid = String(m.uid);
            if (!targetIds.includes(uid)) targetIds.push(uid);
        });
    }
    args.forEach(arg => { if (/^\d+$/.test(arg) && !targetIds.includes(arg)) targetIds.push(arg); });
    const finalTargets = targetIds.filter(tid => {
        if (tid === senderId) return false;
        const targetLevel = getLevel(tid, threadId, adminIds);
        if (isBoxAdmin) return targetLevel < ROLES["Admin"];
        return targetLevel < senderLevel;
    });
    if (finalTargets.length === 0) {
        if (targetIds.length > 0) return reply(ctx, "⚠️ Không thể kick người có chức vụ bằng/cao hơn!");
        return reply(ctx, `◈ Cú pháp: ${prefix}kick [@tag / reply / ID]\n◈ ${prefix}kick key [@] [vàng/bạc/xóa] — Cấp/tước key\n◈ ${prefix}kick all — Kick tất cả thành viên thấp hơn`);
    }
    try {
        await api.removeUserFromGroup(String(threadId), finalTargets);
        const tagString = finalTargets.map(() => "@tag").join(", ");
        await ctx.reply(`⚔️ [ TRỤC XUẤT ] ⚔️\n━━━━━━━━━━━━━━━━━━\n✅ Đã tiễn ${tagString} lên đường!\n━━━━━━━━━━━━━━━━━━\n📌 Tổng cộng: ${finalTargets.length} đối tượng.`, finalTargets);
    } catch (e) { await ctx.reply(`⚠️ Không thể kick: ${e.message}. Bot cần quyền phó/trưởng nhóm!`); }
}

async function _doSetkey(ctx) {
    const { api, threadId, senderId, adminIds, args, message, prefix } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng trong nhóm!");
    const isBotAdmin = adminIds.includes(String(senderId));
    const senderLevel = getLevel(senderId, threadId, adminIds);
    if (senderLevel < ROLES["Vàng"]) return reply(ctx, "⚠️ Chỉ những người có Key Vàng mới được quyền cấp Key.");
    const roleKeywords = {
        "Vàng": ["vàng", "vàng", "v", "gold", "vang"],
        "Bạc": ["bạc", "bạc", "b", "silver", "bac"],
        "Owner": ["owner", "trưởng nhóm", "truong nhom"],
        "Thành viên": ["xoa", "xóa", "xóa", "del", "huy", "hủy", "hủy", "remove"]
    };
    let resolvedRole = null;
    let idArgs = [];
    args.forEach(arg => {
        const norm = arg.toLowerCase().normalize("NFC");
        const normNFD = arg.toLowerCase().normalize("NFD");
        let isRole = false;
        for (const [roleName, keywords] of Object.entries(roleKeywords)) {
            if (keywords.includes(norm) || keywords.includes(normNFD)) {
                resolvedRole = roleName; isRole = true; break;
            }
        }
        if (!isRole && /^\d+$/.test(arg)) if (!idArgs.includes(arg)) idArgs.push(arg);
    });
    let targetIds = [];
    const quote = message.data?.quote || message.data?.content?.quote;
    if (quote?.uidFrom || quote?.ownerId) targetIds.push(String(quote.uidFrom || quote.ownerId));
    if (message.data?.mentions?.length > 0) {
        message.data.mentions.forEach(m => { const uid = String(m.uid); if (!targetIds.includes(uid)) targetIds.push(uid); });
    }
    idArgs.forEach(id => { if (!targetIds.includes(id)) targetIds.push(id); });
    if (targetIds.length === 0 || args.length === 0) {
        return reply(ctx,
            `[ 🔑 HƯỚNG DẪN SETKEY ]\n─────────────────\n` +
            `◈ Cú pháp: ${prefix}kick key [@tag / reply] [loại key]\n\n` +
            `⭐ Các loại key:\n` +
            ` ❯ vàng (v/gold): Quyền tối cao, thay đổi chủ nhóm.\n` +
            ` ❯ bạc (b/silver): Quyền quản lý, kick thành viên.\n` +
            ` ❯ xóa (del/remove): Gỡ bỏ toàn bộ quyền hạn.\n` +
            `─────────────────\n` +
            `💡 Ví dụ: ${prefix}kick key @tag vàng`
        );
    }
    const isSelf = targetIds.length === 1 && targetIds[0] === senderId;
    if (!resolvedRole) resolvedRole = (isBotAdmin && isSelf) ? "Vàng" : "Bạc";
    try {
        const targetNames = await Promise.all(targetIds.map(id => getTargetName(api, threadId, id)));
        if (resolvedRole === "Owner" || resolvedRole === "Vàng") {
            if (!isBotAdmin) return reply(ctx, "⚠️ Chỉ Admin Bot mới có quyền thăng chức TRƯỞNG NHÓM!");
            for (const tid of targetIds) statsManager.setRole(threadId, tid, "Vàng");
            try { await api.changeGroupOwner(threadId, targetIds[0]); if (targetIds.length > 1) await api.addGroupAdmins(threadId, targetIds.slice(1)); }
            catch (e) { await api.addGroupAdmins(threadId, targetIds); }
            for (const uid of targetIds) groupAdminManager.addToCache(threadId, uid);
            const nameStr = targetNames.map(n => `• ${n}`).join("\n");
            return ctx.reply({ msg: `👑 [ KEY VÀNG - TRƯỞNG NHÓM ] 👑\n━━━━━━━━━━━━━━━━━━\n✅ Thăng chức thành công:\n${nameStr}\n━━━━━━━━━━━━━━━━━━\n📌 Trạng thái: Trưởng nhóm Zalo đã được trao cho ${targetNames[0]}.`, hidden: true }, targetIds);
        }
        if (resolvedRole === "Bạc") {
            for (const tid of targetIds) statsManager.setRole(threadId, tid, "Bạc");
            try { await api.addGroupAdmins(threadId, targetIds); } catch (e) { }
            for (const uid of targetIds) groupAdminManager.addToCache(threadId, uid);
            const nameStr = targetNames.map(n => `• ${n}`).join("\n");
            return ctx.reply({ msg: `🥈 [ KEY BẠC - PHÓ NHÓM ] 🥈\n━━━━━━━━━━━━━━━━━━\n✅ Thăng chức thành công:\n${nameStr}\n━━━━━━━━━━━━━━━━━━\n📌 Đã được thăng chức Quản lý trên Zalo.`, hidden: true }, targetIds);
        }
        if (resolvedRole === "Thành viên") {
            for (const tid of targetIds) statsManager.setRole(threadId, tid, "Thành viên");
            try { await api.removeGroupAdmins(threadId, targetIds); } catch (e) { }
            for (const uid of targetIds) groupAdminManager.removeFromCache(threadId, uid);
            const nameStr = targetNames.map(n => `• ${n}`).join("\n");
            return ctx.reply({ msg: `🗑️ [ TƯỚC QUYỀN HẠN ] 🗑️\n━━━━━━━━━━━━━━━━━━\n✅ Đã giáng chức:\n${nameStr}\n━━━━━━━━━━━━━━━━━━\n📌 Đã bị gỡ quyền Quản trị trên Zalo.`, hidden: true }, targetIds);
        }
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _doKickall(ctx) {
    const { api, threadId, senderId, adminIds } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng trong nhóm!");
    const senderLevel = getLevel(senderId, threadId, adminIds);
    if (senderLevel < ROLES["Vàng"]) return reply(ctx, "⚠️ Chỉ Key Vàng mới có quyền dùng lệnh này!");
    try {
        const res = await api.getGroupInfo(threadId);
        const info = res.gridInfoMap?.[threadId] || res[threadId];
        const members = info?.memVerList || [];
        await reply(ctx, `🚀 Đang dọn dẹp nhóm...`);
        let count = 0;
        for (const mem of members) {
            const uid = String(mem.uid || mem);
            if (uid === senderId) continue;
            if (getLevel(uid, threadId, adminIds) < senderLevel) {
                try { await api.removeUserFromGroup(threadId, uid); count++; await new Promise(r => setTimeout(r, 600)); } catch { }
            }
        }
        await reply(ctx, `✅ Đã tiễn ${count} thành viên lên đường.`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

export const commands = {
    kick: async (ctx) => {
        const sub = ctx.args[0]?.toLowerCase();
        if (sub === "key") return _doSetkey({ ...ctx, args: ctx.args.slice(1) });
        if (sub === "all") return _doKickall(ctx);
        return _doKick(ctx);
    }
};
