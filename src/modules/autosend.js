/**
 * Module: Autosend (v4.4 - Won Canvas Card) 🚀
 * Tự động gửi Media mỗi giờ + Card ảnh tỷ giá Won→VND bằng Canvas
 */

import fs from "node:fs";
import path from "node:path";
import moment from "moment-timezone";
import axios from "axios";
import { exec } from "child_process";
import { FFMPEG_BIN } from "../utils/core/ffmpegHelper.js";
import { log } from "../logger.js";
import { statsManager } from "../utils/managers/statsManager.js";
import { rentalManager } from "../utils/managers/rentalManager.js";
import { tempDir, readJSON, writeJSON, listJSONDir } from "../utils/core/io-json.js";
import { searchNCT } from "../utils/music/nhaccuatui.js";
import { drawWonCard } from "../utils/canvas/canvasHelper.js";

// ─── Paths ─────────────────────────────────────────────────────────────────
const CONFIG_PATH    = path.join(process.cwd(), "src/data/autosend_v3_settings.json");
const HISTORY_PATH   = path.join(process.cwd(), "src/data/autosend_history.json");
const RATE_HIST_PATH = path.join(process.cwd(), "src/data/won_rate_history.json");
const DATA_DIR       = path.join(process.cwd(), "src/data");

// Các file config/settings không phải media — loại khỏi scan tự động
const NON_MEDIA_FILES = new Set([
    "autosend_history.json", "autosend_v3_settings.json", "autoReact.json",
    "auto_xo_so.json", "autodown_toggle.json", "bank.json", "bot_stats.json",
    "gist_ids.json", "hanSetting.json", "launaMood.json", "launaSetting.json",
    "mutes.json", "prefixes.json", "protection_settings.json", "rentals.json",
    "stats.json", "thread_settings.json", "tiktok_history.json", "won_rate_history.json"
]);

// Alias ngược — tương thích cài đặt cũ (type: "video_gai" → file gai.json)
const TYPE_ALIASES = {
    video:     "gai",
    video_gai: "gai",
    anime:     "vdanime",
    anh:       "anhgai",
    anh_gai:   "anhgai",
};

// Quét động src/data/ — trả về { typeName: filePath } cho mọi JSON chứa array URL
function getDynamicMediaTypes() {
    const result = {};
    try {
        const files = listJSONDir(DATA_DIR)
            .filter(f => !NON_MEDIA_FILES.has(f));
        for (const file of files) {
            const typeName = path.basename(file, ".json");
            const filePath = path.join(DATA_DIR, file);
            try {
                const raw = readJSON(filePath);
                const list = Array.isArray(raw) ? raw : (raw?.urls || raw?.data || null);
                if (Array.isArray(list) && list.length > 0) {
                    result[typeName] = filePath;
                }
            } catch {}
        }
    } catch {}
    return result;
}

// Kiểm tra URL là video hay ảnh
function isVideoUrl(url) {
    if (typeof url !== "string") return false;
    const ext = url.split("?")[0].split(".").pop().toLowerCase();
    return ["mp4", "mov", "avi", "webm", "mkv"].includes(ext);
}

const sysBrand = "[ SYSTEM ]: ";

// ─── Tỷ giá runtime cache ──────────────────────────────────────────────────
let rateCache = { krwToVnd: null, updatedAt: null };

// ─── Lịch sử tỷ giá (persist qua restart) ─────────────────────────────────
const RATE_HIST_MAX = 168;

function loadRateHistory() {
    return readJSON(RATE_HIST_PATH) || [];
}

function saveRateHistory(hist) {
    writeJSON(RATE_HIST_PATH, hist);
}

function pushRateHistory(rate) {
    const hist = loadRateHistory();
    hist.push({ rate, ts: new Date().toISOString() });
    if (hist.length > RATE_HIST_MAX) hist.splice(0, hist.length - RATE_HIST_MAX);
    saveRateHistory(hist);
}

// ─── Fetch tỷ giá ──────────────────────────────────────────────────────────
async function fetchExchangeRates() {
    const sources = [
        {
            name: "open.er-api",
            fn: async () => {
                const res = await axios.get("https://open.er-api.com/v6/latest/KRW", { timeout: 10000 });
                return res.data?.rates?.VND || null;
            }
        },
        {
            name: "exchangerate-api",
            fn: async () => {
                const res = await axios.get("https://api.exchangerate-api.com/v4/latest/KRW", { timeout: 10000 });
                return res.data?.rates?.VND || null;
            }
        },
        {
            name: "frankfurter",
            fn: async () => {
                const res = await axios.get("https://api.frankfurter.app/latest?from=KRW&to=VND", { timeout: 10000 });
                return res.data?.rates?.VND || null;
            }
        },
        {
            name: "fawazahmed0-cdn",
            fn: async () => {
                const res = await axios.get("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/krw.json", { timeout: 10000 });
                return res.data?.krw?.vnd || null;
            }
        },
    ];

    for (const src of sources) {
        try {
            const rate = await src.fn();
            if (rate && rate > 0) {
                rateCache.krwToVnd = rate;
                rateCache.updatedAt = moment().tz("Asia/Ho_Chi_Minh").format("HH:mm  DD/MM/YYYY");
                pushRateHistory(rateCache.krwToVnd);
                return;
            }
        } catch (e) {
            log.warn(`[fetchExchangeRates] ${src.name} thất bại: ${e.message}`);
        }
    }
    log.warn("[fetchExchangeRates] Tất cả nguồn tỷ giá thất bại.");
}

// ─── Format số ─────────────────────────────────────────────────────────────
function fmtVND(n)  { return Math.round(n).toLocaleString("vi-VN"); }
function fmtKRW(n)  { return Math.round(n).toLocaleString("vi-VN"); }

// ─── Parse số kiểu Việt Nam: 1tr / 500k / 1.5tr / 1ty ─────────────────────
function parseViNum(str) {
    if (!str) return null;
    const s = str.trim().toLowerCase().replace(/,/g, "").replace(/\s/g, "");
    const m = s.match(/^([\d.]+)(tr(?:ieu|iệu)?|k|ty|tỷ)?$/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    if (isNaN(num) || num <= 0) return null;
    const u = m[2] || "";
    if (u.startsWith("tr")) return num * 1_000_000;
    if (u === "k")           return num * 1_000;
    if (u === "ty" || u === "tỷ") return num * 1_000_000_000;
    return num;
}

// ─── AI: linear regression ─────────────────────────────────────────────────
function aiPredict(values) {
    const n = values.length;
    if (n < 3) return null;
    const xM = (n - 1) / 2;
    const yM = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    values.forEach((y, x) => { num += (x - xM) * (y - yM); den += (x - xM) ** 2; });
    const slope = den === 0 ? 0 : num / den;
    return (yM - slope * xM) + slope * n;
}

// ─── % thay đổi so với N giờ trước ────────────────────────────────────────
function calcChange(hist, hoursAgo = 24) {
    if (!hist || hist.length < 2) return null;
    const cutoff = new Date(Date.now() - hoursAgo * 3600000);
    const old    = hist.find(h => new Date(h.ts) <= cutoff);
    const cur    = hist[hist.length - 1];
    if (!old || !cur) return null;
    return { pct: ((cur.rate - old.rate) / old.rate) * 100, oldRate: old.rate };
}

// ── drawWonCard imported from canvasHelper.js ──────────────────────────────
// Uses same BeVietnamProBold font + dark navy style as SYSTEM UPTIME card.

// ─── Build rate block (text) cho autosend caption ──────────────────────────
function buildRateBlock() {
    if (!rateCache.krwToVnd) return "";
    const rate  = rateCache.krwToVnd;
    const hist  = loadRateHistory();
    const chg   = calcChange(hist, 24);
    let chgStr  = "";
    if (chg !== null) {
        const s = chg.pct >= 0 ? "+" : "";
        const i = chg.pct > 0.05 ? "tang" : chg.pct < -0.05 ? "giam" : "on dinh";
        chgStr = `\n${i} ${s}${chg.pct.toFixed(2)}% hom nay`;
    }
    return (
        `\n─────────────────` +
        `\n TY GIA WON → VND` +
        `\n 1.000 KRW  =  ${fmtVND(rate * 1000)} VND` +
        `\n 10.000 KRW =  ${fmtVND(rate * 10000)} VND` +
        chgStr +
        `\n Cap nhat: ${rateCache.updatedAt}`
    );
}

// ─── Gửi card ảnh (dùng drawWonCard từ canvasHelper — style uptime) ─────────
async function sendWonCard(api, threadId, threadType, opts, caption = "") {
    const { krwAmount, rate, changeData, predicted, updatedAt } = opts;
    let buf = null;
    try { buf = await drawWonCard(opts); } catch { buf = null; }

    if (buf) {
        const imgPath = path.join(tempDir, `won_card_${Date.now()}.png`);
        try {
            fs.writeFileSync(imgPath, buf);
            await api.sendMessage({ msg: caption, attachments: [imgPath] }, threadId, threadType);
        } finally {
            if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
        }
        return;
    }

    // Canvas không khả dụng → fallback text
    const fV = n => Math.round(n).toLocaleString("vi-VN");
    const chgStr = changeData
        ? (changeData.pct >= 0 ? `▲ +${changeData.pct.toFixed(2)}%` : `▼ ${changeData.pct.toFixed(2)}%`)
        : "Chưa đủ dữ liệu";
    const predStr = predicted !== null ? predicted.toFixed(2) + " VND/KRW" : "N/A";

    let msg = `[ 💱 TỶ GIÁ WON → VND ]\n${"─".repeat(28)}\n`;
    if (krwAmount) {
        msg += `💵 ${fV(krwAmount)} KRW = ${fV(rate * krwAmount)} VND\n`;
        msg += `${"─".repeat(28)}\n`;
    }
    msg += `💹 Tỷ giá hiện tại: ${rate.toFixed(2)} VND/KRW\n`;
    msg += `📊 Thay đổi 24h: ${chgStr}\n`;
    msg += `🤖 AI dự đoán: ${predStr}\n`;
    msg += `${"─".repeat(28)}\n`;
    msg += `1.000 KRW  =  ${fV(rate * 1000)} VND\n`;
    msg += `10.000 KRW =  ${fV(rate * 10000)} VND\n`;
    msg += `100.000 KRW = ${fV(rate * 100000)} VND\n`;
    msg += `${"─".repeat(28)}\n`;
    msg += `🕐 Cập nhật: ${updatedAt}`;
    await api.sendMessage({ msg }, threadId, threadType);
}

// ─── Data helpers ──────────────────────────────────────────────────────────
function loadData(file) {
    const data = readJSON(file);
    if (data !== null) return data;
    return file === CONFIG_PATH ? {} : [];
}

function saveData(file, data) {
    writeJSON(file, data);
}

// ─── Dọn rác: xóa URL cũ trong history không còn xuất hiện trong bất kỳ file media nào ──
function cleanStaleHistory() {
    try {
        const history = loadData(HISTORY_PATH);
        if (!Array.isArray(history) || history.length === 0) return;

        // Gom toàn bộ URL hợp lệ từ tất cả file media hiện có
        const mediaTypes = getDynamicMediaTypes();
        const allValidUrls = new Set();
        for (const filePath of Object.values(mediaTypes)) {
            try {
                const raw  = readJSON(filePath);
                const list = Array.isArray(raw) ? raw : (raw?.urls || raw?.data || []);
                for (const u of list) { if (u) allValidUrls.add(u); }
            } catch {}
        }

        const before  = history.length;
        const cleaned = history.filter(u => allValidUrls.has(u));

        if (cleaned.length < before) {
            saveData(HISTORY_PATH, cleaned);
            log.system(`[autosend] Đã dọn history: xóa ${before - cleaned.length} URL lỗi thời, còn ${cleaned.length}.`);
        }
    } catch (e) {
        log.warn(`[autosend] cleanStaleHistory lỗi: ${e.message}`);
    }
}

// ─── Dọn rác: xóa file temp bị sót (in_* / out_*) trong thư mục cache/temp ──
function cleanTempFiles() {
    try {
        if (!fs.existsSync(tempDir)) return;
        const files = fs.readdirSync(tempDir)
            .filter(f => /^(in_|out_|won_card_)\d+\.(mp4|jpg|jpeg|png|gif|webm)$/i.test(f));
        let count = 0;
        for (const f of files) {
            try { fs.unlinkSync(path.join(tempDir, f)); count++; } catch {}
        }
        if (count > 0) log.system(`[autosend] Đã dọn ${count} file temp bị sót.`);
    } catch (e) {
        log.warn(`[autosend] cleanTempFiles lỗi: ${e.message}`);
    }
}

// ─── Xóa URL chết khỏi file media (khi nhận 404 / lỗi mạng vĩnh viễn) ─────────
function removeDeadUrl(filePath, deadUrl) {
    try {
        const raw  = readJSON(filePath);
        if (!raw) return;
        const isArr = Array.isArray(raw);
        const list  = isArr ? raw : (raw.urls || raw.data || []);
        const after = list.filter(u => u !== deadUrl);
        if (after.length === list.length) return;
        const updated = isArr ? after : { ...raw, ...(raw.urls ? { urls: after } : { data: after }) };
        writeJSON(filePath, updated);
        log.warn(`[autosend] Đã xóa URL chết khỏi ${path.basename(filePath)} (còn ${after.length} URL).`);
    } catch (e) {
        log.warn(`[autosend] removeDeadUrl lỗi: ${e.message}`);
    }
}

async function getUniqueMedia(type) {
    try {
        if (type === "nct") {
            const hotSongs = await searchNCT("top 10 nhạc trẻ");
            const song = hotSongs[Math.floor(Math.random() * hotSongs.length)] || null;
            return song ? { url: song, resolvedType: "nct", filePath: null } : null;
        }

        // Giải quyết alias (video_gai → gai, anh_gai → anhgai, ...)
        const aliasResolved = TYPE_ALIASES[type] || type;

        // Lấy danh sách media types tự động từ src/data/
        const mediaTypes = getDynamicMediaTypes();

        // Tìm file: thử alias trước, rồi tên gốc, rồi fallback sang file đầu tiên tìm được
        let filePath = null;
        let resolvedType = null;

        for (const candidate of [aliasResolved, type]) {
            if (mediaTypes[candidate]) {
                filePath = mediaTypes[candidate];
                resolvedType = candidate;
                break;
            }
        }

        if (!filePath) {
            // Fallback: dùng file media đầu tiên có sẵn
            const first = Object.keys(mediaTypes)[0];
            if (first) {
                filePath = mediaTypes[first];
                resolvedType = first;
                log.info(`[autosend] Fallback "${type}" → "${resolvedType}".`);
            }
        }

        if (!filePath) {
            log.warn(`[autosend] Không tìm thấy file media nào cho type "${type}".`);
            return null;
        }

        if (resolvedType !== type && resolvedType !== aliasResolved) {
            log.info(`[autosend] Dùng fallback "${resolvedType}" thay cho "${type}".`);
        }

        const raw  = readJSON(filePath);
        const list = Array.isArray(raw) ? raw : (raw?.urls || raw?.data || []);
        if (list.length === 0) return null;

        const history    = loadData(HISTORY_PATH);
        const filtered   = list.filter(u => !history.includes(u));
        const targetList = filtered.length > 0 ? filtered : list;
        if (filtered.length === 0) saveData(HISTORY_PATH, []);

        const selected = targetList[Math.floor(Math.random() * targetList.length)];
        if (filtered.length > 0) {
            history.push(selected);
            if (history.length > 1000) history.shift();
            saveData(HISTORY_PATH, history);
        }
        return { url: selected, resolvedType, filePath };
    } catch (e) {
        log.error(`[autosend] getUniqueMedia lỗi: ${e.message}`);
        return null;
    }
}

async function processImage(inputPath, outputPath, hour) {
    try {
        let createCanvas, loadImage;
        try {
            const canvasMod = await import("skia-canvas");
            createCanvas = (w, h) => new canvasMod.Canvas(w, h);
            loadImage = canvasMod.loadImage;
        } catch { return false; }
        const img = await loadImage(inputPath);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const overlayW = 400, overlayH = 120, x = 30, y = 30;
        ctx.fillStyle = "rgba(0, 0, 0, 0.6)"; ctx.fillRect(x, y, overlayW, overlayH);
        ctx.strokeStyle = "#00afea"; ctx.lineWidth = 4; ctx.strokeRect(x, y, overlayW, overlayH);
        ctx.fillStyle = "#ffffff"; ctx.font = "bold 35px Sans"; ctx.fillText(`THONG BAO GIO MOI`, x + 20, y + 50);
        ctx.fillStyle = "#00afea"; ctx.font = "bold 45px Sans"; ctx.fillText(`${hour}:00`, x + 20, y + 100);
        fs.writeFileSync(outputPath, await canvas.toBuffer("jpg"));
        return true;
    } catch { return false; }
}

async function processVideo(inputPath, outputPath, hour) {
    return new Promise((resolve) => {
        const drawtext = `drawtext=text='THONG BAO GIO MOI - ${hour}\\:00':fontcolor=white:fontsize=40:box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-80`;
        const cmd = `"${FFMPEG_BIN}" -y -i "${inputPath}" -vf "${drawtext}" -codec:a copy -t 15 "${outputPath}"`;
        exec(cmd, (err) => resolve(!err));
    });
}

// ─── Main ticker ───────────────────────────────────────────────────────────
export async function startAutosendTicker(api) {
    log.system("⏳ Động cơ Autosend đã sẵn sàng!");

    // Dọn rác ngay khi khởi động
    cleanTempFiles();
    cleanStaleHistory();

    // Tự dọn rác định kỳ mỗi 24 giờ
    setInterval(() => {
        cleanTempFiles();
        cleanStaleHistory();
    }, 24 * 60 * 60 * 1000);

    await fetchExchangeRates();

    let lastFiredHour = -1;
    setInterval(async () => {
        const now    = moment().tz("Asia/Ho_Chi_Minh");
        const minute = now.minute();
        const hour   = now.hour();

        // Cho phép window 0-2 phút để tránh miss do event loop trễ
        if (hour !== lastFiredHour && minute < 3) {
            lastFiredHour = hour;
            await fetchExchangeRates();

            const settings = loadData(CONFIG_PATH);

            // Ưu tiên duyệt đúng các thread đã cài autosend, không phụ thuộc vào statsManager
            const configuredThreads = Object.keys(settings);
            const activeThreads     = statsManager.getAllThreads();
            const threads = [...new Set([...configuredThreads, ...activeThreads])];

            for (const tid of threads) {
                const config = settings[tid];
                if (!config || !config.enabled) continue;
                // Bỏ check isRented nếu thread trong settings thì luôn cho phép gửi
                const isAllowed = configuredThreads.includes(tid) || rentalManager.isRented(tid);
                if (!isAllowed) continue;

                try {
                    const media = await getUniqueMedia(config.type);
                    if (!media) {
                        log.warn(`[autosend] Không có media cho thread ${tid} (type: ${config.type})`);
                        continue;
                    }

                    const { url: mediaRaw, resolvedType } = media;

                    const rateBlock  = buildRateBlock();
                    const msgCaption =
                        `[ SYSTEM NOTIFICATION ]\n` +
                        `─────────────────\n` +
                        `Bây giờ là: ${hour}:00\n` +
                        `Chúc nhóm mình một giờ mới tốt lành!` +
                        rateBlock +
                        `\n─────────────────`;

                    if (resolvedType === "nct") {
                        const song   = mediaRaw;
                        const stream = song.streamURL?.find(s => s.type === "320") || song.streamURL?.[0];
                        if (stream?.stream) {
                            await api.sendMessage({ msg: msgCaption + `\nGoi y nhac: ${song.name}` }, tid, 1);
                            await api.sendVoiceNative({ voiceUrl: stream.stream, duration: (song.duration || 0) * 1000, threadId: tid, threadType: 1 });
                        }
                        continue;
                    }

                    let mediaUrl = typeof mediaRaw === "string" ? mediaRaw : (mediaRaw.urls?.[0] || mediaRaw.url);
                    let mediaFilePath = media.filePath;

                    // Thử tải + gửi, nếu 404 thì xóa URL chết và lấy URL mới (retry 1 lần)
                    for (let attempt = 0; attempt < 2; attempt++) {
                        const isVideo  = isVideoUrl(mediaUrl);
                        const ext      = isVideo ? "mp4" : "jpg";
                        const tempIn   = path.join(tempDir, `in_${Date.now()}.${ext}`);
                        const tempOut  = path.join(tempDir, `out_${Date.now()}.${ext}`);
                        try {
                            const response = await axios({ method: "get", url: mediaUrl, responseType: "stream", timeout: 60000 });
                            const writer   = fs.createWriteStream(tempIn);
                            response.data.pipe(writer);
                            await new Promise((res, rej) => { writer.on("finish", res); writer.on("error", rej); });
                            let success = isVideo ? await processVideo(tempIn, tempOut, hour) : await processImage(tempIn, tempOut, hour);
                            const finalFile = success ? tempOut : tempIn;
                            if (isVideo) await api.sendVideoUnified({ videoPath: finalFile, msg: msgCaption, threadId: tid, threadType: 1 });
                            else         await api.sendMessage({ msg: msgCaption, attachments: [finalFile] }, tid, 1);
                            break; // gửi thành công — thoát vòng retry
                        } catch (e) {
                            const is404 = e?.response?.status === 404 || /404/.test(e.message);
                            if (is404 && mediaFilePath && attempt === 0) {
                                // Xóa URL chết khỏi file media và thử URL khác
                                removeDeadUrl(mediaFilePath, mediaUrl);
                                log.warn(`[autosend] URL 404 cho thread ${tid}, thử URL khác...`);
                                const retry = await getUniqueMedia(config.type);
                                if (retry && retry.url && typeof retry.url === "string") {
                                    mediaUrl      = retry.url;
                                    mediaFilePath = retry.filePath;
                                } else {
                                    log.warn(`[autosend] Không còn URL dự phòng cho thread ${tid}.`);
                                    break;
                                }
                            } else {
                                log.error(`[autosend] Gửi media lỗi (${tid}): ${e.message}`);
                                break;
                            }
                        } finally {
                            if (fs.existsSync(tempIn))  fs.unlinkSync(tempIn);
                            if (fs.existsSync(tempOut)) fs.unlinkSync(tempOut);
                        }
                    }
                } catch (e) {
                    log.error(`[autosend] Lỗi xử lý thread ${tid}: ${e.message}`);
                }
            }
        }
    }, 60000);
}

// ─── Won command handler ────────────────────────────────────────────────────
async function handleWonCommand(ctx) {
    const { api, threadId, threadType, args } = ctx;

    if (!rateCache.krwToVnd) {
        await api.sendMessage({ msg: `${sysBrand}Dang lay ty gia thuc te...` }, threadId, threadType);
        await fetchExchangeRates();
    }
    if (!rateCache.krwToVnd) {
        return api.sendMessage({ msg: `${sysBrand}Khong the lay ty gia luc nay. Thu lai sau!` }, threadId, threadType);
    }

    const rate       = rateCache.krwToVnd;
    const hist       = loadRateHistory();
    const chartRates = hist.slice(-24).map(h => h.rate);
    const changeData = calcChange(hist, 24);
    const predicted  = aiPredict(hist.slice(-24).map(h => h.rate));
    const updatedAt  = rateCache.updatedAt;

    const raw = args.join("").trim();

    if (raw) {
        const krwAmount = parseViNum(raw);
        if (!krwAmount) {
            return api.sendMessage({
                msg: `${sysBrand}Khong hieu "${raw}".\nVi du: !won 10000 | !won 1tr | !won 500k`
            }, threadId, threadType);
        }
        await sendWonCard(api, threadId, threadType, {
            krwAmount, rate, changeData, chartRates, predicted, updatedAt
        });
    } else {
        await sendWonCard(api, threadId, threadType, {
            krwAmount: null, rate, changeData, chartRates, predicted, updatedAt
        });
    }
}

// ─── Commands ──────────────────────────────────────────────────────────────
export const commands = {
    autosend: async (ctx) => {
        const { api, threadId, threadType, args, senderId, adminIds } = ctx;
        if (!adminIds.includes(String(senderId))) return;

        const action   = args[0]?.toLowerCase();
        const settings = loadData(CONFIG_PATH);

        // Lấy danh sách loại media động từ src/data/
        const mediaTypes   = getDynamicMediaTypes();
        const dynamicTypes = Object.keys(mediaTypes); // vd: ["gai", "rap", "vdanime", ...]
        const allAliases   = Object.keys(TYPE_ALIASES); // vd: ["video", "video_gai", "anime", ...]
        const validTypes   = [...new Set([...allAliases, ...dynamicTypes, "nct"])];

        if (action === "on") {
            const curType = settings[threadId]?.type || (dynamicTypes[0] || "gai");
            settings[threadId] = { enabled: true, type: curType };
            saveData(CONFIG_PATH, settings);
            return api.sendMessage({ msg: `${sysBrand}Da BAT Autosend! Bot se gui Media kem card ty gia Won moi gio.\nLoai hien tai: ${curType}` }, threadId, threadType);
        } else if (action === "off") {
            if (settings[threadId]) settings[threadId].enabled = false;
            saveData(CONFIG_PATH, settings);
            return api.sendMessage({ msg: `${sysBrand}Da TAT Autosend.` }, threadId, threadType);
        } else if (action && validTypes.includes(action)) {
            // Giải alias thành tên file thực
            const resolvedType = TYPE_ALIASES[action] || action;
            settings[threadId] = { enabled: true, type: resolvedType };
            saveData(CONFIG_PATH, settings);
            return api.sendMessage({ msg: `${sysBrand}Da doi loai: ${action.toUpperCase()} (${resolvedType})!` }, threadId, threadType);
        } else {
            const config   = settings[threadId];
            const status   = config?.enabled ? "DANG BAT" : "DANG TAT";
            const ri       = rateCache.krwToVnd
                ? `\nTy gia: 1 KRW = ${rateCache.krwToVnd.toFixed(2)} VND`
                : `\nTy gia: Chua cap nhat`;
            const typeList = ["nct", ...dynamicTypes].join(" | ");
            return api.sendMessage({
                msg: `${sysBrand}CAI DAT AUTOSEND\n!autosend on/off | ${typeList}\nTrang thai: ${status}\nLoai hien tai: ${config?.type || "N/A"}\nCac loai kha dung: ${typeList}` + ri
            }, threadId, threadType);
        }
    },

    won:   handleWonCommand,
    tygia: handleWonCommand,
};
