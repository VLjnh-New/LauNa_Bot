import { log } from "../../logger.js";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ERROR_LOG_DIR = "logs";

if (!existsSync(ERROR_LOG_DIR)) {
    mkdirSync(ERROR_LOG_DIR, { recursive: true });
}

/**
 * Log structured error với timestamp
 * @param {string} context - Ngữ cảnh lỗi (e.g., "api.sendMessage")
 * @param {Error|string} error - Thông tin lỗi
 * @param {object} metadata - Dữ liệu bổ sung
 */
export function logError(context, error, metadata = {}) {
    const timestamp = new Date().toISOString();
    const errorMsg  = error instanceof Error ? error.message : String(error);
    const stack     = error instanceof Error ? error.stack : "";

    const errorRecord = {
        timestamp,
        context,
        message: errorMsg,
        stack: stack.split("\n").slice(0, 3).join(" | "),
        metadata,
        severity: metadata.severity || "error",
    };

    if (metadata.severity === "critical") {
        log.error(`[${context}] ${errorMsg}`, stack.split("\n")[1] || "");
    } else {
        log.warn(`[${context}] ${errorMsg}`);
    }

    try {
        const logFile = join(ERROR_LOG_DIR, `errors_${new Date().toISOString().split("T")[0]}.jsonl`);
        writeFileSync(logFile, JSON.stringify(errorRecord) + "\n", { flag: "a" });
    } catch (e) {
        console.error("Failed to write error log:", e.message);
    }

    return errorRecord;
}

/**
 * Wrapper cho API calls với retry và timeout
 * @param {Function} executeFunc - Hàm cần thực thi
 * @param {string} context - Ngữ cảnh (dùng khi log lỗi)
 * @param {{ retries?: number, timeoutMs?: number, fallback?: any }} options
 */
export async function executeWithErrorHandler(executeFunc, context, options = {}) {
    const { retries = 0, timeoutMs = 30_000, fallback = null } = options;

    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const timeout = new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Timeout")), timeoutMs)
            );
            return await Promise.race([executeFunc(), timeout]);
        } catch (error) {
            const isLastAttempt = attempt === retries;
            logError(context, error, {
                attempt: attempt + 1,
                severity: isLastAttempt ? "critical" : "warning",
            });

            if (isLastAttempt) {
                if (fallback !== undefined) return fallback;
                throw error;
            }

            const delay = Math.min(1000 * Math.pow(2, attempt), 10_000);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

/**
 * Đăng ký global error handlers cho uncaught exceptions
 */
export function setupGlobalErrorHandlers() {
    process.on("unhandledRejection", (reason) => {
        logError("unhandledRejection", reason, { severity: "critical" });
    });

    process.on("uncaughtException", (error) => {
        logError("uncaughtException", error, { severity: "critical" });
        process.exit(1);
    });
}
