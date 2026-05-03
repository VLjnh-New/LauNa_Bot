/**
 * Event: Leveling
 * Mỗi tin nhắn hợp lệ → +XP cho người gửi (cooldown 60s)
 * Nếu lên cấp → thông báo trong nhóm
 */

import { addXpToUser } from "../modules/level.js";

export const name = "leveling";
export const description = "Tự động cộng XP khi nhắn tin";
export const alwaysRun = true;

export async function handle(ctx) {
    const { api, senderId, senderName, threadId, threadType, content, isSelf } = ctx;

    if (isSelf || !senderId) return;
    if (!content || typeof content !== "string" || content.trim().length < 2) return;

    try {
        const result = addXpToUser(senderId, senderName);
        if (result?.leveledUp) {
            await api.sendMessage(
                { msg: `[ ⭐ LÊN CẤP! ]\n${senderName} vừa đạt Cấp ${result.newLevel}! 🎉` },
                threadId,
                threadType
            );
        }
    } catch {}
}
