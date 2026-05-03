import { log } from "../../logger.js";

const groupAdminCache = new Map();

export const groupAdminManager = {
    clearCache(threadId) {
        if (threadId) groupAdminCache.delete(String(threadId));
        else groupAdminCache.clear();
    },

    // Thêm UID vào cache admin ngay lập tức (không cần fetch lại)
    addToCache(threadId, uid) {
        const tid = String(threadId);
        const u = String(uid);
        if (groupAdminCache.has(tid)) {
            const cached = groupAdminCache.get(tid);
            if (!cached.admins.includes(u)) cached.admins.push(u);
        }
        // Nếu chưa có cache thì xóa để force fetch lần sau
        else groupAdminCache.delete(tid);
    },

    // Xóa UID khỏi cache admin ngay lập tức (không cần fetch lại)
    removeFromCache(threadId, uid) {
        const tid = String(threadId);
        const u = String(uid);
        if (groupAdminCache.has(tid)) {
            const cached = groupAdminCache.get(tid);
            cached.admins = cached.admins.filter(id => id !== u);
        }
    },

    async fetchGroupAdmins(api, threadId) {
        const tid = String(threadId);
        if (groupAdminCache.has(tid)) {
            const cached = groupAdminCache.get(tid);
            if (Date.now() - cached.time < 300000) return cached.admins; // Cache 5 phút
        }
        try {
            const groupRes = await api.getGroupInfo(tid).catch(() => null);
            const info = groupRes?.[tid] || groupRes?.gridInfoMap?.[tid] || groupRes;
            if (!info) return [];
            
            const admins = [];
            if (info.creatorId) admins.push(String(info.creatorId));
            if (Array.isArray(info.adminIds)) {
                info.adminIds.forEach(id => admins.push(String(id)));
            }
            
            groupAdminCache.set(tid, { admins, time: Date.now() });
            return admins;
        } catch (err) { 
            log.error(`Lỗi fetchGroupAdmins cho ${tid}:`, err.message);
            return []; 
        }
    }
};
