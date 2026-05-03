import { getReaction, deleteReaction } from "../utils/core/reactionRegistry.js";
import { log } from "../globals.js";

export const name = "reactionConfirm";
export const description = "Xử lý reaction xác nhận từ các lệnh (note, v.v.)";

export async function handleReaction(ctx) {
  const { api, reaction, threadId, threadType, isGroup } = ctx;
  const { data } = reaction;
  const { content } = data;

  if (content?.rType === -1) return false;

  const targetMsg = content?.rMsg?.[0] || {};
  const targetGlobalId = String(targetMsg.gMsgID || content?.msgId || "");
  if (!targetGlobalId) return false;

  const entry = getReaction(targetGlobalId);
  if (!entry) return false;

  const reactorId = String(
    data.uidFrom || data.uid || data.senderId ||
    content?.uid || content?.uidFrom || ""
  );

  if (entry.senderId && entry.senderId !== reactorId) return false;

  deleteReaction(targetGlobalId);

  try {
    await entry.handler({ api, threadId, threadType, isGroup, reactorId, log });
  } catch (err) {
    log.error(`[reactionConfirm] handler lỗi: ${err.message}`);
    try {
      await api.sendMessage(
        { msg: `❌ Lỗi xử lý reaction: ${err.message}` },
        threadId,
        threadType
      );
    } catch (_) {}
  }

  return true;
}
