/**
 * Module: DnD — Dungeon & Dragons đơn giản hoá cho Zalo
 * Nhập vai solo trong nhóm/chat: chọn nhân vật, khám phá dungeon, chiến đấu
 * Data: in-memory (sessions per user)
 */

import path from "node:path";
import fs from "node:fs";
import { randomInt } from "crypto";
import { rewardDndPlayer, getDndData } from "../utils/managers/playerManager.js";
import { registerReplySession, renewReplySession } from "../utils/managers/replySessionManager.js";
import { drawDndBattleCard, drawDndStatusCard } from "../utils/canvas/canvasHelper.js";

export const name = "dnd";
export const description = "DnD: nhập vai RPG — chọn nhân vật, khám phá dungeon, chiến đấu";

// ─── Characters ───────────────────────────────────────────────────────────────
const CHARACTERS = {
    warrior: {
        name: "Chiến Binh", emoji: "⚔️",
        hp: 30, atk: "1d8+3", def: 14,
        ability: "Chém mạnh (2d6+3 thiệt hại)",
        desc: "Mạnh, chắc chắn. Phù hợp cho mọi người.",
    },
    mage: {
        name: "Pháp Sư", emoji: "🔮",
        hp: 18, atk: "2d6+2", def: 11,
        ability: "Phép thuật (3d4+4 thiệt hại)",
        desc: "Sát thương cao nhưng máu ít.",
    },
    rogue: {
        name: "Kẻ Trộm", emoji: "🗡️",
        hp: 22, atk: "1d6+4", def: 13,
        ability: "Đâm sau lưng (2d8+2 thiệt hại)",
        desc: "Né tránh tốt, chí mạng cao.",
    },
    healer: {
        name: "Thầy Thuốc", emoji: "✚",
        hp: 25, atk: "1d6+1", def: 12,
        ability: "Hồi máu (tự hồi 1d8+3 HP)",
        desc: "Sống lâu, hỗ trợ tốt.",
    },
};

// ─── Dungeons ─────────────────────────────────────────────────────────────────
const DUNGEONS = [
    { name: "Hầm Ngục Bóng Tối",   enemies: ["Zombie", "Skeleton"],           baseHp: 8,  ac: 10, xp: 150, gold: 50  },
    { name: "Rừng Ma Ám",           enemies: ["Wolf Ghost", "Dark Sprite"],    baseHp: 12, ac: 11, xp: 200, gold: 80  },
    { name: "Tháp Lửa",             enemies: ["Fire Elemental", "Lava Golem"], baseHp: 16, ac: 12, xp: 280, gold: 120 },
    { name: "Lâu Đài Ác Ma",        enemies: ["Demon Knight", "Dark Mage"],    baseHp: 22, ac: 14, xp: 400, gold: 200 },
    { name: "Hang Ổ Rồng",          enemies: ["Dragon Whelp", "Ancient Dragon"], baseHp: 35, ac: 16, xp: 700, gold: 400 },
];

// ─── Dice ─────────────────────────────────────────────────────────────────────
function rollDice(notation) {
    const m = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!m) return 0;
    const count = parseInt(m[1]);
    const sides = parseInt(m[2]);
    const mod   = m[3] ? parseInt(m[3]) : 0;
    let total = mod;
    for (let i = 0; i < count; i++) total += randomInt(1, sides + 1);
    return Math.max(1, total);
}

function d20() { return randomInt(1, 21); }

// ─── Session ──────────────────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TIMEOUT = 30 * 60 * 1000;

function getSession(userId) {
    const s = sessions.get(userId);
    if (s && Date.now() - s.lastActivity > SESSION_TIMEOUT) {
        sessions.delete(userId);
        return null;
    }
    return s || null;
}

function createSession(userId, charKey, senderName) {
    const char    = CHARACTERS[charKey];
    const dungeon = DUNGEONS[0];
    // Load saved DnD progress từ playerManager
    const saved   = getDndData(userId, senderName);
    const savedLevel = saved.heroLevel || 1;
    // HP scale theo hero level: mỗi level +2 HP
    const hpBonus = (savedLevel - 1) * 2;
    const state = {
        userId,
        senderName: senderName || "Người chơi",
        charKey,
        char: char.name,
        charEmoji: char.emoji,
        hp: char.hp + hpBonus,
        maxHp: char.hp + hpBonus,
        atk: char.atk,
        def: char.def,
        ability: char.ability,
        abilityUsed: false,
        xp: 0,
        level: savedLevel,
        gold: 0,
        dungeonIdx: 0,
        dungeon: dungeon.name,
        enemy: null,
        phase: "explore",
        room: 0,
        killsThisRun: 0,
        lastActivity: Date.now(),
    };
    sessions.set(userId, state);
    return state;
}

function calcLevel(xp) {
    return Math.floor(Math.sqrt(xp / 100)) + 1;
}

function spawnEnemy(state) {
    const dungeon = DUNGEONS[state.dungeonIdx] || DUNGEONS[0];
    const names   = dungeon.enemies;
    const name    = names[Math.floor(Math.random() * names.length)];
    const hpScale = 1 + (state.level - 1) * 0.2;
    const hp      = Math.floor(dungeon.baseHp * hpScale);
    state.enemy   = {
        name,
        hp,
        maxHp: hp,
        ac:  dungeon.ac,
        xp:  dungeon.xp,
        gold: dungeon.gold,
        atk: `1d6+${Math.max(1, state.level)}`,
    };
    state.phase = "battle";
    state.abilityUsed = false;
    state.lastActivity = Date.now();
}

function buildStatus(state) {
    const hpBar = buildBar(state.hp, state.maxHp);
    let s = `${state.charEmoji} ${state.char} | Lv.${state.level}\n`;
    s += `❤️ HP: ${state.hp}/${state.maxHp} [${hpBar}]\n`;
    s += `⭐ XP: ${state.xp} | 💰 Vàng: ${state.gold}\n`;
    s += `📍 ${state.dungeon} — Phòng ${state.room + 1}`;
    return s;
}

function buildBar(cur, max, len = 8) {
    const f = Math.round((cur / max) * len);
    return "█".repeat(f) + "░".repeat(len - f);
}

async function reply(ctx, text) {
    await ctx.api.sendMessage({ msg: text, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

const CACHE_DIR = path.join(process.cwd(), "src", "modules", "cache");
function ensureCacheDir() { if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true }); }

async function sendDndCard(ctx, drawFn, state) {
    try {
        const buf = await drawFn(state);
        if (!buf) return false;
        ensureCacheDir();
        const tmp = path.join(CACHE_DIR, `dnd_card_${Date.now()}.png`);
        fs.writeFileSync(tmp, buf);
        await ctx.api.sendMessage({ msg: "", attachments: [tmp] }, ctx.threadId, ctx.threadType);
        setTimeout(() => { try { fs.unlinkSync(tmp); } catch {} }, 10000);
        return true;
    } catch { return false; }
}

// ─── Reply Session helper cho DnD ─────────────────────────────────────────────
const CHAR_KEYS = Object.keys(CHARACTERS); // ["warrior","mage","rogue","healer"]

// Bảng map chung: số → lệnh (dùng cho mọi trường hợp reply)
const DND_ACTION_MAP = {
    "1": "attack",  "tấn công": "attack",  "attack": "attack",
    "2": "ability", "kỹ năng": "ability",  "ability": "ability",
    "3": "rest",    "nghỉ": "rest",         "rest": "rest",
    "4": "explore", "khám phá": "explore",  "explore": "explore",
    "5": "status",  "status": "status",
};

const ALL_ACTIONS = ["attack", "ability", "rest", "explore", "status"];

function makeDndReplyHandler(ctx) {
    return async (input, rCtx) => {
        const action = DND_ACTION_MAP[input.toLowerCase().trim()];
        if (action && ALL_ACTIONS.includes(action)) {
            return commands.dnd({ ...rCtx, args: [action] });
        }
        // Input sai → báo lỗi VÀ tái đăng ký để user thử lại
        await rCtx.api.sendMessage({
            msg: `❓ Không nhận ra "${input}". Nhập: 1=attack | 2=ability | 3=rest | 4=explore | 5=status`,
            quote: rCtx.message.data
        }, rCtx.threadId, rCtx.threadType);
        renewReplySession(rCtx.senderId, rCtx.threadId, makeDndReplyHandler(rCtx));
    };
}

function registerBattleReply(ctx) {
    registerReplySession(ctx.senderId, ctx.threadId, makeDndReplyHandler(ctx));
}

function registerExploreReply(ctx) {
    registerReplySession(ctx.senderId, ctx.threadId, makeDndReplyHandler(ctx));
}

// ─── Commands ─────────────────────────────────────────────────────────────────
export const commands = {

    // !dnd - Hướng dẫn / bắt đầu
    dnd: async (ctx) => {
        const { senderId, args, prefix } = ctx;
        const sub = args[0]?.toLowerCase();

        if (!sub || sub === "help") {
            const state = getSession(senderId);
            await reply(ctx,
                `[ 🎲 DUNGEON & DRAGONS ]\n─────────────────────────\n` +
                `❯ ${prefix}dnd start [nhân vật] — Bắt đầu\n` +
                `❯ ${prefix}dnd attack — Tấn công thường\n` +
                `❯ ${prefix}dnd ability — Dùng kỹ năng đặc biệt\n` +
                `❯ ${prefix}dnd explore — Khám phá tiếp\n` +
                `❯ ${prefix}dnd rest — Nghỉ ngơi (+3 HP)\n` +
                `❯ ${prefix}dnd status — Xem trạng thái\n` +
                `❯ ${prefix}dnd end — Kết thúc hành trình\n` +
                `─────────────────────────\n` +
                `🧙 Nhân vật: warrior | mage | rogue | healer\n` +
                (state ? `💡 Reply nhanh: 1=attack, 2=ability, 3=rest, 4=explore` : `💡 Reply tên nhân vật để bắt đầu nhanh`)
            );
            // Nếu đang có session → đăng ký reply cho hành động
            if (state) {
                if (state.phase === "battle") registerBattleReply(ctx);
                else registerExploreReply(ctx);
            } else {
                // Chưa có session → reply tên nhân vật để bắt đầu
                registerReplySession(senderId, ctx.threadId, async (input, rCtx) => {
                    const choice = input.toLowerCase().trim();
                    const idx = parseInt(choice) - 1;
                    const charKey = CHAR_KEYS[idx] ?? choice;
                    return commands.dnd({ ...rCtx, args: ["start", charKey] });
                });
            }
            return;
        }

        if (sub === "start") {
            const charKey = args[1]?.toLowerCase();
            const { senderName } = ctx;
            if (!charKey || !CHARACTERS[charKey]) {
                // Gợi ý nhân vật cũ nếu đã từng chơi
                const saved = getDndData(senderId, senderName);
                const lastClass = saved.heroClass ? CHARACTERS[saved.heroClass] : null;
                const charList = Object.entries(CHARACTERS);
                let msg = `[ 🧙 CHỌN NHÂN VẬT ]\n─────────────────────────\n`;
                charList.forEach(([key, c], i) => {
                    const tag = (key === saved.heroClass) ? " ← lần trước" : "";
                    msg += `${i + 1}️⃣  ${c.emoji} ${c.name}${tag} (${prefix}dnd start ${key})\n  ${c.desc}\n`;
                });
                msg += `─────────────────────────\n`;
                if (lastClass) msg += `💾 Tiến độ đã lưu: Lv.${saved.heroLevel} | ${saved.kills} tiêu diệt\n`;
                msg += `💡 Reply số hoặc tên nhân vật để chọn`;
                await reply(ctx, msg.trim());
                registerReplySession(senderId, ctx.threadId, async (input, rCtx) => {
                    const choice = input.toLowerCase().trim();
                    const idx = parseInt(choice) - 1;
                    const key = CHAR_KEYS[idx] ?? choice;
                    return commands.dnd({ ...rCtx, args: ["start", key] });
                });
                return;
            }

            const state = createSession(senderId, charKey, senderName);
            const char  = CHARACTERS[charKey];
            const saved = getDndData(senderId, senderName);
            const heroLvNote = state.level > 1 ? `\n🏅 Hero Lv.${state.level} (tích lũy: ${saved.totalXp} XP)` : "";
            await reply(ctx,
                `[ ⚔️ HÀNH TRÌNH BẮT ĐẦU! ]\n─────────────────────────\n` +
                `${char.emoji} Bạn chơi: ${char.name}\n` +
                `❤️ HP: ${state.maxHp} | 🛡 DEF: ${char.def}\n` +
                `⚔️ Tấn công: ${char.atk}\n` +
                `✨ Kỹ năng: ${char.ability}` +
                heroLvNote + `\n` +
                `─────────────────────────\n` +
                `📍 Dungeon: ${state.dungeon}\n` +
                `💡 Dùng ${prefix}dnd explore để khám phá!`
            );
            return;
        }

        const state = getSession(senderId);
        if (!state) {
            await reply(ctx, `⚠️ Chưa có hành trình. Dùng ${prefix}dnd start [nhân vật]`);
            return;
        }

        state.lastActivity = Date.now();

        if (sub === "status") {
            const phaseLabel = state.phase === "battle" ? `⚔️ Đang chiến đấu vs ${state.enemy.name}` : "🗺 Khám phá";
            const sent = await sendDndCard(ctx, drawDndStatusCard, state);
            if (!sent) {
                await reply(ctx,
                    `[ 📊 TRẠNG THÁI ]\n─────────────────────────\n` +
                    buildStatus(state) + `\n` +
                    `${phaseLabel}`
                );
            }
            return;
        }

        if (sub === "end") {
            sessions.delete(senderId);
            const { pkBonus } = rewardDndPlayer(senderId, ctx.senderName, {
                gold: state.gold, xp: state.xp,
                kills: state.killsThisRun || 0,
                dungeonIdx: state.dungeonIdx,
                heroClass: state.charKey,
            });
            const saved = getDndData(senderId);
            await reply(ctx,
                `[ 🏁 KẾT THÚC HÀNH TRÌNH ]\n─────────────────────────\n` +
                `${state.charEmoji} ${state.char} | Hero Lv.${saved.heroLevel}\n` +
                `─────────────────────────\n` +
                `💰 Vàng kiếm được: ${state.gold}\n` +
                `⭐ XP kiếm được: ${state.xp}\n` +
                `💀 Tiêu diệt: ${state.killsThisRun || 0} quái\n` +
                (pkBonus > 0 ? `🎁 Bonus pk credits: +${pkBonus} xu\n` : "") +
                `─────────────────────────\n` +
                `📊 Tổng tích lũy: Lv.${saved.heroLevel} | ${saved.kills} tiêu diệt | ${saved.totalGold} vàng`
            );
            return;
        }

        if (sub === "explore") {
            if (state.phase === "battle") {
                await reply(ctx, `⚠️ Đang trong trận đấu! Hãy ${ctx.prefix}dnd attack hoặc ${ctx.prefix}dnd ability.`);
                registerBattleReply(ctx);
                return;
            }

            state.room++;
            const roll = Math.random();

            if (roll < 0.55) {
                spawnEnemy(state);
                const e = state.enemy;
                await reply(ctx,
                    `[ ⚠️ GẶP KẺ THÙ! ]\n─────────────────────────\n` +
                    `👹 ${e.name} xuất hiện!\n` +
                    `❤️ HP: ${e.hp} | 🛡 AC: ${e.ac}\n` +
                    `─────────────────────────\n` +
                    `➥ Reply: 1=attack | 2=ability | 3=rest | 5=status`
                );
                sendDndCard(ctx, drawDndBattleCard, state).catch(() => {});
                registerBattleReply(ctx);
            } else if (roll < 0.75) {
                const heal = rollDice("1d6+2");
                state.hp = Math.min(state.maxHp, state.hp + heal);
                await reply(ctx,
                    `[ ✨ PHÒNG BÌNH YÊN ]\n─────────────────────────\n` +
                    buildStatus(state) + `\n` +
                    `─────────────────────────\n` +
                    `💊 Tìm thấy thuốc hồi phục! +${heal} HP\n` +
                    `➥ Reply: 1=attack | 2=ability | 3=rest | 4=explore | 5=status`
                );
                registerExploreReply(ctx);
            } else if (roll < 0.90) {
                const gold = Math.floor(Math.random() * 30) + 10;
                state.gold += gold;
                await reply(ctx,
                    `[ 💰 TÌM THẤY KHO BÁU ]\n─────────────────────────\n` +
                    buildStatus(state) + `\n` +
                    `─────────────────────────\n` +
                    `💰 +${gold} vàng!\n` +
                    `➥ Reply: 1=attack | 2=ability | 3=rest | 4=explore | 5=status`
                );
                registerExploreReply(ctx);
            } else {
                // Level up dungeon
                const nextIdx = Math.min(state.dungeonIdx + 1, DUNGEONS.length - 1);
                if (nextIdx > state.dungeonIdx) {
                    state.dungeonIdx = nextIdx;
                    state.dungeon = DUNGEONS[nextIdx].name;
                    await reply(ctx,
                        `[ 🚪 DUNGEON MỚI! ]\n─────────────────────────\n` +
                        buildStatus(state) + `\n` +
                        `─────────────────────────\n` +
                        `🗺 Bạn tiến vào: ${state.dungeon}\n` +
                        `⚠️ Kẻ thù mạnh hơn!\n` +
                        `➥ Reply: 1=attack | 2=ability | 3=rest | 4=explore | 5=status`
                    );
                } else {
                    await reply(ctx,
                        `[ 🗺 KHÁM PHÁ ]\n─────────────────────────\n` +
                        buildStatus(state) + `\n` +
                        `─────────────────────────\n` +
                        `Phòng trống. Tiếp tục khám phá...\n` +
                        `➥ Reply: 1=attack | 2=ability | 3=rest | 4=explore | 5=status`
                    );
                }
                registerExploreReply(ctx);
            }
            return;
        }

        if (sub === "rest") {
            if (state.phase === "battle") {
                await reply(ctx, "⚠️ Không thể nghỉ khi đang chiến đấu!");
                registerBattleReply(ctx);
                return;
            }
            const heal = rollDice("1d4+1");
            state.hp = Math.min(state.maxHp, state.hp + heal);
            await reply(ctx,
                `[ 😴 NGHỈ NGƠI ]\n─────────────────────────\n` +
                `❤️ +${heal} HP\n` +
                buildStatus(state) + `\n` +
                `➥ Reply: 1=attack | 2=ability | 3=rest | 4=explore | 5=status`
            );
            registerExploreReply(ctx);
            return;
        }

        if (sub === "attack" || sub === "ability") {
            if (state.phase !== "battle" || !state.enemy) {
                await reply(ctx, `⚠️ Không có kẻ thù nào. Dùng ${ctx.prefix}dnd explore để khám phá!`);
                registerExploreReply(ctx);
                return;
            }

            const e = state.enemy;
            let dmg = 0;
            let actionMsg = "";

            if (sub === "attack") {
                const hitRoll = d20();
                if (hitRoll >= e.ac) {
                    dmg = rollDice(state.atk);
                    actionMsg = `🎲 Tung d20: ${hitRoll} ≥ ${e.ac} — HIT! ${dmg} thiệt hại!`;
                } else {
                    actionMsg = `🎲 Tung d20: ${hitRoll} < ${e.ac} — Miss!`;
                }
            } else {
                if (state.abilityUsed) {
                    await reply(ctx, "⚠️ Kỹ năng đặc biệt đã dùng rồi! Chờ trận chiến tiếp theo.");
                    registerBattleReply(ctx);
                    return;
                }
                if (state.charKey === "healer") {
                    const heal = rollDice("1d8+3");
                    state.hp = Math.min(state.maxHp, state.hp + heal);
                    actionMsg = `✚ Hồi phục +${heal} HP!`;
                } else {
                    const ablDice = { warrior: "2d6+3", mage: "3d4+4", rogue: "2d8+2" };
                    dmg = rollDice(ablDice[state.charKey] || "2d6");
                    actionMsg = `✨ Kỹ năng đặc biệt! ${dmg} thiệt hại!`;
                }
                state.abilityUsed = true;
            }

            e.hp = Math.max(0, e.hp - dmg);

            // Enemy counter attack
            let counterMsg = "";
            if (e.hp > 0) {
                const eHitRoll = d20();
                if (eHitRoll >= state.def) {
                    const eDmg = rollDice(e.atk);
                    state.hp = Math.max(0, state.hp - eDmg);
                    counterMsg = `👹 ${e.name} phản công! ${eDmg} thiệt hại!`;
                } else {
                    counterMsg = `🛡 Bạn né được đòn của ${e.name}!`;
                }
            }

            // Check outcomes
            if (e.hp <= 0) {
                state.xp  += e.xp;
                state.gold += e.gold;
                state.killsThisRun = (state.killsThisRun || 0) + 1;
                state.level = calcLevel(state.xp);
                state.phase = "explore";
                state.enemy = null;
                // Lưu kill vào playerManager (cross-link: gold → pk credits)
                const { pkBonus } = rewardDndPlayer(senderId, state.senderName, {
                    gold: e.gold, xp: e.xp, kills: 1,
                    dungeonIdx: state.dungeonIdx, heroClass: state.charKey,
                });
                const bonusLine = pkBonus > 0 ? `🎁 +${pkBonus} xu Pokémon\n` : "";
                await reply(ctx,
                    `[ ⚔️ CHIẾN THẮNG! ]\n─────────────────────────\n` +
                    `${actionMsg}\n` +
                    `💀 ${e.name} đã bị tiêu diệt!\n` +
                    `+${e.xp} XP | +${e.gold} vàng\n` +
                    bonusLine +
                    `─────────────────────────\n` +
                    buildStatus(state) + `\n` +
                    `➥ Reply: 1=attack | 2=ability | 3=rest | 4=explore | 5=status`
                );
                registerExploreReply(ctx);
                return;
            }

            if (state.hp <= 0) {
                sessions.delete(senderId);
                // Lưu tiến độ (50% gold do thua trận)
                const goldSaved = Math.floor(state.gold * 0.5);
                rewardDndPlayer(senderId, state.senderName, {
                    gold: goldSaved, xp: state.xp,
                    kills: state.killsThisRun || 0,
                    dungeonIdx: state.dungeonIdx, heroClass: state.charKey,
                });
                const saved = getDndData(senderId);
                await reply(ctx,
                    `[ 💀 BẠN ĐÃ CHẾT! ]\n─────────────────────────\n` +
                    `${actionMsg}\n` +
                    `${counterMsg}\n` +
                    `─────────────────────────\n` +
                    `💰 Vàng lưu lại (50%): ${goldSaved}\n` +
                    `⭐ XP lưu lại: ${state.xp}\n` +
                    `─────────────────────────\n` +
                    `📊 Tổng tích lũy: Lv.${saved.heroLevel} | ${saved.kills} tiêu diệt\n` +
                    `Dùng ${ctx.prefix}dnd start để chơi lại.\n` +
                    `💡 Reply tên nhân vật để bắt đầu lại`
                );
                registerReplySession(senderId, ctx.threadId, async (input, rCtx) => {
                    const choice = input.toLowerCase().trim();
                    const idx = parseInt(choice) - 1;
                    const charKey = CHAR_KEYS[idx] ?? choice;
                    return commands.dnd({ ...rCtx, args: ["start", charKey] });
                });
                return;
            }

            await reply(ctx,
                `[ ⚔️ CHIẾN ĐẤU ]\n─────────────────────────\n` +
                `${actionMsg}\n` +
                `${counterMsg}\n` +
                `─────────────────────────\n` +
                `➥ Reply: 1=attack | 2=ability | 3=rest | 5=status`
            );
            sendDndCard(ctx, drawDndBattleCard, state).catch(() => {});
            registerBattleReply(ctx);
            return;
        }

        if (sub === "profile") {
            const { senderName, message } = ctx;
            const targetId   = message?.data?.mentions?.[0]?.uid || senderId;
            const targetName = message?.data?.mentions?.[0]?.displayName || senderName;
            const saved = getDndData(targetId, targetName);
            const dungeonNames = ["Hầm Ngục", "Rừng Ma Ám", "Tháp Lửa", "Lâu Đài Ác Ma", "Hang Ổ Rồng"];
            const bestDungeonName = dungeonNames[Math.min(saved.bestDungeon || 0, dungeonNames.length - 1)] || "Chưa khám phá";
            const heroClassInfo = saved.heroClass ? CHARACTERS[saved.heroClass] : null;
            const lastPlayed = saved.lastPlayed ? new Date(saved.lastPlayed).toLocaleDateString("vi-VN") : "Chưa chơi";
            await reply(ctx,
                `╔══════════════════════════════╗\n` +
                `║   ⚔️ HỒ SƠ DUNGEON & DRAGONS ║\n` +
                `╚══════════════════════════════╝\n` +
                `👤 ${saved.heroClass ? heroClassInfo?.emoji : "🆕"} ${targetName}\n` +
                `🧙 Nhân vật: ${heroClassInfo ? heroClassInfo.name : "Chưa chọn"}\n` +
                `🏅 Hero Lv: ${saved.heroLevel}\n` +
                `📅 Chơi lần cuối: ${lastPlayed}\n` +
                `──────────────────────────────\n` +
                `💀 Tiêu diệt: ${saved.kills || 0} quái\n` +
                `🗺 Dungeon cao nhất: ${bestDungeonName}\n` +
                `⭐ Tổng XP: ${(saved.totalXp || 0).toLocaleString()}\n` +
                `💰 Tổng vàng: ${(saved.totalGold || 0).toLocaleString()}\n` +
                `──────────────────────────────\n` +
                `🔗 Đã chuyển vào pk: ~${Math.floor((saved.totalGold || 0) * 0.5)} xu`
            );
            return;
        }

        // Unknown sub-command
        await reply(ctx, `❓ Lệnh không hợp lệ. Dùng ${prefix}dnd help để xem hướng dẫn.`);
    },

};
