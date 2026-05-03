import { path, log } from "../globals.js";


import { readFileSync, existsSync } from "node:fs";

export const name = "muteHandler";
export const description = "Dùng deleteMessage để xóa tin nhắn nếu bị mute";

const MUTE_FILE = path.join(process.cwd(), "src", "modules", "cache", "mutes.json");

function isUserMuted(uid) {
    try {
        if (!existsSync(MUTE_FILE)) return false;
        const mutes = JSON.parse(readFileSync(MUTE_FILE, "utf-8"));
        return mutes.includes(String(uid));
    } catch (e) {
        return false;
    }
}

export async function handle(ctx) {
    const { api, message, senderId, threadId, threadType } = ctx;


    if (isUserMuted(senderId)) {
        const msgId = message.data?.msgId || message.data?.globalMsgId;
        if (!message.data || !msgId) {
            return false;
        }


        try {

            await api.deleteMessage(
                {msgId, cliMsgId: message.data.cliMsgId, ownerId: message.data.uidFrom || String(senderId)},
                threadId, threadType
            );

            return true;
        } catch (delErr) {
            log.error(`⚠️ [Mute] Lỗi khi thu hồi tin (${delErr.code}):`, delErr.message);
            if (delErr.message.toLowerCase().includes("permission") || delErr.message.toLowerCase().includes("forbidden")) {
            }
        }
    }
    return false;
}
