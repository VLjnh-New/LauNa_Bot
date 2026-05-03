import { fs, path, axios, log, statsManager } from "../globals.js";
import { protectionManager } from "../utils/managers/protectionManager.js";
import { autoReactManager } from "../utils/managers/autoReactManager.js";
import { drawGroupCard } from "../utils/canvas/canvasHelper.js";
import { tempDir, readJSON } from "../utils/core/io-json.js";

const ROLES = {
    "Admin": 100,
    "Vàng": 50,
    "Bạc": 20,
    "Thành viên": 0
};

function getLevel(uid, threadId, adminIds) {
    if (adminIds.includes(String(uid))) return ROLES["Admin"];
    const stats = statsManager.getStats(threadId, uid);
    return ROLES[stats?.role] || 0;
}

const pendingMemberRequests = new Map();

export const name = "group";
export const description = "Quản lý nhóm (đổi tên, lấy info, kích/thêm thành viên...)";

async function reply(ctx, text) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

// ── Sub-command handlers ──────────────────────────────────────────────────────

async function _name(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng được trong nhóm!");
    const senderLevel = getLevel(ctx.senderId, ctx.threadId, ctx.adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Bạn cần ít nhất [Key Bạc] để đổi tên nhóm!");
    const newName = ctx.args.join(" ");
    if (!newName) return reply(ctx, `◈ Dùng: ${ctx.prefix}group name [tên mới]`);
    try {
        await ctx.api.changeGroupName(ctx.threadId, newName);
        await reply(ctx, `✦ Đã đổi tên nhóm thành: ${newName}`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi khi đổi tên: ${e.message}`); }
}

async function _card(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng được trong nhóm!");
    try {
        ctx.api.sendTypingEvent(ctx.threadId, ctx.threadType).catch(() => { });
        const res = await ctx.api.getGroupInfo(ctx.threadId);
        const info = res.gridInfoMap?.[ctx.threadId] || res;
        if (!info) return reply(ctx, "⚠️ Không tìm thấy thông tin nhóm.");
        const groupName = info.groupName || info.name || "Nhóm không tên";
        const groupId = ctx.threadId;
        const avatar = info.fullAvt || info.avt || info.thumbUrl || "";
        const memberCount = info.totalMember || (info.memVerList ? info.memVerList.length : "?");
        const creatorId = info.creatorId || "?";
        const desc = info.desc || "";
        let creatorName = creatorId;
        try {
            const userRes = await ctx.api.getUserInfo(creatorId);
            const u = userRes?.[creatorId] || userRes;
            creatorName = u?.displayName || u?.zaloName || creatorId;
        } catch { }
        const antiLink = protectionManager.isEnabled(groupId, "link");
        const antiSpam = protectionManager.isEnabled(groupId, "spam");
        let hanEnabled = false;
        try {
            const _launaSet = readJSON(path.join(process.cwd(), "src", "data", "launaSetting.json")) || {};
            hanEnabled = _launaSet[String(groupId)]?.enabled ?? false;
        } catch { }
        const reactConfig = autoReactManager.get(groupId);
        const settings = [
            { label: "Anti-Link", value: antiLink ? "ON" : "OFF", color: antiLink ? "#10b981" : "#94a3b8" },
            { label: "Anti-Spam", value: antiSpam ? "ON" : "OFF", color: antiSpam ? "#10b981" : "#94a3b8" },
            { label: "Bé Hân", value: hanEnabled ? "ON" : "OFF", color: hanEnabled ? "#10b981" : "#94a3b8" },
            { label: "Auto React", value: reactConfig.enabled ? "ON" : "OFF", color: reactConfig.enabled ? "#10b981" : "#94a3b8" },
        ];
        let memberAvatarUrls = [];
        try {
            const memList = info.memVerList || [];
            const topMems = memList.slice(0, 15).map(m => typeof m === "string" ? m.split("_")[0] : String(m?.uid || m)).filter(Boolean);
            if (topMems.length > 0) {
                const profiles = await ctx.api.getGroupMembers(topMems);
                memberAvatarUrls = topMems.map(uid => {
                    const p = profiles[uid] || {};
                    return p.fullAvt || p.avt || "";
                }).filter(url => url !== "");
            }
        } catch (err) { log.error("Lỗi lấy avatar thành viên:", err.message); }
        const imgBuf = await drawGroupCard({
            groupName, groupId, avatar, memberCount, creatorName,
            createdTime: info.createdTime ? new Date(parseInt(info.createdTime)).toLocaleDateString("vi-VN") : "Đang cập nhật",
            description: desc, settings, memberAvatarUrls
        });
        if (!imgBuf) return reply(ctx, `[ 📊 CARD INFO ]\n───\n◈ Tên: ${groupName}\n◈ ID: ${groupId}\n◈ Thành viên: ${memberCount}\n◈ Người tạo: ${creatorName}`);
        const tmpPath = path.join(tempDir, `cardinfo_${Date.now()}.png`);
        fs.writeFileSync(tmpPath, imgBuf);
        await ctx.api.sendMessage({ msg: "", attachments: [tmpPath] }, ctx.threadId, ctx.threadType).catch(() =>
            reply(ctx, `[ 📊 CARD INFO ]\n───\n◈ Tên: ${groupName}\n◈ ID: ${groupId}\n◈ Thành viên: ${memberCount}\n◈ Người tạo: ${creatorName}`)
        );
        try { fs.unlinkSync(tmpPath); } catch { }
    } catch (e) { log.error("Lỗi card:", e.message); await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _info(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng được trong nhóm!");
    try {
        const res = await ctx.api.getGroupInfo(ctx.threadId);
        const info = res.gridInfoMap?.[ctx.threadId] || res;
        if (!info) return reply(ctx, "⚠️ Không tìm thấy thông tin nhóm.");
        const memberCount = info.totalMember || (info.memVerList ? info.memVerList.length : "Không rõ");
        const creatorId = info.creatorId ? info.creatorId : "Không rõ";
        let creatorName = creatorId;
        if (creatorId && creatorId !== "Không rõ") {
            try {
                const uInfo = await ctx.api.getUserInfo(creatorId);
                const user = uInfo[creatorId] || Object.values(uInfo)[0];
                creatorName = user?.displayName || user?.zaloName || creatorId;
            } catch { }
        }
        let msg = `[ 👥 THÔNG TIN NHÓM ]\n─────────────────\n`;
        msg += `◈ Tên: ${info.groupName || info.name || "Không tên"}\n`;
        msg += `◈ Thành viên: ${memberCount}\n◈ Người tạo: ${creatorName}\n`;
        msg += `─────────────────\n✨ Chúc nhóm mọi điều tốt đẹp!`;
        await reply(ctx, msg);
    } catch (e) { log.error("Lỗi info:", e.message); await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _leave(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(ctx.senderId, ctx.threadId, ctx.adminIds);
    if (senderLevel < ROLES["Vàng"]) return reply(ctx, "⚠️ Chỉ Admin hoặc [Key Vàng] mới có quyền ra lệnh rời nhóm!");
    await reply(ctx, "👋 Tạm biệt mọi người! Bot xin phép rời nhóm.");
    try {
        if (typeof ctx.api.leaveGroup === "function") await ctx.api.leaveGroup(ctx.threadId);
        else if (ctx.api.group && typeof ctx.api.group.leave === "function") await ctx.api.group.leave(ctx.threadId);
        else await reply(ctx, "⚠️ API không hỗ trợ lệnh rời nhóm.");
    } catch (e) { await reply(ctx, `⚠️ Không thể rời nhóm: ${e.message}`); }
}

async function _add(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(ctx.senderId, ctx.threadId, ctx.adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Bạn cần ít nhất [Key Bạc] để thêm thành viên!");
    const phone = ctx.args[0];
    if (!phone) return reply(ctx, `◈ Dùng: ${ctx.prefix}group add [số điện thoại]`);
    try {
        await ctx.api.addUserToGroup(phone, ctx.threadId);
        await reply(ctx, `✅ Đã gửi lời mời hoặc thêm SĐT ${phone} vào nhóm.`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi thêm thành viên: ${e.message}`); }
}

async function _avt(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng được trong nhóm!");
    const senderLevel = getLevel(ctx.senderId, ctx.threadId, ctx.adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Bạn cần ít nhất [Key Bạc] để đổi ảnh nhóm!");
    const quote = ctx.message.data.quote;
    if (!quote) return reply(ctx, `[ 🖼️ ĐỔI ẢNH NHÓM ]\n─────────────────\n◈ Hãy reply vào một tấm ảnh.\n◈ Gõ lệnh: ${ctx.prefix}group avt\n─────────────────\n✨ Bot sẽ cập nhật ảnh đại diện nhóm ngay!`);
    let attach;
    try { attach = typeof quote.attach === "string" ? JSON.parse(quote.attach) : quote.attach; }
    catch (e) { return reply(ctx, "⚠️ Dữ liệu ảnh không hợp lệ."); }
    const imageUrl = attach?.hdUrl || attach?.href || attach?.url;
    if (!imageUrl) return reply(ctx, "⚠️ Không tìm thấy ảnh trong tin nhắn được reply.");
    let cleanUrl = imageUrl.replace(/\\\//g, "/");
    try { cleanUrl = decodeURIComponent(cleanUrl); } catch { /* giữ nguyên nếu URL chứa %xx không hợp lệ */ }
    const MIME_EXT = { "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
    let tempPath = null;
    const clockEmojis = ["🕐","🕑","🕒","🕓","🕔","🕕","🕖","🕗","🕘","🕙","🕚","🕛"];
    let clockIdx = 0;
    const reactionInterval = setInterval(() => {
        if (ctx.message && ctx.message.data) {
            ctx.api.addReaction(clockEmojis[clockIdx % clockEmojis.length], { msgId: ctx.message.data.msgId || ctx.message.data.globalMsgId, cliMsgId: ctx.message.data.cliMsgId }, ctx.threadId, ctx.threadType).catch(() => { });
            clockIdx++;
        }
    }, 2000);
    try {
        const response = await axios({ method: "get", url: cleanUrl, responseType: "stream", timeout: 30000, maxRedirects: 5 });
        const ctype = String(response.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
        if (ctype && !ctype.startsWith("image/")) throw new Error(`URL không trả về ảnh (content-type: ${ctype || "?"})`);
        const ext = MIME_EXT[ctype] || path.extname(cleanUrl.split("?")[0]).toLowerCase() || ".jpg";
        const safeExt = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(ext) ? ext : ".jpg";
        tempPath = path.join(tempDir, `temp_avt_${Date.now()}${safeExt}`);
        const writer = fs.createWriteStream(tempPath);
        response.data.pipe(writer);
        await new Promise((resolve, reject) => { writer.on("finish", resolve); writer.on("error", reject); response.data.on("error", reject); });
        const stat = fs.statSync(tempPath);
        if (!stat.size) throw new Error("File ảnh tải về rỗng.");
        await ctx.api.changeGroupAvatar(tempPath, ctx.threadId);
        await reply(ctx, "✅ Đã cập nhật ảnh đại diện nhóm thành công!");
    } catch (err) {
        log.error("Lỗi group avt:", err.message);
        await reply(ctx, `⚠️ Lỗi đổi avatar nhóm: ${err.message}`);
    }
    finally { clearInterval(reactionInterval); if (tempPath && fs.existsSync(tempPath)) { try { fs.unlinkSync(tempPath); } catch { } } }
}

async function _linkon(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(ctx.senderId, ctx.threadId, ctx.adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Bạn phải có [Key Bạc] mới được mở link nhóm!");
    try {
        const res = await ctx.api.enableGroupLink(ctx.threadId);
        await reply(ctx, `✦ Đã mở link nhóm!\n➥ Link: ${res.link}`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _linkoff(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(ctx.senderId, ctx.threadId, ctx.adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Bạn phải có [Key Bạc] mới được tắt link nhóm!");
    try {
        await ctx.api.disableGroupLink(ctx.threadId);
        await reply(ctx, "✦ Đã khóa link tham gia nhóm.");
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _pending(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(ctx.senderId, ctx.threadId, ctx.adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Chỉ Admin hoặc [Key Bạc] mới có quyền xem hàng chờ!");
    try {
        const data = await ctx.api.getGroupMembersJoinRequest(ctx.threadId);
        const list = data.users || [];
        if (list.length === 0) return reply(ctx, "✅ Hiện tại không có yêu cầu tham gia nào.");
        let msg = `[ ⏳ DANH SÁCH CHỜ DUYỆT ]\n─────────────────\n`;
        const sessionRequests = [];
        list.forEach((user, index) => {
            msg += `${index + 1}. ${user.displayName || "Không tên"}\n   🆔: ${user.uid}\n`;
            sessionRequests.push({ index: index + 1, uid: user.uid, name: user.displayName });
        });
        msg += `─────────────────\n➥ Reply số STT để duyệt.\n`;
        msg += `💡 ${ctx.prefix}group duyet on [ID]\n💡 ${ctx.prefix}group duyet off [ID]\n💡 ${ctx.prefix}group duyet all`;
        pendingMemberRequests.set(`${ctx.threadId}-${ctx.senderId}`, sessionRequests);
        setTimeout(() => pendingMemberRequests.delete(`${ctx.threadId}-${ctx.senderId}`), 60000);
        await reply(ctx, msg);
    } catch (e) { log.error("Lỗi pending:", e.message); await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _new(ctx) {
    const { api, threadId, threadType, adminIds, senderId, args, message, prefix } = ctx;
    if (!adminIds.includes(String(senderId))) return reply(ctx, "⚠️ Chỉ Admin Bot mới được tạo nhóm!");
    const members = [];
    if (message.data?.mentions?.length) message.data.mentions.forEach(m => members.push(String(m.uid)));
    args.forEach(a => { if (/^\d+$/.test(a) && !members.includes(a)) members.push(a); });
    const name = args.filter(a => !/^\d+$/.test(a)).join(" ").trim() || "Nhóm mới";
    if (members.length === 0) return reply(ctx, `◈ Cú pháp: ${prefix}group new [tên nhóm] [@tag/ID thành viên...]`);
    try {
        await api.createGroup({ name, members });
        await reply(ctx, `✅ Đã tạo nhóm "${name}" với ${members.length} thành viên!`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi tạo nhóm: ${e.message}`); }
}

async function _disband(ctx) {
    const { api, threadId, adminIds, senderId } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    if (!adminIds.includes(String(senderId))) return reply(ctx, "⚠️ Chỉ Admin Bot mới được giải tán nhóm!");
    try {
        await api.disperseGroup(threadId);
        await reply(ctx, "✅ Đã gửi lệnh giải tán nhóm.");
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _up(ctx) {
    const { api, threadId, adminIds, senderId } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    if (!adminIds.includes(String(senderId))) return reply(ctx, "⚠️ Chỉ Admin Bot mới được nâng cấp nhóm!");
    try {
        await api.upgradeGroupToCommunity(threadId);
        await reply(ctx, "✅ Đã nâng cấp nhóm lên Cộng đồng Zalo!");
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _link(ctx) {
    const { api, threadId, adminIds, senderId } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(senderId, threadId, adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Cần ít nhất Key Bạc để đổi link nhóm!");
    try {
        const res = await api.changeGroupLink(threadId);
        const link = res?.link || res?.groupLink || JSON.stringify(res);
        await reply(ctx, `✅ Đã đổi link tham gia nhóm!\n🔗 Link mới: ${link}`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _addad(ctx) {
    const { api, threadId, adminIds, senderId, args, message, prefix } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    if (!adminIds.includes(String(senderId))) return reply(ctx, "⚠️ Chỉ Admin Bot mới được thêm admin nhóm!");
    const targets = [];
    if (message.data?.mentions?.length) message.data.mentions.forEach(m => targets.push(String(m.uid)));
    args.forEach(a => { if (/^\d+$/.test(a) && !targets.includes(a)) targets.push(a); });
    if (targets.length === 0) return reply(ctx, `◈ Cú pháp: ${prefix}group addad [@tag/ID]`);
    try {
        await api.addGroupAdmins(threadId, targets);
        await reply(ctx, `✅ Đã thêm ${targets.length} admin nhóm Zalo!`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _redad(ctx) {
    const { api, threadId, adminIds, senderId, args, message, prefix } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    if (!adminIds.includes(String(senderId))) return reply(ctx, "⚠️ Chỉ Admin Bot mới được xóa admin nhóm!");
    const targets = [];
    if (message.data?.mentions?.length) message.data.mentions.forEach(m => targets.push(String(m.uid)));
    args.forEach(a => { if (/^\d+$/.test(a) && !targets.includes(a)) targets.push(a); });
    if (targets.length === 0) return reply(ctx, `◈ Cú pháp: ${prefix}group redad [@tag/ID]`);
    try {
        await api.removeGroupAdmins(threadId, targets);
        await reply(ctx, `✅ Đã xóa ${targets.length} admin nhóm Zalo!`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _invite(ctx) {
    const { api, threadId, adminIds, senderId, args, message, prefix } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(senderId, threadId, adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Cần ít nhất Key Bạc để mời thành viên!");
    const targets = [];
    if (message.data?.mentions?.length) message.data.mentions.forEach(m => targets.push(String(m.uid)));
    args.forEach(a => { if (/^\d+$/.test(a) && !targets.includes(a)) targets.push(a); });
    if (targets.length === 0) return reply(ctx, `◈ Cú pháp: ${prefix}group invite [@tag/ID]`);
    try {
        for (const uid of targets) await api.inviteUserToGroups(uid, threadId);
        await reply(ctx, `✅ Đã gửi lời mời tham gia nhóm cho ${targets.length} người!`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _join(ctx) {
    const { api, threadId, threadType, adminIds, senderId, args, prefix } = ctx;
    if (!adminIds.includes(String(senderId))) return reply(ctx, "⚠️ Chỉ Admin Bot mới được dùng lệnh này!");
    const link = args[0];
    if (!link || !link.includes("zalo")) return reply(ctx, `◈ Cú pháp: ${prefix}group join [link nhóm Zalo]`);
    try {
        await api.joinGroupByLink(link);
        await api.sendMessage({ msg: "✅ Đã tham gia nhóm thành công!" }, threadId, threadType);
    } catch (e) { await api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType); }
}

async function _block(ctx) {
    const { api, threadId, adminIds, senderId, args, message, prefix } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(senderId, threadId, adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Cần ít nhất Key Bạc!");
    const quote = message.data?.quote;
    const targets = [];
    if (quote?.uidFrom || quote?.ownerId) targets.push(String(quote.uidFrom || quote.ownerId));
    if (message.data?.mentions?.length) message.data.mentions.forEach(m => { if (!targets.includes(String(m.uid))) targets.push(String(m.uid)); });
    args.forEach(a => { if (/^\d+$/.test(a) && !targets.includes(a)) targets.push(a); });
    if (targets.length === 0) return reply(ctx, `◈ Cú pháp: ${prefix}group block [@tag/ID]`);
    try {
        await api.addGroupBlockedMember(threadId, targets);
        await reply(ctx, `✅ Đã thêm ${targets.length} người vào danh sách chặn nhóm!`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _unblock(ctx) {
    const { api, threadId, adminIds, senderId, args, message, prefix } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(senderId, threadId, adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Cần ít nhất Key Bạc!");
    const quote = message.data?.quote;
    const targets = [];
    if (quote?.uidFrom || quote?.ownerId) targets.push(String(quote.uidFrom || quote.ownerId));
    if (message.data?.mentions?.length) message.data.mentions.forEach(m => { if (!targets.includes(String(m.uid))) targets.push(String(m.uid)); });
    args.forEach(a => { if (/^\d+$/.test(a) && !targets.includes(a)) targets.push(a); });
    if (targets.length === 0) return reply(ctx, `◈ Cú pháp: ${prefix}group unblock [@tag/ID]`);
    try {
        await api.removeGroupBlockedMember(threadId, targets);
        await reply(ctx, `✅ Đã gỡ chặn ${targets.length} người khỏi danh sách chặn nhóm!`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _set(ctx) {
    const { api, threadId, adminIds, senderId, args, prefix } = ctx;
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(senderId, threadId, adminIds);
    if (senderLevel < ROLES["Vàng"]) return reply(ctx, "⚠️ Cần Key Vàng để đổi cài đặt nhóm!");
    const key = args[0]?.toLowerCase();
    const val = args[1]?.toLowerCase();
    const helpMsg =
        `[ ⚙️ CÀI ĐẶT NHÓM ]\n─────────────────\n` +
        `◈ ${prefix}group set joinapprove on/off\n` +
        `◈ ${prefix}group set link on/off\n` +
        `◈ ${prefix}group set changename on/off\n` +
        `◈ ${prefix}group set sendmsg on/off\n─────────────────`;
    if (!key || !val) return reply(ctx, helpMsg);
    const settingMap = { joinapprove: "addMemberPermission", link: "linkSetting", changename: "namePermission", sendmsg: "msgPermission" };
    const field = settingMap[key];
    if (!field) return reply(ctx, helpMsg);
    try {
        await api.changeGroupSetting(threadId, { [field]: (val === "on" || val === "1") ? 1 : 0 });
        await reply(ctx, `✅ Đã cập nhật cài đặt nhóm: ${key} = ${val}`);
    } catch (e) { await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

async function _duyet(ctx) {
    if (!ctx.isGroup) return reply(ctx, "⚠️ Chỉ dùng trong nhóm!");
    const senderLevel = getLevel(ctx.senderId, ctx.threadId, ctx.adminIds);
    if (senderLevel < ROLES["Bạc"]) return reply(ctx, "⚠️ Chỉ Admin hoặc [Key Bạc] mới có quyền duyệt thành viên!");
    const action = ctx.args[0]?.toLowerCase();
    let isApprove = true;
    let actionText = "Chấp nhận (on)";
    if (["off","no","bo","huy","reject"].includes(action)) { isApprove = false; actionText = "Từ chối (off)"; }
    else if (action === "all") { isApprove = true; actionText = "Chấp nhận tất cả"; }
    else if (action !== "on") return reply(ctx, `◈ Dùng: ${ctx.prefix}group duyet [on/off/all] [ID (nếu có)]`);
    const targetIds = ctx.args.slice(1).filter(id => /^\d+$/.test(id));
    try {
        let members = targetIds;
        if (members.length === 0) {
            const data = await ctx.api.getGroupMembersJoinRequest(ctx.threadId);
            members = (data?.users || []).map(u => String(u.uid)).filter(Boolean);
            if (members.length === 0) return reply(ctx, "✅ Hàng chờ trống, không có gì để duyệt.");
        }
        await ctx.api.handleGroupPendingMembers(ctx.threadId, members, isApprove);
        await reply(ctx, `✅ Đã ${actionText} ${members.length} thành viên${targetIds.length ? `: ${targetIds.join(", ")}` : " trong hàng chờ"}!`);
    } catch (e) { log.error("Lỗi duyet:", e.message); await reply(ctx, `⚠️ Lỗi: ${e.message}`); }
}

// ── Main command ──────────────────────────────────────────────────────────────

const HELP_MSG = (prefix) =>
    `[ 👥 QUẢN LÝ NHÓM ]\n─────────────────\n` +
    `${prefix}group name [tên]   — Đổi tên nhóm\n` +
    `${prefix}group card         — Xem card info\n` +
    `${prefix}group info         — Thông tin nhóm\n` +
    `${prefix}group avt          — Đổi ảnh nhóm (reply ảnh)\n` +
    `${prefix}group leave        — Bot rời nhóm\n` +
    `${prefix}group add [SĐT]    — Thêm thành viên\n` +
    `${prefix}group linkon       — Mở link nhóm\n` +
    `${prefix}group linkoff      — Tắt link nhóm\n` +
    `${prefix}group pending      — Xem hàng chờ duyệt\n` +
    `${prefix}group duyet on/off/all — Duyệt thành viên\n` +
    `${prefix}group new [tên]    — Tạo nhóm mới\n` +
    `${prefix}group disband      — Giải tán nhóm\n` +
    `${prefix}group up           — Nâng cấp nhóm\n` +
    `${prefix}group link         — Đổi link nhóm\n` +
    `${prefix}group addad [@]    — Thêm admin nhóm\n` +
    `${prefix}group redad [@]    — Xóa admin nhóm\n` +
    `${prefix}group invite [@]   — Mời thành viên\n` +
    `${prefix}group join [link]  — Tham gia nhóm\n` +
    `${prefix}group block [@]    — Chặn thành viên\n` +
    `${prefix}group unblock [@]  — Gỡ chặn thành viên\n` +
    `${prefix}group set [key] [on/off] — Cài đặt nhóm\n` +
    `─────────────────`;

export const commands = {
    group: async (ctx) => {
        const sub = ctx.args[0]?.toLowerCase();
        const subCtx = { ...ctx, args: ctx.args.slice(1) };
        switch (sub) {
            case "name":    return _name(subCtx);
            case "card":    return _card(ctx);
            case "info":    return _info(ctx);
            case "leave":   return _leave(ctx);
            case "add":     return _add(subCtx);
            case "avt":     return _avt(ctx);
            case "linkon":  return _linkon(ctx);
            case "linkoff": return _linkoff(ctx);
            case "pending": return _pending(ctx);
            case "new":     return _new(subCtx);
            case "disband": case "gt": return _disband(ctx);
            case "up":      return _up(ctx);
            case "link":    return _link(ctx);
            case "addad":   return _addad(subCtx);
            case "redad":   return _redad(subCtx);
            case "invite":  return _invite(subCtx);
            case "join":    return _join(subCtx);
            case "block":   return _block(subCtx);
            case "unblock": return _unblock(subCtx);
            case "set":     return _set(subCtx);
            case "duyet":   return _duyet(subCtx);
            default:        return reply(ctx, HELP_MSG(ctx.prefix));
        }
    }
};

export async function handle(ctx) {
    const { content, threadId, senderId, api, isGroup, message } = ctx;
    if (!content || !isGroup || message.isSelf) return false;
    const key = `${threadId}-${senderId}`;
    const pendingList = pendingMemberRequests.get(key);
    if (pendingList && /^\d+$/.test(content.trim())) {
        const choiceIdx = parseInt(content.trim());
        const target = pendingList.find(u => u.index === choiceIdx);
        if (target) {
            try {
                await api.handleGroupPendingMembers(threadId, [target.uid], true);
                await api.sendMessage({ msg: `✅ Đã duyệt thành viên: ${target.name} (${target.uid})` }, threadId, ctx.threadType ?? 1);
                const newList = pendingList.filter(u => u.index !== choiceIdx);
                if (newList.length === 0) pendingMemberRequests.delete(key);
                else pendingMemberRequests.set(key, newList);
                return true;
            } catch (e) { await api.sendMessage({ msg: `⚠️ Lỗi khi duyệt: ${e.message}` }, threadId, 1); }
        }
    }
    return false;
}
