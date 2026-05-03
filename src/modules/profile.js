import { fs, path, axios, log } from "../globals.js";
import { UpdateSettingsType } from "../utils/constants.js";

export const name = "profile";
export const description = "Xem và quản lý tài khoản bot: info, bio, name, avatar, online/offline, privacy";

const TEMP_DIR = path.join(process.cwd(), ".cache");

function reply(ctx, text) {
    return ctx.api.sendMessage(
        { msg: text, quote: ctx.message.data },
        ctx.threadId,
        ctx.threadType
    );
}

function isAdmin(ctx) {
    return ctx.adminIds.includes(String(ctx.senderId));
}

function genderLabel(g) {
    if (g === 0) return "Nam";
    if (g === 1) return "Nữ";
    return "Không rõ";
}

function formatDob(dob, sdob) {
    if (sdob && typeof sdob === "string" && sdob.trim()) return sdob.trim();
    if (!dob) return "Chưa cài";
    const d = String(dob);
    if (d.length === 8) return `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`;
    if (d.length >= 9) {
        const date = new Date(Number(dob) * 1000);
        if (!isNaN(date.getTime())) {
            return `${String(date.getDate()).padStart(2,"0")}/${String(date.getMonth()+1).padStart(2,"0")}/${date.getFullYear()}`;
        }
    }
    return "Chưa cài";
}

function dobToApiFormat(dob) {
    if (!dob) return "";
    const d = String(dob);
    if (d.length === 8) return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
    if (d.length >= 9) {
        const date = new Date(Number(dob) * 1000);
        if (!isNaN(date.getTime())) {
            return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
        }
    }
    return "";
}

const PRIVACY_KEYS = {
    birthday:    UpdateSettingsType.ViewBirthday,
    online:      UpdateSettingsType.ShowOnlineStatus,
    seen:        UpdateSettingsType.DisplaySeenStatus,
    message:     UpdateSettingsType.ReceiveMessage,
    call:        UpdateSettingsType.AcceptCall,
    phone:       UpdateSettingsType.AddFriendViaPhone,
    qr:          UpdateSettingsType.AddFriendViaQR,
    group:       UpdateSettingsType.AddFriendViaGroup,
    contact:     UpdateSettingsType.AddFriendViaContact,
    recommend:   UpdateSettingsType.DisplayOnRecommendFriend,
};

const PRIVACY_LABELS = {
    birthday:  "Xem ngày sinh",
    online:    "Hiện trạng thái online",
    seen:      "Hiện đã xem",
    message:   "Nhận tin nhắn lạ",
    call:      "Nhận cuộc gọi lạ",
    phone:     "Kết bạn qua SĐT",
    qr:        "Kết bạn qua QR",
    group:     "Kết bạn qua nhóm",
    contact:   "Kết bạn qua danh bạ",
    recommend: "Hiện trong gợi ý",
};

async function downloadImage(url, destPath) {
    const cleanUrl = decodeURIComponent(url.replace(/\\\//g, "/"));
    const response = await axios({ method: "get", url: cleanUrl, responseType: "stream", timeout: 15000 });
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
    });
}

export const commands = {
    profile: async (ctx) => {
        const { api, args, threadId, threadType, adminIds, senderId } = ctx;
        const sub = args[0]?.toLowerCase();

        if (!sub) {
            return commands._viewInfo(ctx);
        }

        const adminSubs = ["bio", "name", "avatar", "listavt", "delavt", "online", "offline", "privacy", "reuseavt", "lang"];
        if (adminSubs.includes(sub) && !isAdmin(ctx)) {
            return reply(ctx, "⛔ Chỉ Admin bot mới được dùng lệnh này.");
        }

        switch (sub) {
            case "bio":      return commands._setBio(ctx);
            case "name":     return commands._setName(ctx);
            case "avatar":   return commands._setAvatar(ctx);
            case "listavt":  return commands._listAvatar(ctx);
            case "delavt":   return commands._delAvatar(ctx);
            case "reuseavt": return commands._reuseAvatar(ctx);
            case "lang":     return commands._setLang(ctx);
            case "online":   return commands._setOnline(ctx, true);
            case "offline":  return commands._setOnline(ctx, false);
            case "privacy":  return commands._setPrivacy(ctx);
            default:
                return reply(ctx,
                    `[ 🤖 PROFILE BOT ]\n` +
                    `─────────────────\n` +
                    `◈ !profile               — Xem hồ sơ bot\n` +
                    `◈ !profile bio <text>    — Đổi bio/status\n` +
                    `◈ !profile name <tên>    — Đổi tên hiển thị\n` +
                    `◈ !profile avatar        — Đổi avatar (reply ảnh)\n` +
                    `◈ !profile listavt       — Danh sách avatar cũ\n` +
                    `◈ !profile delavt <id>   — Xóa avatar theo ID\n` +
                    `◈ !profile reuseavt <id> — Dùng lại avatar cũ\n` +
                    `◈ !profile lang <vi/en>  — Đổi ngôn ngữ\n` +
                    `◈ !profile online        — Bật trạng thái online\n` +
                    `◈ !profile offline       — Ẩn trạng thái online\n` +
                    `◈ !profile privacy <key> <on/off> — Cài riêng tư\n` +
                    `─────────────────\n` +
                    `Keys privacy: ${Object.keys(PRIVACY_LABELS).join(", ")}`
                );
        }
    },

    _viewInfo: async (ctx) => {
        const { api, threadId, threadType } = ctx;
        try {
            const info = await api.fetchAccountInfo();
            if (!info) return reply(ctx, "⚠️ Không lấy được thông tin tài khoản.");

            const profile = info.profile || info;
            const name     = profile.displayName || profile.zaloName || profile.name || "Không rõ";
            const uid      = profile.userId || profile.uid || "N/A";
            const phone    = profile.phoneNumber || profile.phone || "Ẩn";
            const gender   = genderLabel(profile.gender);
            const dob      = formatDob(profile.dob || profile.birthday, profile.sdob);
            const bio      = profile.statusMsg || profile.bio || profile.status || "Trống";
            const avatar   = profile.avt || profile.avatar || profile.fullAvt || "";

            let msg = `[ 🤖 HỒ SƠ BOT ]\n`;
            msg += `─────────────────\n`;
            msg += `◈ Tên    : ${name}\n`;
            msg += `◈ UID    : ${uid}\n`;
            msg += `◈ SĐT    : ${phone}\n`;
            msg += `◈ Giới   : ${gender}\n`;
            msg += `◈ Ngày sinh: ${dob}\n`;
            msg += `◈ Bio    : ${bio}\n`;
            if (avatar) msg += `◈ Avatar : ${avatar}\n`;
            msg += `─────────────────`;

            return api.sendMessage({ msg, quote: ctx.message.data }, threadId, threadType);
        } catch (e) {
            log.error("[profile] fetchAccountInfo lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi lấy thông tin: ${e.message}`);
        }
    },

    _setBio: async (ctx) => {
        const text = ctx.args.slice(1).join(" ").trim();
        if (!text) return reply(ctx, "⚠️ Cú pháp: !profile bio <nội dung status>");
        try {
            await ctx.api.updateProfileBio(text);
            return reply(ctx, `✅ Đã đổi bio thành:\n"${text}"`);
        } catch (e) {
            log.error("[profile] updateProfileBio lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi đổi bio: ${e.message}`);
        }
    },

    _setName: async (ctx) => {
        const newName = ctx.args.slice(1).join(" ").trim();
        if (!newName) return reply(ctx, "⚠️ Cú pháp: !profile name <tên mới>");
        try {
            const info = await ctx.api.fetchAccountInfo();
            const current = info?.profile || info || {};
            const dob = dobToApiFormat(current.dob);
            await ctx.api.updateProfile({
                profile: {
                    name: newName,
                    dob,
                    gender: current.gender ?? 0,
                },
            });
            return reply(ctx, `✅ Đã đổi tên thành: ${newName}`);
        } catch (e) {
            log.error("[profile] updateProfile name lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi đổi tên: ${e.message}`);
        }
    },

    _setAvatar: async (ctx) => {
        const { api, message, threadId, threadType } = ctx;
        const quote = message?.data?.quote;

        if (!quote) {
            return reply(ctx, "⚠️ Hãy reply vào một ảnh rồi dùng lệnh: !profile avatar");
        }

        let attach;
        try {
            attach = typeof quote.attach === "string" ? JSON.parse(quote.attach) : quote.attach;
        } catch {
            return reply(ctx, "⚠️ Dữ liệu ảnh không hợp lệ.");
        }

        // Ưu tiên ảnh gốc → HD → normal → href/url; thumbUrl bỏ vì thường < 240
        const imageUrl =
            attach?.oriUrl || attach?.rawUrl || attach?.hdUrl ||
            attach?.normalUrl || attach?.href || attach?.url;
        if (!imageUrl) return reply(ctx, "⚠️ Không tìm thấy ảnh trong tin nhắn được reply.");

        const tempPath = path.join(TEMP_DIR, `profile_avt_${Date.now()}.jpg`);
        try {
            if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
            await reply(ctx, "⏳ Đang tải và cập nhật avatar...");
            await downloadImage(imageUrl, tempPath);
            await api.changeAccountAvatar(tempPath);
            return reply(ctx, "✅ Đã cập nhật avatar bot thành công!");
        } catch (e) {
            log.error("[profile] changeAccountAvatar lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi đổi avatar: ${e.message}`);
        } finally {
            if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
    },

    _listAvatar: async (ctx) => {
        const count = parseInt(ctx.args[1]) || 10;
        try {
            const data = await ctx.api.getAvatarList(count);
            if (!data || !data.photos || data.photos.length === 0) {
                return reply(ctx, "📭 Không có avatar nào trong lịch sử.");
            }
            let msg = `[ 🖼️ DANH SÁCH AVATAR ]\n─────────────────\n`;
            data.photos.forEach((p, i) => {
                const photoId = p.photoId || p.photo_id || "?";
                const url     = p.url || p.href || "";
                msg += `${i + 1}. ID: ${photoId}\n`;
                if (url) msg += `   🔗 ${url}\n`;
            });
            msg += `─────────────────\n◈ Dùng: !profile delavt <photoId> để xóa`;
            return reply(ctx, msg);
        } catch (e) {
            log.error("[profile] getAvatarList lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi lấy danh sách avatar: ${e.message}`);
        }
    },

    _delAvatar: async (ctx) => {
        const photoId = ctx.args[1];
        if (!photoId) return reply(ctx, "⚠️ Cú pháp: !profile delavt <photoId>");
        try {
            await ctx.api.deleteAvatar(photoId);
            return reply(ctx, `✅ Đã xóa avatar có ID: ${photoId}`);
        } catch (e) {
            log.error("[profile] deleteAvatar lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi xóa avatar: ${e.message}`);
        }
    },

    _setOnline: async (ctx, active) => {
        try {
            await ctx.api.updateActiveStatus(active);
            return reply(ctx, active
                ? "✅ Đã bật trạng thái Online cho bot."
                : "✅ Đã ẩn trạng thái Online của bot."
            );
        } catch (e) {
            log.error("[profile] updateActiveStatus lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi cài đặt trạng thái: ${e.message}`);
        }
    },

    _reuseAvatar: async (ctx) => {
        const photoId = ctx.args[1];
        if (!photoId) return reply(ctx, "⚠️ Cú pháp: !profile reuseavt <photoId>\n💡 Dùng !profile listavt để xem danh sách.");
        try {
            await ctx.api.reuseAvatar(photoId);
            return reply(ctx, `✅ Đã đổi lại avatar với ID: ${photoId}`);
        } catch (e) {
            log.error("[profile] reuseAvatar lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi: ${e.message}`);
        }
    },

    _setLang: async (ctx) => {
        const lang = ctx.args[1]?.toLowerCase();
        const langMap = { vi: "vi", vn: "vi", en: "en", english: "en", tiengviet: "vi" };
        const resolved = langMap[lang];
        if (!resolved) return reply(ctx, "⚠️ Cú pháp: !profile lang <vi/en>");
        try {
            await ctx.api.updateLang(resolved);
            return reply(ctx, `✅ Đã đổi ngôn ngữ thành: ${resolved === "vi" ? "Tiếng Việt" : "English"}`);
        } catch (e) {
            log.error("[profile] updateLang lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi: ${e.message}`);
        }
    },

    _setPrivacy: async (ctx) => {
        const key   = ctx.args[1]?.toLowerCase();
        const value = ctx.args[2]?.toLowerCase();

        if (!key || !value) {
            let help = `[ 🔒 CÀI ĐẶT RIÊNG TƯ ]\n─────────────────\n`;
            help += `Cú pháp: !profile privacy <key> <on/off>\n\n`;
            help += `◈ Keys có thể dùng:\n`;
            for (const [k, label] of Object.entries(PRIVACY_LABELS)) {
                help += `  ${k.padEnd(12)} — ${label}\n`;
            }
            return reply(ctx, help.trim());
        }

        const settingKey = PRIVACY_KEYS[key];
        if (!settingKey) {
            return reply(ctx, `⚠️ Key không hợp lệ: "${key}"\nDùng: ${Object.keys(PRIVACY_LABELS).join(", ")}`);
        }

        if (!["on", "off", "1", "0"].includes(value)) {
            return reply(ctx, "⚠️ Giá trị phải là: on hoặc off");
        }

        const boolValue = value === "on" || value === "1";
        try {
            await ctx.api.updateSettings(settingKey, boolValue ? 1 : 0);
            const label = PRIVACY_LABELS[key];
            return reply(ctx, `✅ ${label}: ${boolValue ? "Bật" : "Tắt"}`);
        } catch (e) {
            log.error("[profile] updateSettings lỗi:", e.message);
            return reply(ctx, `⚠️ Lỗi cài đặt: ${e.message}`);
        }
    },
};
