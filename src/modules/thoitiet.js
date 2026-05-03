import axios from "axios";

export const name        = "thoitiet";
export const description = "Xem thời tiết qua wttr.in";

// ── Icon thời tiết ────────────────────────────────────────────────────────────
const ICONS = [
    ["thunder",   "⛈️"], ["storm",    "🌩️"], ["blizzard", "🌨️"],
    ["snow",      "❄️"], ["sleet",    "🌨️"], ["drizzle",  "🌦️"],
    ["rain",      "🌧️"], ["shower",   "🌦️"], ["overcast", "☁️"],
    ["cloud",     "⛅"], ["fog",      "🌫️"], ["mist",     "🌫️"],
    ["haze",      "🌫️"], ["smoke",    "🌫️"], ["sunny",    "☀️"],
    ["clear",     "☀️"], ["wind",     "💨"], ["tornado",   "🌪️"],
];
function icon(desc = "") {
    const d = desc.toLowerCase();
    for (const [k, v] of ICONS) if (d.includes(k)) return v;
    return "🌡️";
}

// ── Ngày trong tuần ───────────────────────────────────────────────────────────
const DAY = ["CN","T2","T3","T4","T5","T6","T7"];
function fmtDate(str) {
    if (!str) return "";
    const d = new Date(str);
    return `${DAY[d.getDay()]} ${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}`;
}

function uvLabel(u) {
    const n = Number(u);
    if (n <= 2) return `${n} Thấp`;
    if (n <= 5) return `${n} TB`;
    if (n <= 7) return `${n} Cao`;
    if (n <= 10)return `${n} Rất cao`;
    return `${n} Cực cao`;
}

// ── Lấy thời tiết ─────────────────────────────────────────────────────────────
async function getWeather(city) {
    const res = await axios.get(`https://wttr.in/${encodeURIComponent(city)}`, {
        params:  { format: "j1", lang: "vi" },
        timeout: 15000,
        headers: { "User-Agent": "curl/7.68.0", "Accept": "application/json" },
    });
    return res.data;
}

// ── Dịch mô tả thời tiết sang tiếng Việt ─────────────────────────────────────
const DESC_MAP = {
    "sunny": "Nắng", "clear": "Trời quang", "partly cloudy": "Ít mây",
    "cloudy": "Nhiều mây", "overcast": "Âm u", "mist": "Sương mù",
    "fog": "Sương mù dày", "light rain": "Mưa nhỏ", "moderate rain": "Mưa vừa",
    "heavy rain": "Mưa lớn", "light drizzle": "Mưa phùn", "drizzle": "Mưa phùn",
    "thundery": "Dông", "thunder": "Sấm sét", "blizzard": "Bão tuyết",
    "light snow": "Tuyết nhẹ", "snow": "Tuyết", "patchy rain": "Mưa rải rác",
    "patchy snow": "Tuyết rải rác", "freezing": "Đóng băng",
};
function translateDesc(desc = "") {
    const d = desc.toLowerCase();
    for (const [k, v] of Object.entries(DESC_MAP)) {
        if (d.includes(k)) return v;
    }
    return desc;
}

// ── Tạo bản tin ───────────────────────────────────────────────────────────────
function buildMessage(data, cityInput) {
    const cur  = data.current_condition?.[0] || {};
    const area = data.nearest_area?.[0];
    const city = area?.areaName?.[0]?.value
              || area?.region?.[0]?.value
              || cityInput;

    const desc    = cur.weatherDesc?.[0]?.value || cur.lang_vi?.[0]?.value || "";
    const descVN  = translateDesc(desc);
    const ico     = icon(desc);
    const temp    = cur.temp_C    || "?";
    const feels   = cur.FeelsLikeC|| null;
    const hum     = cur.humidity  || "?";
    const wind    = cur.windspeedKmph || "?";
    const uv      = cur.uvIndex   || null;
    const vis     = cur.visibility|| null;
    const pres    = cur.pressure  || null;

    const lines = [
        `${ico} THỜI TIẾT — ${city.toUpperCase()}`,
        `─────────────────────────────`,
        `🌡️  Nhiệt độ   : ${temp}°C${feels ? ` (cảm giác ${feels}°C)` : ""}`,
        `💧  Độ ẩm      : ${hum}%`,
        `💨  Gió        : ${wind} km/h`,
        descVN ? `☁️  Bầu trời   : ${descVN}` : null,
        uv   ? `☀️  Chỉ số UV  : ${uvLabel(uv)}` : null,
        vis  ? `👁️  Tầm nhìn  : ${vis} km` : null,
        pres ? `🌐  Áp suất   : ${pres} hPa` : null,
    ].filter(Boolean);

    // Dự báo 3 ngày
    const forecast = data.weather || [];
    if (forecast.length) {
        lines.push(`─────────────────────────────`);
        lines.push(`📅 DỰ BÁO 3 NGÀY`);
        for (const d of forecast.slice(0, 3)) {
            const dDesc = d.hourly?.find(h => h.time === "1200")?.weatherDesc?.[0]?.value
                       || d.hourly?.[0]?.weatherDesc?.[0]?.value || "";
            const di  = icon(dDesc);
            const dVN = translateDesc(dDesc);
            const lo  = d.mintempC ?? "?";
            const hi  = d.maxtempC ?? "?";
            const dt  = fmtDate(d.date);
            lines.push(`  ${di} ${dt}: ${lo}°C – ${hi}°C  ${dVN}`);
        }
    }

    lines.push(`─────────────────────────────`);
    lines.push(`⏱️ Nguồn: wttr.in`);
    return lines.join("\n");
}

// ── Commands ──────────────────────────────────────────────────────────────────
export const commands = {

    thoitiet: async (ctx) => {
        const { api, args, threadId, threadType, prefix } = ctx;
        const query = args.join(" ").trim();

        if (!query) {
            return api.sendMessage({
                msg: [
                    `🌤️ THỜI TIẾT — Hướng dẫn`,
                    `─────────────────────────────`,
                    `${prefix}thoitiet <tên thành phố>`,
                    ``,
                    `Ví dụ:`,
                    `  ${prefix}thoitiet Ha Noi`,
                    `  ${prefix}thoitiet Ho Chi Minh`,
                    `  ${prefix}thoitiet Da Nang`,
                    `  ${prefix}thoitiet Can Tho`,
                ].join("\n"),
            }, threadId, threadType);
        }

        const loading = await api.sendMessage(
            { msg: `🔍 Đang lấy thời tiết "${query}"...` },
            threadId, threadType
        );

        try {
            const data = await getWeather(query);
            if (!data?.current_condition?.length) {
                await api.sendMessage(
                    { msg: `❌ Không tìm thấy "${query}". Thử dùng tên tiếng Anh, VD: Ha Noi, Ho Chi Minh.` },
                    threadId, threadType
                );
            } else {
                await api.sendMessage({ msg: buildMessage(data, query) }, threadId, threadType);
            }
        } catch (e) {
            await api.sendMessage(
                { msg: `❌ Lỗi: ${e?.response?.data?.message || e.message}` },
                threadId, threadType
            );
        } finally {
            try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
        }
    },

    tt: async (ctx) => commands.thoitiet(ctx),
};
