import { log } from "../globals.js";
import { appContext, MessageType } from "zca-api";
import { getReaction } from "../utils/core/reactionRegistry.js";

export const name = "reactionUndo";
export const description = "Thu hồi tin nhắn bot khi có reaction";

/**
 * Handle reaction event
 * @param {object} ctx 
 */
export async function handleReaction(ctx) {
    const { api, reaction, threadId, isGroup, log } = ctx;
    const { data } = reaction;
    const { content } = data;

    // console.log(`[ReactionUndo Debug] Raw Data: ${JSON.stringify(data)}`);

    // content.rType === -1 is typically a removed reaction
    if (content.rType === -1) return false;

    // Lấy thông tin tin nhắn bị thả reaction
    const targetMsg = content.rMsg?.[0] || {};
    // gMsgID thường có trong cả group và private event hiện đại
    const targetGlobalId = targetMsg.gMsgID || (isGroup ? null : content.msgId);
    const targetCliId = targetMsg.cMsgID || content.cliMsgId;

    // msgSender: UID người gửi tin (trong group)
    // uidOwner / fuid: UID người sở hữu tin (trong private)
    const ownerId = content.msgSender || data.uidOwner || data.fuid || data.ownerId;
    const botUid = appContext.uid;
    const botUin = appContext.uin;

    if (!targetGlobalId || !ownerId) return false;

    // Nếu tin nhắn đang chờ xác nhận từ registry (note, import...) → bỏ qua, không undo
    if (getReaction(targetGlobalId)) return false;

    // So sánh với cả UID (dài) và UIN (ngắn)
    const isBot = String(ownerId) === String(botUid) || (botUin && String(ownerId) === String(botUin));

    if (!isBot) return false;

    log.chat("EVENT", "ReactionUndo", threadId, `Thu hồi tin nhắn Bot (ID: ${targetGlobalId})`);

    const msgPayload = {
        type: isGroup ? MessageType.GroupMessage : MessageType.DirectMessage,
        threadId: threadId,
        data: {
            msgId: String(targetGlobalId),
            cliMsgId: String(targetCliId),
            uidFrom: String(botUid),
            quote: {
                globalMsgId: String(targetGlobalId),
                cliMsgId: String(targetCliId)
            }
        }
    };

    const msgArgs = [{msgId: String(targetGlobalId), cliMsgId: String(targetCliId)}, threadId, isGroup ? 1 : 0];

    // Thử undoMessage trước
    try {
        await api.undoMessage(...msgArgs);
        return true;
    } catch (_) {}

    // Thử undo (API khác)
    try {
        await api.undo(...msgArgs);
        return true;
    } catch (_) {}

    // Thử deleteMessage for everyone
    try {
        await api.deleteMessage(...msgArgs);
        return true;
    } catch (e3) {
        log.warn(`[ReactionUndo] Không thể thu hồi tin nhắn: ${e3.message}`);
    }

    return false;
}
