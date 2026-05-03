import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../logger.js";

const keysPath = path.join(process.cwd(), "src", "data", "keys.json");

export const keyManager = {
    _data: {},

    load() {
        try {
            this._data = readJSON(keysPath) || {};
        } catch (e) {
            log.error("Lỗi khi load keys.json:", e.message);
            this._data = {};
        }
    },

    save() {
        try { writeJSON(keysPath, this._data); } catch (e) {
            log.error("Lỗi khi save keys.json:", e.message);
        }
    },

    generateKey(days, tier = "normal", creator = "Admin") {
        this.load();
        const key = "RENT-" + Math.random().toString(36).substring(2, 10).toUpperCase() + "-" + Math.random().toString(36).substring(2, 6).toUpperCase();
        this._data[key] = { days, tier, creator, createdAt: Date.now() };
        this.save();
        return key;
    },

    useKey(key, threadId) {
        this.load();
        if (!this._data[key]) {
            return { success: false, msg: "Mã kích hoạt không tồn tại hoặc đã được sử dụng." };
        }
        const info = this._data[key];
        const days = info.days;
        const tier = info.tier || "normal";
        delete this._data[key];
        this.save();
        return { success: true, days, tier };
    },

    getAllKeys() {
        this.load();
        return this._data;
    }
};
