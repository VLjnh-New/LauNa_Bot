export const name = "autoReact";

/**
 * Xử lý tự động thả reaction cho tin nhắn mới
 */
export async function handle(ctx) {
    const { api, threadId, threadType, message, isGroup } = ctx;

    // Chỉ hoạt động trong nhóm
    if (!isGroup) return false;

    const settings = autoReactManager.get(threadId);
    if (!settings.enabled) return false;

    const { count, icon } = settings;

    // Thực hiện thả reaction
    for (let i = 0; i < count; i++) {
        const reactIcon = icon || reaction_all[Math.floor(Math.random() * reaction_all.length)];
        // Dùng try-catch để tránh crash nếu tin nhắn bị lỗi
        try {
            await api.addReaction(reactIcon, {
                msgId: message.data.msgId || message.data.globalMsgId,
                cliMsgId: message.data.cliMsgId
            }, threadId, threadType).catch(() => { });
        } catch (e) {
            // Bỏ qua lỗi
        }
    }

    // Trả về false để các module khác vẫn có thể xử lý tin nhắn này
    return false;
}
