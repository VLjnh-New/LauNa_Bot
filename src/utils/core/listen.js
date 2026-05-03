import { ThreadType } from "zca-api";
import fs from "node:fs";
import path from "node:path";
import { statsManager } from "../managers/statsManager.js";
import { rentalManager } from "../managers/rentalManager.js";
import { prefixManager } from "../managers/prefixManager.js";
import { messageCache } from "../core/messageCache.js";
import { cooldownManager } from "../managers/cooldownManager.js";
import { groupAdminManager } from "../managers/groupAdminManager.js";
import { threadSettingsManager } from "../managers/threadSettingsManager.js";
import { resolveReplySession } from "../managers/replySessionManager.js";

function levenshteinDistance(s1, s2) {
    const m = s1.length, n = s2.length;
    const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
        }
    }
    return dp[m][n];
}

// ── Anti-spam: rate limit per thread (tối đa N tin/giây) ─────────────────────
const THREAD_RATE_LIMIT  = 10;   // tối đa 10 tin xử lý / giây / thread
const THREAD_RATE_WINDOW = 1000; // 1 giây
const threadRateMap = new Map();

function isThreadRateLimited(threadId) {
    const now = Date.now();
    let entry = threadRateMap.get(threadId);
    if (!entry || now - entry.ts > THREAD_RATE_WINDOW) {
        threadRateMap.set(threadId, { count: 1, ts: now });
        return false;
    }
    entry.count++;
    if (entry.count > THREAD_RATE_LIMIT) return true;
    return false;
}

// Dọn threadRateMap mỗi 30s để tránh rò rỉ RAM
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of threadRateMap.entries()) {
        if (now - v.ts > THREAD_RATE_WINDOW * 5) threadRateMap.delete(k);
    }
}, 30_000);

// ── Anti-spam: giới hạn "lệnh không tìm thấy" 1 lần / 15s / sender ──────────
const NOT_FOUND_COOLDOWN_MS = 15_000;
const notFoundMap = new Map();

function canSendNotFound(senderId) {
    const now = Date.now();
    const last = notFoundMap.get(senderId) || 0;
    if (now - last < NOT_FOUND_COOLDOWN_MS) return false;
    notFoundMap.set(senderId, now);
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of notFoundMap.entries()) {
        if (now - v > NOT_FOUND_COOLDOWN_MS * 4) notFoundMap.delete(k);
    }
}, 60_000);

// ── Per-thread async queue: tối đa 3 handler chạy song song / thread ─────────
const THREAD_CONCURRENCY = 3;
const threadQueues = new Map();

function getQueue(threadId) {
    if (!threadQueues.has(threadId)) {
        threadQueues.set(threadId, { running: 0, queue: [] });
    }
    return threadQueues.get(threadId);
}

function enqueue(threadId, fn) {
    const q = getQueue(threadId);
    return new Promise((resolve, reject) => {
        q.queue.push({ fn, resolve, reject });
        drain(threadId);
    });
}

function drain(threadId) {
    const q = getQueue(threadId);
    while (q.running < THREAD_CONCURRENCY && q.queue.length > 0) {
        const { fn, resolve, reject } = q.queue.shift();
        q.running++;
        fn().then(resolve, reject).finally(() => {
            q.running--;
            drain(threadId);
        });
    }
}

// Dọn threadQueues khi idle mỗi 60s
setInterval(() => {
    for (const [k, q] of threadQueues.entries()) {
        if (q.running === 0 && q.queue.length === 0) threadQueues.delete(k);
    }
}, 60_000);

// ── boxNameCache: dùng chung qua các lần reconnect, không tạo lại ─────────────
const boxNameCache = new Map();
const BOX_CACHE_TTL = 30 * 60 * 1000; // 30 phút
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of boxNameCache.entries()) {
        if (now - val.ts > BOX_CACHE_TTL) boxNameCache.delete(key);
    }
}, 15 * 60 * 1000);

export async function handleListen(api, ctx_base) {
    const { prefix, selfListen, adminIds, allCommands, eventHandlers, log } = ctx_base;
    const ownId = api.getOwnId();

    const fetchBoxName = async (threadId) => {
        const cached = boxNameCache.get(threadId);
        if (cached && Date.now() - cached.ts < BOX_CACHE_TTL) return cached.name;
        try {
            const groupRes = await api.getGroupInfo(threadId).catch(() => null);
            const info = groupRes?.[threadId] || groupRes?.gridInfoMap?.[threadId] || groupRes;
            const bName = info?.gName || info?.gname || info?.name || info?.title || "Nhóm";
            if (boxNameCache.size >= 200) {
                // Xóa key cũ nhất — O(1) bằng iterator, không dùng sort
                const firstKey = boxNameCache.keys().next().value;
                if (firstKey !== undefined) boxNameCache.delete(firstKey);
            }
            boxNameCache.set(threadId, { name: bName, ts: Date.now() });
            return bName;
        } catch { return "Nhóm"; }
    };

    const listener = api.listener;

    listener.on("message", async (message) => {
        let { data, type, threadId, isSelf } = message;
        if (isSelf && !selfListen) return;

        // ── Rate limit per thread: bỏ qua tin thứ 11+ trong vòng 1s ─────────
        if (!adminIds.includes(String(data.uidFrom ?? data.uid ?? "")) && isThreadRateLimited(threadId)) return;

        // ── Đưa vào queue: tối đa 3 handler chạy song song / thread ─────────
        enqueue(threadId, async () => {
        let ctx = null;
        try {

            const senderId = String(data.uidFrom ?? data.uid ?? "");
            const senderName = data.dName ?? senderId;

            // --- CACHE TIN NHẮN (TIẾT KIỆM RAM) ---
            const cacheData = {
                content: typeof data.content === "string" ? data.content
                    : (data.content?.text || data.content?.desc || data.content?.title || data.content?.href || null),
                senderName, senderId, threadId, type,
                msgId: data.msgId, cliMsgId: data.cliMsgId, globalMsgId: data.globalMsgId,
                data
            };
            if (data.msgId)       messageCache.set(data.msgId,       cacheData);
            if (data.cliMsgId)    messageCache.set(data.cliMsgId,    cacheData);
            if (data.globalMsgId) messageCache.set(data.globalMsgId, cacheData);

            let content = null;
            if (typeof data.content === "string") {
                content = data.content.trim();
            } else if (typeof data.content === "object" && data.content !== null) {
                content = data.content.text || data.content.desc || data.content.title || data.content.href || null;
            }

            const isGroup = type === ThreadType.Group;
            const currentPrefix = (prefixManager.getPrefix(threadId) || prefix).trim();
            const groupName = isGroup ? await fetchBoxName(threadId) : null;

            const isOwner = adminIds.includes(String(senderId));
            const isRented = rentalManager.isRented(threadId);

            // --- XỬ LÝ MENTION Ở ĐẦU (REPLY) --- (cần trước cả rental gate)
            let processedContent = content || "";
            if (data.mentions?.length > 0) {
                const sortedMentions = [...data.mentions].sort((a, b) => a.pos - b.pos);
                let lastTagEnd = 0;
                for (const m of sortedMentions) {
                    if (processedContent.slice(lastTagEnd, m.pos).trim() === "") {
                        lastTagEnd = m.pos + m.len;
                    } else break;
                }
                processedContent = processedContent.slice(lastTagEnd).trim();
            }

            // --- CHẠY EVENTS CÓ alwaysRun=true TRƯỚC RENTAL GATE (vd: protection) ---
            if (isGroup && !isSelf) {
                const baseCtx = { ...ctx_base, api, message, content: processedContent, isGroup, threadId, threadType: type, senderId, senderName, isSelf };
                for (const evt of eventHandlers) {
                    if (!evt.alwaysRun) continue;
                    try {
                        if (typeof evt.handle === "function") {
                            if (await evt.handle(baseCtx)) return;
                        }
                    } catch (e) { log.error(`Lỗi event alwaysRun [${evt.name}]:`, e.message); }
                }
            }

            // --- HỆ THỐNG ADMIN ONLY (PER-THREAD) & ROLE CHECK ---
            if (isGroup) {
                const groupAdmins = await groupAdminManager.fetchGroupAdmins(api, threadId);
                const isBoxAdmin = groupAdmins.includes(String(senderId));
                const isAdminOnly = threadSettingsManager.isAdminOnly(threadId);

                // --- GHI THỐNG KÊ TƯƠNG TÁC ---
                if (!isSelf && senderId) {
                    const role = isOwner ? "Admin" : (isBoxAdmin ? "Admin" : null);
                    statsManager.addMessage(threadId, senderId, senderName, role);
                }

                if (!isOwner) {
                    if (!isRented) return; // Nhóm chưa thuê = block commands

                    if (isAdminOnly && !isBoxAdmin) {
                        if (content?.startsWith(currentPrefix)) {
                            const tagName = `@${senderName}`;
                            const msg = `🔒 @tag ─ Nhóm đang ở chế độ [ADMIN ONLY].\nChỉ Quản trị viên mới dùng được Bot lúc này.`;
                            const mentions = [{ uid: String(senderId), pos: 3, len: tagName.length }];
                            await api.sendMessage({ msg, mentions, quote: data }, threadId, type).catch(() => {});
                        }
                        return;
                    }
                }
            } else {
                // Chat riêng: có thể thêm logic nếu cần, hiện tại không block
            }

            ctx = { ...ctx_base, api, message, content, isGroup, threadId, threadType: type, senderId, senderName, isSelf };
            
            // --- HÀM REPLY SIÊU CẤP ---
            ctx.reply = async (msgObj, targetUids = [], opts = {}) => {
                let text = typeof msgObj === "string" ? msgObj : (msgObj.msg || "");
                const attachments = msgObj.attachments || [];
                const hidden = opts.hidden ?? msgObj.hidden ?? false;
                const quote = message.data?.quote || message.data?.content?.quote || message.data;
                if (targetUids.length === 0) {
                    const qId = String(quote?.uidFrom || quote?.ownerId || "");
                    if (qId) targetUids = [qId];
                }
                let mentions = [];
                if (hidden) {
                    // Tag ẩn: mention với len=0 — ping nhưng không hiện @tên
                    targetUids.forEach(uid => mentions.push({ uid: String(uid), pos: text.length, len: 0 }));
                } else {
                    let count = 0;
                    while (text.includes("@tag") && count < targetUids.length) {
                        const tagName = " @Thành viên ";
                        const pos = text.indexOf("@tag");
                        text = text.replace("@tag", tagName);
                        mentions.push({ uid: String(targetUids[count]), pos: pos + 1, len: tagName.trim().length });
                        count++;
                    }
                }
                return api.sendMessage({ msg: text, attachments, quote: message.data, mentions }, threadId, type).catch(e => log.error("Reply Error:", e.message));
            };

            // --- XỬ LÝ EVENT HANDLERS (bỏ qua alwaysRun đã chạy ở trên) ---
            let handledByEvent = false;
            for (const evt of eventHandlers) {
                if (evt.alwaysRun) continue; // đã chạy trước rental gate
                try {
                    if (typeof evt.handle === "function") {
                        if (await evt.handle({ ...ctx, content: processedContent })) { handledByEvent = true; break; }
                    }
                } catch (e) { log.error(`Lỗi event [${evt.name}]:`, e.message); }
            }
            if (handledByEvent) return;

            // --- XỬ LÝ LỆNH (COMMAND) ---
            let isCommand = false, cmdStr = "";
            let sanitized = processedContent.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
            if (currentPrefix && sanitized.startsWith(currentPrefix)) {
                isCommand = true;
                cmdStr = sanitized.slice(currentPrefix.length).trim();
            }

            if (isCommand) {
                if (!cmdStr) return;
                let parts = cmdStr.split(/\s+/);
                let cName = parts[0].toLowerCase();
                const args = parts.slice(1);
                const handler = allCommands[cName];

                log.chat(isGroup ? "GROUP" : "PRIVATE", senderName, threadId, `⚡ [COMMAND] ${cName.toUpperCase()}`, groupName);

                if (handler) {
                    // --- KIỂM TRA COOLDOWN (TRỪ ADMIN) ---
                    if (!isOwner) {
                        const timeLeft = cooldownManager.getRemainingCooldown(senderId, cName, 5);
                        if (timeLeft) {
                            return api.sendMessage({ msg: `⏳ Hãy đợi ${timeLeft}s trước khi dùng lại ${currentPrefix}${cName}.` }, threadId, type);
                        }
                        cooldownManager.setCooldown(senderId, cName, 5);
                    }

                    // Chỉ gửi 1 reaction sau 1.5s — không lặp để tránh spam API
                    const reactionTimer = setTimeout(() => {
                        api.addReaction(Math.random() > 0.5 ? "ok" : "akoi", {msgId: message.data?.globalMsgId || message.data?.msgId, cliMsgId: message.data?.cliMsgId}, threadId, type).catch(() => {});
                    }, 1500);
                    try {
                        api.sendTypingEvent(threadId, type).catch(() => {});
                        await handler({ ...ctx, args });
                    } catch (e) {
                        log.error(`Lỗi command !${cName}:`, e.message);
                        await api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, type).catch(() => {});
                    } finally { clearTimeout(reactionTimer); }
                } else {
                    // --- LỆNH KHÔNG TỒN TẠI: giới hạn 1 reply / 15s / người ---
                    if (canSendNotFound(senderId)) {
                        const send = (msg) => api.sendMessage({ msg }, threadId, type);
                        const cmdList = Object.keys(allCommands);
                        // Chỉ so với 30 lệnh đầu để tránh tính toán nặng
                        const sampleList = cmdList.slice(0, 30);
                        const best = sampleList.reduce((acc, cmd) => {
                            const dist = levenshteinDistance(cName, cmd);
                            return dist < acc.dist ? { cmd, dist } : acc;
                        }, { cmd: "help", dist: Infinity });

                        await send(
                            `❓ Không có lệnh "${currentPrefix}${cName}".\n` +
                            `💡 Ý bạn là: ${currentPrefix}${best.cmd}?\n` +
                            `📋 Gõ ${currentPrefix}help để xem toàn bộ lệnh.`
                        );
                    }
                }
            } else {
                if (!isSelf) log.chat(isGroup ? "GROUP" : "PRIVATE", senderName, threadId, content, groupName);
                // --- XỬ LÝ REPLY SESSION (reply số/text vào menu bot) ---
                // Dùng processedContent (đã lọc @mention đầu câu) để map chính xác
                const replyInput = processedContent.trim() || content?.trim() || "";
                if (!isSelf && replyInput) {
                    const handled = await resolveReplySession(senderId, threadId, replyInput, ctx);
                    if (handled) return;
                }
            }

        } catch (err) {
            log.error("Lỗi listener:", err.stack);
            if (err?.message?.includes("zpw_sek") && !global._sessionExpiredHandled) {
                global._sessionExpiredHandled = true;
                log.warn("Session key hết hạn — xoá cookie và restart bot...");
                try { fs.writeFileSync(path.join(process.cwd(), "cookie.json"), JSON.stringify([], null, 2)); } catch {}
                setTimeout(() => global.restartBot?.("Session expired: zpw_sek invalid"), 2000);
            }
        }
        finally {
            ctx = null;
        }
        }); // end enqueue
    });

    // Các listener khác
    listener.on("undo", async (undo) => {
        const { isGroup, data } = undo;
        const threadId = isGroup ? String(data.idTo || "") : String(data.uidFrom || "");
        // data.content chứa trực tiếp globalMsgId/cliMsgId của tin bị thu hồi
        // data.content.deleteMsg là một number (không phải object)
        const content = data?.content || {};
        const ctx = {
            api, undo, threadId,
            threadType: isGroup ? 1 : 0,
            senderId: String(data.uidFrom || ""),
            senderName: data.dName || "",
            msgId: String(content.globalMsgId || ""),
            cliMsgId: String(content.cliMsgId || ""),
            log, adminIds
        };
        for (const evt of eventHandlers) { if (evt.handleUndo) await evt.handleUndo(ctx).catch(e => log.error(e.message)); }
    });

    listener.on("reaction", async (event) => {
        try {
            const type = event.threadType ?? (event.data?.threadType ?? 0);
            const ctx = { api, event: event.data || event, reaction: event, threadId: event.threadId, threadType: type, isGroup: type === 1, log };
            for (const evt of eventHandlers) {
                if (typeof evt.handleReaction === "function") {
                    await evt.handleReaction(ctx).catch(e => log.error(`Lỗi reaction [${evt.name}]:`, e.message));
                }
            }
        } catch (err) { log.error("Lỗi listener reaction:", err.message); }
    });

    listener.on("group_event", async (event) => {
        // Cập nhật cache admin trực tiếp bằng sourceId từ event (không cần fetch lại Zalo API)
        const act = event.data?.act || event.data?.actType || event.data?.eventType || "";
        const tid = event.threadId;
        const rawData = event.data?.content || event.data?.data;
        let parsed = null;
        try {
            parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
        } catch {}
        const affectedUid = String(parsed?.sourceId || parsed?.targetId || parsed?.userId || "");

        if (affectedUid && tid) {
            if (act === "add_admin") {
                groupAdminManager.addToCache(tid, affectedUid);
            } else if (act === "remove_admin") {
                groupAdminManager.removeFromCache(tid, affectedUid);
            } else if (act === "change_owner") {
                groupAdminManager.clearCache(tid); // Owner đổi thì fetch lại cho chắc
            }
        }

        if (!rentalManager.isRented(event.threadId) && !adminIds.includes(event.data?.uidFrom)) return;
        const ctx = { api, event, threadId: event.threadId, threadType: 1, isGroup: true, adminIds, log };
        for (const evt of eventHandlers) { if (evt.handleGroupEvent) await evt.handleGroupEvent(ctx).catch(e => log.error(e.message)); }
    });


    listener.start();
    log.success(`LauNa đã sẵn sàng! Prefix: "${prefix}"`);

    // Quét lịch sử (Memory Safe - Chỉ quét 10 tin)
    (async () => {
        try {
            const groupsResp = await api.getAllGroups().catch(() => ({ gridVerMap: {} }));
            const groupIds = Object.keys(groupsResp.gridVerMap || {});
            for (const gId of groupIds) {
                if (!rentalManager.isRented(gId)) continue;
                const history = await api.getGroupChatHistory(gId, 10).catch(() => []);
                for (const msg of history) {
                    const cData = {
                        content: typeof msg.content === "string" ? msg.content : (msg.content?.text || null),
                        senderName: msg.dName || "User", senderId: String(msg.uidFrom || ""), threadId: gId, type: 1,
                        msgId: msg.msgId, cliMsgId: msg.cliMsgId, globalMsgId: msg.globalMsgId
                    };
                    if (msg.msgId) messageCache.set(msg.msgId, cData);
                }
            }
        } catch (e) {}
    })();
}
