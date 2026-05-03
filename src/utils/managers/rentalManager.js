import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../logger.js";

const rentalsPath = path.join(process.cwd(), "src", "data", "rentals.json");

const store = {
    _data: null,
    load() {
        if (this._data) return this._data;
        try {
            this._data = readJSON(rentalsPath) || {};
        } catch (e) { log.error("[RentalManager] Lỗi load:", e.message); this._data = {}; }
        return this._data;
    },
    save() {
        try { writeJSON(rentalsPath, this._data); } catch (e) { log.error("[RentalManager] Lỗi save:", e.message); }
    }
};

export const rentalManager = {
    load() { store.load(); },

    addRent(threadId, days, tier = "normal") {
        const d = store.load();
        const msToAdd = days * 24 * 60 * 60 * 1000;
        const now = Date.now();
        let currentExp = now;
        if (d[threadId]) {
            currentExp = Math.max(typeof d[threadId] === "object" ? d[threadId].exp : d[threadId], now);
        }
        const newExp = currentExp + msToAdd;
        d[threadId] = { exp: newExp, tier };
        store.save();
        return newExp;
    },

    isRented(threadId) {
        const d = store.load();
        const data = d[String(threadId)];
        if (!data) return false;
        return (typeof data === "object" ? data.exp : data) > Date.now();
    },

    getTier(threadId) {
        const d = store.load();
        const data = d[String(threadId)];
        if (!data) return "none";
        return typeof data === "object" ? (data.tier || "normal") : "normal";
    },

    getExpiry(threadId) {
        const d = store.load();
        const data = d[threadId];
        if (!data) return "Chưa thuê";
        const exp  = typeof data === "object" ? data.exp  : data;
        const tier = typeof data === "object" ? data.tier : "normal";
        if (exp <= Date.now()) return "Đã hết hạn";
        return `${new Date(exp).toLocaleString("vi-VN")} (${tier})`;
    },

    getAllRentals() {
        const now = Date.now();
        const d = store.load();
        return Object.entries(d)
            .filter(([, data]) => (typeof data === "object" ? data.exp : data) > now)
            .map(([id, data]) => ({
                id,
                exp:  typeof data === "object" ? data.exp  : data,
                tier: typeof data === "object" ? data.tier : "normal"
            }));
    },

    removeRent(threadId) {
        const d = store.load();
        if (d[threadId]) { delete d[threadId]; store.save(); return true; }
        return false;
    }
};
