/**
 * driveAutoInit.js
 * Tự động khởi động OAuth Google Drive khi bot start
 * Nếu diver.json có client_id + client_secret nhưng thiếu refresh_token
 * → gửi link xác thực vào DM admin, nếu không được thì tự nhắn chính mình (selfListen)
 * → auto-retry sau khi timeout
 */
import { readDiver, startDriveAuth } from "./diver.js";
import { getBotId } from "../../index.js";
import { log } from "../../logger.js";

const THREAD_TYPE_DM   = 0;
const RETRY_DELAY_MS   = 10 * 60 * 1000; // retry sau 10 phút nếu timeout
const STARTUP_DELAY_MS = 6000;            // chờ bot fully ready

export async function autoInitDrive(api, adminIds) {
    const diver = readDiver();

    if (diver.refresh_token) {
        log.info("[DriveAutoInit] ✅ refresh_token đã có — Drive sẵn sàng.");
        return;
    }

    if (!diver.client_id || !diver.client_secret) {
        log.warn("[DriveAutoInit] ⚠️ Thiếu client_id/client_secret trong diver.json — bỏ qua.");
        return;
    }

    log.info("[DriveAutoInit] 🔐 Chưa có token, tự động khởi động OAuth sau 6 giây...");
    await new Promise(r => setTimeout(r, STARTUP_DELAY_MS));

    await _runAuthWithRetry(api, adminIds);
}

// ─── Vòng lặp auth + retry ────────────────────────────────────────────────────

async function _runAuthWithRetry(api, adminIds) {
    // Kiểm tra lại trước khi chạy (có thể đã được auth từ !gdrive auth)
    if (readDiver().refresh_token) {
        log.info("[DriveAutoInit] ✅ Token đã có (từ lệnh chat) — dừng auto-init.");
        return;
    }

    try {
        await startDriveAuth(async (msg) => {
            await _sendToAdmin(api, adminIds, msg);
        });

        const updated = readDiver();
        await _sendToAdmin(api, adminIds, [
            "✅ Xác thực Google Drive thành công!",
            `📧 Email: ${updated.email || "?"}`,
            "🚀 Drive đã sẵn sàng!",
        ].join("\n"));

    } catch (e) {
        if (e.message === "AUTH_TIMEOUT") {
            log.warn(`[DriveAutoInit] ⏰ Timeout — thử lại sau ${RETRY_DELAY_MS / 60000} phút...`);
            await _sendToAdmin(api, adminIds,
                `⏰ Xác thực Drive hết giờ. Bot sẽ tự thử lại sau ${RETRY_DELAY_MS / 60000} phút.`
            ).catch(() => {});
            setTimeout(() => _runAuthWithRetry(api, adminIds), RETRY_DELAY_MS);

        } else if (e.message === "AUTH_CANCELLED") {
            log.info("[DriveAutoInit] Phiên auth bị huỷ.");

        } else if (e.message === "NO_REFRESH_TOKEN") {
            await _sendToAdmin(api, adminIds, [
                "⚠️ Google không trả refresh_token!",
                "Thu hồi quyền tại: https://myaccount.google.com/permissions",
                "Rồi khởi động lại bot hoặc dùng: .gdrive auth",
            ].join("\n")).catch(() => {});

        } else if (e.message?.includes("Đang có phiên xác thực")) {
            // Ai đó đã dùng !gdrive auth → bỏ qua, không cần retry
            log.info("[DriveAutoInit] Phiên auth đang chạy từ lệnh chat — không cần auto-init.");

        } else {
            log.error("[DriveAutoInit] Lỗi:", e.message);
        }
    }
}

// ─── Gửi tin nhắn đến admin ───────────────────────────────────────────────────
// Thử theo thứ tự: DM admin → self-message bot → log ra console

async function _sendToAdmin(api, adminIds, msg) {
    // 1. Thử DM từng admin
    for (const adminId of (adminIds || [])) {
        try {
            await api.sendMessage({ msg }, adminId, THREAD_TYPE_DM);
            return; // Gửi được → xong
        } catch {}
    }

    // 2. Thử gửi cho chính bot (selfListen = true nên bot nhận được)
    const botId = getBotId?.();
    if (botId) {
        try {
            await api.sendMessage({ msg }, botId, THREAD_TYPE_DM);
            log.info("[DriveAutoInit] Đã gửi vào self-chat của bot.");
            return;
        } catch {}
    }

    // 3. Fallback: in ra console rõ ràng
    log.info("[DriveAutoInit] ══════════════════════════════════════");
    log.info("[DriveAutoInit] " + msg.split("\n").join("\n[DriveAutoInit] "));
    log.info("[DriveAutoInit] ══════════════════════════════════════");
}
