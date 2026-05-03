//cc
import { log, fs, path } from "../globals.js";
import axios from "axios";
import { v4 as uuidv4 } from "uuid";
import { registerReaction } from "../utils/core/reactionRegistry.js";

export const name = "adc";
export const description = "Upload hoặc thay thế code file trên server";

const ROOT = process.cwd();

function send(ctx, msg) {
    return ctx.api.sendMessage({ msg, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

// ── Thư mục bỏ qua ───────────────────────────────────────────────────────────
const SKIP_DIRS = new Set([
    "node_modules", ".git", ".next", "dist", "build", ".replit-cache"
]);

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

const GROUP_LABELS = {
    modules: "📦 Modules",
    events:  "⚡ Events",
    utils:   "🔧 Utils",
    data:    "📊 Data",
    assets:  "🖼️  Assets",
    root:    "📁 Root"
};

// ── Session cho lệnh adc <file> <url> khi có nhiều kết quả ───────────────────
const adcCache = new Map();

// ── Quét toàn bộ file trong project (giống ship) ─────────────────────────────
function scanAllFiles(keyword = "") {
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
            if (SKIP_DIRS.has(e.name)) continue;

            if (e.isDirectory()) {
                walk(fullPath);
            } else {
                if (kw && !relPath.toLowerCase().includes(kw)) continue;
                results.push(relPath);
            }
        }
    }

    walk(path.join(ROOT, "src"));

    for (const f of ["bot.js", "config.json", "package.json"]) {
        const full = path.join(ROOT, f);
        if (fs.existsSync(full) && (!kw || f.toLowerCase().includes(kw))) {
            results.push(f);
        }
    }

    return results.sort();
}

// ── Tìm file theo tên chính xác / gần đúng trên toàn project ─────────────────
function findFile(filename, startDir = ROOT) {
    const exactMatches = [];
    const nameMatches  = [];

    function searchRecursive(dir, depth = 0) {
        if (depth > 8) return;
        try {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                if (SKIP_DIRS.has(item)) continue;
                const fullPath = path.join(dir, item);
                let stat;
                try { stat = fs.statSync(fullPath); } catch { continue; }
                if (stat.isFile()) {
                    const isInModules = fullPath.includes("modules");
                    const fileInfo = { path: fullPath, isInModules };
                    if (item === filename) {
                        exactMatches.push(fileInfo);
                    } else if (path.parse(item).name === path.parse(filename).name) {
                        nameMatches.push(fileInfo);
                    }
                } else if (stat.isDirectory()) {
                    searchRecursive(fullPath, depth + 1);
                }
            }
        } catch { }
    }

    searchRecursive(startDir);

    const sortByPriority = arr => arr.sort((a, b) => b.isInModules - a.isInModules);
    return [
        ...sortByPriority(exactMatches).map(f => f.path),
        ...sortByPriority(nameMatches).map(f => f.path)
    ];
}

// ── Phân nhóm danh sách file ──────────────────────────────────────────────────
function groupFiles(files) {
    const groups = { modules: [], events: [], utils: [], data: [], assets: [], root: [] };
    for (const f of files) {
        if      (f.startsWith("src/modules")) groups.modules.push(f);
        else if (f.startsWith("src/events"))  groups.events.push(f);
        else if (f.startsWith("src/utils"))   groups.utils.push(f);
        else if (f.startsWith("src/data"))    groups.data.push(f);
        else if (f.startsWith("src/assets"))  groups.assets.push(f);
        else                                  groups.root.push(f);
    }
    return groups;
}

// ── Build text danh sách ──────────────────────────────────────────────────────
function buildListText(files, keyword, url) {
    const groups = groupFiles(files);
    const lines  = [];
    let   idx    = 1;
    const index  = [];

    for (const [key, label] of Object.entries(GROUP_LABELS)) {
        const list = groups[key];
        if (!list.length) continue;
        lines.push(`\n${label}`);
        lines.push("─".repeat(28));
        for (const f of list) {
            const fname = path.basename(f);
            const dir   = path.dirname(f).replace(/^src\//, "");
            lines.push(`  ${String(idx).padStart(2, " ")}. ${fname}  (${dir})`);
            index.push(f);
            idx++;
        }
    }

    const header = keyword
        ? `[ 📝 ADC IMPORT ]\nTìm "${keyword}" — ${files.length} file\n🔗 ${url}\n`
        : `[ 📝 ADC IMPORT ]\nTất cả file — ${files.length} file\n🔗 ${url}\n`;

    return {
        text:  header + lines.join("\n") + "\n\n💡 Reply số để chọn file ghi đè. Ví dụ: 3",
        index
    };
}

// ── Thực hiện download URL và ghi đè file ────────────────────────────────────
async function doImport({ api, threadId, threadType, filePath, rawUrl, url, ctx }) {
    const relative = path.relative(ROOT, filePath);

    const sent = await api.sendMessage(
        {
            msg:
                `[ 📝 CODE IMPORT ]\n` +
                `─────────────────\n` +
                `📁 File: ${relative}\n\n` +
                `🔗 Nguồn:\n${url}\n` +
                `─────────────────\n` +
                `📌 Thả cảm xúc để tải & ghi đè file`,
            quote: ctx.message.data,
        },
        threadId,
        threadType
    );

    const sentMsgId    = sent?.message?.data?.globalMsgId || sent?.message?.globalMsgId || sent?.message?.data?.msgId || sent?.message?.msgId;
    const sentCliMsgId = sent?.message?.data?.cliMsgId || sent?.message?.cliMsgId;

    if (!sentMsgId) return;

    registerReaction(String(sentMsgId), {
        ttl: 5 * 60 * 1000,
        senderId: String(ctx.message.data?.uidFrom || ctx.message.data?.senderId || ""),
        handler: async ({ api: rApi }) => {
            let newContent;
            try {
                newContent = (await axios.get(rawUrl, {
                    timeout: 12000,
                    headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
                })).data;
            } catch (e) {
                await rApi.sendMessage({ msg: `❌ Tải nội dung thất bại: ${e.message}` }, threadId, threadType);
                return;
            }

            const fileBody = typeof newContent === "string" ? newContent : JSON.stringify(newContent, null, 2);
            try {
                fs.mkdirSync(path.dirname(filePath), { recursive: true });
                fs.writeFileSync(filePath, fileBody);
            } catch (e) {
                await rApi.sendMessage({ msg: `❌ Ghi file thất bại: ${e.message}` }, threadId, threadType);
                return;
            }

            let reloaded = false;
            try {
                const { pathToFileURL } = await import("node:url");
                const modUrl = pathToFileURL(filePath).href + "?t=" + Date.now();
                const newMod = await import(modUrl);
                if (newMod.commands && ctx.allCommands) {
                    for (const [cmd, handler] of Object.entries(newMod.commands)) {
                        ctx.allCommands[cmd] = handler;
                    }
                    reloaded = true;
                }
            } catch { }

            try {
                if (sentMsgId && sentCliMsgId) {
                    await rApi.undoMessage({ msgId: sentMsgId, cliMsgId: sentCliMsgId, threadId, type: threadType }, threadId, threadType);
                }
            } catch { }

            await rApi.sendMessage(
                {
                    msg:
                        `[ ✅ GHI ĐÈ THÀNH CÔNG ]\n` +
                        `─────────────────\n` +
                        `📁 File: ${relative}\n` +
                        `🔄 Hot-reload: ${reloaded ? "✅ Đã load vào RAM" : "⚠️ Cần restart bot"}\n` +
                        `⏰ ${new Date().toLocaleString("vi-VN")}\n` +
                        `─────────────────`,
                },
                threadId,
                threadType
            );
        },
    });
}

// ── Chuẩn hoá raw URL ─────────────────────────────────────────────────────────
function toRawUrl(url) {
    if (/pastebin\.com\/(?!raw\/)/.test(url)) {
        return url.replace("pastebin.com/", "pastebin.com/raw/");
    }
    if (!url.includes("/raw/") && !url.includes("raw=true")) {
        return url.includes("?") ? url + "&raw=true" : url + "?raw=true";
    }
    return url;
}

// ── Commands ──────────────────────────────────────────────────────────────────
export const commands = {

    adc: async (ctx) => {
        const { args, threadId, threadType, prefix, message, api } = ctx;

        let filename = args[0];
        let url      = args[1];

        const quote = message?.data?.quote;

        // adc add <file> → reply URL
        if (filename === "add") {
            filename = args[1];
            url = quote?.msg?.trim() || quote?.content?.trim();
            if (!filename) return send(ctx, `❌ Thiếu tên file. Dùng: ${prefix}adc add <file>`);
            if (!url || !url.startsWith("http")) return send(ctx, `❌ Vui lòng reply một tin nhắn chứa URL hợp lệ.`);
        }

        if (!filename) {
            return send(ctx,
                `[ 📝 ADC TOOL ]\n` +
                `─────────────────\n` +
                `1. ${prefix}adc <file>\n` +
                `➥ Xuất code file\n\n` +
                `2. ${prefix}adc <file> <url>\n` +
                `➥ Tìm & ghi đè file trên toàn project\n\n` +
                `3. ${prefix}adc add <file>\n` +
                `➥ Reply link để tạo file mới\n` +
                `─────────────────`
            );
        }

        try {
            // ── Chế độ IMPORT (có URL) ────────────────────────────────────────
            if (url && url.startsWith("http")) {
                const rawUrl  = toRawUrl(url);
                const finalName = filename.endsWith(".js") ? filename : filename + ".js";

                // Tìm file trong toàn project
                const foundFiles = findFile(finalName);

                // Không tìm thấy → tạo mới trong src/modules/
                if (!foundFiles.length) {
                    const newPath = path.join(ROOT, "src", "modules", finalName);
                    await doImport({ api, threadId, threadType, filePath: newPath, rawUrl, url, ctx });
                    return;
                }

                // Tìm thấy đúng 1 file → xác nhận ngay
                if (foundFiles.length === 1) {
                    await doImport({ api, threadId, threadType, filePath: foundFiles[0], rawUrl, url, ctx });
                    return;
                }

                // Tìm thấy nhiều file → hiện danh sách chọn
                const relFiles = foundFiles.map(f => path.relative(ROOT, f));
                const { text, index } = buildListText(relFiles, finalName, url);

                const sent = await api.sendMessage({ msg: text }, threadId, threadType);
                const msgId = sent?.msgId || sent?.globalMsgId
                    || sent?.message?.data?.globalMsgId || sent?.message?.globalMsgId;

                const senderId = String(message?.data?.uidFrom || message?.data?.senderId || "");
                const session  = {
                    index,          // relPath[]
                    foundFiles,     // fullPath[]
                    rawUrl,
                    url,
                    senderId,
                    ctx,
                    timeout: setTimeout(() => {
                        adcCache.delete(`${threadId}_${senderId}`);
                        if (msgId) adcCache.delete(String(msgId));
                    }, 120_000)
                };

                adcCache.set(`${threadId}_${senderId}`, session);
                if (msgId) adcCache.set(String(msgId), session);
                return;
            }

            // ── Chế độ EXPORT (không có URL) ─────────────────────────────────
            const foundFiles = findFile(filename);
            if (!foundFiles.length) return send(ctx, `❌ Không tìm thấy file: ${filename}`);

            const filePath = foundFiles[0];
            const content  = fs.readFileSync(filePath, "utf8");
            const relative = path.relative(ROOT, filePath);

            let rawUrl = null;
            let editUrl = null;

            const uuid = uuidv4();
            const launaBase = `https://sex.launa.rf.gd/note/${uuid}`;
            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    await axios.put(launaBase, content, {
                        headers: { "content-type": "text/plain; charset=utf-8" },
                        timeout: 12000,
                    });
                    rawUrl  = `${launaBase}?raw=true`;
                    editUrl = launaBase;
                    break;
                } catch (e) {
                    const status = e.response?.status;
                    const shouldRetry = !status || status === 429 || status >= 500;
                    if (shouldRetry && attempt < 3) {
                        await new Promise(r => setTimeout(r, attempt * 2000));
                        continue;
                    }
                    break;
                }
            }

            if (!rawUrl) {
                try {
                    const res = await axios.post("https://paste.rs/", content, {
                        headers: { "content-type": "text/plain; charset=utf-8" },
                        timeout: 12000,
                    });
                    const pasteUrl = res.data?.trim();
                    if (pasteUrl?.startsWith("http")) { rawUrl = pasteUrl; editUrl = pasteUrl; }
                } catch { }
            }

            if (!rawUrl) {
                try {
                    const form = new URLSearchParams();
                    form.append("content", content);
                    form.append("syntax", "javascript");
                    form.append("expiry_days", "30");
                    const res = await axios.post("https://dpaste.org/api/", form, {
                        headers: { "content-type": "application/x-www-form-urlencoded" },
                        timeout: 12000,
                        maxRedirects: 0,
                        validateStatus: s => s < 400,
                    });
                    const pasteUrl = res.data?.trim() || res.headers?.location;
                    if (pasteUrl?.startsWith("http")) { rawUrl = pasteUrl + ".txt"; editUrl = pasteUrl; }
                } catch { }
            }

            if (!rawUrl) return send(ctx, `❎️ Upload thất bại!`);

            const sent = await ctx.api.sendMessage(
                {
                    msg:
                        `[ 📝 CODE EXPORT ]\n` +
                        `─────────────────\n` +
                        `📁 File: ${relative}\n\n` +
                        `🔗 Raw:\n${rawUrl}\n\n` +
                        `✏️ Edit:\n${editUrl}\n` +
                        `─────────────────\n` +
                        `Thả cảm xúc để thay thế code cũ`,
                    quote: ctx.message.data,
                },
                threadId,
                threadType
            );

            const sentMsgId    = sent?.message?.data?.globalMsgId || sent?.message?.globalMsgId || sent?.message?.data?.msgId || sent?.message?.msgId;
            const sentCliMsgId = sent?.message?.data?.cliMsgId || sent?.message?.cliMsgId;

            if (!sentMsgId) return;

            registerReaction(String(sentMsgId), {
                ttl: 30 * 60 * 1000,
                senderId: String(ctx.message.data?.uidFrom || ctx.message.data?.senderId || ""),
                handler: async ({ api: rApi }) => {
                    let newContent;
                    try {
                        newContent = (await axios.get(rawUrl, {
                            timeout: 12000,
                            headers: { "Cache-Control": "no-cache", "Pragma": "no-cache" }
                        })).data;
                    } catch (e) {
                        await rApi.sendMessage({ msg: `❌ Tải nội dung thất bại: ${e.message}` }, threadId, threadType);
                        return;
                    }

                    const fileBody = typeof newContent === "string" ? newContent : JSON.stringify(newContent, null, 2);
                    try {
                        fs.writeFileSync(filePath, fileBody);
                    } catch (e) {
                        await rApi.sendMessage({ msg: `❌ Ghi file thất bại: ${e.message}` }, threadId, threadType);
                        return;
                    }

                    let reloaded = false;
                    try {
                        const { pathToFileURL } = await import("node:url");
                        const modUrl = pathToFileURL(filePath).href + "?t=" + Date.now();
                        const newMod = await import(modUrl);
                        if (newMod.commands && ctx.allCommands) {
                            for (const [cmd, handler] of Object.entries(newMod.commands)) {
                                ctx.allCommands[cmd] = handler;
                            }
                            reloaded = true;
                        }
                    } catch { }

                    try {
                        if (sentMsgId && sentCliMsgId) {
                            await rApi.undoMessage({ msgId: sentMsgId, cliMsgId: sentCliMsgId, threadId, type: threadType }, threadId, threadType);
                        }
                    } catch { }

                    await rApi.sendMessage(
                        {
                            msg:
                                `[ ✅ THAY THẾ THÀNH CÔNG ]\n` +
                                `─────────────────\n` +
                                `📁 File: ${relative}\n` +
                                `🔄 Hot-reload: ${reloaded ? "✅ Đã load vào RAM" : "⚠️ Cần restart bot"}\n` +
                                `⏰ ${new Date().toLocaleString("vi-VN")}\n` +
                                `─────────────────`,
                        },
                        threadId,
                        threadType
                    );
                },
            });

        } catch (e) {
            log.error("⚠️ ADC ERROR:", e.message);
            return send(ctx, `❎️ Thất bại: ${e.message}`);
        }
    }
};

// ── Handle: reply số để chọn file trong danh sách ────────────────────────────
export async function handle(ctx) {
    const { api, threadId, threadType, senderId, content, message } = ctx;
    if (!content || message.isSelf) return false;

    const quoteId = message?.data?.quote?.msgId || message?.data?.quote?.globalMsgId;
    const trimmed = content.trim();

    let session = null;
    if (quoteId && adcCache.has(String(quoteId))) {
        session = adcCache.get(String(quoteId));
    } else if (/^\d+$/.test(trimmed)) {
        session = adcCache.get(`${threadId}_${senderId}`);
    }

    if (!session || session.senderId !== String(senderId)) return false;

    const num = parseInt(trimmed);
    if (isNaN(num) || num < 1 || num > session.foundFiles.length) return false;

    clearTimeout(session.timeout);
    adcCache.delete(`${threadId}_${senderId}`);
    if (quoteId) adcCache.delete(String(quoteId));

    const filePath = session.foundFiles[num - 1];
    await doImport({
        api,
        threadId,
        threadType,
        filePath,
        rawUrl: session.rawUrl,
        url:    session.url,
        ctx:    session.ctx
    });

    return true;
}
