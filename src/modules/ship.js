import { fs, path } from "../globals.js";

export const name        = "ship";
export const description = "Gửi bất kỳ file nào trong project đến người dùng (admin)";

// ── Cấu hình ────────────────────────────────────────────────────────────────
const ROOT = process.cwd();

// Thư mục/pattern bị loại trừ
const EXCLUDE_PATTERNS = [
    /node_modules/,
    /\/cache\//,
    /\/\.git\//,
    /\/launaMemory\//,
    /\/launaHistory\//,
    /autosend_history\.json/,
    /bot_stats\.json/,
    /\.log$/,
    /\.tmp$/
];

// Nhóm file theo loại (hiển thị)
const GROUP_LABELS = {
    modules:   "📦 Modules",
    events:    "⚡ Events",
    utils:     "🔧 Utils",
    data:      "📊 Data",
    assets:    "🖼️  Assets",
    root:      "📁 Root"
};

// ── Session chờ chọn số ──────────────────────────────────────────────────────
const shipCache = new Map();

// ── Helper: quét toàn bộ file trong project ──────────────────────────────────
function scanFiles(keyword = "") {
    const results = [];
    const kw = keyword.toLowerCase().trim();

    function walk(dir) {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
        catch { return; }

        for (const e of entries) {
            const fullPath = path.join(dir, e.name);
            const relPath  = path.relative(ROOT, fullPath);

            if (EXCLUDE_PATTERNS.some(p => p.test(fullPath))) continue;

            if (e.isDirectory()) {
                walk(fullPath);
            } else {
                if (kw && !relPath.toLowerCase().includes(kw)) continue;
                results.push(relPath);
            }
        }
    }

    walk(path.join(ROOT, "src"));
    // Thêm root files nếu cần
    for (const f of ["bot.js", "config.json", "package.json"]) {
        const rel = f;
        const full = path.join(ROOT, f);
        if (fs.existsSync(full) && (!kw || rel.toLowerCase().includes(kw))) {
            results.push(rel);
        }
    }

    return results.sort();
}

// ── Helper: phân nhóm danh sách file ────────────────────────────────────────
function groupFiles(files) {
    const groups = { modules: [], events: [], utils: [], data: [], assets: [], root: [] };

    for (const f of files) {
        if      (f.startsWith("src/modules"))      groups.modules.push(f);
        else if (f.startsWith("src/events"))       groups.events.push(f);
        else if (f.startsWith("src/utils"))        groups.utils.push(f);
        else if (f.startsWith("src/data"))         groups.data.push(f);
        else if (f.startsWith("src/assets"))       groups.assets.push(f);
        else                                       groups.root.push(f);
    }

    return groups;
}

// ── Helper: lấy target từ quote hoặc mention ────────────────────────────────
function getTargetFromCtx(ctx) {
    const { message } = ctx;
    const quote = message?.data?.quote;
    if (quote?.ownerId || quote?.uidFrom) {
        return String(quote.ownerId || quote.uidFrom);
    }
    // mention: @userId trong nội dung
    const mentions = message?.data?.mentions;
    if (mentions && Array.isArray(mentions) && mentions.length) {
        return String(mentions[0].uid || mentions[0].userId);
    }
    return null;
}

// ── Helper: build text danh sách ────────────────────────────────────────────
function buildListText(files, keyword) {
    if (!files.length) {
        return keyword
            ? `⚠️ Không tìm thấy file nào chứa "${keyword}"`
            : "⚠️ Không tìm thấy file nào trong project.";
    }

    const groups = groupFiles(files);
    const lines  = [];
    let   idx    = 1;
    const index  = [];  // [idx → relPath]

    for (const [key, label] of Object.entries(GROUP_LABELS)) {
        const list = groups[key];
        if (!list.length) continue;
        lines.push(`\n${label}`);
        lines.push("─".repeat(28));
        for (const f of list) {
            const name = path.basename(f);
            const dir  = path.dirname(f).replace(/^src\//, "");
            lines.push(`  ${String(idx).padStart(2, " ")}. ${name}  (${dir})`);
            index.push({ idx, relPath: f });
            idx++;
        }
    }

    const header = keyword
        ? `📦 Ship File — Kết quả: "${keyword}" (${files.length} file)\n`
        : `📦 Ship File — Tất cả file trong project (${files.length} file)\n`;

    return header + lines.join("\n") + "\n\n💡 Reply số để bot gửi file. Ví dụ: 3";
}

// ── isAdmin ──────────────────────────────────────────────────────────────────
function isAdmin(ctx) {
    return ctx.adminIds?.includes(String(ctx.senderId));
}

// ── Commands ─────────────────────────────────────────────────────────────────
export const commands = {
    /**
     * .ship                → list tất cả file
     * .ship <keyword>      → tìm file theo tên
     * .ship <keyword> @ai  → tìm + sẵn sàng gửi cho user được tag/reply
     */
    ship: async (ctx) => {
        const { api, threadId, threadType, senderId, args, message } = ctx;

        if (!isAdmin(ctx)) {
            return api.sendMessage(
                { msg: "⛔ Lệnh này chỉ dành cho admin bot!" },
                threadId, threadType
            );
        }

        const keyword = args.join(" ").trim();
        const files   = scanFiles(keyword);
        const target  = getTargetFromCtx(ctx);

        if (!files.length) {
            return api.sendMessage(
                { msg: keyword
                    ? `⚠️ Không tìm thấy file nào chứa "${keyword}". Thử từ khóa khác.`
                    : "⚠️ Không tìm thấy file nào trong project."
                },
                threadId, threadType
            );
        }

        // Build indexed list
        const groups = groupFiles(files);
        const index  = [];  // { relPath }
        for (const key of Object.keys(GROUP_LABELS)) {
            for (const f of (groups[key] || [])) index.push(f);
        }

        const text = buildListText(files, keyword);
        const sent = await api.sendMessage({ msg: text }, threadId, threadType);

        const msgId   = sent?.msgId || sent?.globalMsgId;
        const session = {
            index,
            target,
            senderId,
            timeout: setTimeout(() => {
                shipCache.delete(`${threadId}_${senderId}`);
                if (msgId) shipCache.delete(msgId);
            }, 120_000)
        };
        shipCache.set(`${threadId}_${senderId}`, session);
        if (msgId) shipCache.set(msgId, session);
    }
};

// ── Handle: người dùng reply số để gửi file ──────────────────────────────────
export async function handle(ctx) {
    const { api, threadId, threadType, senderId, content, message } = ctx;
    if (!content || message.isSelf) return false;
    if (!isAdmin(ctx)) return false;

    const quoteId = message?.data?.quote?.msgId || message?.data?.quote?.globalMsgId;
    const trimmed = content.trim();

    let session = null;
    if (quoteId && shipCache.has(quoteId)) {
        session = shipCache.get(quoteId);
    } else if (/^\d+$/.test(trimmed)) {
        session = shipCache.get(`${threadId}_${senderId}`);
    }

    if (!session || session.senderId !== senderId) return false;

    const num = parseInt(trimmed);
    if (isNaN(num) || num < 1 || num > session.index.length) return false;

    // Xóa session
    clearTimeout(session.timeout);
    shipCache.delete(`${threadId}_${senderId}`);
    if (quoteId) shipCache.delete(quoteId);

    const relPath  = session.index[num - 1];
    const fullPath = path.join(ROOT, relPath);
    const fileName = path.basename(fullPath);

    if (!fs.existsSync(fullPath)) {
        await api.sendMessage({ msg: `⚠️ File không tồn tại: ${relPath}` }, threadId, threadType);
        return true;
    }

    const stat = fs.statSync(fullPath);
    if (stat.size > 50 * 1024 * 1024) {
        await api.sendMessage({ msg: `⚠️ File quá lớn (${(stat.size / 1024 / 1024).toFixed(1)} MB). Giới hạn 50 MB.` }, threadId, threadType);
        return true;
    }

    await api.addReaction("📦", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => {});

    // Gửi file riêng tư cho admin (DM), không gửi vào group
    const dmId   = session.target || senderId;
    const caption = `📦 Ship: ${fileName}\n📁 ${relPath}\n📏 ${(stat.size / 1024).toFixed(1)} KB`;

    try {
        await api.sendMessage({ msg: caption, attachments: [fullPath] }, dmId, 0);
        await api.addReaction("✅", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => {});
        // Thông báo trong group (nếu lệnh dùng trong group)
        if (threadType !== 0) {
            await api.sendMessage(
                { msg: `📦 Đã gửi riêng file "${fileName}" vào tin nhắn riêng tư cho bạn!` },
                threadId, threadType
            );
        }
    } catch (e) {
        await api.addReaction("❌", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, threadType).catch(() => {});
        await api.sendMessage({ msg: `⚠️ Gửi file thất bại: ${e.message}` }, threadId, threadType);
    }

    return true;
}
