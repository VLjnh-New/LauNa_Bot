/**
 * launaMsgTracker.js
 * Theo dõi các tin nhắn LauNa đã gửi theo từng thread
 * để hỗ trợ tính năng undo (thu hồi tin nhắn).
 *
 * Học từ Zia messageStore pattern
 */

// threadId → [{ msgId, cliMsgId, ts }, ...]  (tối đa 20 tin mỗi thread)
const threadMsgStore = new Map();
const MAX_PER_THREAD = 20;

/**
 * Lưu tin nhắn vừa gửi vào store
 */
export function trackSent(threadId, msgId, cliMsgId) {
    if (!threadId || !msgId) return;
    const tid = String(threadId);
    if (!threadMsgStore.has(tid)) threadMsgStore.set(tid, []);
    const arr = threadMsgStore.get(tid);
    arr.push({ msgId: String(msgId), cliMsgId: String(cliMsgId || ""), ts: Date.now() });
    if (arr.length > MAX_PER_THREAD) arr.splice(0, arr.length - MAX_PER_THREAD);
}

/**
 * Lấy tin nhắn theo index âm (vd: -1 = cuối cùng, -2 = áp cuối)
 */
export function getByIndex(threadId, index = -1) {
    const arr = threadMsgStore.get(String(threadId)) || [];
    if (!arr.length) return null;
    const i = index < 0 ? arr.length + index : index;
    return arr[i] ?? null;
}

/**
 * Lấy N tin nhắn gần nhất
 */
export function getRecent(threadId, count = 1) {
    const arr = threadMsgStore.get(String(threadId)) || [];
    return arr.slice(-Math.abs(count));
}

/**
 * Xoá tin khỏi store sau khi undo thành công
 */
export function removeByMsgId(threadId, msgId) {
    const arr = threadMsgStore.get(String(threadId));
    if (!arr) return;
    const idx = arr.findIndex(m => m.msgId === String(msgId));
    if (idx !== -1) arr.splice(idx, 1);
}

/**
 * Xoá store của thread (vd: khi xoá lịch sử)
 */
export function clearThread(threadId) {
    threadMsgStore.delete(String(threadId));
}

// Dọn store cũ mỗi 30 phút
setInterval(() => {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [tid, arr] of threadMsgStore.entries()) {
        const filtered = arr.filter(m => m.ts > cutoff);
        if (!filtered.length) threadMsgStore.delete(tid);
        else threadMsgStore.set(tid, filtered);
    }
}, 30 * 60 * 1000);
