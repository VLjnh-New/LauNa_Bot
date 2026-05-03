import { fs, path, log } from "../globals.js";

export const name = "vd";
export const description = "Xem video ngẫu nhiên theo thể loại (gai, anime, ...)";

const CACHE_DIR = path.join(process.cwd(), "src", "data");

// Hàm bỏ dấu tiếng Việt
const nonAccent = (str) => {
    return str.normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "D")
        .toLowerCase();
};

export const commands = {
    vd: async (ctx) => {
        const { api, threadId, threadType, args, prefix } = ctx;

        // Lấy type, bỏ dấu (ví dụ: "gái" -> "gai")
        let inputType = args[0] ? nonAccent(args[0]) : "gai";

        // Logic tìm file thông minh: 
        // 1. Thử vdgai.json (nếu gõ gai)
        // 2. Thử vdanime.json (nếu gõ anime)
        // 3. Thử [type].json
        let fileType = inputType;
        if (inputType === "gai") fileType = "vdgai";
        else if (inputType === "anime") fileType = "vdanime";

        let cachePath = path.join(CACHE_DIR, `${fileType}.json`);

        // Nếu file vdgai/vdanime không tồn tại, thử tìm file nguyên bản user gõ
        if (!fs.existsSync(cachePath)) {
            cachePath = path.join(CACHE_DIR, `${inputType}.json`);
        }

        if (!fs.existsSync(cachePath)) {
            return api.sendMessage({
                msg: `⚠️ Không tìm thấy dữ liệu cho: ${args[0] || "gai"}\n💡 Dùng: ${prefix}api add ${inputType} [link] để tạo mới.`
            }, threadId, threadType);
        }

        const clockEmojis = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
        let clockIdx = 0;
        const reactionInterval = setInterval(() => {
            if (ctx.message && ctx.message.data) {
                api.addReaction(clockEmojis[clockIdx % clockEmojis.length], {
                    msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId
                }, threadId, threadType).catch(() => { });
                clockIdx++;
            }
        }, 2000);

        try {
            const data = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            if (!Array.isArray(data) || data.length === 0) {
                return api.sendMessage({ msg: `⚠️ Danh sách video [${inputType}] đang trống!` }, threadId, threadType);
            }

            const randomLink = data[Math.floor(Math.random() * data.length)];
            const displayTitle = inputType.toUpperCase();

            await api.sendVideoEnhanced({
                videoUrl: randomLink,
                thumbnailUrl: "https://drive.google.com/uc?id=1pCQPRic8xPxbgUaPSIczb94S4RDdWDHK&export=download",
                duration: 15000,
                width: 720,
                height: 1280,
                fileSize: 10 * 1024 * 1024,
                msg: `[ 🎬 VIDEO ${displayTitle} ]\n─────────────────\n📺 Chúc bạn xem video vui vẻ!\n📊 Tổng kho: ${data.length} video.`,
                threadId,
                threadType,
            });

        } catch (e) {
            log.error(`Lỗi lệnh vd ${inputType}:`, e.message);
            await api.sendMessage({ msg: `⚠️ Lỗi khi lấy video: ${e.message}` }, threadId, threadType);
        } finally {
            clearInterval(reactionInterval);
        }
    },

    // Phím tắt cho người dùng quen tay
    vdgai: async (ctx) => {
        ctx.args = ["gai"];
        return commands.vd(ctx);
    },

};
