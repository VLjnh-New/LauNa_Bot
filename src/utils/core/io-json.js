import fs from "node:fs";
import path from "node:path";

export const tempDir = path.join(process.cwd(), "src", "modules", "cache", "temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

// ── In-memory cache ─────────────────────────────────────────────────────────────
const _cache = new Map();

// ── Thu thập tất cả file JSON từ các thư mục data ──────────────────────────────
function _collectJsonFiles(dir, result = []) {
    try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) _collectJsonFiles(full, result);
            else if (entry.name.endsWith(".json")) result.push(full);
        }
    } catch {}
    return result;
}

// ── Public: khởi động (gọi 1 lần lúc bot start) ───────────────────────────────
export async function initDataStore() {
    const dirs = [
        path.join(process.cwd(), "src", "data"),
        path.join(process.cwd(), "src", "modules", "data"),
        path.join(process.cwd(), "src", "modules", "cache"),
    ];
    let loaded = 0;
    for (const dir of dirs) {
        if (!fs.existsSync(dir)) continue;
        for (const filePath of _collectJsonFiles(dir)) {
            if (_cache.has(filePath)) continue;
            try {
                const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
                _cache.set(filePath, data);
                loaded++;
            } catch {}
        }
    }
    logMessageToFile(`initDataStore: đã tải ${loaded} file từ diver (file system)`, "diver");
    return true;
}

// ── Liệt kê "files" trong một thư mục ảo (dùng thay fs.readdirSync) ───────────
export function listJSONDir(dirPath) {
    const prefix = dirPath.endsWith(path.sep) ? dirPath : dirPath + path.sep;
    const result = [];
    for (const key of _cache.keys()) {
        if (key.startsWith(prefix) && key.endsWith(".json")) {
            result.push(path.basename(key));
        }
    }
    // Cũng quét file system trực tiếp nếu chưa có trong cache
    try {
        if (fs.existsSync(dirPath)) {
            for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
                if (!entry.isDirectory() && entry.name.endsWith(".json")) {
                    if (!result.includes(entry.name)) result.push(entry.name);
                }
            }
        }
    } catch {}
    return result;
}

// ── Core I/O ───────────────────────────────────────────────────────────────────
export function readJSON(filePath) {
    if (_cache.has(filePath)) return _cache.get(filePath);
    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
            _cache.set(filePath, data);
            return data;
        }
    } catch (e) {
        logMessageToFile(`readJSON lỗi [${filePath}]: ${e.message}`, "io-error");
    }
    return null;
}

export function writeJSON(filePath, data) {
    if (data === null) {
        _cache.delete(filePath);
        try { fs.unlinkSync(filePath); } catch {}
        return true;
    }
    _cache.set(filePath, data);
    const tmpPath = filePath + ".tmp";
    try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), "utf-8");
        fs.renameSync(tmpPath, filePath);
        return true;
    } catch (e) {
        logMessageToFile(`writeJSON lỗi [${filePath}]: ${e.message}`, "io-error");
        try { fs.unlinkSync(tmpPath); } catch {}
    }
    return false;
}

// ── Logging ────────────────────────────────────────────────────────────────────
export function logMessageToFile(message, type = "general") {
    try {
        const logDir = path.join(process.cwd(), "logs");
        if (!fs.existsSync(logDir)) fs.mkdirSync(logDir);
        const fileName = `${type}_${new Date().toISOString().split("T")[0]}.log`;
        const filePath = path.join(logDir, fileName);
        const timestamp = new Date().toLocaleString();
        fs.appendFileSync(filePath, `[${timestamp}] ${message}\n`);
    } catch {}
}

// ── Cache cleanup (file temp) ─────────────────────────────────────────────────
export function cleanTempFiles() {
    try {
        if (!fs.existsSync(tempDir)) return;
        const files = fs.readdirSync(tempDir);
        const now = Date.now();
        files.forEach((file) => {
            const filePath = path.join(tempDir, file);
            try {
                const stats = fs.statSync(filePath);
                if (now - stats.mtimeMs > 5 * 60 * 1000) fs.unlinkSync(filePath);
            } catch {}
        });
    } catch {}
}

export function cleanupOldFiles() {
    const extensions = new Set([".mp4", ".mp3", ".aac", ".jpg", ".jpeg", ".png", ".webp", ".tmp", ".gif", ".webm"]);
    const now = Date.now();
    const maxAge = 5 * 60 * 1000;
    const cacheRoot = path.join(process.cwd(), "src", "modules", "cache");
    const targets = new Set([process.cwd(), cacheRoot, tempDir]);
    try {
        if (fs.existsSync(cacheRoot)) {
            for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
                if (entry.isDirectory()) targets.add(path.join(cacheRoot, entry.name));
            }
        }
    } catch {}

    let deleted = 0;
    for (const dir of targets) {
        try {
            if (!fs.existsSync(dir)) continue;
            for (const file of fs.readdirSync(dir)) {
                const ext = path.extname(file).toLowerCase();
                if (!extensions.has(ext)) continue;
                const fullPath = path.join(dir, file);
                try {
                    const stats = fs.statSync(fullPath);
                    if (now - stats.mtimeMs > maxAge) { fs.unlinkSync(fullPath); deleted++; }
                } catch {}
            }
        } catch {}
    }
    if (deleted > 0) logMessageToFile(`cleanupOldFiles: đã xóa ${deleted} file rác`, "cleanup");
}
