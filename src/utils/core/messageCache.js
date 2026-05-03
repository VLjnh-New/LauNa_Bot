const cache = new Map();

export const messageCache = {
    set: (msgId, data) => {
        cache.set(String(msgId), {
            ...data,
            timestamp: Date.now()
        });

        if (cache.size > 100) {
            const firstKey = cache.keys().next().value;
            cache.delete(firstKey);
        }
    },
    get: (msgId) => cache.get(String(msgId)),
    delete: (msgId) => cache.delete(String(msgId))
};

// Dọn dẹp mỗi 2 phút, giữ tối đa 5 phút
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of cache.entries()) {
        if (now - val.timestamp > 300_000) cache.delete(key);
    }
}, 120_000);
