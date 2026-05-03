import { log } from "../globals.js";
import { AvatarSize } from "zca-api";

export const name = "find";
export const description = "Tra cứu bạn bè Zalo: online, lastonline, tìm theo SĐT";

export const commands = {
    find: async (ctx) => {
        const { api, args, message, threadId, threadType, prefix } = ctx;
        const sub = args[0]?.toLowerCase();

        if (sub === "online") {
            try {
                await api.sendMessage({ msg: "⏳ Đang lấy danh sách bạn bè đang online..." }, threadId, threadType);
                const res = await api.getFriendOnlines();
                const list = res?.friends || res?.data || res || [];
                if (!Array.isArray(list) || list.length === 0) return api.sendMessage({ msg: "📴 Hiện không có bạn bè nào đang online." }, threadId, threadType);
                let msg = `[ 🟢 BẠN BÈ ĐANG ONLINE (${list.length}) ]\n─────────────────\n`;
                list.slice(0, 30).forEach((f, i) => {
                    const name = f.displayName || f.zaloName || f.dName || `UID: ${f.uid}`;
                    msg += `${i + 1}. ${name}\n`;
                });
                if (list.length > 30) msg += `... và ${list.length - 30} người khác\n`;
                msg += `─────────────────`;
                await api.sendMessage({ msg }, threadId, threadType);
            } catch (e) { await api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType); }
            return;
        }

        if (sub === "last") {
            const quote = message.data?.quote;
            let uid = null;
            if (message.data?.mentions?.length) uid = String(message.data.mentions[0].uid);
            else if (quote?.uidFrom || quote?.ownerId) uid = String(quote.uidFrom || quote.ownerId);
            else if (args[1] && /^\d+$/.test(args[1])) uid = args[1];
            if (!uid) return api.sendMessage({ msg: `◈ Cú pháp: ${prefix}find last [@tag / reply / ID]` }, threadId, threadType);
            try {
                const res = await api.lastOnline(uid);
                const ts = res?.lastOnline || res?.lastActive || res;
                const time = ts ? new Date(Number(ts) * 1000).toLocaleString("vi-VN") : "Không rõ";
                await api.sendMessage({ msg: `⏱ Lần cuối online của UID ${uid}:\n📅 ${time}` }, threadId, threadType);
            } catch (e) { await api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType); }
            return;
        }

        const phoneRaw = sub || "";
        if (!phoneRaw) {
            return api.sendMessage({
                msg: `[ 🔍 TRA CỨU ZALO ]\n─────────────────\n` +
                    `${prefix}find [SĐT]     — Tra cứu theo số điện thoại\n` +
                    `${prefix}find online    — Xem bạn bè đang online\n` +
                    `${prefix}find last [@]  — Lần cuối online\n─────────────────`
            }, threadId, threadType);
        }

        const phoneInput = phoneRaw.replace(/\D/g, "");
        try {
            await api.sendMessage({ msg: `⏳ Đang tra cứu thông tin số ${phoneInput} trên Data Zalo...` }, threadId, threadType);
            const result = await api.getMultiUsersByPhones(phoneInput, AvatarSize.Large);
            if (!result || Object.keys(result).length === 0) {
                return api.sendMessage({ msg: `❌ Không tìm thấy thông tin/Tài khoản không tồn tại của SĐT: ${phoneInput}` }, threadId, threadType);
            }
            const phoneKey = Object.keys(result)[0];
            const user = result[phoneKey];
            if (!user || user.error) {
                return api.sendMessage({ msg: `❌ Tài khoản khoá số, không có dữ liệu cho SĐT: ${phoneInput}` }, threadId, threadType);
            }
            let msg = `[ 🔍 HỒ SƠ ZALO ]\n─────────────────\n`;
            msg += `◈ SĐT Tìm : ${phoneInput}\n`;
            msg += `◈ Tên Zalo: ${user.dName || user.zaloName || "Ẩn"}\n`;
            msg += `◈ UID     : ${user.uid || "Chưa cấp"}\n`;
            msg += `─────────────────`;
            if (user.avatar) msg += `\n🔗 Link HD Avatar:\n${user.avatar}`;
            const styles = [{ start: 0, len: 18, st: "b" }, { start: 0, len: 18, st: "c_db342e" }];
            await api.sendMessage({ msg, styles }, threadId, threadType);
        } catch (e) {
            log.error("Lỗi tra cứu SĐT:", e.message);
            await api.sendMessage({ msg: `⚠️ Hệ thống Zalo từ chối hoặc bị lỗi: ${e.message}\n(Có thể do người đó cài đặt riêng tư khoá tìm bằng SĐT).` }, threadId, threadType);
        }
    }
};
