import { fs, path, log } from "../globals.js";

export const name = "duyetmem";
export const description = "Tự động duyệt thành viên bằng tính năng duyệt Pending Members của zca-js";

const TOGGLE_FILE = path.join(process.cwd(), "src", "modules", "cache", "duyetmem_toggle.json");

function loadToggle() {
    try {
        if (fs.existsSync(TOGGLE_FILE)) return JSON.parse(fs.readFileSync(TOGGLE_FILE, "utf8"));
    } catch { }
    return {};
}

function saveToggle(data) {
    fs.writeFileSync(TOGGLE_FILE, JSON.stringify(data, null, 2), "utf8");
}

function isAutoApproveEnabled(threadId) {
    const data = loadToggle();
    return data[threadId] === true || data[threadId] === "auto";
}

function isStrictAuto(threadId) {
    const data = loadToggle();
    return data[threadId] === "auto";
}

function setAutoApprove(threadId, enabled) {
    const data = loadToggle();
    data[threadId] = enabled;
    saveToggle(data);
}

export const commands = {
    duyetmem: async (ctx) => {
        const { api, args, threadId, threadType, senderId, adminIds, isGroup } = ctx;
        if (!isGroup) return api.sendMessage({ msg: "⚠️ Lệnh này chỉ dùng trong nhóm." }, threadId, threadType);

        if (!adminIds.includes(String(senderId))) {
            return api.sendMessage({ msg: "⚠️ Chỉ Admin Bot hoặc người quản trị được cấp quyền mới được tự động cấu hình tính năng này." }, threadId, threadType);
        }

        const sub = (args[0] || "").toLowerCase();

        if (sub === "on" || sub === "bật") {
            setAutoApprove(threadId, true);
            const msg = "🛡️ [ KIỂM SOÁT DUYỆT ]\n─────────────────\n✅ Đã BẬT chế độ duyệt bằng tay.\n📌 Bot sẽ báo cáo khi có người xin vào, QTV reply 'ok' để cho vào sếp nha!";
            await api.sendMessage({ msg }, threadId, threadType);

            try {
                const pendingData = await api.getPendingGroupMembers(threadId);
                if (pendingData?.users?.length > 0) {
                    const ids = pendingData.users.map(u => u.uid);
                    await api.reviewPendingMemberRequest({ members: ids, isApprove: true }, threadId);
                    await api.sendMessage({ msg: `✨ Hân đã dọn dẹp và duyệt ${ids.length} thành viên cũ đang chờ rồi nhé!` }, threadId, threadType);
                }
            } catch (err) { }

        } else if (sub === "auto") {
            setAutoApprove(threadId, "auto");
            const msg = "🛡️ [ AUTO DUYỆT MEM ]\n─────────────────\n🚀 Đã BẬT chế độ DUYỆT TỰ ĐỘNG 100%.\n✨ Từ giờ ai xin vào Hân sẽ cho vào luôn, sếp hông cần gõ 'ok' nữa đâu!";
            await api.sendMessage({ msg }, threadId, threadType);

        } else if (sub === "off" || sub === "tắt") {
            setAutoApprove(threadId, false);
            const msg = "🛡️ [ TẮT DUYỆT MEM ]\n─────────────────\n❌ Đã dừng tính năng duyệt thành viên sếp nha!";
            await api.sendMessage({ msg }, threadId, threadType);

        } else if (sub === "link") {
            try {
                const linkInfo = await api.enableGroupLink(threadId);
                if (linkInfo?.link) {
                    await api.sendMessage({ msg: `🔗 [ LINK NHÓM ]\n─────────────────\n➥ ${linkInfo.link}\n─────────────────\n✨ Gửi link này cho bạn bè để họ vào nhóm nha!` }, threadId, threadType);
                }
            } catch (err) {
                await api.sendMessage({ msg: `⚠️ Bot hông lấy được link nhóm (Sếp xem Hân đã là QTV chưa nha).` }, threadId, threadType);
            }
        } else if (sub === "close" || sub === "dong") {
            try {
                await api.disableGroupLink(threadId);
                await api.sendMessage({ msg: `🚫 [ KHÓA LINK ]\n─────────────────\n✅ Đã khóa Link tham gia nhóm thành công sếp ơi!` }, threadId, threadType);
            } catch (err) {
                await api.sendMessage({ msg: `⚠️ Thất bại: ${err.message}` }, threadId, threadType);
            }
        } else {
            const current = loadToggle()[threadId];
            const status = current === "auto" ? "TỰ ĐỘNG (AUTO) 🚀" : (current === true ? "THỦ CÔNG (MANUAL) 🛡️" : "ĐANG TẮT ❌");
            let help = `[ 🛡️ QUẢN LÝ THÀNH VIÊN ]\n`;
            help += `─────────────────\n`;
            help += ` ❯ Trạng thái: ${status}\n`;
            help += `─────────────────\n`;
            help += ` ❯ ${ctx.prefix}duyetmem on   ➥ Duyệt khi sếp nói ok\n`;
            help += ` ❯ ${ctx.prefix}duyetmem auto ➥ Tự duyệt luôn 100%\n`;
            help += ` ❯ ${ctx.prefix}duyetmem off  ➥ Tắt tính năng\n`;
            help += ` ❯ ${ctx.prefix}duyetmem link ➥ Lấy link nhóm\n`;
            help += ` ❯ ${ctx.prefix}duyetmem close➥ Khóa link nhóm\n`;
            help += `─────────────────\n💡 Nhóm sếp, Hân quản, duyệt mem Hân lo!`;
            await api.sendMessage({ msg: help }, threadId, threadType);
        }
    }
};

export const pendingApprovals = new Map();

export async function handle(ctx) {
    const { content, threadId, message, api, log, threadType, adminIds, senderId } = ctx;
    const body = content?.trim().toLowerCase();

    const quote = message.data?.quote || message.data?.content?.quote;
    const quoteId = quote?.globalMsgId || quote?.msgId;

    const isTrigger = body === "ok" || body === "duyệt" || body.endsWith(" ok") || body.endsWith(" duyệt");

    if (isTrigger) {
    }

    if (quoteId && isTrigger) {
        const pending = pendingApprovals.get(threadId);

        if (pending && String(pending.msgId) === String(quoteId)) {
            let isBoxAdmin = false;
            try {
                const groupInfo = await api.getGroupInfo(threadId);
                const groupData = groupInfo.gridInfoMap?.[threadId] || groupInfo[threadId] || groupInfo;
                if (groupData?.adminIds?.includes(String(senderId)) || groupData?.creatorId === String(senderId)) {
                    isBoxAdmin = true;
                }
            } catch (e) {
                log.error(`[DuyetMem] Lỗi lấy groupInfo check quyền: ${e.message}`);
                if (adminIds.includes(String(senderId))) isBoxAdmin = true;
            }

            if (!isBoxAdmin) {
                await api.sendMessage({ msg: "⚠️ Chỉ Quản trị viên (QTV) của Nhóm mới có quyền dùng phản hồi 'ok' hoặc 'duyệt' để chấp nhận thành viên!" }, threadId, threadType);
                return true;
            }

            try {
                const pendingData = await api.getPendingGroupMembers(threadId);
                const users = pendingData?.users || [];

                if (users.length === 0) {
                    await api.sendMessage({ msg: "⚠️ Không còn thành viên nào trong danh sách chờ duyệt." }, threadId, threadType);
                    pendingApprovals.delete(threadId);
                    return true;
                }

                const idsToApprove = users.map(u => u.uid);
                await api.reviewPendingMemberRequest({ members: idsToApprove, isApprove: true }, threadId);

                await api.sendMessage({
                    msg: `✅ Đã duyệt thành công ${users.length} thành viên theo yêu cầu!`,
                    quote: message.data
                }, threadId, threadType);

                pendingApprovals.delete(threadId);
                return true;
            } catch (e) {
                log.error(`[DuyetMem] Lỗi duyệt mem qua phản hồi: ${e.message}`);
                await api.sendMessage({ msg: `❌ Lỗi: ${e.message}` }, threadId, threadType);
            }
        }
    }
    return false;
}

export async function handleGroupEvent(ctx) {
    const { api, event, threadId, log } = ctx;

    if (event.type !== "join_request") return;
    if (!isAutoApproveEnabled(threadId)) return;

    try {
        const pendingData = await api.getPendingGroupMembers(threadId);
        const users = pendingData?.users || [];

        if (users.length === 0) return;

        const names = [];
        for (const u of users) {
            let name = u.dName || u.name;
            if (!name) {
                try {
                    const res = await api.getUserInfo(u.uid);
                    const profile = res.changed_profiles?.[u.uid] || res[u.uid] || res;
                    name = profile?.zaloName || profile?.displayName || `UID: ${u.uid}`;
                } catch {
                    name = `UID: ${u.uid}`;
                }
            }
            names.push(name);
        }

        const nameList = names.join('\n 👤 ');
        const howText = event.data?.joinType === 1 ? 'dùng Link mời' : 'xin tham gia';

        // Check nếu là Strict Auto thì duyệt luôn
        if (isStrictAuto(threadId)) {
            const ids = users.map(u => u.uid);
            await api.reviewPendingMemberRequest({ members: ids, isApprove: true }, threadId);
            const welcomeMsg = `🛡️ [ AUTO DUYỆT THÀNH VIÊN ]\n─────────────────\n✅ Đã tự động duyệt ${users.length} thành viên ${howText} sếp ơi!\n👤 Thành viên: ${names.join(", ")}\n─────────────────\n✨ Chào mừng các bạn gia nhập nhóm nha! 💖`;
            return await api.sendMessage({ msg: welcomeMsg }, threadId, 1);
        }

        const sent = await api.sendMessage({
            msg: `🛡️ [ YÊU CẦU THAM GIA ]\n─────────────────\n✨ Có ${users.length} thành viên đang ${howText}:\n 👤 ${nameList}\n─────────────────\n👉 Phản hồi "ok" hoặc "duyệt" để chấp nhận nhé!`,
        }, threadId, 1);


        const msgId = sent?.message?.data?.msgId || sent?.message?.msgId || sent?.message?.data?.msgid || sent?.message?.msgid ||
            sent?.link?.data?.msgId || sent?.link?.msgId ||
            (sent?.attachment && (sent.attachment[0]?.data?.msgId || sent.attachment[0]?.msgId));

        if (msgId) {
            pendingApprovals.set(threadId, {
                msgId: String(msgId),
                uids: users.map(u => u.uid)
            });
        } else {
            log.error(`[DuyetMem] KHÔNG lấy được msgId từ response gửi tin!`);
        }

    } catch (e) {
        log.error(`[DuyetMem] Lỗi thông báo duyệt mem: ${e.message}`);
    }
}
