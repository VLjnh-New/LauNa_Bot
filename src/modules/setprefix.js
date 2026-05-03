import { rentalManager } from "../globals.js";

export const name = "setprefix";
export const description = "Thay đổi ký tự lệnh (prefix) riêng cho nhóm hiện tại";

export const commands = {
    setprefix: async (ctx) => {
        const { api, threadId, threadType, senderId, adminIds, isGroup, args, prefix: defaultPrefix } = ctx;

        if (!isGroup) {
            return api.sendMessage({ msg: "⚠️ Lệnh này chỉ dùng trong nhóm!" }, threadId, threadType);
        }

        // Chỉ Admin nhóm/bot mới được dùng
        if (!adminIds.includes(String(senderId)) && !rentalManager.isRented(threadId)) {
            return;
        }

        const newPrefix = args[0];

        if (!newPrefix) {
            const currentPrefix = prefixManager.getPrefix(threadId) || defaultPrefix;
            return api.sendMessage({ msg: `📌 Prefix hiện tại của nhóm: ${currentPrefix}\n💡 Dùng: ${currentPrefix}setprefix [ký tự mới] hoặc "reset" để quay về mặc định` }, threadId, threadType);
        }

        if (newPrefix.toLowerCase() === "reset") {
            prefixManager.resetPrefix(threadId);
            return api.sendMessage({ msg: `✅ Đã khôi phục Prefix về mặc định: ${defaultPrefix}` }, threadId, threadType);
        }

        if (newPrefix.length > 2) {
            return api.sendMessage({ msg: "⚠️ Prefix chỉ nên dài từ 1 đến 2 ký tự." }, threadId, threadType);
        }

        if (newPrefix === "prefix" || newPrefix.match(/^[a-z0-9]+$/i)) {
            return api.sendMessage({ msg: "⚠️ Vui lòng không đặt Prefix bằng chữ cái/số để tránh trùng lặp tin nhắn chat." }, threadId, threadType);
        }

        prefixManager.setPrefix(threadId, newPrefix);
        return api.sendMessage({ msg: `✅ Đã đổi Prefix của nhóm thành: ${newPrefix}\n💡 Gõ ${newPrefix}menu để xem danh sách lệnh!` }, threadId, threadType);
    }
};
