import { protectionManager } from "../utils/managers/protectionManager.js";
import { nsfwDetector } from "../utils/moderation/nsfwDetector.js";
import { mediaHelper } from "../utils/core/mediaHelper.js";
import { log } from "../globals.js";

export const name = "anti-protection";
export const description = "Hệ thống bảo vệ nhóm: Link, Spam, Photo, Sticker, Tag, NSFW";

const ZALO_GROUP_LINK_REGEX = /zalo\.me\/g\/[a-zA-Z0-9_\-]+/i;
const NSFW_THRESHOLD = 0.15;

function isSticker(data, content) {
    return mediaHelper.isSticker(data, content);
}

function isPhoto(data, content) {
    return mediaHelper.isPhoto(data, content);
}

// spam: track ALL message types per user
const spamData = new Map();
const kickHistory = [];

// Thresholds
const MSG_LIMIT = 5;
const TIME_LIMIT = 5000;
const MAX_KICKS_PER_MIN = 10;
const NOTIFY_COOLDOWN = 15000;
const lastNotify = new Map();

async function getDisplayName(api, uid) {
    try {
        const info = await api.getUserInfo(uid);
        const u = info?.[uid] || info;
        return u?.displayName || u?.zaloName || uid;
    } catch {
        return uid;
    }
}

async function tryDeleteMessage(ctx) {
    const { api, message, threadId, threadType } = ctx;
    try {
        await api.deleteMessage({msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId, ownerId: message.data?.uidFrom}, threadId, threadType);
    } catch (e) {
        log.error?.(`[Protection] Lỗi khi xoá tin vi phạm: ${e.message}`);
    }
}

async function handleViolation(ctx, type, count, forceNotify = false) {
    const { api, threadId, threadType, senderId } = ctx;
    const config = protectionManager.CONFIG[type];

    await tryDeleteMessage(ctx);

    const notifyKey = `${type}_${threadId}_${senderId}`;
    const now = Date.now();
    const lastN = lastNotify.get(notifyKey) || 0;
    const isKick = (config && count >= config.kick);

    if (!isKick && !forceNotify && (now - lastN < NOTIFY_COOLDOWN)) return;
    lastNotify.set(notifyKey, now);

    const name = await getDisplayName(api, senderId);
    const headers = {
        photo: "📷 ANTI-PHOTO",
        nude: "🛡️ ANTI-NUDE",
        sticker: "🎨 ANTI-STICKER",
        tag: "🏷️ ANTI-TAG",
        link: "🔗 ANTI-LINK",
        spam: "⚡ ANTI-SPAM"
    };

    const header = `➜ [ ${headers[type] || `ANTI-${type.toUpperCase()}`} ]\n`;
    let msg = "";

    if (isKick) {
        try {
            await api.removeUserFromGroup(threadId, [senderId]);
            msg = `${header}${name}\n➜ 📣 Đã kick ra khỏi nhóm do vi phạm quá nhiều lần (${count}/${config.kick}). 👋`;
            protectionManager.resetViolation(threadId, senderId, type);
        } catch {
            try {
                await api.blockUsersInGroup(threadId, [senderId]);
                msg = `${header}${name}\n➜ 📣 Đã chặn và mời bạn ra do vi phạm liên tục (${count}/${config.kick}). 👋`;
                protectionManager.resetViolation(threadId, senderId, type);
            } catch {
                msg = `${header}${name}\n➜ ⚠️ Bot không đủ quyền kick/block. Ad xử lý giúp với! 🥺`;
                protectionManager.resetViolation(threadId, senderId, type);
            }
        }
    } else if (config && count >= config.warn) {
        msg = `${header}${name}\n➜ 😡 CẢNH BÁO: Vi phạm ${count} lần. Thêm ${config.kick - count} lần nữa là KICK!`;
    } else {
        const reasons = {
            photo: "không cho gửi ảnh",
            nude: "không cho phép gửi ảnh nhạy cảm (NSFW/NUDE)",
            sticker: "không cho gửi sticker",
            tag: "không được tag @Tất cả",
            link: "không được gửi link nhóm Zalo",
            spam: "không gửi tin nhắn liên tục"
        };
        msg = `${header}${name}\n➜ 🎀 Nhóm mình ${reasons[type] || "đang có bảo vệ"}. Đừng tái phạm nha! ✨`;
    }

    if (msg) {
        await api.sendMessage({
            msg,
            mentions: [{ uid: senderId, pos: header.length, len: name.length }],
            styles: [
                { start: 2, len: (headers[type] || `ANTI-${type.toUpperCase()}`).length + 4, st: "b" },
                { start: 2, len: (headers[type] || `ANTI-${type.toUpperCase()}`).length + 4, st: "c_db342e" }
            ]
        }, threadId, threadType);
    }
}

export async function handle(ctx) {
    const { message, threadId, threadType, senderId, adminIds, isGroup, api, content } = ctx;
    if (message.isSelf) return false;
    if (!isGroup) return false;

    const { data } = message;
    const now = Date.now();
    const isOwner = adminIds.includes(String(senderId));

    // Bỏ qua các check bảo vệ cho Admin, TRỪ lọc NSFW/NUDE
    if (isOwner && !protectionManager.isEnabled(threadId, "nude")) return false;

    // Link check
    if (protectionManager.isEnabled(threadId, "link")) {
        let textToCheck = content || "";
        if (!textToCheck && data?.content) {
            textToCheck = typeof data.content === "string" ? data.content : (data.content.href || data.content.text || "");
        }
        if (textToCheck && ZALO_GROUP_LINK_REGEX.test(textToCheck)) {
            await tryDeleteMessage(ctx);
            const name = await getDisplayName(api, senderId);
            await api.sendMessage({
                msg: `➜ [ 🔗 ANTI-LINK ]\n${name}\n➜ 🚫 Link nhóm Zalo không được phép. Đã gỡ!`,
                mentions: [{ uid: senderId, pos: 19, len: name.length }]
            }, threadId, threadType);
            return true;
        }
    }

    // Spam check
    if (protectionManager.isEnabled(threadId, "spam")) {
        const key = `${threadId}_${senderId}`;
        const timestamps = spamData.get(key) || [];
        const recent = timestamps.filter(t => now - t < TIME_LIMIT);
        recent.push(now);
        spamData.set(key, recent);

        setTimeout(() => {
            const cur = spamData.get(key);
            if (cur && cur.length > 0 && Date.now() - cur[cur.length - 1] > 60000) spamData.delete(key);
        }, 61000);

        if (recent.length >= MSG_LIMIT) {
            spamData.set(key, []);
            while (kickHistory.length > 0 && kickHistory[0] < now - 60000) kickHistory.shift();
            if (kickHistory.length < MAX_KICKS_PER_MIN) {
                const count = protectionManager.addViolation(threadId, senderId, "spam");
                await handleViolation(ctx, "spam", count);
                kickHistory.push(now);
                return true;
            }
        }
    }

    // Tag check
    if (protectionManager.isEnabled(threadId, "tag")) {
        const mentions = data.mentions || [];
        if (mentions.some(m => m.uid === "-1" || m.uid === -1)) {
            const count = protectionManager.addViolation(threadId, senderId, "tag");
            await handleViolation(ctx, "tag", count);
            return true;
        }
    }

    // Sticker check
    if (protectionManager.isEnabled(threadId, "sticker") && isSticker(data, content)) {
        const count = protectionManager.addViolation(threadId, senderId, "sticker");
        await handleViolation(ctx, "sticker", count);
        return true;
    }

    // Anti-NSFW/Nude check (áp dụng cho cả admin — chỉ xóa, không tính vi phạm)
    const isPhotoTarget = protectionManager.isEnabled(threadId, "nude") && mediaHelper.isPhoto(data, content);
    const isVideoTarget = protectionManager.isEnabled(threadId, "nude") && mediaHelper.isVideo(data, content);

    if (isPhotoTarget || isVideoTarget) {
        const attachUrl = isVideoTarget
            ? mediaHelper.extractVideoUrl(data.attach || data.content)
            : mediaHelper.extractImageUrl(data.attach || data.content);
        if (attachUrl) {
            try {
                const res = await nsfwDetector.checkUrl(attachUrl, api);
                if ((res?.score || 0) >= NSFW_THRESHOLD) {
                    if (isOwner) {
                        await tryDeleteMessage(ctx);
                        await api.sendMessage({ msg: "🛡️ [ ANTI-NUDE ]\nPhát hiện nội dung nhạy cảm (18+) từ quản trị viên! Đã gỡ bỏ." }, threadId, threadType);
                        return true;
                    }
                    const count = protectionManager.addViolation(threadId, senderId, "nude");
                    await handleViolation(ctx, "nude", count, true);
                    return true;
                }
            } catch (e) {
                log.error?.(`[Protection] Lỗi NSFW check: ${e.message}`);
            }
        }
    }

    // Bỏ qua các check còn lại nếu là admin
    if (isOwner) return false;

    // Photo check
    if (protectionManager.isEnabled(threadId, "photo") && isPhoto(data, content)) {
        const count = protectionManager.addViolation(threadId, senderId, "photo");
        await handleViolation(ctx, "photo", count);
        return true;
    }

    return false;
}
