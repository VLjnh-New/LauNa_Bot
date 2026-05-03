import { path, statsManager } from "../globals.js";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const name = "mute";
export const description = "Lệnh cấm chat/tắt tiếng người dùng (yêu cầu admin bot)";

// ─── Tải danh sách muted ───
const MUTE_FILE = path.join(process.cwd(), "src", "data", "mutes.json");

function loadMutes() {
    try {
        if (!existsSync(MUTE_FILE)) return [];
        return JSON.parse(readFileSync(MUTE_FILE, "utf-8")).filter(id => /^\d+$/.test(String(id)));
    } catch {
        return [];
    }
}

function saveMutes(arr) {
    const cleanArr = [...new Set(arr.filter(id => /^\d+$/.test(String(id))))];
    writeFileSync(MUTE_FILE, JSON.stringify(cleanArr, null, 2), "utf-8");
}

let mutedUsers = loadMutes();

async function reply(ctx, text) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

async function getTargetName(api, userId) {
    if (!userId) return "Người dùng";
    const stats = statsManager.getStats(null, userId);
    if (stats && stats.name && stats.name !== "Người dùng") return stats.name;
    try {
        const u = await api.getUserInfo(userId);
        const user = u[userId] || Object.values(u)[0];
        return user?.displayName || user?.zaloName || `ID:${userId}`;
    } catch { return `ID:${userId}`; }
}

function getTargetId(ctx, input) {
    if (ctx.message.data.mentions && ctx.message.data.mentions.length > 0) {
        const mention = ctx.message.data.mentions.find(m => m.uid !== "-1" && m.uid !== -1);
        if (mention) return String(mention.uid);
    }
    if (ctx.message.data.quote) {
        return String(ctx.message.data.quote.uidFrom || ctx.message.data.quote.ownerId);
    }
    if (input && /^\d+$/.test(String(input))) {
        return String(input);
    }
    return null;
}

export const commands = {

    mute: async (ctx) => {
        if (!ctx.adminIds.includes(String(ctx.senderId))) {
            return reply(ctx, "⚠️ Phải là Admin Bot mới được dùng lệnh !mute.");
        }

        const { args, prefix } = ctx;
        const sub = args[0]?.toLowerCase();

        if (!sub) {
            let help = `[ 🔇 QUẢN LÝ MUTE ]\n`;
            help += `─────────────────\n`;
            help += ` ❯ ${prefix}mute add [id/tag] ➥ Chặn chat\n`;
            help += ` ❯ ${prefix}mute del [id/tag] ➥ Bỏ chặn\n`;
            help += ` ❯ ${prefix}mute list         ➥ Danh sách\n`;
            help += `─────────────────\n`;
            help += `💡 Có thể tag hoặc reply tin nhắn để dùng.`;
            return reply(ctx, help);
        }

        mutedUsers = loadMutes(); // Reload cho chắc

        if (sub === "list") {
            if (mutedUsers.length === 0) return reply(ctx, "✨ Hiện tại hông có ai bị cấm chat hết sếp ơi!");
            
            const icons = ["akoi", "lỏ r hihi", "ok", "Đang tải...", "Chờ tí nha", "Xong rùi ✨"];
            let iconIdx = 0;
            const reactionInterval = setInterval(() => {
                if (ctx.message && ctx.message.data) {
                    ctx.api.addReaction(icons[iconIdx % icons.length], {msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId}, ctx.threadId, ctx.threadType).catch(() => { });
                    iconIdx++;
                }
            }, 2000);

            try {
                let msg = `[ 🔇 DANH SÁCH BIỆT GIAM ]\n`;
                msg += `─────────────────\n`;
                const namePromises = mutedUsers.map(uid => getTargetName(ctx.api, uid));
                const names = await Promise.all(namePromises);
                msg += mutedUsers.map((uid, idx) => ` ❯ ${names[idx]} (${uid})`).join("\n");
                msg += `\n─────────────────\n💡 Có ${mutedUsers.length} người đang bị khóa mõm!`;
                return reply(ctx, msg);
            } finally {
                clearInterval(reactionInterval);
            }
        }

        if (sub === "add") {
            const targetId = getTargetId(ctx, args[1]);
            if (!targetId) return reply(ctx, `⚠️ Sếp ơi, tag người đó hoặc reply tin nhắn để Hân biết đường mà Mute nha!`);
            
            const targetName = await getTargetName(ctx.api, targetId);
            if (mutedUsers.includes(targetId)) return reply(ctx, `◈ Người dùng [ ${targetName} ] vốn đã bị biệt giam rồi nè!`);
            
            mutedUsers.push(targetId);
            saveMutes(mutedUsers);
            let successMsg = `[ 🔇 THỰC THI CẤM CHAT ]\n─────────────────\n`;
            successMsg += `👤 Đối tượng: ${targetName}\n🆔 ID: ${targetId}\n🔐 Trạng thái: Đã khóa mõm thành công!\n─────────────────\n✨ Từ giờ người này chat sẽ bị Hân xóa sạch luôn!`;
            return reply(ctx, successMsg);
        }

        if (sub === "del" || sub === "remove" || sub === "unmute") {
            const targetId = getTargetId(ctx, args[1]);
            if (!targetId) return reply(ctx, `⚠️ Sếp định thả ai ra thì tag người đó vào nhé!`);

            const targetName = await getTargetName(ctx.api, targetId);
            if (!mutedUsers.includes(targetId)) return reply(ctx, `◈ Người này có bị Mute đâu mà sếp bắt Hân thả ra dợ? 😂`);
            
            mutedUsers = mutedUsers.filter(id => id !== targetId);
            saveMutes(mutedUsers);
            let unMsg = `[ 🔊 LÀNH LẠI VỚI NHAU ]\n─────────────────\n`;
            unMsg += `👤 Đối tượng: ${targetName}\n🆔 ID: ${targetId}\n🔓 Trạng thái: Đã được tự do!\n─────────────────\n✨ Người này đã có thể chat lại bình thường rồi sếp!`;
            return reply(ctx, unMsg);
        }

        // Backward compatibility: !mute [tag/reply/id]
        const directId = getTargetId(ctx, sub);
        if (directId) {
            const targetName = await getTargetName(ctx.api, directId);
            if (mutedUsers.includes(directId)) {
                return reply(ctx, `◈ Người dùng [ ${targetName} ] đã bị mute rồi sếp! Dùng "${prefix}mute del" để thả nhé.`);
            }
            mutedUsers.push(directId);
            saveMutes(mutedUsers);
            let autoMsg = `[ 🔇 MUTE THẦN TỐC ]\n─────────────────\n`;
            autoMsg += `👤 Đối tượng: ${targetName}\n🔐 Trạng thái: Đã khóa mõm!\n─────────────────\n✨ Lần sau dùng lệnh chuyên nghiệp hơn đi sếp ơi!`;
            return reply(ctx, autoMsg);
        } else {
            return reply(ctx, `⚠️ Lệnh hông hợp lệ rồi sếp! Dùng "${prefix}mute" để xem Hân hướng dẫn nhé.`);
        }
    },

    _silence_removed: async (ctx) => {
        const { api, args, threadId, threadType, prefix } = ctx;
        const sub = args[0]?.toLowerCase();
        const helpMsg =
            `[ 🔕 TẮT THÔNG BÁO ZALO ]\n─────────────────\n` +
            `◈ ${prefix}silence on              — Tắt thông báo vĩnh viễn\n` +
            `◈ ${prefix}silence 1h              — Tắt 1 giờ\n` +
            `◈ ${prefix}silence 4h              — Tắt 4 giờ\n` +
            `◈ ${prefix}silence 8am             — Tắt đến 8 giờ sáng\n` +
            `◈ ${prefix}silence off             — Bật lại thông báo\n` +
            `─────────────────`;
        if (!sub) return api.sendMessage({ msg: helpMsg }, threadId, threadType);
        const durationMap = { "1h": 3600, "4h": 14400, "8am": "until8AM", "forever": -1 };
        try {
            if (sub === "off") {
                await api.setMute({ action: 3 }, threadId, threadType);
                return api.sendMessage({ msg: "🔔 Đã bật lại thông báo cho cuộc trò chuyện này." }, threadId, threadType);
            }
            const duration = sub === "on" ? -1 : (durationMap[sub] ?? -1);
            await api.setMute({ action: 1, duration }, threadId, threadType);
            const label = sub === "on" ? "vĩnh viễn" : (sub === "8am" ? "đến 8 giờ sáng" : sub);
            return api.sendMessage({ msg: `🔕 Đã tắt thông báo ${label} cho cuộc trò chuyện này.` }, threadId, threadType);
        } catch (e) { await api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType); }
    },
};
