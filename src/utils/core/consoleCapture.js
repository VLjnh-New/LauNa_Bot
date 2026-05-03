/**
 * consoleCapture.js
 * Bắt toàn bộ output console (log/warn/error/info) vào một buffer vòng.
 * Admin có thể xem log ngay trong chat mà không cần vào Termux.
 */

const MAX_LINES = 200;
const _lines = [];
let _capturing = false;

function _push(level, args) {
    const text = args.map(a => {
        if (typeof a === "string") return a;
        try { return JSON.stringify(a); } catch { return String(a); }
    }).join(" ")
    // Bỏ ANSI color codes để text đọc được trong chat
    .replace(/\x1b\[[0-9;]*m/g, "");

    const ts = new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    _lines.push(`[${ts}] ${level} ${text}`);
    if (_lines.length > MAX_LINES) _lines.shift();
}

const _orig = {
    log:   console.log.bind(console),
    warn:  console.warn.bind(console),
    error: console.error.bind(console),
    info:  console.info.bind(console),
};

export function startCapture() {
    if (_capturing) return;
    _capturing = true;

    console.log   = (...a) => { _push("   ", a); _orig.log(...a); };
    console.warn  = (...a) => { _push("⚠️ ", a); _orig.warn(...a); };
    console.error = (...a) => { _push("❌ ", a); _orig.error(...a); };
    console.info  = (...a) => { _push("ℹ️ ", a); _orig.info(...a); };
}

/**
 * Lấy N dòng gần nhất
 * @param {number} n
 * @returns {string}
 */
export function getLines(n = 50) {
    const slice = _lines.slice(-Math.min(n, MAX_LINES));
    return slice.length ? slice.join("\n") : "(Chưa có log nào)";
}

/**
 * Xoá toàn bộ buffer
 */
export function clearLines() {
    _lines.length = 0;
}

export function lineCount() {
    return _lines.length;
}
