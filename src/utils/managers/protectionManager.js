import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../logger.js";

const settingsPath = path.join(process.cwd(), "src", "data", "protection_settings.json");

export const protectionManager = {
    _settings: {},
    _violations: {},

    CONFIG: {
        photo:   { window: 15000,  warn: 5, kick: 8,  cleanup: 120000 },
        sticker: { window: 15000,  warn: 2, kick: 3,  cleanup: 120000 },
        tag:     { window: 60000,  warn: 2, kick: 3,  cleanup: 300000 },
        link:    { window: 60000,  warn: 1, kick: 5,  cleanup: 300000 },
        spam:    { window: 5000,   warn: 2, kick: 3,  cleanup: 60000  },
        nude:    { window: 60000,  warn: 2, kick: 3,  cleanup: 300000 },
        call:    { window: 60000,  warn: 0, kick: 1,  cleanup: 300000 }
    },

    load() {
        try {
            this._settings = readJSON(settingsPath) || {};
        } catch (e) {
            log.error("Lỗi khi load protection_settings.json:", e.message);
            this._settings = {};
        }
    },

    save() {
        try { writeJSON(settingsPath, this._settings); } catch (e) {
            log.error("Lỗi khi save protection_settings.json:", e.message);
        }
    },

    isEnabled(threadId, type) {
        if (Object.keys(this._settings).length === 0) this.load();
        return this._settings[threadId]?.[type] === true;
    },

    setEnabled(threadId, type, enabled) {
        this.load();
        if (!this._settings[threadId]) this._settings[threadId] = {};
        this._settings[threadId][type] = enabled;
        this.save();
    },

    addViolation(threadId, userId, type) {
        this.cleanup(threadId);
        const now = Date.now();
        if (!this._violations[threadId]) this._violations[threadId] = {};
        if (!this._violations[threadId][userId]) this._violations[threadId][userId] = {};
        let v = this._violations[threadId][userId][type];
        const config = this.CONFIG[type];
        if (!v || (now - v.firstTime > config.window)) {
            v = { count: 1, firstTime: now };
        } else { v.count++; }
        this._violations[threadId][userId][type] = v;
        return v.count;
    },

    resetViolation(threadId, userId, type) {
        if (this._violations[threadId]?.[userId]?.[type]) {
            delete this._violations[threadId][userId][type];
        }
    },

    cleanup(threadId) {
        const now = Date.now();
        if (!this._violations[threadId]) return;
        for (const userId in this._violations[threadId]) {
            for (const type in this._violations[threadId][userId]) {
                const config = this.CONFIG[type];
                if (now - this._violations[threadId][userId][type].firstTime > config.cleanup) {
                    delete this._violations[threadId][userId][type];
                }
            }
            if (Object.keys(this._violations[threadId][userId]).length === 0) {
                delete this._violations[threadId][userId];
            }
        }
    }
};
