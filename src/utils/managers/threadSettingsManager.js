import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../logger.js";

const settingsPath = path.join(process.cwd(), "src", "data", "thread_settings.json");

export const threadSettingsManager = {
    _data: null,

    load() {
        if (this._data !== null) return this._data;
        try {
            this._data = readJSON(settingsPath) || {};
        } catch (e) {
            log.error("Lỗi khi load thread_settings.json:", e.message);
            this._data = {};
        }
        return this._data;
    },

    save() {
        try { writeJSON(settingsPath, this._data); } catch (e) {
            log.error("Lỗi khi save thread_settings.json:", e.message);
        }
    },

    get(threadId, key, defaultValue = false) {
        this.load();
        return this._data[String(threadId)]?.[key] ?? defaultValue;
    },

    set(threadId, key, value) {
        this.load();
        const tid = String(threadId);
        if (!this._data[tid]) this._data[tid] = {};
        this._data[tid][key] = value;
        this.save();
    },

    toggle(threadId, key) {
        const current = this.get(threadId, key, false);
        this.set(threadId, key, !current);
        return !current;
    },

    isAdminOnly(threadId) { return this.get(threadId, "adminOnly", false); },

    isRequireMentionLauna(threadId) { return this.get(threadId, "requireMentionLauna", false); },
    setRequireMentionLauna(threadId, value) { this.set(threadId, "requireMentionLauna", !!value); },
    toggleRequireMentionLauna(threadId) { return this.toggle(threadId, "requireMentionLauna"); }
};
