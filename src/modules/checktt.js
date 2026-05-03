import { statsManager } from "../globals.js";

export const name = "checktt";
export const description = "Kiểm tra tương tác nhóm: checktt, top";

async function reply(ctx, text) {
    await ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

export const commands = {

    // !checktt - Xem tương tác của bản thân hoặc người được tag (giả lập tag bằng ID)
    checktt: async (ctx) => {
        if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng trong nhóm!");

        let targetId = null;

        // 1. Kiểm tra tag (@)
        if (ctx.message.data.mentions && ctx.message.data.mentions.length > 0) {
            targetId = ctx.message.data.mentions[0].uid;
        }
        // 2. Kiểm tra reply
        else if (ctx.message.data.quote && ctx.message.data.quote.ownerId) {
            targetId = ctx.message.data.quote.ownerId;
        }
        // 3. Kiểm tra User ID truyền vào (nếu là số)
        else if (ctx.args[0] && /^\d+$/.test(ctx.args[0])) {
            targetId = ctx.args[0];
        }
        // 4. Kiểm tra 'all'
        else if (ctx.args[0]?.toLowerCase() === "all") {
            return checkAll(ctx);
        }
        // 5. Mặc định là bản thân
        else {
            targetId = ctx.senderId;
        }

        const stats = statsManager.getStats(ctx.threadId, targetId);

        if (!stats) return reply(ctx, "⚠️ Hiện chưa có dữ liệu tương tác cho người này.");

        const now = Date.now();
        const daysInGroup = Math.floor((now - stats.joinDate) / (1000 * 60 * 60 * 24));
        const joinDateStr = new Date(stats.joinDate).toLocaleDateString("vi-VN");

        let msg = `[ 📊 TƯƠNG TÁC CÁ NHÂN ]\n`;
        msg += `─────────────────\n`;
        msg += `👤 Name: ${stats.name}\n`;
        msg += `🆔 ID: ${targetId}\n`;
        msg += `🎖️ Chức vụ: ${stats.role || "Thành viên"}\n`;
        msg += `📅 Ngày vào: ${joinDateStr}\n`;
        msg += `⏱️ Thời gian: ${daysInGroup} ngày vừa qua\n`;
        msg += `─────────────────\n`;
        msg += `💬 Hôm nay: ${stats.day} tin nhắn\n`;
        msg += `💬 Tuần này: ${stats.week} tin nhắn\n`;
        msg += `💬 Tổng: ${stats.total} tin nhắn\n`;
        msg += `─────────────────\n`;
        msg += `🔥 Hãy tích cực tương tác nhé! ✨`;

        await reply(ctx, msg);
    },

    // !top [total/day/week] - Xem bảng xếp hạng
    top: async (ctx) => {
        if (!ctx.isGroup) return reply(ctx, "⚠️ Lệnh này chỉ dùng trong nhóm!");

        const typeMap = {
            "all": "total",
            "total": "total",
            "day": "day",
            "week": "week"
        };
        const typeArg = ctx.args[0]?.toLowerCase() || "total";
        const type = typeMap[typeArg] || "total";
        const typeName = type === "day" ? "NGÀY" : (type === "week" ? "TUẦN" : "TỔNG");

        const topList = statsManager.getTop(ctx.threadId, type, 10);

        if (topList.length === 0) return reply(ctx, "⚠️ Chưa có dữ liệu tương tác trong nhóm này.");

        let boxName = "Nhóm";
        try {
            const groupRes = await ctx.api.getGroupInfo(ctx.threadId);
            // Log để debug chính xác cấu trúc API hiện tại
            // console.log("[Debug] getGroupInfo:", JSON.stringify(groupRes).substring(0, 200));

            // Thử các trường hợp phổ biến của zca-js/Zalo API
            const info = groupRes.gridInfoMap?.[ctx.threadId] || groupRes[ctx.threadId] || groupRes;
            boxName = info?.gName || info?.gname || info?.name || info?.title || "Nhóm";
        } catch (e) {
            console.error("Lỗi lấy tên nhóm:", e.message);
        }

        let msg = `[ 🏆 TOP TƯƠNG TÁC ${typeName} ]\n`;
        msg += `─────────────────\n`;
        msg += `📂 Box: ${boxName}\n`;
        msg += `─────────────────\n`;

        topList.forEach((u, i) => {
            const medal = i === 0 ? "🥇" : (i === 1 ? "🥈" : (i === 2 ? "🥉" : `${i + 1}.`));
            msg += `${medal} ${u.name}: ${u[type]} tin nhắn\n`;
        });

        msg += `─────────────────\n`;
        msg += `✨ Dùng !checktt để xem chi tiết bản thân.`;

        await reply(ctx, msg);
    }

};

async function checkAll(ctx) {
    const { api, threadId, threadType, log } = ctx;

    // Lấy toàn bộ danh sách thành viên từ statsManager
    const topList = statsManager.getTop(threadId, "total", 100); // Lấy tối đa 100 người cho gọn

    if (topList.length === 0) return reply(ctx, "⚠️ Chưa có dữ liệu tương tác trong nhóm này.");

    let boxName = "Nhóm";
    try {
        const groupRes = await api.getGroupInfo(threadId);
        const info = groupRes.gridInfoMap?.[threadId] || groupRes[threadId] || groupRes;
        boxName = info?.gName || info?.gname || info?.name || info?.title || "Nhóm";
    } catch (e) { }

    let msg = `[ 📊 TỔNG TƯƠNG TÁC NHÓM ]\n`;
    msg += `─────────────────\n`;
    msg += `📂 Box: ${boxName}\n`;
    msg += `👥 Tổng số: ${topList.length} thành viên đã nhắn tin\n`;
    msg += `─────────────────\n\n`;

    topList.forEach((u, i) => {
        const medal = i === 0 ? "🥇" : (i === 1 ? "🥈" : (i === 2 ? "🥉" : `${i + 1}.`));
        msg += `${medal} ${u.name}: ${u.total} (Hôm nay: ${u.day})\n`;
    });

    msg += `\n─────────────────\n`;
    msg += `✨ Dùng !checktt để xem chi tiết bản thân.`;

    await reply(ctx, msg);
}
