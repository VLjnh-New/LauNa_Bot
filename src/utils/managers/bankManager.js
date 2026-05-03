import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../logger.js";

const bankPath = path.join(process.cwd(), "src", "data", "bank.json");

let _saveTimer = null;
function scheduleSave(data) {
    if (_saveTimer) clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => { _saveTimer = null; writeJSON(bankPath, data); }, 200);
}

export const bankManager = {
    _data: {},
    _loaded: false,

    load() {
        try {
            this._data = readJSON(bankPath) || {};
            this._loaded = true;
        } catch (e) {
            log.error("Lỗi khi load bank.json:", e.message);
            this._data = {};
            this._loaded = true;
        }
    },

    save() { scheduleSave(this._data); },

    getBalance(senderId) {
        const id = String(senderId);
        if (this._data[id] === undefined) {
            this._data[id] = 10000;
            this.save();
        }
        return this._data[id];
    },

    add(senderId, amount) {
        const id = String(senderId);
        this.getBalance(id);
        this._data[id] += amount;
        this.save();
        return this._data[id];
    },

    subtract(senderId, amount) {
        const id = String(senderId);
        this.getBalance(id);
        this._data[id] = Math.max(0, this._data[id] - amount);
        this.save();
        return this._data[id];
    }
};

bankManager.load();
