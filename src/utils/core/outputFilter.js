/**
 * outputFilter.js
 * Lọc thông tin nội bộ nhạy cảm khỏi AI responses trước khi gửi user.
 *
 * Học từ zalo-personal (output-filter.ts).
 * Ngăn lộ: file paths, API keys, stack traces, PM2 commands, nội bộ bot.
 *
 * Redaction là best-effort — chỉ sanitize, KHÔNG block message.
 */

const REDACTION_PATTERNS = [
    // File paths tuyệt đối
    { pattern: /\/home\/[^\s"'`)\]}>]+/g,         replacement: "[path]" },
    { pattern: /\/root\/[^\s"'`)\]}>]+/g,         replacement: "[path]" },
    { pattern: /\/tmp\/[^\s"'`)\]}>]+/g,          replacement: "[path]" },
    { pattern: /C:\\Users\\[^\s"'`)\]}>]+/g,      replacement: "[path]" },

    // API keys / tokens (common patterns — độ dài >= 20 ký tự)
    { pattern: /\b(api[_-]?key|token|secret|password|apikey)[:\s=]+["']?[A-Za-z0-9_\-./+=]{20,}["']?/gi, replacement: "$1=[redacted]" },

    // PM2 / shell commands nguy hiểm
    { pattern: /\bpm2\s+(restart|stop|start|delete|kill)\s+[^\s]*/g, replacement: "pm2 [command]" },
    { pattern: /\brm\s+-rf?\s+[^\s]*/g, replacement: "rm [redacted]" },

    // Node.js stack trace lines
    { pattern: /at\s+[^\n]*node_modules[^\n]*/g, replacement: "" },
    { pattern: /at\s+[^\n]*\/dist\/[^\n]*/g,      replacement: "" },
    { pattern: /at\s+[^\n]*eval\s*\([^\n]*/g,     replacement: "" },

    // Nội bộ LauNa (tên module, key names)
    { pattern: /\b(GEMINI_KEY|HF_KEY|PIXVERSE_TOKEN|DUCK_AI)[_A-Z]*\s*[:=]\s*[^\s]+/g, replacement: "[secret]" },

    // JSON object keys với giá trị nhạy cảm
    { pattern: /"(cookie|cookies|secretKey|imei|userAgent)"\s*:\s*"[^"]{10,}"/g, replacement: '"$1":"[redacted]"' },
];

/**
 * Lọc thông tin nhạy cảm từ text.
 * @param {string} text
 * @returns {string}
 */
export function filterOutput(text) {
    if (!text || typeof text !== "string") return text;
    let result = text;
    for (const { pattern, replacement } of REDACTION_PATTERNS) {
        // Reset regex state (quan trọng với global flag)
        pattern.lastIndex = 0;
        result = result.replace(pattern, replacement);
    }
    // Dọn dòng trống dư thừa do stack trace bị xóa
    result = result.replace(/\n{3,}/g, "\n\n").trim();
    return result;
}

/**
 * Kiểm tra nhanh xem text có chứa thông tin nội bộ không.
 * @param {string} text
 * @returns {boolean}
 */
export function hasInternalInfo(text) {
    if (!text) return false;
    return REDACTION_PATTERNS.some(({ pattern }) => {
        pattern.lastIndex = 0;
        return pattern.test(text);
    });
}
