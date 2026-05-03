import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../globals.js";

const MEMORY_DIR = path.resolve(process.cwd(), "src/data/launaMemory");
const MAX_TURNS  = 20;
const MAX_NOTES  = 10;

function userFile(userId) {
    return path.join(MEMORY_DIR, `${String(userId)}.json`);
}

function loadMemory(userId) {
    const raw = readJSON(userFile(userId));
    const data = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
    if (!Array.isArray(data.history)) data.history = [];
    if (!Array.isArray(data.notes))   data.notes   = [];
    if (typeof data.updatedAt === "undefined") data.updatedAt = null;
    return data;
}

function saveMemory(userId, data) {
    data.updatedAt = new Date().toISOString();
    writeJSON(userFile(userId), data);
}

export function getUserHistory(userId) {
    return loadMemory(userId).history;
}

export function appendUserHistory(userId, role, content) {
    const data = loadMemory(userId);
    data.history.push({ role, content, time: new Date().toISOString() });
    if (data.history.length > MAX_TURNS * 2) data.history.splice(0, 2);
    saveMemory(userId, data);
}

export function clearUserHistory(userId) {
    const data = loadMemory(userId);
    data.history = [];
    saveMemory(userId, data);
}

export function addUserNote(userId, note) {
    const data = loadMemory(userId);
    data.notes.unshift({ text: note, time: new Date().toISOString() });
    if (data.notes.length > MAX_NOTES) data.notes.length = MAX_NOTES;
    saveMemory(userId, data);
}

export function clearAllUserMemory(userId) {
    writeJSON(userFile(userId), null);
}

export const name = "memory";
export const description = "Bộ nhớ hội thoại per-user — lưu ngữ cảnh, ghi chú cá nhân";

export const commands = {
    mem: async (ctx) => {
        const { api, args, threadId, threadType, senderId, senderName, prefix } = ctx;
        const sub = args[0]?.toLowerCase();

        if (!sub) {
            const data  = loadMemory(senderId);
            const turns = Math.floor(data.history.length / 2);
            const notes = data.notes.length;
            const last  = data.updatedAt
                ? new Date(data.updatedAt).toLocaleString("vi-VN")
                : "Chưa có";
            return api.sendMessage({
                msg: [
                    `🧠 Bộ nhớ của ${senderName}`,
                    `• Lịch sử hội thoại: ${turns} lượt`,
                    `• Ghi chú cá nhân: ${notes} mục`,
                    `• Cập nhật lần cuối: ${last}`,
                    ``,
                    `Lệnh:`,
                    `  ${prefix}mem show    — Xem lịch sử gần đây`,
                    `  ${prefix}mem notes   — Xem ghi chú`,
                    `  ${prefix}mem set [nội dung] — Lưu ghi chú`,
                    `  ${prefix}mem clear   — Xóa lịch sử chat`,
                    `  ${prefix}mem reset   — Xóa toàn bộ`,
                ].join("\n"),
            }, threadId, threadType);
        }

        if (sub === "show") {
            const data = loadMemory(senderId);
            if (!data.history.length) {
                return api.sendMessage({ msg: `🧠 Chưa có lịch sử hội thoại nào.` }, threadId, threadType);
            }
            const recent = data.history.slice(-6);
            const lines  = recent.map(h => `${h.role === "user" ? "👤" : "🤖"} ${h.content.slice(0, 100)}${h.content.length > 100 ? "..." : ""}`);
            return api.sendMessage({
                msg: `🧠 Lịch sử gần đây (${Math.floor(data.history.length / 2)} lượt):\n\n${lines.join("\n")}`,
            }, threadId, threadType);
        }

        if (sub === "notes") {
            const data = loadMemory(senderId);
            if (!data.notes.length) {
                return api.sendMessage({ msg: `🧠 Chưa có ghi chú nào.` }, threadId, threadType);
            }
            const lines = data.notes.map((n, i) => `${i + 1}. ${n.text}`);
            return api.sendMessage({ msg: `🧠 Ghi chú của ${senderName}:\n${lines.join("\n")}` }, threadId, threadType);
        }

        if (sub === "set") {
            const note = args.slice(1).join(" ").trim();
            if (!note) return api.sendMessage({ msg: `🧠 Nhập nội dung ghi chú!` }, threadId, threadType);
            addUserNote(senderId, note);
            return api.sendMessage({ msg: `✅ Đã lưu ghi chú: "${note}"` }, threadId, threadType);
        }

        if (sub === "clear") {
            clearUserHistory(senderId);
            return api.sendMessage({ msg: `🧹 Đã xóa lịch sử hội thoại của ${senderName}.` }, threadId, threadType);
        }

        if (sub === "reset") {
            clearAllUserMemory(senderId);
            return api.sendMessage({ msg: `🗑️ Đã xóa toàn bộ dữ liệu bộ nhớ của ${senderName}.` }, threadId, threadType);
        }

        return api.sendMessage({
            msg: `❓ Lệnh không hợp lệ. Dùng: ${prefix}mem | show | notes | set | clear | reset`,
        }, threadId, threadType);
    },

    memchat: async (ctx) => {
        const { api, args, threadId, threadType, senderId, raw, prefix } = ctx;
        let prompt = args.join(" ").trim();
        if (!prompt && raw?.quote?.msg) prompt = raw.quote.msg.trim();
        if (!prompt) {
            return api.sendMessage({
                msg: `🧠 Chat với bộ nhớ:\n${prefix}memchat <câu hỏi>\nBot sẽ nhớ ngữ cảnh hội thoại trước đó của bạn.`,
            }, threadId, threadType);
        }

        const { pollinationsChat, getPollinationsKey } = await import("./apiai.js");
        const apiKey = getPollinationsKey();
        if (!apiKey) return api.sendMessage({ msg: `⚠️ Chưa cấu hình pollinations.apiKey!` }, threadId, threadType);

        appendUserHistory(senderId, "user", prompt);
        const history = getUserHistory(senderId).slice(-10);

        const thinking = await api.sendMessage({ msg: `🧠 Đang trả lời (có nhớ ngữ cảnh)...` }, threadId, threadType);
        try {
            const reply = await pollinationsChat(
                "Bạn là trợ lý thông minh, trả lời tự nhiên bằng tiếng Việt. Nhớ ngữ cảnh hội thoại.",
                prompt,
                history.slice(0, -1),
                "openai"
            );
            appendUserHistory(senderId, "assistant", reply);
            await api.sendMessage({ msg: `🧠 [Nhớ ngữ cảnh]\n${reply}`, quote: raw }, threadId, threadType);
        } catch (e) {
            log.error("[MemoryChat]", e.message);
            appendUserHistory(senderId, "assistant", "[lỗi]");
            await api.sendMessage({ msg: `❌ Lỗi: ${e.message}` }, threadId, threadType);
        } finally {
            try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
        }
    },
};
