import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../logger.js";

const configPath = path.join(process.cwd(), "src", "data", "autoReact.json");

export const autoReactManager = {
    _settings: {},

    load() {
        try {
            this._settings = readJSON(configPath) || {};
        } catch (e) {
            log.error("Lỗi khi load autoReact.json:", e.message);
            this._settings = {};
        }
    },

    save() {
        try { writeJSON(configPath, this._settings); } catch (e) {
            log.error("Lỗi khi save autoReact.json:", e.message);
        }
    },

    set(threadId, enabled, count = 10, icon = null) {
        this.load();
        this._settings[threadId] = { enabled, count: parseInt(count) || 10, icon: icon || null };
        this.save();
    },

    get(threadId) {
        this.load();
        return this._settings[threadId] || { enabled: false, count: 0, icon: null };
    },

    isEnabled(threadId) { return this.get(threadId).enabled; }
};
