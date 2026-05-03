import { rentalManager } from "../globals.js";
import { pendingRentRemovals } from "./admin.js";

export const name = "rent";
export const description = "Quản lý thuê bot: rent, activate";

async function reply(ctx, text, ttl = 0) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data, ttl },
        ctx.threadId,
        ctx.threadType
    );
}

function isAdmin(ctx) {
    return ctx.adminIds.includes(String(ctx.senderId));
}

async function getGroupName(api, groupId) {
    if (!groupId) return "Nhóm ẩn danh";
    try {
        const info = await api.getGroupInfo(groupId);
        const groupInfo = info.gridInfoMap?.[groupId] || info;
        return groupInfo.name || groupInfo.groupName || groupId;
    } catch { return groupId; }
}

export const commands = {
    // !rent hoặc !rent add/del/list
    rent: async (ctx) => {
        const { api, args, threadId, threadType, senderId, prefix } = ctx;
        const [sub, arg1, arg2] = args;
        const isUserAdmin = isAdmin(ctx);

        // 1. Chỉ Admin mới được sử dụng lệnh !rent
        if (!isUserAdmin) {
            return reply(ctx, `⚠️ Lệnh này chỉ dành cho Admin Bot!`);
        }

        // 2. Đối với Admin:
        // Nếu gõ !rent không có sub-command -> Liệt kê menu chức năng
        if (!sub) {
            let help = `[ ⚙️ QUẢN LÝ THUÊ BOT ]\n`;
            help += `─────────────────\n`;
            help += ` ❯ ${prefix}rent add [ngày] [id] [tier] ➥ Gia hạn\n`;
            help += ` ❯ ${prefix}rent del [id]      ➥ Xóa hạn\n`;
            help += ` ❯ ${prefix}rent list          ➥ Xem danh sách\n`;
            help += ` ❯ ${prefix}rent key [ngày] [tier] ➥ Tạo Key\n`;
            help += ` ❯ ${prefix}rent info              ➥ Xem hạn Box\n`;
            help += ` ❯ ${prefix}rent activate [key]    ➥ Kích hoạt Key\n`;
            help += `─────────────────\n`;
            help += `💡 tier: gold, silver, normal`;
            return reply(ctx, help);
        }

        switch (sub.toLowerCase()) {
            case "info":
            case "status": {
                const expiry = rentalManager.getExpiry(threadId);
                let msg = `[ 📊 KIỂM TRA HẠN DÙNG ]\n`;
                msg += `─────────────────\n`;
                msg += ` 🏠 Nhóm: ${ctx.threadName || "Nhóm hiện tại"}\n`;
                msg += ` 🆔 ID: ${threadId}\n`;
                msg += ` 📅 Hạn: ${expiry}\n─────────────────\n`;
                msg += `✨ Liên hệ Admin để gia hạn thêm nha!`;
                await reply(ctx, msg);
                break;
            }
            case "add": {
                let days = parseInt(arg1);
                let targetId = arg2 || threadId;
                let tierInput = (args[3] || "normal").toLowerCase();
                let tier = tierInput === "bạc" ? "silver" : (tierInput === "vàng" ? "gold" : tierInput);
                if (isNaN(days)) return reply(ctx, `◈ Cách dùng: ${prefix}rent add [số ngày] [ID Box] [tier]`);

                const groupName = await getGroupName(api, targetId);
                const newExp = rentalManager.addRent(targetId, days, tier);
                const dateStr = new Date(newExp).toLocaleString("vi-VN");
                let succMsg = `[ ✅ GIA HẠN THÀNH CÔNG ]\n─────────────────\n`;
                succMsg += ` 🏠 Nhóm: ${groupName}\n 🆔 ID: ${targetId}\n ⏳ Thêm: ${days} ngày\n 💎 Gói: ${tier.toUpperCase()}\n 📅 Hạn mới: ${dateStr}\n─────────────────\n🚀 Chúc sếp trải nghiệm vui vẻ!`;
                await reply(ctx, succMsg);
                break;
            }

            case "del": {
                let targetId = arg1 || threadId;
                const groupName = await getGroupName(api, targetId);
                const success = rentalManager.removeRent(targetId);
                if (success) {
                    await reply(ctx, `[ 🗑️ XÓA HẠN THUÊ ]\n─────────────────\n✅ Đã xóa dữ liệu thuê của Nhóm:\n ➥ ${groupName} (${targetId})\n─────────────────\n✨ Nhóm này đã trở về trạng thái chưa thuê sếp ơi!`);
                } else {
                    await reply(ctx, `⚠️ Sếp ơi, Hân hông tìm thấy dữ liệu thuê của Nhóm [ ${groupName} ] đâu hết!`);
                }
                break;
            }

            case "list": {
                try {
                    const rentedData = rentalManager.getAllRentals();
                    if (rentedData.length === 0) return reply(ctx, "⚠️ Hiện chưa có nhóm nào đang thuê.");

                    // Lấy info nhóm (cố gắng lấy tên)
                    let groupInfoMap = {};
                    try {
                        const ids = rentedData.map(r => r.id);
                        const groupInfoResp = await api.getGroupInfo(ids);
                        groupInfoMap = groupInfoResp.gridInfoMap || {};
                    } catch (e) { }

                    let msg = `[ 🏆 DANH SÁCH THUÊ BOT ]\n`;
                    msg += `─────────────────\n`;
                    msg += `➥ Nhập STT để XÓA NGÀY THUÊ sếp nha.\n\n`;

                    const rentedGroupsList = [];
                    rentedData.forEach((item, i) => {
                        const index = i + 1;
                        const info = groupInfoMap[item.id];
                        const name = info ? info.name : "Nhóm ẩn danh";
                        const expiry = new Date(item.exp).toLocaleString("vi-VN");

                        msg += ` ${index}. ${name}\n 🔗 ID: ${item.id}\n 📅 Hạn: ${expiry}\n\n`;
                        rentedGroupsList.push({ index, id: item.id, name });
                    });
                    
                    msg += `─────────────────\n💡 Có ${rentedData.length} nhóm đang thuê.`;
                    await reply(ctx, msg);

                    // Sử dụng Map từ global để đồng bộ với admin handler
                    const removalsMap = global.pendingRentRemovals || pendingRentRemovals;
                    removalsMap.set(`${threadId}-${senderId}`, rentedGroupsList);
                    setTimeout(() => {
                        removalsMap.delete(`${threadId}-${senderId}`);
                    }, 60000);

                } catch (e) {
                    await reply(ctx, `⚠️ Lỗi: ${e.message}`);
                }
                break;
            }

            case "key": {
                let days = parseInt(arg1);
                let tierInput = (arg2 || "normal").toLowerCase();
                let tier = tierInput === "bạc" ? "silver" : (tierInput === "vàng" ? "gold" : tierInput);
                if (isNaN(days)) return reply(ctx, `◈ Cách dùng: ${prefix}rent key [số ngày] [tier]`);
                const key = keyManager.generateKey(days, tier, `Admin: ${senderId}`);
                await reply(ctx, `🔑 Đã tạo mã kích hoạt ${days} ngày (Gói: ${tier}):\n➥ ${key}\n\n👉 Dùng: ${prefix}rent activate ${key} để sử dụng.`);
                break;
            }

            case "activate": {
                const key = arg1;
                if (!key) return reply(ctx, `⚠️ Cách dùng: ${prefix}rent activate [mã kích hoạt]`);
                const result = keyManager.useKey(key, threadId);
                if (result.success) {
                    const newExp  = rentalManager.addRent(threadId, result.days, result.tier);
                    const dateStr = new Date(newExp).toLocaleString("vi-VN");
                    let msg = `[ ✅ KÍCH HOẠT THÀNH CÔNG ]\n─────────────────\n`;
                    msg += `◈ GÓI: ${result.tier.toUpperCase()}\n`;
                    msg += `◈ THÊM: ${result.days} ngày\n`;
                    msg += `◈ HẠN MỚI: ${dateStr}\n─────────────────\n`;
                    msg += `✨ Cảm ơn bạn đã tin dùng dịch vụ!`;
                    await reply(ctx, msg);
                } else {
                    await reply(ctx, `⚠️ Lỗi: ${result.msg}`);
                }
                break;
            }

            default: {
                let help = `[ ⚙️ QUẢN LÝ THUÊ BOT ]\n`;
                help += `─────────────────\n`;
                help += ` ❯ ${prefix}rent add [ngày] [id] [tier] ➥ Gia hạn\n`;
                help += ` ❯ ${prefix}rent del [id]              ➥ Xóa hạn\n`;
                help += ` ❯ ${prefix}rent list                  ➥ Xem danh sách\n`;
                help += ` ❯ ${prefix}rent key [ngày] [tier]     ➥ Tạo Key\n`;
                help += ` ❯ ${prefix}rent info                  ➥ Xem hạn Box\n`;
                help += ` ❯ ${prefix}rent activate [key]        ➥ Kích hoạt Key\n`;
                help += `─────────────────\n`;
                help += `💡 tier: gold, silver, normal`;
                await reply(ctx, help);
            }
        }
    },
};
