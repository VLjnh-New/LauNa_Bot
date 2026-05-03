import { fs, path, log } from "../globals.js";
import { threadSettingsManager } from "../utils/managers/threadSettingsManager.js";
import { readJSON } from "../utils/core/io-json.js";
import axios from "axios";
import FormData from "form-data";

const CACHE_DIR   = path.join(process.cwd(), "src", "data");
const TEMP_DIR    = path.join(process.cwd(), "src", "modules", "cache");
const PREFIX_KEY  = "shortcut_data_";

const pendingDelete     = new Map();
const pendingInput      = new Map();
const pendingOutput     = new Map();
const pendingAttachment = new Map();

const SESSION_TTL = 90_000; // 90 giây

export const name        = "shortcut";
export const description = "Phản hồi tự động theo từ khóa hoặc khi @tag thành viên";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getShortcuts(threadId) {
    const data = threadSettingsManager.load();
    const tid  = String(threadId);
    if (!data[tid]) return [];
    return Object.entries(data[tid])
        .filter(([k, v]) => k.startsWith(PREFIX_KEY) && v !== null && v !== undefined)
        .map(([k, v]) => {
            try {
                const parsed = JSON.parse(v);
                if (!parsed) return null;
                return { key: k.slice(PREFIX_KEY.length), value: parsed };
            }
            catch { return null; }
        })
        .filter(Boolean);
}

async function uploadToCatbox(url, ext) {
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    const tmpFile = path.join(TEMP_DIR, `sc_${Date.now()}.${ext}`);
    try {
        const res    = await axios({ method: "GET", url, responseType: "stream", timeout: 30000 });
        const writer = fs.createWriteStream(tmpFile);
        res.data.pipe(writer);
        await new Promise((ok, fail) => { writer.on("finish", ok); writer.on("error", fail); });

        const form = new FormData();
        form.append("reqtype", "fileupload");
        form.append("fileToUpload", fs.createReadStream(tmpFile));
        const up = await axios.post("https://catbox.moe/user/api.php", form, {
            headers: form.getHeaders(), timeout: 60000,
        });
        return up.data?.trim();
    } finally {
        try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
    }
}

function extractAttachmentUrl(message) {
    const raw = message?.data;
    if (!raw) return null;
    if (Array.isArray(raw.attachments)) {
        for (const a of raw.attachments) {
            const url = a?.url || a?.fileUrl || a?.href || a?.hdUrl;
            if (url) return { url, type: a?.type || "photo" };
        }
    }
    return null;
}

function formatBody(template, senderName, senderId, groupName) {
    const now     = new Date();
    const timeStr = [now.getHours(), now.getMinutes(), now.getSeconds()]
        .map(n => String(n).padStart(2, "0")).join(":");
    return template
        .replace(/{name}/g,       `@${senderName}`)
        .replace(/{nameThread}/g, groupName || "Nhóm")
        .replace(/{time}/g,       timeStr)
        .replace(/{link}/g,       `https://www.facebook.com/profile.php?id=${senderId}`);
}

async function sendShortcutResponse(api, threadId, threadType, data, ctx) {
    const { senderId, senderName, groupName, message } = ctx;
    const body     = formatBody(data.output, senderName, senderId, groupName);
    const mentions = [];
    if (data.output.includes("{name}")) {
        const pos = body.indexOf(`@${senderName}`);
        if (pos !== -1) mentions.push({ uid: String(senderId), pos, len: senderName.length + 1 });
    }

    const msgObj = { msg: body, mentions, quote: message.data };

    if (data.uri && data.uri !== "s") {
        const VIDEO_MODES = ["vdgai", "vdanime", "vdcosplay", "vdchill"];

        if (VIDEO_MODES.includes(data.uri)) {
            const file = path.join(CACHE_DIR, `${data.uri}.json`);
            const _listData = readJSON(file);
            if (_listData) {
                try {
                    const list = Array.isArray(_listData) ? _listData : [];
                    const link = list[Math.floor(Math.random() * list.length)];
                    if (link) {
                        return await api.sendVideoEnhanced({
                            videoUrl:     link,
                            thumbnailUrl: "https://drive.google.com/uc?id=1pCQPRic8xPxbgUaPSIczb94S4RDdWDHK&export=download",
                            msg: body, threadId, threadType, mentions,
                            duration: 15000, width: 720, height: 1280,
                            fileSize: 10 * 1024 * 1024,
                        });
                    }
                } catch (e) { log.warn("[Shortcut] Video mode error:", e.message); }
            }
        } else if (data.uri.startsWith("http")) {
            if (/\.(mp4|mov|webm)(\?|$)/i.test(data.uri)) {
                return await api.sendVideoEnhanced({
                    videoUrl: data.uri, msg: body, threadId, threadType, mentions,
                });
            }
            msgObj.attachmentUrls = [data.uri];
        }
    }

    return await api.sendMessage(msgObj, threadId, threadType);
}

// ── Commands ──────────────────────────────────────────────────────────────────

export const commands = {
    shortcut: async (ctx) => {
        const { args, threadId, senderId, adminIds, reply, message } = ctx;
        const sub = args[0]?.toLowerCase();

        // ── Hướng dẫn ──────────────────────────────────────────────────────
        if (!sub || sub === "help" || sub === "hd") {
            return reply(
                `[ 📖 HƯỚNG DẪN SHORTCUT ]\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `• .shortcut add       — Thêm shortcut theo từ khóa\n` +
                `• .shortcut tag       — Thêm shortcut khi @tag ai đó\n` +
                `• .shortcut list      — Xem danh sách shortcut\n` +
                `• .shortcut del <số>  — Xóa shortcut theo số thứ tự\n` +
                `\n` +
                `[ 📝 BIẾN TRONG NỘI DUNG ]\n` +
                `• {name}       — Mention người gửi\n` +
                `• {nameThread} — Tên nhóm\n` +
                `• {time}       — Giờ hiện tại\n` +
                `• {link}       — Link Facebook của người gửi\n` +
                `\n` +
                `[ 📎 ĐÍNH KÈM ]\n` +
                `• s        — Không có đính kèm\n` +
                `• vdgai / vdanime / vdcosplay / vdchill — Video ngẫu nhiên từ kho\n` +
                `• Gửi ảnh/video thực tế khi được hỏi\n` +
                `\n` +
                `[ 💡 VÍ DỤ ]\n` +
                `.shortcut add → nhập "xin chào" → nhập "Chào {name}!" → nhập s`
            );
        }

        // ── List ────────────────────────────────────────────────────────────
        if (sub === "list" || sub === "all" || sub === "-a") {
            const shortcuts = getShortcuts(threadId);
            if (shortcuts.length === 0) return reply("⚠️ Chưa có shortcut nào. Dùng .shortcut add để thêm.");

            let msg = `[ 📋 DANH SÁCH SHORTCUT — ${shortcuts.length} cái ]\n━━━━━━━━━━━━━━━\n`;
            const listForDelete = [];
            shortcuts.forEach(({ key, value: d }, i) => {
                const hasFile = d.uri && d.uri !== "s" ? "📎" : "✉️";
                const trigger = d.type === "tag" ? `@Tag (${d.targetId})` : `"${d.input}"`;
                const preview = d.output.length > 30 ? d.output.slice(0, 30) + "…" : d.output;
                msg += `${i + 1}. ${hasFile} ${trigger} ➜ ${preview}\n`;
                listForDelete.push({ index: i + 1, key });
            });
            msg += `\n💡 Nhập số thứ tự để xoá, hoặc nhập 0 để huỷ.`;
            const sent = await reply(msg);
            if (sent) pendingDelete.set(`${threadId}_${senderId}`, { list: listForDelete, time: Date.now() });
            return;
        }

        // ── Delete trực tiếp ────────────────────────────────────────────────
        if (sub === "del" || sub === "delete" || sub === "remove" || sub === "xoa") {
            const shortcuts = getShortcuts(threadId);
            const idx       = parseInt(args[1]) - 1;
            if (isNaN(idx) || !shortcuts[idx]) {
                return reply(`⚠️ Vui lòng nhập số hợp lệ. Dùng .shortcut list để xem danh sách.`);
            }
            threadSettingsManager.set(threadId, `${PREFIX_KEY}${shortcuts[idx].key}`, null);
            return reply(`✅ Đã xoá shortcut #${idx + 1}.`);
        }

        // ── Tag shortcut ────────────────────────────────────────────────────
        if (sub === "tag") {
            let targetId = String(senderId);
            if (message.data?.mentions?.length > 0) {
                targetId = String(message.data.mentions[0].uid);
            } else if (message.data?.quote) {
                targetId = String(message.data.quote.ownerId || message.data.quote.uidFrom || senderId);
            }
            const isOwner = adminIds.includes(String(senderId));
            if (targetId !== String(senderId) && !isOwner) {
                return reply("⚠️ Chỉ Admin Bot mới có thể set shortcut tag cho người khác!");
            }
            const sent = await reply(`📌 Nhập nội dung phản hồi khi @tag người này (uid: ${targetId}).`);
            if (sent) pendingOutput.set(`${threadId}_${senderId}`, { type: "tag", targetId, time: Date.now() });
            return;
        }

        // ── Add shortcut mới ────────────────────────────────────────────────
        if (!sub || sub === "add" || sub === "them") {
            const sent = await reply(
                `📌 Nhập TỪ KHOÁ cho shortcut.\n` +
                `(Khi ai gõ đúng từ này, bot sẽ tự động phản hồi)`
            );
            if (sent) pendingInput.set(`${threadId}_${senderId}`, { time: Date.now() });
        }
    },
};

// ── Handle ────────────────────────────────────────────────────────────────────

export async function handle(ctx) {
    const { content, threadId, api, threadType, isGroup, senderId, message } = ctx;
    if (!isGroup || message.isSelf) return false;

    const key = `${threadId}_${senderId}`;

    // ── Xoá qua danh sách ──────────────────────────────────────────────────
    if (pendingDelete.has(key)) {
        const sess = pendingDelete.get(key);
        if (Date.now() - sess.time < SESSION_TTL) {
            const num = parseInt(content?.trim());
            if (num === 0) {
                pendingDelete.delete(key);
                api.sendMessage({ msg: "↩️ Đã huỷ." }, threadId, threadType);
                return true;
            }
            const target = sess.list.find(i => i.index === num);
            if (target) {
                pendingDelete.delete(key);
                threadSettingsManager.set(threadId, `${PREFIX_KEY}${target.key}`, null);
                api.sendMessage({ msg: `✅ Đã xoá shortcut #${num}.` }, threadId, threadType);
                return true;
            }
        } else {
            pendingDelete.delete(key);
        }
    }

    // ── Bước 1: Nhận từ khoá ───────────────────────────────────────────────
    if (pendingInput.has(key)) {
        const sess = pendingInput.get(key);
        if (Date.now() - sess.time < SESSION_TTL) {
            if (!content?.trim()) return false;
            pendingInput.delete(key);
            const sent = await api.sendMessage({
                msg: `📌 Từ khoá: "${content.trim()}"\nBây giờ nhập NỘI DUNG phản hồi.\n(Có thể dùng {name}, {time}, {nameThread}, {link})`,
            }, threadId, threadType);
            if (sent) pendingOutput.set(key, { type: "text", input: content.trim(), time: Date.now() });
            return true;
        } else {
            pendingInput.delete(key);
        }
    }

    // ── Bước 2: Nhận nội dung phản hồi ────────────────────────────────────
    if (pendingOutput.has(key)) {
        const sess = pendingOutput.get(key);
        if (Date.now() - sess.time < SESSION_TTL) {
            if (!content?.trim()) return false;
            pendingOutput.delete(key);
            const sent = await api.sendMessage({
                msg: [
                    `📌 Nội dung: "${content.trim()}"`,
                    `Cuối cùng, gửi ĐÍNH KÈM (ảnh/video) hoặc nhập:`,
                    `• s           — Không đính kèm`,
                    `• vdgai / vdanime / vdcosplay / vdchill — Video ngẫu nhiên từ kho`,
                ].join("\n"),
            }, threadId, threadType);
            if (sent) pendingAttachment.set(key, { ...sess, output: content.trim(), time: Date.now() });
            return true;
        } else {
            pendingOutput.delete(key);
        }
    }

    // ── Bước 3: Nhận đính kèm ──────────────────────────────────────────────
    if (pendingAttachment.has(key)) {
        const sess = pendingAttachment.get(key);
        if (Date.now() - sess.time < SESSION_TTL) {
            const VALID_MODES = ["s", "vdgai", "vdanime", "vdcosplay", "vdchill"];
            let uri = content?.trim().toLowerCase();

            if (!VALID_MODES.includes(uri)) {
                const att = extractAttachmentUrl(message);
                if (!att) {
                    api.sendMessage({
                        msg: `⚠️ Vui lòng gửi ảnh/video, hoặc nhập:\n• s — không đính kèm\n• vdgai / vdanime / vdcosplay / vdchill`,
                    }, threadId, threadType);
                    return true;
                }
                try {
                    api.sendMessage({ msg: "⏳ Đang upload đính kèm lên Catbox..." }, threadId, threadType);
                    const ext = att.type === "video" ? "mp4" : att.type === "audio" ? "m4a" : "jpg";
                    uri = await uploadToCatbox(att.url, ext);
                    if (!uri?.startsWith("http")) throw new Error("Catbox không trả về URL hợp lệ");
                } catch (e) {
                    log.warn("[Shortcut] Catbox upload failed:", e.message);
                    api.sendMessage({ msg: `❌ Lỗi upload đính kèm: ${e.message}` }, threadId, threadType);
                    return true;
                }
            }

            pendingAttachment.delete(key);
            const shortcutKey = sess.type === "tag"
                ? `tag_${sess.targetId}`
                : `text_${Buffer.from(sess.input).toString("hex")}`;

            const finalData = {
                type:     sess.type,
                input:    sess.input    || null,
                targetId: sess.targetId || null,
                output:   sess.output,
                uri,
            };
            threadSettingsManager.set(threadId, `${PREFIX_KEY}${shortcutKey}`, JSON.stringify(finalData));

            const VIDEO_MODES_ONLY = ["vdgai", "vdanime", "vdcosplay", "vdchill"];
            const attachLabel = uri === "s" ? "Không" : VIDEO_MODES_ONLY.includes(uri) ? `Kho video [${uri}]` : uri;
            api.sendMessage({
                msg: [
                    `✅ Đã thêm shortcut thành công!`,
                    `• Loại: ${sess.type === "tag" ? "Tag" : "Từ khoá"}`,
                    sess.type === "text" ? `• Từ khoá: "${sess.input}"` : `• UID: ${sess.targetId}`,
                    `• Nội dung: "${sess.output}"`,
                    `• Đính kèm: ${attachLabel}`,
                ].join("\n"),
            }, threadId, threadType);
            return true;
        } else {
            pendingAttachment.delete(key);
        }
    }

    // ── Kích hoạt shortcut ──────────────────────────────────────────────────
    const shortcuts = getShortcuts(threadId).map(s => s.value);

    // 1. Tag shortcut
    const mentions = message.data?.mentions || [];
    if (mentions.length > 0) {
        for (const m of mentions) {
            const sc = shortcuts.find(s => s.type === "tag" && s.targetId === String(m.uid));
            if (sc) {
                await sendShortcutResponse(api, threadId, threadType, sc, ctx);
                return true;
            }
        }
    }

    // 2. Từ khoá (exact match)
    if (content?.trim()) {
        const sc = shortcuts.find(
            s => s.type === "text" && s.input?.toLowerCase() === content.trim().toLowerCase()
        );
        if (sc) {
            await sendShortcutResponse(api, threadId, threadType, sc, ctx);
            return true;
        }
    }

    return false;
}
