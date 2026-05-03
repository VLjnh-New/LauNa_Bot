/**
 * Module: Level / XP
 * Hệ thống cấp độ theo kiểu MEE6 — nhắn tin được XP, lên cấp, bảng xếp hạng
 * Data: src/data/levels.json
 */

import path from "node:path";

export const name = "level";
export const description = "Hệ thống cấp độ: rank, lvtop";

const DATA_PATH = path.join(process.cwd(), "src", "data", "levels.json");

const LEVEL_CONFIG = {
    minXp: 15,
    maxXp: 25,
    cooldownMs: 60_000,
};

function getRequiredXp(level) {
    return 5 * (level ** 2) + 50 * level + 100;
}

function loadLevels() {
    return readJSON(DATA_PATH) || {};
}

function saveLevels(data) {
    writeJSON(DATA_PATH, data);
}

export function getUserLevel(userId) {
    const all = loadLevels();
    if (!all[userId]) all[userId] = { xp: 0, level: 0, totalXp: 0, lastMessage: 0, name: "" };
    return { user: all[userId], all };
}

export function addXpToUser(userId, userName) {
    const { user, all } = getUserLevel(userId);

    if (Date.now() - user.lastMessage < LEVEL_CONFIG.cooldownMs) return null;

    const xpGain = Math.floor(Math.random() * (LEVEL_CONFIG.maxXp - LEVEL_CONFIG.minXp + 1)) + LEVEL_CONFIG.minXp;
    user.xp += xpGain;
    user.totalXp = (user.totalXp || 0) + xpGain;
    user.lastMessage = Date.now();
    user.name = userName || user.name || userId;

    let leveledUp = false;
    let newLevel = user.level;
    while (user.xp >= getRequiredXp(user.level)) {
        user.xp -= getRequiredXp(user.level);
        user.level++;
        leveledUp = true;
        newLevel = user.level;
    }

    all[userId] = user;
    saveLevels(all);
    return { leveledUp, newLevel, xpGain };
}

function buildProgressBar(current, required, length = 10) {
    const filled = Math.round((current / required) * length);
    return "█".repeat(filled) + "░".repeat(length - filled);
}

async function reply(ctx, text) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

export const commands = {

    // !rank [@mention hoặc không có] - Xem cấp độ
    rank: async (ctx) => {
        const { senderId, senderName, message } = ctx;
        let targetId = senderId;
        let targetName = senderName;

        if (message?.data?.mentions?.length > 0) {
            const mention = message.data.mentions[0];
            targetId = mention.uid || senderId;
            targetName = mention.displayName || senderName;
        }

        const { user } = getUserLevel(targetId);
        const required = getRequiredXp(user.level);
        const bar = buildProgressBar(user.xp, required);

        await reply(ctx,
            `[ ⭐ CẤP ĐỘ — ${targetName} ]\n` +
            `─────────────────────\n` +
            `🏅 Cấp: ${user.level}\n` +
            `✨ XP: ${user.xp} / ${required}\n` +
            `[${bar}]\n` +
            `📊 Tổng XP: ${user.totalXp || 0}`
        );
    },

    // !lvtop - Bảng xếp hạng cấp độ top 10
    lvtop: async (ctx) => {
        const all = loadLevels();
        const sorted = Object.entries(all)
            .map(([uid, u]) => ({ uid, ...u }))
            .sort((a, b) => (b.totalXp || 0) - (a.totalXp || 0))
            .slice(0, 10);

        if (!sorted.length) {
            await reply(ctx, "⚠️ Chưa có dữ liệu xếp hạng.");
            return;
        }

        const medals = ["🥇", "🥈", "🥉"];
        let msg = `[ 🏆 BẢNG XẾP HẠNG TOP 10 ]\n─────────────────────\n`;
        sorted.forEach((u, i) => {
            const medal = medals[i] || `${i + 1}.`;
            msg += `${medal} ${u.name || u.uid} — Cấp ${u.level} (${u.totalXp || 0} XP)\n`;
        });

        await reply(ctx, msg.trim());
    },

};
