import { fs, path, log } from "../globals.js";
import { drawWelcome, drawGoodbye } from "../utils/canvas/canvasHelper.js";

export const name = "groupNotify";
export const description = "Thông báo join/leave nhóm với Card Canvas Premium";

export async function handle(ctx) { }

export async function handleGroupEvent(ctx) {
    const { api, event, threadId, threadType } = ctx;
    const { type, data } = event;

    // 1. NGƯỜI THAM GIA NHÓM
    if (type === "join") {
        const members = data.updateMembers || [];
        const approverId = data.approverId || null;
        let approverName = "";

        if (approverId) {
            try {
                const appInfo = await api.getUserInfo(approverId);
                const profiles = appInfo.changed_profiles || appInfo;
                const p = profiles[approverId] || Object.values(profiles)[0];
                approverName = p?.zaloName || p?.displayName || "Admin";
            } catch { }
        }

        for (const member of members) {
            const nameFallback = member.dName || "bạn";
            const welcomeMsg = `🎊 Chào mừng ${nameFallback} đã tham gia nhóm! Chúc bạn có những giây phút vui vẻ cùng mọi người nhé. ✨`;
            try {
                const targetId = member.uId || member.id || member.userId;
                if (!targetId) continue;

                const result = await api.getUserInfo(targetId).catch(() => null);
                let userInfo = null;
                if (result) {
                    const profiles = result.changed_profiles || result;
                    userInfo = profiles[targetId] || Object.values(profiles)[0] || result;
                }

                const finalData = {
                    ...userInfo,
                    displayName: userInfo?.zaloName || userInfo?.displayName || member.dName,
                    avatar: userInfo?.avatar || member.avatar || member.avatar_25
                };

                const groupInfo = await api.getGroupInfo(threadId).catch(() => null);
                const groupName = groupInfo?.name || "nhóm";
                const groupAvatar = groupInfo?.avatar || "";

                const buffer = await drawWelcome(finalData, groupName, approverName, groupAvatar);

                if (buffer && Buffer.isBuffer(buffer)) {
                    const tempPath = path.join(process.cwd(), `welcome_${targetId}_${Date.now()}.png`);
                    fs.writeFileSync(tempPath, buffer);
                    await api.sendMessage({
                        msg: welcomeMsg,
                        attachments: [tempPath]
                    }, threadId, threadType);
                    try { fs.unlinkSync(tempPath); } catch {}
                } else {
                    await api.sendMessage({ msg: welcomeMsg }, threadId, threadType);
                }
            } catch (err) {
                log.warn(`[groupNotify] Welcome lỗi: ${err.message}`);
                await api.sendMessage({ msg: welcomeMsg }, threadId, threadType).catch(() => {});
            }
        }
    }

    // 2. NGƯỜI RỜI NHÓM
    else if (type === "leave" || type === "remove_member") {
        const members = data.updateMembers || [];
        const groupInfo = await api.getGroupInfo(threadId).catch(() => null);
        const groupName = groupInfo?.name || "nhóm";

        for (const member of members) {
            const actionText = type === "leave" ? "đã rời khỏi nhóm" : "đã được mời ra khỏi nhóm";
            const goodbyeMsg = `👋 ${member.dName || "Thành viên"} ${actionText}. Chúc bạn gặp nhiều may mắn! 💫`;
            try {
                const targetId = member.uId || member.id || member.userId;
                const finalData = {
                    displayName: member.dName,
                    avatar: member.avatar || member.avatar_25
                };

                const buffer = await drawGoodbye(finalData, groupName);

                if (buffer && Buffer.isBuffer(buffer)) {
                    const tempPath = path.join(process.cwd(), `goodbye_${targetId}_${Date.now()}.png`);
                    fs.writeFileSync(tempPath, buffer);
                    await api.sendMessage({
                        msg: goodbyeMsg,
                        attachments: [tempPath]
                    }, threadId, threadType);
                    try { fs.unlinkSync(tempPath); } catch {}
                } else {
                    await api.sendMessage({ msg: goodbyeMsg }, threadId, threadType);
                }
            } catch (err) {
                log.warn(`[groupNotify] Goodbye lỗi: ${err.message}`);
                await api.sendMessage({ msg: goodbyeMsg }, threadId, threadType).catch(() => {});
            }
        }
    }
}
