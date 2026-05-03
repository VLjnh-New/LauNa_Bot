/**
 * inputBuffer.js
 * Gom nhiều tin nhắn liên tiếp từ cùng 1 user trong 1 thread
 * thành 1 lần xử lý AI duy nhất.
 *
 * Học từ Zia (RxJS messageBuffer) — viết lại cho Node.js thuần.
 *
 * Pattern:
 *  - Tin đầu tiên từ user → "primary": trả về Promise, caller await để lấy text gom lại
 *  - Tin tiếp theo trong cửa sổ 2.5s → "secondary": trả về null, caller return false ngay
 *  - Sau 2.5s im lặng: Promise resolve với toàn bộ text đã gom
 *  - Tối đa 8 giây chờ dù có liên tiếp bao nhiêu tin (tránh delay vô hạn)
 */

const DEBOUNCE_MS  = 2500;  // chờ 2.5s sau tin cuối
const MAX_WAIT_MS  = 8000;  // tối đa 8s kể từ tin đầu

// key: `${threadId}:${senderId}` → { lines, debounceTimer, forceTimer, resolve }
const pendingMap = new Map();

/**
 * Đưa tin nhắn vào buffer.
 * @returns {Promise<string>|null}
 *   - Promise<string>: nếu đây là tin ĐẦU TIÊN trong cửa sổ (primary), caller cần await
 *   - null: nếu đây là tin TIẾP THEO trong cửa sổ (secondary), caller return false ngay
 */
export function bufferMessage(threadId, senderId, text) {
    const key = `${threadId}:${senderId}`;

    if (pendingMap.has(key)) {
        // Secondary: thêm vào buffer, reset debounce timer
        const entry = pendingMap.get(key);
        clearTimeout(entry.debounceTimer);
        entry.lines.push(text);
        entry.debounceTimer = setTimeout(() => flush(key), DEBOUNCE_MS);
        return null; // caller nên return false ngay
    }

    // Primary: tạo buffer mới, trả về Promise để caller await
    let resolveRef;
    const promise = new Promise(resolve => { resolveRef = resolve; });

    const debounceTimer = setTimeout(() => flush(key), DEBOUNCE_MS);
    const forceTimer    = setTimeout(() => flush(key), MAX_WAIT_MS);

    pendingMap.set(key, {
        lines: [text],
        debounceTimer,
        forceTimer,
        resolve: resolveRef,
    });

    return promise;
}

function flush(key) {
    const entry = pendingMap.get(key);
    if (!entry) return;
    clearTimeout(entry.debounceTimer);
    clearTimeout(entry.forceTimer);
    const combined = entry.lines.join("\n").trim();
    pendingMap.delete(key);
    entry.resolve(combined);
}

/**
 * Huỷ buffer (khi user bị block / rate limit).
 */
export function cancelBuffer(threadId, senderId) {
    const key = `${threadId}:${senderId}`;
    const entry = pendingMap.get(key);
    if (!entry) return;
    clearTimeout(entry.debounceTimer);
    clearTimeout(entry.forceTimer);
    entry.resolve(entry.lines.join("\n").trim());
    pendingMap.delete(key);
}

// Dọn buffer cũ (phòng hờ) mỗi 10 phút
setInterval(() => {
    for (const key of pendingMap.keys()) flush(key);
}, 10 * 60 * 1000);
