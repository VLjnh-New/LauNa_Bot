/**
 * ReplySessionManager
 * Quản lý phiên chờ reply: sau khi bot gửi menu,
 * người dùng chỉ cần gửi số hoặc text để chọn lựa.
 * Key: `${senderId}:${threadId}`
 */

const DEFAULT_TTL = 2 * 60 * 1000; // 2 phút

const sessions = new Map();

// Dọn session hết hạn mỗi 60s
setInterval(() => {
    const now = Date.now();
    for (const [key, session] of sessions.entries()) {
        if (now > session.expiresAt) sessions.delete(key);
    }
}, 60_000);

function makeKey(senderId, threadId) {
    return `${senderId}:${threadId}`;
}

/**
 * Đăng ký một phiên chờ reply cho người dùng trong thread.
 * @param {string} senderId
 * @param {string} threadId
 * @param {Function} handler - async (input: string, ctx: object) => void
 * @param {number} [ttl] - thời gian sống (ms), mặc định 2 phút
 */
export function registerReplySession(senderId, threadId, handler, ttl = DEFAULT_TTL) {
    const key = makeKey(senderId, threadId);
    sessions.set(key, {
        handler,
        expiresAt: Date.now() + ttl,
        createdAt: Date.now(),
        ttl,
    });
}

/**
 * Kiểm tra và xử lý phiên reply nếu tồn tại.
 * @param {string} senderId
 * @param {string} threadId
 * @param {string} input - nội dung tin nhắn người dùng gửi
 * @param {object} ctx - context hiện tại
 * @returns {boolean} true nếu đã xử lý, false nếu không có phiên
 */
export async function resolveReplySession(senderId, threadId, input, ctx) {
    const key = makeKey(senderId, threadId);
    const session = sessions.get(key);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        sessions.delete(key);
        return false;
    }
    sessions.delete(key); // Xóa trước khi chạy handler
    try {
        await session.handler(input.trim(), ctx);
    } catch (e) {
        console.error(`[ReplySession] Lỗi handler (${key}):`, e.message);
    }
    return true;
}

/**
 * Gia hạn lại session hiện tại (dùng khi input sai, muốn user thử lại).
 * Gọi từ trong handler nếu muốn giữ session sau khi input không hợp lệ.
 */
export function renewReplySession(senderId, threadId, handler, ttl = DEFAULT_TTL) {
    registerReplySession(senderId, threadId, handler, ttl);
}

/**
 * Xóa phiên reply nếu người dùng muốn hủy.
 */
export function cancelReplySession(senderId, threadId) {
    sessions.delete(makeKey(senderId, threadId));
}

/**
 * Kiểm tra có phiên chờ reply không (không xóa).
 */
export function hasReplySession(senderId, threadId) {
    const key = makeKey(senderId, threadId);
    const session = sessions.get(key);
    if (!session) return false;
    if (Date.now() > session.expiresAt) {
        sessions.delete(key);
        return false;
    }
    return true;
}
