import os from "os";
import { fs, path, rentalManager } from "../globals.js";
import { ThreadType } from "zca-api";
import { drawUserInfo, drawMenuCanvas, drawCmdDetailCanvas } from "../utils/canvas/canvasHelper.js";


export const name = "general";
export const description = "Lệnh cơ bản: help, menu, info, system";

// ── Phân loại lệnh theo danh mục ──────────────────────────────────────────────
const CATEGORIES = [
    {
        key: "game", label: "🎮 GAME & RPG",
        modules: ["pokemon", "dnd", "gameserver", "quest", "achievement", "slots", "poker", "taixiu", "caro", "cotuong", "gamevui", "vuatiengviet", "fun", "noitu", "gd", "level"],
        desc: "Pokemon · DnD · Boss Raid · Quest · Slot · Poker · Cờ · Mini-games"
    },
    {
        key: "eco", label: "💰 KINH TẾ",
        modules: ["shop", "bank", "batchu", "rent", "tokenbudget"],
        desc: "Shop · Chuyển xu · Inventory · Danh hiệu · Ngân hàng"
    },
    {
        key: "media", label: "🎵 MEDIA & NHẠC",
        modules: ["yt", "tiktok", "spotify", "zing", "nct", "soundcloud", "sing", "capcut", "down", "hotMusic", "mixcloud", "pinterest", "yanhh", "media", "fbstory"],
        desc: "YouTube · TikTok · Spotify · Zing · Tải nhạc · Story"
    },
    {
        key: "ai", label: "🤖 AI & TRA CỨU",
        modules: ["duckai", "vdgai", "find", "wiki", "thoitiet", "giavang", "giaxang", "xsmb", "mail"],
        desc: "Chat AI · Vẽ AI · Wiki · Thời tiết · Giá vàng · XSMB"
    },
    {
        key: "social", label: "📱 MẠNG XÃ HỘI",
        modules: ["locket", "friends", "share", "xnhau", "ghepmat", "profile", "x", "stk", "poll"],
        desc: "Locket · Friends · Ghép mặt · Share · Story · Poll"
    },
    {
        key: "admin", label: "🛡️ QUẢN TRỊ",
        modules: ["admin", "kick", "mute", "block", "anti", "protection", "checktt", "duyetmem", "adc"],
        desc: "Kick · Mute · Anti-spam · Anti-link · Duyệt mem · Admin"
    },
    {
        key: "settings", label: "⚙️ CÀI ĐẶT",
        modules: ["setprefix", "autoreply", "shortcut", "scheduler", "autosend", "ghichu", "memory", "token", "proxy", "shell"],
        desc: "Prefix · Tự động trả lời · Lịch đăng · Ghi chú · Token"
    },
    {
        key: "info", label: "📊 THÔNG TIN",
        modules: ["general", "uptime", "chattools", "ff", "icon", "buff"],
        desc: "System · Uptime · Info user · ID · Thống kê"
    },
];

const HIDE = new Set(["help","menu","antilink","antispam","bj"]);

const CAT_KEYS = new Set(CATEGORIES.map(c => c.key));
const KNOWN_MODULES = new Set(CATEGORIES.flatMap(c => c.modules));

// Bỏ dấu tiếng Việt + lowercase + chuẩn hoá khoảng trắng để match alias.
function noDia(s) {
    return String(s || "")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .toLowerCase().trim().replace(/\s+/g, " ");
}

// Alias tiếng Việt cho các danh mục (đã bỏ dấu, lowercase).
const CAT_ALIASES = {
    "game": "game", "rpg": "game", "game rpg": "game", "game va rpg": "game",
    "kinh te": "eco", "kinhte": "eco", "eco": "eco", "tien": "eco",
    "media": "media", "nhac": "media", "media nhac": "media", "media va nhac": "media",
    "ai": "ai", "tra cuu": "ai", "tracuu": "ai", "ai tra cuu": "ai", "ai va tra cuu": "ai",
    "social": "social", "mxh": "social", "mang xa hoi": "social", "xa hoi": "social",
    "admin": "admin", "quan tri": "admin", "qt": "admin",
    "settings": "settings", "setting": "settings", "cai dat": "settings", "caidat": "settings",
    "info": "info", "thong tin": "info", "thongtin": "info", "tt": "info",
    "other": "other", "khac": "other", "khong phan loai": "other",
};

function chunkText(text, max = 1800) {
    if (text.length <= max) return [text];
    const lines = text.split("\n");
    const parts = [];
    let cur = "";
    for (const ln of lines) {
        if ((cur + ln + "\n").length > max && cur) { parts.push(cur.trimEnd()); cur = ""; }
        cur += ln + "\n";
    }
    if (cur.trim()) parts.push(cur.trimEnd());
    return parts;
}

function formatCmdList(cmds, prefix, perLine = 4) {
    const out = [];
    for (let i = 0; i < cmds.length; i += perLine) {
        out.push("  " + cmds.slice(i, i + perLine).map(c => `${prefix}${c}`).join("  "));
    }
    return out.join("\n");
}

async function reply(ctx, text, ttl = 0) {
    const res = await ctx.api.sendMessage(
        { msg: text, quote: ctx.message?.data, ttl },
        ctx.threadId,
        ctx.threadType
    );
    if (ttl > 0 && res?.message) {
        setTimeout(async () => {
            try {
                await ctx.api.undo({
                    msgId: res.message.msgId,
                    cliMsgId: res.message.cliMsgId
                }, ctx.threadId, ctx.threadType);
            } catch {}
        }, ttl);
    }
    return res;
}

function uptime() {
    const up = process.uptime();
    const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = Math.floor(up % 60);
    return `${h}h ${m}m ${s}s`;
}

async function sendCanvasImage(ctx, buffer, caption = "") {
    const { api, threadId, threadType } = ctx;
    const cacheDir = path.join(process.cwd(), ".cache");
    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
    const tmpFile = path.join(cacheDir, `menu_${Date.now()}.png`);
    fs.writeFileSync(tmpFile, buffer);
    try {
        await api.sendMessage({ msg: caption, attachments: [tmpFile] }, threadId, threadType);
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

export const commands = {
    // ── .help / .menu ──────────────────────────────────────────────────────────
    // Cú pháp:
    //   .help                → menu chính (danh mục)
    //   .help all            → toàn bộ lệnh, chia trang
    //   .help <danh mục>     → lệnh trong danh mục (game/eco/media/ai/social/admin/settings/info/other)
    //   .help <module>       → lệnh trong module cụ thể (vd: .help yt)
    //   .help <lệnh>         → chi tiết 1 lệnh
    //   .help txt            → bản text (dự phòng nếu canvas hỏng)
    help: async (ctx) => {
        const { moduleInfo = [], prefix, args } = ctx;
        const totalCmds = moduleInfo.reduce((s, m) => s + (m.commands?.filter(c => !HIDE.has(c)).length || 0), 0);

        // Tách flag txt khỏi phần còn lại; giữ nguyên args1 (chưa normalize) cho
        // phần lookup module/command (vốn là ASCII), còn `sub` đã noDia để
        // match alias tiếng Việt có dấu/space.
        const wantText = (args[0] || "").toLowerCase() === "txt" || (args[0] || "").toLowerCase() === "text";
        const rawArgs = wantText ? args.slice(1) : args;
        const args1   = (rawArgs[0] || "").toLowerCase().trim();
        const sub     = noDia(rawArgs.join(" "));
        const catKey  = CAT_ALIASES[sub];   // resolve tiếng Việt → key chuẩn

        // ── .help all ──────────────────────────────────────────────────────
        if (sub === "all") {
            if (wantText) return sendAllMenuText(ctx, moduleInfo, prefix, totalCmds);
            return sendAllMenuImage(ctx, moduleInfo, prefix, totalCmds);
        }

        // ── .help other / .help khác ───────────────────────────────────────
        if (catKey === "other") {
            if (wantText) return sendOtherMenu(ctx, moduleInfo, prefix);
            return sendOtherMenuImage(ctx, moduleInfo, prefix);
        }

        // ── .help <danh mục> (có alias tiếng Việt) ─────────────────────────
        if (catKey && CAT_KEYS.has(catKey)) {
            const cat = CATEGORIES.find(c => c.key === catKey);
            if (wantText) return sendCategoryMenuText(ctx, cat, moduleInfo, prefix);
            return sendCategoryMenuImage(ctx, cat, moduleInfo, prefix);
        }

        // ── .help <module> hoặc <lệnh> (single token, ASCII) ──────────────
        if (args1) {
            const mod = moduleInfo.find(m => m.name?.toLowerCase() === args1);
            if (mod) {
                if (wantText) return sendModuleDetail(ctx, mod, prefix);
                return sendModuleDetailImage(ctx, mod, prefix);
            }
            const cmdMod = moduleInfo.find(m => m.commands?.includes(args1));
            if (cmdMod) {
                if (wantText) return sendCmdDetail(ctx, args1, cmdMod, prefix);
                return sendCmdDetailImage(ctx, args1, cmdMod, prefix);
            }
            return reply(ctx,
                `❌ Không tìm thấy "${rawArgs.join(" ")}".\n` +
                `💡 Gõ ${prefix}help để xem menu, ${prefix}help all để xem toàn bộ lệnh.\n` +
                `📚 Danh mục: game · kinh tế · media · ai · mạng xã hội · quản trị · cài đặt · thông tin · khác`);
        }

        // ── Menu chính: canvas (mặc định) ──────────────────────────────────
        return sendImageMenu(ctx, moduleInfo, prefix, totalCmds);
    },

    hello: async (ctx) => {
        await reply(ctx, `👋 Xin chào ${ctx.senderName || ctx.senderId}!\n✨ Tôi là LauNa — Bot thông minh trên Zalo.\n💡 Gõ ${ctx.prefix}menu để xem danh sách tính năng!`);
    },

    info: async (ctx) => {
        const { api, threadId, threadType, senderId, args, message, adminIds, prefix } = ctx;

        let targetId = senderId;
        if (message.data?.mentions?.length > 0) {
            targetId = message.data.mentions[0].uid;
        } else if (message.data?.quote?.ownerId) {
            targetId = message.data.quote.ownerId;
        } else if (args[0] && /^\d+$/.test(args[0])) {
            targetId = args[0];
        } else if (args[0]) {
            // Tìm kiếm theo username (gộp từ findid)
            try {
                await api.sendMessage({ msg: `⏳ Đang tìm "${args[0]}"...` }, threadId, threadType);
                const res = await api.findUserByUsername(args[0]);
                const found = res?.profile || res;
                if (found && !found.error && (found.uid || found.userId)) {
                    targetId = found.uid || found.userId;
                } else {
                    return await reply(ctx, `❌ Không tìm thấy người dùng: ${args[0]}\n💡 Thử dùng ${prefix}find [SĐT] để tìm qua số điện thoại.`);
                }
            } catch (e) {
                return await reply(ctx, `⚠️ Lỗi tìm kiếm username: ${e.message}`);
            }
        }

        try {
            const result = await api.getUserInfo(String(targetId));
            if (!result || Object.keys(result).length === 0) {
                return reply(ctx, `⚠️ Không tìm thấy thông tin cho ID: ${targetId}`);
            }

            const profiles = result.changed_profiles || result;
            const user = profiles[String(targetId)] || Object.values(profiles)[0] || result;

            if (!user || !user.userId) {
                return reply(ctx, `⚠️ Không tìm thấy thông tin cho ID: ${targetId}`);
            }

            const displayName = user.zaloName || user.displayName || "Không rõ";
            const avatar = user.avatar || "";

            let genderStr = "Không rõ";
            if (user.gender === 0) genderStr = "🚹 Nam";
            else if (user.gender === 1) genderStr = "🚺 Nữ";

            let bdayStr = "Ẩn";
            if (user.sdob) bdayStr = user.sdob;
            else if (user.dob && user.dob !== 0) bdayStr = `${user.dob}`;

            let onlineStr = "Không rõ";
            if (user.lastActionTime) {
                const diff = Math.floor((Date.now() - user.lastActionTime) / 60000);
                if (diff < 2) onlineStr = "🟢 Đang online";
                else if (diff < 60) onlineStr = `🟡 ${diff} phút trước`;
                else if (diff < 1440) onlineStr = `🔴 ${Math.floor(diff / 60)} giờ trước`;
                else onlineStr = `⚫ ${Math.floor(diff / 1440)} ngày trước`;
            }
            if (user.isActive === 1 || user.isActivePC === 1) {
                const diff = Math.floor((Date.now() - user.lastActionTime) / 60000);
                if (diff < 5) onlineStr = "🟢 Đang online";
            }

            const type = ctx.isGroup ? "Nhóm" : "Cá nhân";
            const expiry = rentalManager.getExpiry(ctx.threadId);

            const fields = [
                { icon: "🆔", label: "UID", value: String(targetId) },
                { icon: user.gender === 0 ? "🚹" : "🚺", label: "Giới tính", value: genderStr.replace(/🚹 |🚺 /g, "") },
                { icon: "🟢", label: "Trạng thái", value: onlineStr.replace(/🟢 |🟡 |🔴 |⚫ /g, "") },
                { icon: "🎂", label: "Sinh nhật", value: bdayStr },
            ];
            if (user.phoneNumber) fields.push({ icon: "📱", label: "SĐT", value: user.phoneNumber });
            if (user.createdTs) {
                const createdDate = new Date(user.createdTs * 1000).toLocaleDateString("vi-VN");
                fields.push({ icon: "📅", label: "Ngày tạo", value: createdDate });
            }
            fields.push({ icon: "📂", label: "Thread", value: `${threadId.slice(0, 12)}... (${type})` });
            fields.push({ icon: "⏳", label: "Hạn Bot", value: expiry });

            const buffer = await drawUserInfo({
                displayName,
                username: user.username || "",
                avatar,
                bio: user.status || "",
                onlineStatus: onlineStr.includes("Đang online") ? "online" : "offline",
                fields
            });

            if (!buffer) {
                const infoText =
                    `[ 👤 THÔNG TIN USER ]\n${"─".repeat(28)}\n` +
                    `🆔 UID: ${targetId}\n` +
                    `👤 Tên: ${displayName}\n` +
                    fields.map(f => `${f.icon} ${f.label}: ${f.value}`).join("\n");
                return await reply(ctx, infoText);
            }
            const cacheDir = path.join(process.cwd(), ".cache");
            if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
            const tmpFile = path.join(cacheDir, `info_card_${Date.now()}.png`);
            fs.writeFileSync(tmpFile, buffer);
            try {
                await api.sendMessage({ msg: `👤 Info: ${displayName}`, attachments: [tmpFile] }, threadId, threadType);
            } finally {
                if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
            }
        } catch (e) {
            console.error("[INFO CMD ERROR]", e);
            await reply(ctx, `⚠️ Không thể lấy thông tin user: ${e.message}`);
        }
    },

    system: async (ctx) => {
        const { moduleInfo, eventHandlers } = ctx;

        // ── Uptime bot ────────────────────────────────────────────────────────
        const up = process.uptime();
        const d  = Math.floor(up / 86400);
        const h  = Math.floor((up % 86400) / 3600);
        const m  = Math.floor((up % 3600) / 60);
        const s  = Math.floor(up % 60);
        const uptimeStr = `${d > 0 ? d + "d " : ""}${h}h ${m}m ${s}s`;

        // ── Node.js memory ────────────────────────────────────────────────────
        const mem      = process.memoryUsage();
        const rss      = (mem.rss      / 1024 / 1024).toFixed(1);
        const heapUsed = (mem.heapUsed / 1024 / 1024).toFixed(1);
        const heapTotal= (mem.heapTotal/ 1024 / 1024).toFixed(1);
        const external = (mem.external / 1024 / 1024).toFixed(1);

        // ── RAM hệ thống ──────────────────────────────────────────────────────
        const totalRam = os.totalmem();
        const freeRam  = os.freemem();
        const usedRam  = totalRam - freeRam;
        const ramPct   = ((usedRam / totalRam) * 100).toFixed(1);
        const toGB     = (b) => (b / 1024 / 1024 / 1024).toFixed(2);
        const ramBar   = (() => {
            const filled = Math.round(ramPct / 10);
            return "█".repeat(filled) + "░".repeat(10 - filled);
        })();

        // ── CPU ───────────────────────────────────────────────────────────────
        const cpus    = os.cpus();
        const cpuName = cpus[0]?.model?.trim() || "Unknown";
        const cores   = cpus.length;
        const load    = os.loadavg();
        const cpuPct  = Math.min(100, (load[0] / cores) * 100).toFixed(1);
        const cpuBar  = (() => {
            const filled = Math.round(cpuPct / 10);
            return "█".repeat(filled) + "░".repeat(10 - filled);
        })();

        // ── Hệ thống uptime (server) ──────────────────────────────────────────
        const sysUp  = os.uptime();
        const sd     = Math.floor(sysUp / 86400);
        const sh     = Math.floor((sysUp % 86400) / 3600);
        const sm     = Math.floor((sysUp % 3600) / 60);
        const sysStr = `${sd > 0 ? sd + "d " : ""}${sh}h ${sm}m`;

        // ── Cảnh báo RAM ──────────────────────────────────────────────────────
        const ramWarn = parseFloat(rss) > 800
            ? "\n⚠️ RAM Bot cao! Cân nhắc khởi động lại."
            : parseFloat(ramPct) > 85
            ? "\n⚠️ RAM Server gần đầy!"
            : "";

        const msg =
            `[ ⚙️ HỆ THỐNG BOT ]\n` +
            `─────────────────\n` +
            `🕐 Bot uptime  : ${uptimeStr}\n` +
            `🖥️  Server up   : ${sysStr}\n` +
            `─────────────────\n` +
            `🧠 RAM Server\n` +
            `   [${ramBar}] ${ramPct}%\n` +
            `   Đã dùng : ${toGB(usedRam)} GB\n` +
            `   Còn lại : ${toGB(freeRam)} GB\n` +
            `   Tổng    : ${toGB(totalRam)} GB\n` +
            `─────────────────\n` +
            `📦 RAM Node.js\n` +
            `   RSS     : ${rss} MB\n` +
            `   Heap    : ${heapUsed} / ${heapTotal} MB\n` +
            `   External: ${external} MB\n` +
            `─────────────────\n` +
            `⚡ CPU: ${cpuName}\n` +
            `   Cores   : ${cores} lõi\n` +
            `   Load    : [${cpuBar}] ${cpuPct}%\n` +
            `   Load avg: ${load.map(l => l.toFixed(2)).join(" / ")} (1/5/15m)\n` +
            `─────────────────\n` +
            `🔧 Node.js  : ${process.version}\n` +
            `💻 OS       : ${os.platform()} ${os.arch()}\n` +
            `📦 Modules  : ${moduleInfo?.length ?? 0}\n` +
            `🎯 Events   : ${eventHandlers?.length ?? 0}` +
            ramWarn;

        await reply(ctx, msg);
    },

    id: async (ctx) => {
        const { api, message, senderId, threadId, threadType } = ctx;

        let id = senderId;
        let targetNameText = "bạn";

        if (message.data?.mentions?.length > 0) {
            id = message.data.mentions[0].uid;
            targetNameText = "người được tag";
        } else if (message.data?.quote) {
            id = message.data.quote.ownerId;
            targetNameText = "người được reply";
        }

        let realName = "";
        try {
            const result = await api.getUserInfo(String(id));
            const user = result[id] || Object.values(result)[0];
            if (user) realName = `\n👤 Tên: ${user.displayName || user.zaloName || "Không rõ"}`;
        } catch { }

        return ctx.api.sendMessage({ msg: `🆔 ID của ${targetNameText} là: ${id}${realName}` }, threadId, threadType);
    },
};

commands.getinfo = commands.info;
commands.menu = commands.help;

// ── Menu dạng ảnh (canvas) — chỉ chạy khi user gõ .help img ──────────────────
async function sendImageMenu(ctx, moduleInfo, prefix, totalCmds) {
    const groups = CATEGORIES.map(c => {
        const cmdCount = moduleInfo.filter(m => c.modules.includes(m.name))
            .reduce((s, m) => s + (m.commands?.filter(x => !HIDE.has(x)).length || 0), 0);
        const parts = c.label.split(" ");
        return { icon: parts[0], name: parts.slice(1).join(" "), count: cmdCount, cmds: c.desc };
    });
    try {
        const buffer = await drawMenuCanvas(groups, { totalCmds, prefix, uptime: uptime(), page: 1, totalPages: 1 });
        if (buffer) return await sendCanvasImage(ctx, buffer, `🌸 LAUNA BOT — MENU\n💡 ${prefix}help <danh mục>`);
    } catch (e) { console.error("[MENU CANVAS ERROR]", e.message); }
    return reply(ctx, `⚠️ Không tạo được ảnh menu. Dùng ${prefix}help (text) thay thế.`);
}

// ── Lệnh trong 1 danh mục, dạng text gọn ─────────────────────────────────────
async function sendCategoryMenuText(ctx, cat, moduleInfo, prefix) {
    const mods = moduleInfo.filter(m => cat.modules.includes(m.name) && m.commands?.some(c => !HIDE.has(c)));
    if (!mods.length) return reply(ctx, `⚠️ Danh mục "${cat.key}" chưa có module nào.`);

    let msg = `${cat.label}\n─────────────────────\n`;
    let total = 0;
    for (const mod of mods) {
        const cmds = mod.commands.filter(c => !HIDE.has(c));
        if (!cmds.length) continue;
        total += cmds.length;
        msg += `${getModuleIcon(mod.name)} ${mod.name.toUpperCase()} (${cmds.length})\n`;
        msg += formatCmdList(cmds, prefix) + "\n";
    }
    msg += `─────────────────────\n📊 ${total} lệnh · 💡 ${prefix}help <lệnh>`;

    for (const part of chunkText(msg)) await reply(ctx, part, 180000);
}

// ── Lệnh trong 1 module ──────────────────────────────────────────────────────
async function sendModuleDetail(ctx, mod, prefix) {
    const cmds = (mod.commands || []).filter(c => !HIDE.has(c));
    let msg = `${getModuleIcon(mod.name)} MODULE: ${mod.name.toUpperCase()}\n`;
    if (mod.description) msg += `📝 ${mod.description}\n`;
    msg += `─────────────────────\n`;
    msg += cmds.length ? formatCmdList(cmds, prefix) : "  (không có lệnh)";
    msg += `\n─────────────────────\n📊 ${cmds.length} lệnh · 💡 ${prefix}help <lệnh>`;
    return reply(ctx, msg, 180000);
}

// ── Chi tiết 1 lệnh ──────────────────────────────────────────────────────────
async function sendCmdDetail(ctx, cmdName, mod, prefix) {
    const related = (mod.commands || []).filter(c => !HIDE.has(c) && c !== cmdName);
    let msg = `💡 LỆNH: ${prefix}${cmdName}\n`;
    msg += `📦 Module: ${mod.name}\n`;
    msg += `📝 ${mod.description || "Không có mô tả."}\n`;
    if (related.length) {
        msg += `─────────────────────\n🔗 Lệnh liên quan:\n${formatCmdList(related, prefix)}`;
    }
    return reply(ctx, msg, 180000);
}

// ── Module chưa được phân danh mục ───────────────────────────────────────────
async function sendOtherMenu(ctx, moduleInfo, prefix) {
    const mods = moduleInfo.filter(m => !KNOWN_MODULES.has(m.name) && m.commands?.some(c => !HIDE.has(c)));
    if (!mods.length) return reply(ctx, `✅ Mọi module đều đã được phân danh mục.`);

    let msg = `📦 MODULE KHÁC\n─────────────────────\n`;
    let total = 0;
    for (const mod of mods) {
        const cmds = mod.commands.filter(c => !HIDE.has(c));
        total += cmds.length;
        msg += `${getModuleIcon(mod.name)} ${mod.name.toUpperCase()} (${cmds.length})\n`;
        msg += formatCmdList(cmds, prefix) + "\n";
    }
    msg += `─────────────────────\n📊 ${total} lệnh`;
    for (const part of chunkText(msg)) await reply(ctx, part, 180000);
}

// ── Tất cả lệnh dạng text, tự chia trang ─────────────────────────────────────
async function sendAllMenuText(ctx, moduleInfo, prefix, totalCmds) {
    const blocks = [];
    for (const cat of CATEGORIES) {
        const mods = moduleInfo.filter(m => cat.modules.includes(m.name) && m.commands?.some(c => !HIDE.has(c)));
        if (!mods.length) continue;
        let block = `${cat.label}\n`;
        for (const mod of mods) {
            const cmds = mod.commands.filter(c => !HIDE.has(c));
            block += `  ${getModuleIcon(mod.name)} ${mod.name}: ${cmds.map(c => prefix + c).join(" ")}\n`;
        }
        blocks.push(block);
    }
    const otherMods = moduleInfo.filter(m => !KNOWN_MODULES.has(m.name) && m.commands?.some(c => !HIDE.has(c)));
    if (otherMods.length) {
        let block = `📦 KHÁC\n`;
        for (const mod of otherMods) {
            const cmds = mod.commands.filter(c => !HIDE.has(c));
            block += `  ${getModuleIcon(mod.name)} ${mod.name}: ${cmds.map(c => prefix + c).join(" ")}\n`;
        }
        blocks.push(block);
    }

    const header = `📋 TẤT CẢ LỆNH (${totalCmds}) · ⏱️ ${uptime()}\n─────────────────────\n`;
    const footer = `─────────────────────\n💡 ${prefix}help <lệnh> để xem chi tiết`;
    const full = header + blocks.join("─────────────────────\n") + footer;

    const parts = chunkText(full, 1800);
    for (let i = 0; i < parts.length; i++) {
        const tag = parts.length > 1 ? `\n[Trang ${i + 1}/${parts.length}]` : "";
        await reply(ctx, parts[i] + tag, 180000);
        if (i < parts.length - 1) await new Promise(r => setTimeout(r, 250));
    }
}

// ── Chi tiết 1 module dạng ảnh (canvas) ──────────────────────────────────────
async function sendModuleDetailImage(ctx, mod, prefix) {
    const cmds = (mod.commands || []).filter(c => !HIDE.has(c));
    try {
        const groups = [{
            icon: getModuleIcon(mod.name),
            name: mod.name.toUpperCase(),
            count: cmds.length,
            cmds: cmds.length ? cmds.map(c => `${prefix}${c}`).join("  ·  ") : "(không có lệnh)"
        }];
        const buffer = await drawMenuCanvas(groups, {
            totalCmds: cmds.length, prefix, uptime: uptime(),
            allMode: cmds.length > 12, title: `📦  ${mod.name.toUpperCase()}`
        });
        if (buffer) {
            const cap = `📦 ${mod.name.toUpperCase()}\n${mod.description ? "📝 " + mod.description + "\n" : ""}📊 ${cmds.length} lệnh · 💡 ${prefix}help <lệnh>`;
            return await sendCanvasImage(ctx, buffer, cap);
        }
    } catch (e) { console.error("[MODULE CANVAS ERROR]", e.message); }
    return sendModuleDetail(ctx, mod, prefix);
}

// ── Chi tiết 1 lệnh dạng ảnh (canvas) ────────────────────────────────────────
async function sendCmdDetailImage(ctx, cmdName, mod, prefix) {
    try {
        const related = (mod.commands || []).filter(c => !HIDE.has(c));
        const buffer = await drawCmdDetailCanvas({
            cmdName, moduleName: mod.name,
            description: mod.description || "Không có mô tả.",
            relatedCmds: related, prefix
        });
        if (buffer) {
            return await sendCanvasImage(ctx, buffer,
                `💡 ${prefix}${cmdName}  ·  ${mod.name}\n📝 ${mod.description || "Không có mô tả."}`);
        }
    } catch (e) { console.error("[CMD DETAIL CANVAS ERROR]", e.message); }
    return sendCmdDetail(ctx, cmdName, mod, prefix);
}

// ── Module chưa phân danh mục, dạng ảnh ──────────────────────────────────────
async function sendOtherMenuImage(ctx, moduleInfo, prefix) {
    const mods = moduleInfo.filter(m => !KNOWN_MODULES.has(m.name) && m.commands?.some(c => !HIDE.has(c)));
    if (!mods.length) return reply(ctx, `✅ Mọi module đều đã được phân danh mục.`);
    const groups = [];
    let total = 0;
    for (const mod of mods) {
        const cmds = mod.commands.filter(c => !HIDE.has(c));
        total += cmds.length;
        groups.push({
            icon: getModuleIcon(mod.name),
            name: mod.name.toUpperCase(),
            count: cmds.length,
            cmds: cmds.map(c => `${prefix}${c}`).join("  ·  ")
        });
    }
    try {
        const buffer = await drawMenuCanvas(groups, {
            totalCmds: total, prefix, uptime: uptime(),
            allMode: groups.length > 6, title: "📦  KHÁC"
        });
        if (buffer) return await sendCanvasImage(ctx, buffer, `📦 MODULE KHÁC\n📊 ${total} lệnh · 💡 ${prefix}help <lệnh>`);
    } catch (e) { console.error("[OTHER CANVAS ERROR]", e.message); }
    return sendOtherMenu(ctx, moduleInfo, prefix);
}

// ── Lệnh trong 1 danh mục, dạng ảnh ─────────────────────────────────────────
async function sendCategoryMenuImage(ctx, cat, moduleInfo, prefix) {
    const mods = moduleInfo?.filter(m => cat.modules.includes(m.name)) || [];
    if (!mods.length) return reply(ctx, `⚠️ Chưa có module nào trong danh mục này.`);

    const groups = [];
    for (const mod of mods) {
        const visible = mod.commands.filter(c => !HIDE.has(c));
        if (!visible.length) continue;
        groups.push({
            icon: getModuleIcon(mod.name.toLowerCase()),
            name: mod.name.toUpperCase(),
            count: visible.length,
            cmds: visible.map(c => `${prefix}${c}`).join("  ·  ")
        });
    }
    const total = groups.reduce((s, g) => s + g.count, 0);

    try {
        const catParts = cat.label.split(" ");
        const buffer = await drawMenuCanvas(groups, {
            totalCmds: total, prefix, uptime: uptime(),
            allMode: groups.length > 6,
            title: `${catParts[0]}  ${catParts.slice(1).join(" ")}`
        });
        if (buffer) return await sendCanvasImage(ctx, buffer, `${cat.label}\n📊 ${total} lệnh · 💡 ${prefix}help <lệnh>`);
    } catch (e) { console.error("[CATEGORY CANVAS ERROR]", e.message); }
    return sendCategoryMenuText(ctx, cat, moduleInfo, prefix);
}

// ── Toàn bộ lệnh dạng ảnh (canvas) ──────────────────────────────────────────
// Card width có hạn (~410px) + fitText() cắt cụt 1 dòng → phải chia nhỏ
// commands của từng module thành nhiều card (≤ 6 lệnh / card) rồi paginate.
const ALL_MENU_PER_PAGE  = 14;
const ALL_MENU_CMDS_CARD = 6;

async function sendAllMenuImage(ctx, moduleInfo, prefix, totalCmds) {
    // 1. Sắp các module theo danh mục cho gọn
    const ordered = [];
    const seen    = new Set();
    for (const cat of CATEGORIES) {
        for (const modName of cat.modules) {
            const mod = moduleInfo.find(m => m.name === modName);
            if (!mod || seen.has(mod.name)) continue;
            const cmds = (mod.commands || []).filter(c => !HIDE.has(c));
            if (!cmds.length) continue;
            seen.add(mod.name);
            ordered.push({ mod, cmds });
        }
    }
    for (const mod of moduleInfo) {
        if (seen.has(mod.name)) continue;
        const cmds = (mod.commands || []).filter(c => !HIDE.has(c));
        if (!cmds.length) continue;
        ordered.push({ mod, cmds });
    }
    if (!ordered.length) return reply(ctx, `⚠️ Không có module nào để hiển thị.`);

    // 2. Mỗi module → 1 hoặc nhiều card (mỗi card ≤ ALL_MENU_CMDS_CARD lệnh)
    const cards = [];
    for (const { mod, cmds } of ordered) {
        const chunks = [];
        for (let i = 0; i < cmds.length; i += ALL_MENU_CMDS_CARD) {
            chunks.push(cmds.slice(i, i + ALL_MENU_CMDS_CARD));
        }
        chunks.forEach((chunk, idx) => {
            const suffix = chunks.length > 1 ? ` (${idx + 1}/${chunks.length})` : "";
            cards.push({
                icon:  getModuleIcon(mod.name),
                name:  mod.name.toUpperCase() + suffix,
                count: idx === 0 ? cmds.length : chunk.length,
                cmds:  chunk.map(c => `${prefix}${c}`).join("  ·  "),
            });
        });
    }

    // 3. Paginate cards
    const totalPages = Math.max(1, Math.ceil(cards.length / ALL_MENU_PER_PAGE));
    let sentAny = false;

    for (let p = 0; p < totalPages; p++) {
        const slice = cards.slice(p * ALL_MENU_PER_PAGE, (p + 1) * ALL_MENU_PER_PAGE);
        try {
            const buffer = await drawMenuCanvas(slice, {
                totalCmds, prefix, uptime: uptime(),
                page: p + 1, totalPages,
                allMode: true,
                title: `📋  TẤT CẢ LỆNH  ·  ${p + 1}/${totalPages}`,
            });
            if (buffer) {
                const cap = p === 0
                    ? `📋 TẤT CẢ LỆNH — ${totalCmds} lệnh / ${ordered.length} module / ${totalPages} trang\n💡 ${prefix}help <module>  ·  ${prefix}help <lệnh>`
                    : `📋 Trang ${p + 1}/${totalPages}`;
                await sendCanvasImage(ctx, buffer, cap);
                sentAny = true;
            }
        } catch (e) { console.error("[ALL MENU CANVAS ERROR]", e.message); }
    }

    if (!sentAny) return sendAllMenuText(ctx, moduleInfo, prefix, totalCmds);
}

// ── Icon theo tên module ───────────────────────────────────────────────────────
const MODULE_ICONS = {
    admin: "🛡️", anti: "🚫", autoreply: "💬", autosend: "📤",
    batchu: "🔤", block: "🔒", buff: "💪", call: "📞",
    capcut: "🎬", caro: "♟️", chattools: "🔧", checktt: "✅",
    cotuong: "♜",  down: "📥",    duckai: "🤖",  fbstory: "📱",
    find: "🔍",    friends: "👥", fun: "😄",     gamevui: "🎮",
    gdrive: "💾",  general: "📖", ghepmat: "🖼️", ghichu: "📝",
    giavang: "🥇", giaxang: "⛽", group: "👥",   hotMusic: "🔥",
    icon: "😊",    kick: "👢",    launa: "🌸",   locket: "💞",
    mail: "📧",    media: "🎥",   memory: "💭",  mixcloud: "🎧",
    mute: "🔕",    multiprovider: "🌐", nct: "🎵", noitu: "📝",
    pinterest: "📌", poll: "📊",  profile: "👤", proxy: "🌐",
    rent: "💰",    scheduler: "⏰", setprefix: "⚙️", share: "🔗",
    shell: "💻",   shortcut: "⚡", sing: "🎶",  soundcloud: "☁️",
    spotify: "🎵", stk: "🏷️",    taixiu: "🎲",  thoitiet: "🌤️",
    thuhoi: "↩️",  tiktok: "📹",  token: "🔑",  tokenbudget: "💳",
    uptime: "⏱️",  vdgai: "🤖",   vuatiengviet: "🏆", wiki: "📚",
    x: "🐦",       xnhau: "🥂",   xsmb: "🎯",   yanhh: "🖼️", yt: "▶️",
    zing: "🎼",    duyetmem: "✔️", note: "📋",   adc: "📢",
    // Game modules mới
    pokemon: "🎣",  dnd: "⚔️",    gameserver: "🌐", quest: "📋",
    achievement: "🏆", slots: "🎰", poker: "🃏",  level: "⭐",
    shop: "🏪",    bank: "🏦",    gd: "🎮",
};

function getModuleIcon(name) {
    return MODULE_ICONS[name?.toLowerCase()] || "◈";
}
