/**
 * Reaction Registry
 * Lưu trữ các reaction callback đang chờ từ các module lệnh
 */

const _registry = new Map();

/**
 * Đăng ký một reaction callback
 * @param {string} msgId - Global message ID của tin nhắn bot gửi
 * @param {object} opts
 * @param {number}   opts.ttl      - Thời gian tồn tại (ms), mặc định 30 phút
 * @param {string}   opts.senderId - UID người được phép trigger
 * @param {Function} opts.handler  - async handler({ api, threadId, threadType, reactorId, log })
 */
export function registerReaction(msgId, { ttl = 30 * 60 * 1000, senderId, handler } = {}) {
  if (!msgId || typeof handler !== "function") return;
  _registry.set(String(msgId), {
    expires: Date.now() + ttl,
    senderId: senderId ? String(senderId) : null,
    handler,
  });
}

/**
 * Lấy và kiểm tra entry. Nếu quá hạn, tự xóa và trả null.
 * @param {string} msgId
 * @returns {object|null}
 */
export function getReaction(msgId) {
  const entry = _registry.get(String(msgId));
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    _registry.delete(String(msgId));
    return null;
  }
  return entry;
}

/**
 * Xóa một entry khỏi registry
 * @param {string} msgId
 */
export function deleteReaction(msgId) {
  _registry.delete(String(msgId));
}

/**
 * Dọn dẹp các entry đã hết hạn
 */
export function cleanupReactions() {
  const now = Date.now();
  for (const [key, val] of _registry) {
    if (now > val.expires) _registry.delete(key);
  }
}

// Tự dọn mỗi 10 phút
setInterval(cleanupReactions, 10 * 60 * 1000);
