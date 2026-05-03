import { log, axios } from "../globals.js";

export const name = "ff";
export const description = "Tra cứu thông tin tài khoản Free Fire (thông tin, thống kê, tìm kiếm)";

const API_BASE = "https://launa-api-vmrm.onrender.com";

const SERVER_ALIASES = {
    vn: "VN", "việt nam": "VN", "vietnam": "VN",
    sg: "SG", singapore: "SG",
    id: "ID", indonesia: "ID",
    th: "TH", thailand: "TH",
    my: "MY", malaysia: "MY",
    ph: "PH", philippines: "PH",
    tw: "TW", taiwan: "TW",
    br: "BR", brazil: "BR",
    us: "US", usa: "US",
    in: "IN", india: "IN",
    bd: "BD", bangladesh: "BD",
    pk: "PK", pakistan: "PK",
    sa: "SA",
};

function resolveServer(input = "VN") {
    return SERVER_ALIASES[input.toLowerCase()] || input.toUpperCase();
}

function formatTime(timestamp) {
    if (!timestamp) return "N/A";
    const d = new Date(Number(timestamp) * 1000);
    return d.toLocaleString("vi-VN");
}

function send(ctx, msg) {
    return ctx.api.sendMessage({ msg, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

export const commands = {

    ff: async (ctx) => {
        const { args, prefix } = ctx;
        const sub = args[0]?.toLowerCase();

        const helpMsg =
            `[ 🎮 FREE FIRE ]\n` +
            `─────────────────\n` +
            `◈ ${prefix}ff info <uid> [server]\n` +
            `  ➥ Xem thông tin tài khoản\n\n` +
            `◈ ${prefix}ff stats <uid> [server] [br|cs] [RANKED|NORMAL|CAREER]\n` +
            `  ➥ Thống kê trận đấu\n\n` +
            `◈ ${prefix}ff search <tên> [server]\n` +
            `  ➥ Tìm kiếm tài khoản\n` +
            `─────────────────\n` +
            `Server mặc định: VN`;

        if (!sub || sub === "help") return send(ctx, helpMsg);

        if (sub === "info") {
            const uid = args[1];
            const server = resolveServer(args[2]);

            if (!uid) return send(ctx, `⚠️ Thiếu UID!\nCú pháp: ${prefix}ff info <uid> [server]`);

            try {
                const res = await axios.get(`${API_BASE}/freefire/player-show`, {
                    params: { uid, server }
                });

                if (!res.data?.status) {
                    return send(ctx, `❌ Lỗi: ${res.data?.message || "Không lấy được dữ liệu"}`);
                }

                const d = res.data.data;
                const b = d.basicinfo || {};
                const pet = d.petinfo || {};

                const rankMap = {
                    301: "Đồng", 302: "Bạc", 303: "Vàng",
                    304: "Bạch Kim", 305: "Kim Cương",
                    306: "Heroic", 307: "Grand Master"
                };

                const rankName = rankMap[b.rank] || `Hạng ${b.rank}`;
                const csRankName = rankMap[b.csrank] || `Hạng ${b.csrank}`;

                let msg =
                    `[ 🎮 THÔNG TIN FREE FIRE ]\n` +
                    `─────────────────\n` +
                    `👤 Tên: ${b.nickname || "N/A"}\n` +
                    `🆔 UID: ${b.accountid || uid}\n` +
                    `🌏 Server: ${b.region || server}\n` +
                    `⭐ Cấp độ: ${b.level || 0} (EXP: ${(b.exp || 0).toLocaleString()})\n` +
                    `🏆 Rank BR: ${rankName} (${(b.rankingpoints || 0).toLocaleString()} điểm)\n` +
                    `⚔️ Rank CS: ${csRankName}\n` +
                    `❤️ Lượt thích: ${(b.liked || 0).toLocaleString()}\n` +
                    `📅 Season: ${b.seasonid || "N/A"}\n` +
                    `🕐 Đăng nhập cuối: ${formatTime(b.lastloginat)}\n`;

                if (pet.name) {
                    msg += `\n🐾 Pet: ${pet.name} (Lv.${pet.level || 1})\n`;
                }

                if (d.clanbasicinfo?.clanName) {
                    msg += `🛡️ Clan: ${d.clanbasicinfo.clanName}\n`;
                }

                msg += `─────────────────`;
                return send(ctx, msg);

            } catch (e) {
                log.error("ff info error:", e.message);
                return send(ctx, `⚠️ Lỗi: ${e.message}`);
            }
        }

        if (sub === "stats") {
            const uid = args[1];
            const server = resolveServer(args[2]);
            const gamemode = (args[3] || "br").toLowerCase();
            const matchmode = (args[4] || "RANKED").toUpperCase();

            if (!uid) return send(ctx, `⚠️ Thiếu UID!\nCú pháp: ${prefix}ff stats <uid> [server] [br|cs] [RANKED|NORMAL|CAREER]`);

            if (!["br", "cs"].includes(gamemode)) {
                return send(ctx, `⚠️ Chế độ không hợp lệ!\nChỉ dùng: br (Battle Royale) hoặc cs (Clash Squad)`);
            }

            if (!["RANKED", "NORMAL", "CAREER"].includes(matchmode)) {
                return send(ctx, `⚠️ Loại trận không hợp lệ!\nChỉ dùng: RANKED, NORMAL hoặc CAREER`);
            }

            try {
                const [infoRes, statsRes] = await Promise.all([
                    axios.get(`${API_BASE}/freefire/player-show`, { params: { uid, server } }),
                    axios.get(`${API_BASE}/freefire/player-stats`, { params: { uid, server, gamemode, matchmode } })
                ]);

                const nickname = infoRes.data?.data?.basicinfo?.nickname || uid;

                if (!statsRes.data?.status) {
                    return send(ctx, `❌ Lỗi: ${statsRes.data?.message || "Không lấy được thống kê"}`);
                }

                const data = statsRes.data.data;
                const gamemodeLabel = gamemode === "br" ? "Battle Royale" : "Clash Squad";
                const matchmodeLabel = { RANKED: "Xếp hạng", NORMAL: "Thường", CAREER: "Sự nghiệp" }[matchmode];

                let msg =
                    `[ 📊 THỐNG KÊ FREE FIRE ]\n` +
                    `─────────────────\n` +
                    `👤 ${nickname} | ${server}\n` +
                    `🎮 ${gamemodeLabel} — ${matchmodeLabel}\n` +
                    `─────────────────\n`;

                const sections = {
                    solo: "🧍 Solo",
                    duo: "👥 Duo",
                    quad: "👨‍👩‍👧‍👦 Squad"
                };

                let hasStats = false;

                for (const [key, label] of Object.entries(sections)) {
                    const stat = data[`${key}stats`]?.detailedstats;
                    if (!stat || Object.keys(stat).length === 0) continue;
                    hasStats = true;

                    const matches = stat.numbermatchplayed || 0;
                    const wins = stat.numberofberankingpoint || stat.win || 0;
                    const kills = stat.kill || 0;
                    const damage = stat.totaldamagedealt || 0;
                    const winrate = matches > 0 ? ((wins / matches) * 100).toFixed(1) : "0";
                    const kd = matches > 0 ? (kills / matches).toFixed(2) : "0";

                    msg +=
                        `${label}\n` +
                        `  🎯 Trận: ${matches} | Thắng: ${wins} (${winrate}%)\n` +
                        `  ⚔️ Kill: ${kills} | KD: ${kd}\n` +
                        `  💥 Sát thương: ${damage.toLocaleString()}\n\n`;
                }

                if (!hasStats) {
                    msg += `📭 Chưa có dữ liệu thống kê cho chế độ này.\n\n`;
                }

                msg += `─────────────────`;
                return send(ctx, msg);

            } catch (e) {
                log.error("ff stats error:", e.message);
                return send(ctx, `⚠️ Lỗi: ${e.message}`);
            }
        }

        if (sub === "search") {
            const keyword = args.slice(1, -1).join(" ") || args[1];
            const lastArg = args[args.length - 1];
            const server = args.length >= 3 && resolveServer(lastArg) !== lastArg.toUpperCase()
                ? resolveServer(lastArg)
                : resolveServer(args[2]) || "VN";
            const searchKeyword = args.length >= 3 ? args.slice(1, -1).join(" ") : args.slice(1).join(" ");

            if (!searchKeyword) return send(ctx, `⚠️ Thiếu từ khóa!\nCú pháp: ${prefix}ff search <tên> [server]`);

            try {
                const res = await axios.get(`${API_BASE}/freefire/search-account`, {
                    params: { keyword: searchKeyword, server }
                });

                if (!res.data?.status) {
                    return send(ctx, `❌ Lỗi: ${res.data?.message || "Không tìm thấy kết quả"}`);
                }

                const accounts = res.data?.data || [];

                if (!accounts.length) {
                    return send(ctx, `🔍 Không tìm thấy tài khoản nào với từ khóa: "${searchKeyword}"`);
                }

                let msg =
                    `[ 🔍 TÌM KIẾM FREE FIRE ]\n` +
                    `─────────────────\n` +
                    `Từ khóa: "${searchKeyword}" | Server: ${server}\n` +
                    `─────────────────\n`;

                accounts.slice(0, 10).forEach((acc, i) => {
                    const name = acc.nickname || acc.name || "N/A";
                    const id = acc.accountid || acc.uid || "N/A";
                    const level = acc.level || "?";
                    msg += `${i + 1}. ${name}\n   🆔 ${id} | ⭐ Lv.${level}\n\n`;
                });

                msg += `─────────────────`;
                return send(ctx, msg);

            } catch (e) {
                log.error("ff search error:", e.message);
                return send(ctx, `⚠️ Lỗi: ${e.message}`);
            }
        }

        return send(ctx, helpMsg);
    }

};
