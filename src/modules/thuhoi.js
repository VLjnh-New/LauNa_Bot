import { log } from "../globals.js";
export const name = "thuhoi";
export const description = "Gỡ / Thu hồi tin nhắn đang reply (Dành cho Admin hoặc tự thu hồi tin của bot)";

export const commands = {
    thuhoi: async (ctx) => {
        const { api, message, threadId, threadType, senderId, adminIds, log } = ctx;

        // Cần reply lại một tin nhắn để thu hồi
        const quote = message.data?.quote;
        if (!quote) {
            return api.sendMessage({ msg: "⚠️ Vui lòng phản hồi (reply) lại tin nhắn bạn muốn thu hồi/xoá." }, threadId, threadType);
        }

        const msgIdToDel = quote.globalMsgId;
        const cliMsgIdToDel = quote.cliMsgId;
        const ownerId = quote.ownerId; // Người gửi tin nhắn gốc

        try {
            // Thử dùng API undo trước (Thu hồi tin nhắn của chính Bot)
            // UndoPayload: { msgId, cliMsgId }
            await api.undo({ msgId: msgIdToDel, cliMsgId: cliMsgIdToDel }, threadId, threadType);
        } catch (undoErr) {
            // Nếu không phải tin nhắn của Bot thì Undo sẽ lỗi, chuyển qua DeleteMessage (Xóa tin nhắn người khác nếu bot có quyền Admin)

            // Nếu muốn xoá tin người khác, người gọi lệnh phải có quyền Admin Bot
            if (!adminIds.includes(String(senderId))) {
                return api.sendMessage({ msg: "⚠️ Bot chỉ có thể gỡ tin nhắn người khác nếu người ra lệnh là Admin." }, threadId, threadType);
            }

            try {
                // DeleteMessageDestination: { data: { cliMsgId, msgId, uidFrom }, threadId, type }
                await api.deleteMessage({
                    msgId: String(msgIdToDel),
                    cliMsgId: String(cliMsgIdToDel),
                    ownerId: String(ownerId)
                }, threadId, threadType); // onlyMe = false -> Xoá cho mọi người
            } catch (delErr) {
                await api.sendMessage({ msg: `⚠️ Bot không thể gỡ tin nhắn này. Đảm bảo bot là Trưởng/Phó nhóm (Lỗi: ${delErr.message})` }, threadId, threadType);
            }
        }
    }
};
