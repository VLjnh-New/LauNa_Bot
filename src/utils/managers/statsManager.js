import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../logger.js";

const statsPath = path.join(process.cwd(), "src", "data", "stats.json");

function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

const store = {
    _data: null,
    _saveTimeout: null,
    load() {
        if (this._data) return this._data;
        try {
            this._data = readJSON(statsPath) || {};
        } catch (e) { log.error("[StatsManager] Lỗi load:", e.message); this._data = {}; }
        return this._data;
    },
    save() {
        try { writeJSON(statsPath, this._data); } catch (e) { log.error("[StatsManager] Lỗi save:", e.message); }
    },
    saveDebounced() {
        if (this._saveTimeout) clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => this.save(), 5000);
    }
};

export const statsManager = {
    load() { store.load(); },

    addMessage(threadId, senderId, senderName, role = null) {
        const data = store.load();
        if (!data[threadId]) {
            data[threadId] = { members: {}, lastResetDay: new Date().getDate(), lastResetWeek: getWeekNumber(new Date()) };
        }
        const thread = data[threadId];
        const now = new Date();
        const today = now.getDate();
        const currentWeek = getWeekNumber(now);

        if (thread.lastResetDay !== today) {
            Object.values(thread.members).forEach(m => m.day = 0);
            thread.lastResetDay = today;
        }
        if (thread.lastResetWeek !== currentWeek) {
            Object.values(thread.members).forEach(m => m.week = 0);
            thread.lastResetWeek = currentWeek;
        }

        if (!thread.members[senderId]) {
            thread.members[senderId] = { name: senderName, total: 0, day: 0, week: 0, joinDate: Date.now(), role: "Thành viên" };
        }
        const member = thread.members[senderId];
        member.name = senderName;
        if (role) { if (role === "Admin" || member.role === "Thành viên") member.role = role; }
        member.total++; member.day++; member.week++;
        store.saveDebounced();
    },

    getStats(threadId, senderId) {
        const data = store.load();
        const thread = data[threadId];
        if (!thread || !thread.members[senderId]) return null;
        return thread.members[senderId];
    },

    getTop(threadId, type = "total", limit = 10) {
        const data = store.load();
        const thread = data[threadId];
        if (!thread) return [];
        return Object.entries(thread.members)
            .map(([id, d]) => ({ id, ...d }))
            .sort((a, b) => b[type] - a[type])
            .slice(0, limit);
    },

    getAllThreads() { return Object.keys(store.load()); },

    setRole(threadId, uid, role) {
        const data = store.load();
        if (!data[threadId]) {
            data[threadId] = { members: {}, lastResetDay: new Date().getDate(), lastResetWeek: getWeekNumber(new Date()) };
        }
        if (!data[threadId].members[uid]) {
            data[threadId].members[uid] = { name: "Người dùng", total: 0, day: 0, week: 0, joinDate: Date.now(), role };
        } else { data[threadId].members[uid].role = role; }
        store.save();
    },

    resetDayAll() {
        const data = store.load();
        Object.values(data).forEach(t => {
            Object.values(t.members || {}).forEach(m => m.day = 0);
            t.lastResetDay = new Date().getDate();
        });
        store.save();
    },

    resetWeekAll() {
        const data = store.load();
        const week = getWeekNumber(new Date());
        Object.values(data).forEach(t => {
            Object.values(t.members || {}).forEach(m => m.week = 0);
            t.lastResetWeek = week;
        });
        store.save();
    },

    save() { store.save(); },
    saveDebounced() { store.saveDebounced(); },
    _getWeekNumber: getWeekNumber
};
