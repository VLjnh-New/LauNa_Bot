import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { log } from "../logger.js";

export const name = "rp";
export const description = "Roleplay GIF — ôm, hôn, vỗ đầu, tát... dùng nekos.best";

const NEKOS = "https://nekos.best/api/v2";

const ACTIONS = {
    "ôm":      { cat: "hug",       withTarget: "{a} ôm {t} thật chặt! 🤗",             noTarget: "{a} tự ôm bản thân... 🤗" },
    "om":      { cat: "hug",       withTarget: "{a} ôm {t} thật chặt! 🤗",             noTarget: "{a} tự ôm bản thân... 🤗" },
    "hôn":     { cat: "kiss",      withTarget: "{a} hôn {t}! 💋",                       noTarget: null },
    "hon":     { cat: "kiss",      withTarget: "{a} hôn {t}! 💋",                       noTarget: null },
    "vỗ đầu":  { cat: "pat",       withTarget: "{a} vỗ đầu {t} nhẹ nhàng~ 🥰",        noTarget: "{a} tự vỗ đầu mình... 🥴" },
    "vodau":   { cat: "pat",       withTarget: "{a} vỗ đầu {t} nhẹ nhàng~ 🥰",        noTarget: "{a} tự vỗ đầu mình... 🥴" },
    "tát":     { cat: "slap",      withTarget: "{a} tát {t} một cái thật đau! 💢",     noTarget: null },
    "tat":     { cat: "slap",      withTarget: "{a} tát {t} một cái thật đau! 💢",     noTarget: null },
    "cắn":     { cat: "bite",      withTarget: "{a} cắn {t}! 😬",                       noTarget: null },
    "can":     { cat: "bite",      withTarget: "{a} cắn {t}! 😬",                       noTarget: null },
    "khóc":    { cat: "cry",       withTarget: "{a} khóc vì {t}... 😢",                noTarget: "{a} đang khóc... 😢" },
    "khoc":    { cat: "cry",       withTarget: "{a} khóc vì {t}... 😢",                noTarget: "{a} đang khóc... 😢" },
    "nhảy":    { cat: "dance",     withTarget: "{a} nhảy cùng {t}! 💃",               noTarget: "{a} đang nhảy một mình! 💃" },
    "nhay":    { cat: "dance",     withTarget: "{a} nhảy cùng {t}! 💃",               noTarget: "{a} đang nhảy một mình! 💃" },
    "đấm":     { cat: "kick",      withTarget: "{a} đấm {t} thật mạnh! 👊",            noTarget: null },
    "dam":     { cat: "kick",      withTarget: "{a} đấm {t} thật mạnh! 👊",            noTarget: null },
    "liếm":    { cat: "lick",      withTarget: "{a} liếm {t}!? 👅",                    noTarget: null },
    "liem":    { cat: "lick",      withTarget: "{a} liếm {t}!? 👅",                    noTarget: null },
    "cù":      { cat: "tickle",    withTarget: "{a} cù {t}! 😂",                       noTarget: null },
    "cu":      { cat: "tickle",    withTarget: "{a} cù {t}! 😂",                       noTarget: null },
    "chọc":    { cat: "poke",      withTarget: "{a} chọc vào má {t}~ 👉",             noTarget: null },
    "choc":    { cat: "poke",      withTarget: "{a} chọc vào má {t}~ 👉",             noTarget: null },
    "bế":      { cat: "cuddle",    withTarget: "{a} bế {t} lên! 🫂",                   noTarget: null },
    "be":      { cat: "cuddle",    withTarget: "{a} bế {t} lên! 🫂",                   noTarget: null },
    "xịt":     { cat: "baka",      withTarget: "{a} xịt {t}! 💨😤",                    noTarget: null },
    "xit":     { cat: "baka",      withTarget: "{a} xịt {t}! 💨😤",                    noTarget: null },
    "ngủ":     { cat: "sleep",     withTarget: null,                                    noTarget: "{a} đang buồn ngủ... 😴" },
    "ngu":     { cat: "sleep",     withTarget: null,                                    noTarget: "{a} đang buồn ngủ... 😴" },
    "hãnh":    { cat: "smug",      withTarget: null,                                    noTarget: "{a} đang tự hào về bản thân 😏" },
    "hanh":    { cat: "smug",      withTarget: null,                                    noTarget: "{a} đang tự hào về bản thân 😏" },
    "đỏ mặt":  { cat: "blush",     withTarget: "{a} đỏ mặt vì {t}~ 😳",              noTarget: "{a} đang đỏ mặt... 😳" },
    "do mat":  { cat: "blush",     withTarget: "{a} đỏ mặt vì {t}~ 😳",              noTarget: "{a} đang đỏ mặt... 😳" },
    "nom":     { cat: "nom",       withTarget: "{a} ăn {t}! 😋",                       noTarget: "{a} đang ăn gì đó... 😋" },
    "hờn":     { cat: "pout",      withTarget: "{a} hờn {t}! 😒",                      noTarget: "{a} đang hờn... 😒" },
    "hon2":    { cat: "pout",      withTarget: "{a} hờn {t}! 😒",                      noTarget: "{a} đang hờn... 😒" },
    "nhờn":    { cat: "shrug",     withTarget: null,                                    noTarget: "{a} 🤷" },
    "nhon":    { cat: "shrug",     withTarget: null,                                    noTarget: "{a} 🤷" },
    "nắm tay": { cat: "handhold",  withTarget: "{a} nắm tay {t} 💞",                  noTarget: null },
    "nam tay": { cat: "handhold",  withTarget: "{a} nắm tay {t} 💞",                  noTarget: null },
};

const cooldowns = new Map();
const COOLDOWN_MS = 5000;

function checkCooldown(senderId, cmd) {
    const key = `rp:${cmd}:${senderId}`;
    const now = Date.now();
    const last = cooldowns.get(key) || 0;
    if (now - last < COOLDOWN_MS) return Math.ceil((COOLDOWN_MS - (now - last)) / 1000);
    cooldowns.set(key, now);
    return null;
}

async function fetchGif(category) {
    try {
        const res = await axios.get(`${NEKOS}/${category}`, { timeout: 8000 });
        return res.data?.results?.[0]?.url || null;
    } catch {
        return null;
    }
}

async function downloadGif(url) {
    const tmpPath = path.join(process.cwd(), `rp_${Date.now()}.gif`);
    try {
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 15000 });
        fs.writeFileSync(tmpPath, Buffer.from(res.data));
        return tmpPath;
    } catch {
        return null;
    }
}

async function runRp(ctx, actionKey, action) {
    const { api, threadId, threadType, senderName, senderId, args, mentions } = ctx;

    const cd = checkCooldown(senderId, actionKey);
    if (cd) {
        return api.sendMessage({ msg: `⏳ Chờ ${cd}s trước khi dùng tiếp nhé!` }, threadId, threadType);
    }

    const targetId = mentions?.[0]?.uid || null;
    const targetName = mentions?.[0]?.displayName || args.join(" ").trim().replace(/^@/, "") || null;

    let text;
    if (targetId && targetId !== senderId) {
        if (!action.withTarget) {
            return api.sendMessage({ msg: "❌ Lệnh này không cần tag ai cả!" }, threadId, threadType);
        }
        text = action.withTarget.replace("{a}", senderName).replace("{t}", targetName);
    } else {
        if (!action.noTarget) {
            return api.sendMessage({ msg: "❌ Bạn cần tag một người để dùng lệnh này!" }, threadId, threadType);
        }
        text = action.noTarget.replace("{a}", senderName);
    }

    const gifUrl = await fetchGif(action.cat);
    if (!gifUrl) {
        return api.sendMessage({ msg: text }, threadId, threadType);
    }

    const tmpPath = await downloadGif(gifUrl);
    try {
        if (tmpPath) {
            await api.sendMessage({ msg: text, attachments: [tmpPath] }, threadId, threadType);
        } else {
            await api.sendMessage({ msg: `${text}\n🖼️ ${gifUrl}` }, threadId, threadType);
        }
    } finally {
        if (tmpPath && fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
}

const helpText = `[ 💖 ROLEPLAY GIF — RP ]
─────────────────────────
Gửi GIF anime cute kèm tin nhắn!

📌 Cú pháp: .ôm @ai | .hôn @ai | ...

🎯 Các hành động có thể dùng:
• .ôm @ai        — Ôm nhau 🤗
• .hôn @ai       — Hôn 💋
• .vỗ đầu @ai    — Vỗ đầu 🥰
• .tát @ai       — Tát 💢
• .cắn @ai       — Cắn 😬
• .khóc          — Khóc 😢
• .nhảy          — Nhảy 💃
• .đấm @ai       — Đấm 👊
• .liếm @ai      — Liếm 👅
• .cù @ai        — Cù 😂
• .chọc @ai      — Chọc 👉
• .bế @ai        — Bế 🫂
• .nắm tay @ai   — Nắm tay 💞
• .đỏ mặt [@ai]  — Đỏ mặt 😳
• .nom [@ai]     — Ăn 😋
• .hờn [@ai]     — Hờn 😒
• .ngủ           — Ngủ 😴
─────────────────────────`;

export const commands = {};

for (const [key, action] of Object.entries(ACTIONS)) {
    commands[key] = (ctx) => runRp(ctx, key, action);
}

commands["rp"] = async (ctx) => {
    await ctx.api.sendMessage({ msg: helpText }, ctx.threadId, ctx.threadType);
};
