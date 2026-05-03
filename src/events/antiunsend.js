import fs from "node:fs";
import path from "node:path";
import { messageCache } from "../utils/core/messageCache.js";
import { protectionManager } from "../utils/managers/protectionManager.js";
import { downloadFile } from "../utils/core/util.js";
import { log } from "../globals.js";

export const name = "antiunsend";
export const description = "Tự động gửi lại tin nhắn khi có người thu hồi (Anti-Unsend)";

async function getDisplayName(api, uid) {
    try {
        const info = await api.getUserInfo(uid);
        const u = info?.[uid] || info?.[String(uid)] || info;
        return u?.displayName || u?.zaloName || u?.name || String(uid);
    } catch {
        return String(uid);
    }
}

// ─── Helper: parse params (JSON hoặc query-string) ───────────────────────────
function parseParams(params) {
    if (!params) return {};
    if (typeof params === "object") return params;
    try { return JSON.parse(params); } catch {}
    try { return Object.fromEntries(new URLSearchParams(params)); } catch {}
    return {};
}

// ─── Helper: build notify message ─────────────────────────────────────────────
function buildNotify(label, authorName, authorId, extra = "") {
    const header = `[ UNDO ${label} ]`;
    const authorTag = `@${authorName}`;
    const line1 = `➜ ${header}`;
    const line2 = `${authorTag} vừa thu hồi một ${label.toLowerCase()}.`;
    const text = extra ? `${line1}\n${line2}\n${extra}` : `${line1}\n${line2}`;

    const headerStart = 2;
    const styles = [
        { start: headerStart, len: header.length, st: "b", type: "b" },
        { start: headerStart, len: header.length, st: "c_db342e", type: "c_db342e" }
    ];
    const mentionPos = text.indexOf(authorTag);
    const mentions = mentionPos >= 0
        ? [{ uid: String(authorId), pos: mentionPos, len: authorTag.length }]
        : [];
    return { text, styles, mentions };
}

// ─── Main handler ──────────────────────────────────────────────────────────────
export async function handleUndo(ctx) {
    const { api, threadId, threadType, senderId: authorId, msgId, cliMsgId, log: ctxLog } = ctx;
    const logger = ctxLog || log;

    // 1. Kiểm tra AntiUndo có bật không
    if (!protectionManager.isEnabled(threadId, "undo")) return;

    // 2. Không bắt tin của chính mình hoặc Admin
    const ownId = api.getOwnId?.() || api.getContext?.()?.uid || "";
    const { adminIds = [] } = ctx;
    if (String(authorId) === String(ownId) || adminIds.includes(String(authorId))) return;

    // 3. Tìm tin gốc trong cache
    const cached = messageCache.get(msgId) || messageCache.get(cliMsgId);

    if (!cached) {
        logger.warn?.(`[AntiUndo] ❌ Không tìm thấy tin gốc trong cache. msgId=${msgId}`);
        try {
            const authorName = await getDisplayName(api, authorId) || String(authorId);
            const { text, styles, mentions } = buildNotify("TIN NHẮN", authorName, authorId,
                "➜ (Không có trong cache — tin nhắn quá cũ hoặc bot chưa thấy)");
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
        } catch (e) {
            logger.error?.(`[AntiUndo] Lỗi gửi thông báo fallback: ${e.message}`);
        }
        return;
    }

    const { senderId: cachedSenderId, senderName: rawName, content: originalText, data: originalData } = cached;
    const resolvedSenderId = cachedSenderId || authorId;

    // 4. Lấy tên hiển thị
    let authorName = rawName || String(resolvedSenderId);
    try { authorName = await getDisplayName(api, resolvedSenderId) || authorName; } catch {}

    // 5. Phân tích loại tin nhắn
    const msgType    = originalData?.msgType || "";
    const rawContent = originalData?.content;
    const rawAttach  = originalData?.attach;

    let c = {};
    if (typeof rawContent === "object" && rawContent !== null) {
        c = rawContent;
    } else if (typeof rawContent === "string") {
        try { c = JSON.parse(rawContent); } catch { c = {}; }
    }

    let attach = {};
    if (typeof rawAttach === "object" && rawAttach !== null) {
        attach = rawAttach;
    } else if (typeof rawAttach === "string") {
        try { attach = JSON.parse(rawAttach); } catch { attach = {}; }
    }

    const stickerId  = c?.id  || attach?.id  || c?.stickerID  || attach?.stickerID;
    const stickerCat = c?.catId || attach?.catId || c?.catID || attach?.catID;

    const extra      = c?.extra || attach?.extra || {};
    const rawParams  = c?.params || attach?.params || originalData?.params || "";
    const parsedParams = parseParams(rawParams);

    // ── VIDEO ──────────────────────────────────────────────────────────────────
    const isVideo = msgType.startsWith("chat.video")
        || !!extra?.videoUrl || !!c?.videoUrl
        || ("video_width" in parsedParams);

    if (isVideo) {
        const videoUrl = extra?.videoUrl || c?.videoUrl || c?.href;
        const thumbUrl = extra?.thumbUrl  || c?.thumb   || videoUrl;
        const duration = Number(parsedParams?.duration || extra?.duration || 0);
        const width    = Number(parsedParams?.video_width  || extra?.width  || 720);
        const height   = Number(parsedParams?.video_height || extra?.height || 1280);

        if (videoUrl) {
            try {
                const { text, styles, mentions } = buildNotify("VIDEO", authorName, resolvedSenderId);
                await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType).catch(() => {});
                await api.sendVideoEnhanced({
                    videoUrl, thumbnailUrl: thumbUrl,
                    duration: Math.floor(duration), width: Math.floor(width), height: Math.floor(height),
                    msg: "", threadId, threadType
                });
                logger.info?.(`[AntiUndo] ✅ Đã tóm VIDEO của ${authorName}`);
            } catch (e) { logger.error?.(`[AntiUndo] Lỗi VIDEO: ${e.message}`); }
            return;
        }
    }

    // ── VOICE ─────────────────────────────────────────────────────────────────
    const isVoice = msgType.startsWith("chat.voice")
        || msgType.startsWith("chat.audio")
        || (typeof c?.href === "string" && (c.href.includes(".aac") || c.href.includes(".m4a")));

    if (isVoice && c?.href) {
        try {
            const fileSize = Number(parsedParams?.fileSize || 0);
            const duration = Number(parsedParams?.duration || 0);
            const { text, styles, mentions } = buildNotify("VOICE", authorName, resolvedSenderId);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            await api.sendVoiceNative({
                voiceUrl: c.href, duration, fileSize, threadId, threadType, ttl: 1800000
            }).catch(async (e) => {
                logger.warn?.(`[AntiUndo] sendVoiceNative thất bại (${e.message}), thử download...`);
                const tmpPath = path.join(process.cwd(), `tmp_voice_${Date.now()}.aac`);
                const downloaded = await downloadFile(c.href, tmpPath);
                if (downloaded) {
                    await api.sendVoiceUnified({ filePath: downloaded, threadId, threadType })
                        .finally(() => fs.unlink(downloaded, () => {}));
                } else {
                    await api.sendMessage({ msg: `🎵 Voice: ${c.href}` }, threadId, threadType);
                }
            });
            logger.info?.(`[AntiUndo] ✅ Đã tóm VOICE của ${authorName}`);
        } catch (e) { logger.error?.(`[AntiUndo] Lỗi VOICE: ${e.message}`); }
        return;
    }

    // ── FILE ──────────────────────────────────────────────────────────────────
    if (msgType === "share.file" || msgType.includes("file")) {
        try {
            const fileUrl   = c?.href || "";
            const fileName  = parsedParams?.fileName  || "Tệp_đính_kèm";
            const fileExt   = parsedParams?.fileExt   || "";
            const fullName  = fileExt ? `${fileName}.${fileExt}` : fileName;
            const extra_str = `➜ Tên tệp: ${fullName}` + (fileUrl ? `\n➜ Link: ${fileUrl}` : "");
            const { text, styles, mentions } = buildNotify("TỆP", authorName, resolvedSenderId, extra_str);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            if (fileUrl) {
                await api.sendLink({ link: fileUrl, msg: fullName }, threadId, threadType).catch(() => {});
            }
            logger.info?.(`[AntiUndo] ✅ Đã tóm FILE của ${authorName}: ${fullName}`);
        } catch (e) { logger.error?.(`[AntiUndo] Lỗi FILE: ${e.message}`); }
        return;
    }

    // ── ẢNH ───────────────────────────────────────────────────────────────────
    const isPhoto = msgType.startsWith("chat.photo")
        || !!(extra?.hdUrl || extra?.url || extra?.thumbUrl || extra?.normalUrl);

    if (isPhoto) {
        const imgUrl = extra?.hdUrl || extra?.url || extra?.normalUrl || extra?.thumbUrl || c?.href;
        if (imgUrl) {
            try {
                const tmpPath = path.join(process.cwd(), `tmp_undo_${Date.now()}.jpg`);
                await downloadFile(imgUrl, tmpPath);
                const { text, styles, mentions } = buildNotify("ẢNH", authorName, resolvedSenderId);
                await api.sendImageEnhanced({
                    imageUrl: imgUrl, msg: text, mentions,
                    threadId, threadType,
                    width:  Math.floor(Number(extra?.width  || 720)),
                    height: Math.floor(Number(extra?.height || 1280))
                }).catch(() => {});
                fs.unlink(tmpPath, () => {});
                logger.info?.(`[AntiUndo] ✅ Đã tóm ẢNH của ${authorName}`);
            } catch (e) { logger.error?.(`[AntiUndo] Lỗi ẢNH: ${e.message}`); }
            return;
        }
    }

    // ── STICKER ───────────────────────────────────────────────────────────────
    const isSticker = msgType.startsWith("chat.sticker")
        || !!(stickerId && stickerCat);

    if (isSticker && stickerId && stickerCat) {
        try {
            const stickerObj = {
                id: String(stickerId),
                cateId: String(stickerCat),
                type: 1
            };
            const { text, styles, mentions } = buildNotify("STICKER", authorName, resolvedSenderId);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            await api.sendSticker(stickerObj, threadId, threadType === 1 ? 1 : 0).catch((e) => {
                logger.error?.(`[AntiUndo] sendSticker API Error: ${e.message}`);
                api.sendSticker(stickerObj, threadId, threadType).catch(() => {});
            });
            logger.info?.(`[AntiUndo] ✅ Đã tóm STICKER id=${stickerId} cat=${stickerCat} của ${authorName}`);
        } catch (e) { logger.error?.(`[AntiUndo] Lỗi STICKER: ${e.message}`); }
        return;
    }

    // ── VĂN BẢN (fallback cuối) ───────────────────────────────────────────────
    const displayText = originalText
        || (typeof rawContent === "string" ? rawContent : null)
        || c?.text || c?.title || c?.desc || "";

    if (displayText) {
        try {
            const { text, styles, mentions } = buildNotify("TIN NHẮN", authorName, resolvedSenderId,
                `➜ Nội dung: "${displayText}"`);
            await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
            logger.info?.(`[AntiUndo] ✅ Đã tóm TEXT của ${authorName}: "${displayText.slice(0, 50)}"`);
        } catch (e) { logger.error?.(`[AntiUndo] Lỗi TEXT: ${e.message}`); }
        return;
    }

    // Không xác định được loại
    logger.warn?.(`[AntiUndo] ⚠️ Không xử lý được. msgType="${msgType}"`);
    try {
        const { text, styles, mentions } = buildNotify("TIN NHẮN", authorName, resolvedSenderId,
            "➜ (Không thể khôi phục nội dung tin nhắn này)");
        await api.sendMessage({ msg: text, mentions, styles }, threadId, threadType);
    } catch {}
}
