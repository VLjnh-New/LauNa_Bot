import { path, log } from "../globals.js";
import moment from "moment-timezone";
import { readJSON, writeJSON } from "../utils/core/io-json.js";

const DATLICH_PATH = path.join(process.cwd(), "src/data/datlich.json");

export const name = "scheduler";
export const description = "Hệ thống đặt lịch nhắc nhở (hẹn giờ gửi tin nhắn)";

function loadData() {
    return readJSON(DATLICH_PATH) || {};
}

function saveData(data) {
    writeJSON(DATLICH_PATH, data);
}

export const commands = {
    datlich: async (ctx) => {
        const { api, threadId, threadType, args, senderId, adminIds } = ctx;
        const action = args[0]?.toLowerCase();

        if (action === "add") {
            // !datlich add 10/03/2026_18:00:00 Chúc mừng sinh nhật
            const timeStr = args[1];
            const reason = args.slice(2).join(" ");

            if (!timeStr || !reason) {
                return api.sendMessage({ msg: "⚠️ Cách dùng: !datlich add [DD/MM/YYYY_HH:mm:ss] [Nội dung]" }, threadId, threadType);
            }

            // Simple validation of time string
            const timeMatch = timeStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})_(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
            if (!timeMatch) {
                return api.sendMessage({ msg: "❌ Định dạng thời gian không hợp lệ! Vui lòng dùng: DD/MM/YYYY_HH:mm:ss" }, threadId, threadType);
            }

            const data = loadData();
            if (!data[threadId]) data[threadId] = {};

            data[threadId][timeStr] = {
                reason: reason,
                senderId: senderId,
                timestamp: Date.now() // to record when it was created
            };

            saveData(data);
            return api.sendMessage({ msg: `✅ Đã đặt lịch thành công!\n⏰ Thời gian: ${timeStr}\n📝 Nội dung: ${reason}` }, threadId, threadType);
        }
        else if (action === "list") {
            const data = loadData();
            const schedules = data[threadId];

            if (!schedules || Object.keys(schedules).length === 0) {
                return api.sendMessage({ msg: "ℹ️ Hiện tại nhóm không có lịch hẹn nào." }, threadId, threadType);
            }

            let msg = "[ 📅 DANH SÁCH LỊCH HẸN ]\n";
            msg += "─────────────────\n";
            let i = 1;
            for (const time in schedules) {
                msg += `${i++}. ${time} -> ${schedules[time].reason}\n`;
            }
            msg += "─────────────────\n💡 Dùng !datlich del [STT] để xóa.";
            return api.sendMessage({ msg }, threadId, threadType);
        }
        else if (action === "del" || action === "delete") {
            const index = parseInt(args[1]);
            if (isNaN(index)) return api.sendMessage({ msg: "⚠️ Vui lòng nhập số thứ tự lịch cần xóa." }, threadId, threadType);

            const data = loadData();
            const schedules = data[threadId];
            if (!schedules) return;

            const keys = Object.keys(schedules);
            if (index < 1 || index > keys.length) {
                return api.sendMessage({ msg: "❌ Số thứ tự không tồn tại." }, threadId, threadType);
            }

            const keyToDelete = keys[index - 1];
            delete data[threadId][keyToDelete];
            saveData(data);

            return api.sendMessage({ msg: `✅ Đã xóa lịch hẹn: ${keyToDelete}` }, threadId, threadType);
        }
        else {
            return api.sendMessage({ msg: "❓ Cách dùng:\n1. !datlich add [Thời gian] [Nội dung]\n2. !datlich list\n3. !datlich del [STT]" }, threadId, threadType);
        }
    }
};

/**
 * Background runner to check and execute scheduled tasks
 */
export async function checkAndExecuteSchedules(api, log) {
    const data = loadData();
    const now = moment().tz("Asia/Ho_Chi_Minh");
    const nowStr = now.format("DD/MM/YYYY_HH:mm:ss");

    // Convert current time to numbers for comparison
    const nowParts = nowStr.split(/[/_:]/).map(Number);
    const nowMs = new Date(nowParts[2], nowParts[1] - 1, nowParts[0], nowParts[3], nowParts[4], nowParts[5]).getTime();

    let changed = false;

    for (const tid in data) {
        const schedules = data[tid];
        for (const timeStr in schedules) {
            try {
                const parts = timeStr.split(/[/_:]/).map(Number);
                const targetMs = new Date(parts[2], parts[1] - 1, parts[0], parts[3], parts[4], parts[5]).getTime();

                // If scheduled time has passed
                if (targetMs <= nowMs) {
                    const task = schedules[timeStr];


                    let senderName = `UID ${task.senderId}`;
                    try {
                        const uInfo = await api.getUserInfo(task.senderId);
                        const user = uInfo[task.senderId] || Object.values(uInfo)[0];
                        senderName = user?.displayName || user?.zaloName || senderName;
                    } catch { }

                    const announceMsg = `[ ⏰ THÔNG BÁO LỊCH HẸN ]\n─────────────────\n📝 Nội dung: ${task.reason}\n👤 Người đặt: @${senderName}`;

                    await api.sendMessage({
                        msg: announceMsg,
                        mentions: [{ uid: task.senderId, pos: announceMsg.indexOf("@"), len: senderName.length + 1 }]
                    }, tid, 1); // 1 is Group

                    delete data[tid][timeStr];
                    changed = true;
                }
            } catch (e) {
                log.error(`[Scheduler] Lỗi xử lý lịch ${timeStr} tại ${tid}: ${e.message}`);
                delete data[tid][timeStr];
                changed = true;
            }
        }
    }

    if (changed) saveData(data);
}
