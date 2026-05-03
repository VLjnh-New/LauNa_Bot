import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";
import { log } from "../../logger.js";

const CACHE_FILE = path.resolve(process.cwd(), "src/data/prefixes.json");

class PrefixManager {
    constructor() {
        this.prefixes = new Map();
        this.load();
    }

    load() {
        try {
            const data = readJSON(CACHE_FILE);
            if (data) {
                for (const [threadId, prefix] of Object.entries(data)) {
                    this.prefixes.set(String(threadId), prefix);
                }
            }
        } catch (err) {
            log.error("Lỗi đọc file prefixes.json:", err.message);
        }
    }

    save() {
        try {
            writeJSON(CACHE_FILE, Object.fromEntries(this.prefixes));
        } catch (err) {
            log.error("Lỗi lưu file prefixes.json:", err.message);
        }
    }

    getPrefix(threadId) { return this.prefixes.get(String(threadId)); }

    setPrefix(threadId, prefix) {
        this.prefixes.set(String(threadId), prefix);
        this.save();
    }

    resetPrefix(threadId) {
        if (this.prefixes.has(String(threadId))) {
            this.prefixes.delete(String(threadId));
            this.save();
        }
    }
}

export const prefixManager = new PrefixManager();
