import { pendingBoxRemovals, pendingRentRemovals } from "../modules/admin.js";
import { rentalManager } from "../utils/managers/rentalManager.js";
import { log } from "../logger.js";


export const name = "listboxHandler";
export const description = "Xử lý xóa nhóm chưa thuê theo số thứ tự";

export async function handle(ctx) {
    const { content, senderId, threadId, api, isGroup } = ctx;
    const key = `${threadId}-${senderId}`;
    const choice = parseInt(content);
    if (isNaN(choice)) return;


    const unrentedGroups = pendingBoxRemovals.get(key);
    if (unrentedGroups) {
        const target = unrentedGroups.find(g => g.index === choice);
        if (target) {
            try {
                log.info(`✦ Bot đang rời khỏi nhóm: ${target.name} (${target.id}) theo lệnh của admin.`);
                await api.sendMessage({ msg: "✦ Bot xin phép rời nhóm vì chưa được gia hạn. Hẹn gặp lại!" }, target.id, 1).catch(() => { });
                await api.leaveGroup(target.id);
                await api.sendMessage({ msg: `✦ Đã rời khỏi nhóm: ${target.name}\n◈ ID: ${target.id}` }, threadId, isGroup ? 1 : 0);

                const newUnrented = unrentedGroups.filter(g => g.index !== choice);
                if (newUnrented.length === 0) pendingBoxRemovals.delete(key);
                else pendingBoxRemovals.set(key, newUnrented);
                return true;
            } catch (e) {
                log.error("✖ Lỗi khi rời nhóm:", e.message);
                await api.sendMessage({ msg: `✖ Lỗi khi rời nhóm ${target.name}: ${e.message}` }, threadId, isGroup ? 1 : 0);
            }
        }
    }


    const rentedGroups = pendingRentRemovals.get(key);
    if (rentedGroups) {
        const target = rentedGroups.find(g => g.index === choice);
        if (target) {
            try {
                const success = rentalManager.removeRent(target.id);
                if (success) {
                    await api.sendMessage({ msg: `✦ Đã XOÁ NGÀY THUÊ thành công cho Box:\n◈ ID: ${target.id}` }, threadId, isGroup ? 1 : 0);

                    const newRented = rentedGroups.filter(g => g.index !== choice);
                    if (newRented.length === 0) pendingRentRemovals.delete(key);
                    else pendingRentRemovals.set(key, newRented);
                } else {
                    await api.sendMessage({ msg: `✖ Không thể xóa ngày thuê cho Box:\n◈ ID: ${target.id}. Có thể không tìm thấy hoặc đã hết hạn.` }, threadId, isGroup ? 1 : 0);
                }
                return true;
            } catch (e) {
                log.error("✖ Lỗi khi xóa thuê:", e.message);
                await api.sendMessage({ msg: `✖ Lỗi khi xóa thuê cho Box ${target.id}: ${e.message}` }, threadId, isGroup ? 1 : 0);
            }
        }
    }
    return false;
}
