const store = new Map();

export const botMsgStore = {
    currentModule: null,

    set: (msgId, cliMsgId) => {
        if (!msgId) return;
        store.set(String(msgId), {
            cliMsgId: String(cliMsgId || ""),
            module: botMsgStore.currentModule || null,
            ts: Date.now(),
        });
        if (store.size > 150) {
            const firstKey = store.keys().next().value;
            store.delete(firstKey);
        }
    },

    get: (msgId) => {
        const entry = store.get(String(msgId));
        if (!entry) return undefined;
        return entry.cliMsgId;
    },

    getModule: (msgId) => {
        const entry = store.get(String(msgId));
        return entry?.module ?? null;
    },

    delete: (msgId) => store.delete(String(msgId)),
};

// Dọn entry cũ hơn 10 phút mỗi 5 phút
setInterval(() => {
    const cutoff = Date.now() - 600_000;
    for (const [key, val] of store.entries()) {
        if (val.ts < cutoff) store.delete(key);
    }
}, 300_000);
