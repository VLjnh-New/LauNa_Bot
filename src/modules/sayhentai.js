import { fs, path, axios, log, uploadToTmpFiles } from "../globals.js";
import { drawMangaSearch, drawMangaDetail } from "../utils/canvas/canvasHelper.js";

export const name = "sayhentai";
export const description = "Tìm và đọc manga qua LauNa API (sex.launa.rf.gd/manga)";

const API_BASE = "https://sex.launa.rf.gd";
const API_KEY = "VLjnh-26";
const CACHE_DIR = path.join(process.cwd(), "src/modules/cache");
const SEARCH_LIMIT = 10;
const IMG_BATCH = 5;
const SEARCH_TTL = 5 * 60 * 1000;
const DETAIL_TTL = 15 * 60 * 1000;

const searchSessions = new Map();
const detailSessions = new Map();
const modeSessions = new Map(); // chờ user chọn 1=gốc / 2=real

function ensureCache() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}
function safeUnlink(p, delay = 0) {
    const rm = () => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} };
    delay > 0 ? setTimeout(rm, delay) : rm();
}
function send(ctx, msg, attachments) {
    return ctx.api.sendMessage(
        attachments ? { msg, attachments } : { msg },
        ctx.threadId, ctx.threadType
    );
}

async function sendCanvasCard(ctx, buf, caption, width = 1280, height = 720) {
    if (!buf) { await send(ctx, caption); return; }
    ensureCache();
    const tmpImg = path.join(CACHE_DIR, `manga_card_${Date.now()}.png`);
    try {
        fs.writeFileSync(tmpImg, buf);
        let sent = null;
        try {
            const remoteUrl = await uploadToTmpFiles(tmpImg, ctx.api, ctx.threadId, ctx.threadType);
            if (remoteUrl && ctx.api.sendImageEnhanced) {
                sent = await ctx.api.sendImageEnhanced({
                    imageUrl: remoteUrl, threadId: ctx.threadId, threadType: ctx.threadType,
                    width, height, msg: caption
                });
            }
        } catch {}
        if (!sent) await ctx.api.sendMessage({ msg: caption, attachments: [tmpImg] }, ctx.threadId, ctx.threadType);
        safeUnlink(tmpImg, 6000);
    } catch (e) {
        log.warn(`[sayhentai] canvas send fail: ${e.message}`);
        safeUnlink(tmpImg, 1000);
        await send(ctx, caption);
    }
}

async function apiGet(endpoint, params, timeout = 25000) {
    const res = await axios.get(`${API_BASE}${endpoint}`, {
        params: { ...params, apikey: API_KEY },
        timeout,
        validateStatus: () => true
    });
    if (res.status !== 200 || !res.data || res.data.status === false) {
        const err = res.data?.message || `HTTP ${res.status}`;
        throw new Error(err);
    }
    return res.data;
}

async function searchManga(keyword) {
    const data = await apiGet("/manga/search", { q: keyword, limit: SEARCH_LIMIT });
    return Array.isArray(data.results) ? data.results : [];
}

async function getMangaDetail(url) {
    const data = await apiGet("/manga/detail", { url });
    return {
        title: data.title || "",
        thumbnail: data.thumbnail || "",
        genres: Array.isArray(data.genres) ? data.genres : [],
        authors: Array.isArray(data.authors) ? data.authors : [],
        description: data.description || "",
        chapters: (data.chapters || []).map(c => ({
            name: c.name || c.title || "",
            link: c.link || c.url || ""
        })).filter(c => c.link)
    };
}

async function getChapterImages(chapterUrl) {
    const data = await apiGet("/manga/chapter", { url: chapterUrl });
    return Array.isArray(data.images) ? data.images.filter(Boolean) : [];
}

async function anime2real(imgUrl) {
    const data = await apiGet("/ai/anime2real", { url: imgUrl }, 120000);
    return data.image || null;
}

async function downloadImage(url) {
    try {
        const res = await axios.get(url, {
            responseType: "arraybuffer",
            timeout: 15000,
            headers: { "User-Agent": "Mozilla/5.0" }
        });
        const ext = (url.split("?")[0].split(".").pop() || "jpg").toLowerCase().slice(0, 4);
        const safeExt = /^(jpg|jpeg|png|webp|gif)$/.test(ext) ? ext : "jpg";
        const tmp = path.join(CACHE_DIR, `sh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${safeExt}`);
        fs.writeFileSync(tmp, Buffer.from(res.data));
        return tmp;
    } catch (e) {
        log.warn(`[sayhentai] tải ảnh fail: ${e.message}`);
        return null;
    }
}

async function handleSearch(ctx) {
    const { threadId, senderId, args, prefix } = ctx;
    const query = args.join(" ").trim();

    if (!query) {
        return send(ctx, `⚠️ Dùng: ${prefix}manga <từ khóa>\nVí dụ: ${prefix}manga mẹ kế`);
    }

    try {
        await send(ctx, `🔍 Đang tìm: "${query}"...`);
        const results = await searchManga(query);
        if (!results.length) return send(ctx, `❌ Không tìm thấy truyện nào cho "${query}"`);

        const list = results.slice(0, SEARCH_LIMIT);
        const key = `${threadId}-${senderId}`;
        searchSessions.set(key, list);
        setTimeout(() => searchSessions.delete(key), SEARCH_TTL);

        const text = list.map((it, i) => `${i + 1}. ${it.title}`).join("\n");
        const caption = `📚 [MANGA] Kết quả "${query}":\n─────────────────\n${text}\n─────────────────\n💡 Reply số (1-${list.length}) để xem chi tiết.`;

        let buf = null;
        try { buf = await drawMangaSearch(list, query); }
        catch (e) { log.warn(`[sayhentai] draw search fail: ${e.message}`); }
        await sendCanvasCard(ctx, buf, caption);
    } catch (e) {
        log.error("[sayhentai] search error:", e.message);
        await send(ctx, `❗ Lỗi tìm kiếm: ${e.message}`);
    }
}

export const commands = {
    sayhentai: handleSearch,
    hentai: handleSearch,
    manga: handleSearch
};

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType } = ctx;
    const num = parseInt(content?.trim(), 10);
    if (!Number.isFinite(num) || num < 1) return false;

    const searchKey = `${threadId}-${senderId}`;
    const detailKey = `${threadId}-${senderId}-manga`;
    const modeKey = `${threadId}-${senderId}-mode`;

    // 0) Đang chờ chọn chế độ: 1 = ảnh gốc, 2 = chuyển real
    if (modeSessions.has(modeKey)) {
        const m = modeSessions.get(modeKey);
        if (num !== 1 && num !== 2) {
            await send(ctx, `⚠️ Chỉ chọn 1 (ảnh gốc) hoặc 2 (chuyển real).`);
            return true;
        }
        modeSessions.delete(modeKey);
        const realMode = num === 2;

        try {
            await send(ctx, `📥 Đang lấy "${m.chapterName}"...`);
            const images = await getChapterImages(m.chapterLink);
            if (!images.length) { await send(ctx, "❌ Chương trống."); return true; }

            await send(ctx, realMode
                ? `🎨 Đang chuyển ${images.length} ảnh sang phong cách real (có thể lâu)...`
                : `🖼️ Gửi ${images.length} ảnh gốc...`);
            ensureCache();

            if (realMode) {
                // Convert tuần tự, làm xong ảnh nào gửi luôn ảnh đó
                for (let k = 0; k < images.length; k++) {
                    const src = images[k];
                    let outUrl = src;
                    try {
                        const r = await anime2real(src);
                        if (r) outUrl = r;
                    } catch (e) {
                        log.warn(`[sayhentai] anime2real ${k + 1}/${images.length} fail: ${e.message}`);
                    }
                    const p = await downloadImage(outUrl);
                    if (!p) continue;
                    try {
                        await api.sendMessage({
                            msg: `(${k + 1}/${images.length}) · real`,
                            attachments: [p]
                        }, threadId, threadType);
                    } catch (e) {
                        log.warn(`[sayhentai] gửi ảnh fail: ${e.message}`);
                    } finally {
                        safeUnlink(p, 4000);
                    }
                }
            } else {
                const totalBatches = Math.ceil(images.length / IMG_BATCH);
                for (let i = 0; i < images.length; i += IMG_BATCH) {
                    const batch = images.slice(i, i + IMG_BATCH);
                    const paths = (await Promise.all(batch.map(downloadImage))).filter(Boolean);
                    if (paths.length) {
                        try {
                            await api.sendMessage({
                                msg: `(Phần ${Math.floor(i / IMG_BATCH) + 1}/${totalBatches})`,
                                attachments: paths
                            }, threadId, threadType);
                        } catch (e) {
                            log.warn(`[sayhentai] gửi batch fail: ${e.message}`);
                        } finally {
                            paths.forEach(p => safeUnlink(p, 4000));
                        }
                    }
                }
            }
            await send(ctx, `✅ Xong "${m.chapterName}". Reply số chương khác để đọc tiếp.`);
            return true;
        } catch (e) {
            log.error("[sayhentai] chapter error:", e.message);
            await send(ctx, `❗ Lỗi tải chương: ${e.message}`);
            return true;
        }
    }

    // 1) Đang chọn chương → hỏi chế độ
    if (detailSessions.has(detailKey)) {
        const data = detailSessions.get(detailKey);
        const chapter = data.chapters[num - 1];
        if (!chapter) {
            await send(ctx, `❌ Không có chương ${num}. Chọn 1-${data.chapters.length}.`);
            return true;
        }

        modeSessions.set(modeKey, {
            chapterName: chapter.name,
            chapterLink: chapter.link
        });
        setTimeout(() => modeSessions.delete(modeKey), 3 * 60 * 1000);

        await send(ctx,
            `📖 Đã chọn: ${chapter.name}\n─────────────────\n` +
            `1. Ảnh gốc (anime)\n` +
            `2. Chuyển sang real (AI)\n─────────────────\n` +
            `💡 Reply 1 hoặc 2 trong 3 phút.`
        );
        return true;
    }

    // 2) Đang chọn truyện từ kết quả search
    if (!searchSessions.has(searchKey)) return false;
    const selected = searchSessions.get(searchKey)[num - 1];
    if (!selected) return false;
    searchSessions.delete(searchKey);

    try {
        await send(ctx, `📖 Đang lấy chi tiết: ${selected.title}...`);
        const detail = await getMangaDetail(selected.link);
        if (!detail.chapters.length) {
            return send(ctx, `❌ "${detail.title || selected.title}" chưa có chương nào.`);
        }

        detailSessions.set(detailKey, detail);
        setTimeout(() => detailSessions.delete(detailKey), DETAIL_TTL);

        const chapList = detail.chapters.slice(0, 30)
            .map((c, i) => `${i + 1}. ${c.name}`).join("\n");
        const more = detail.chapters.length > 30 ? `\n...và ${detail.chapters.length - 30} chương nữa` : "";
        const author = detail.authors.filter(a => a && a !== "Đang cập nhật").join(", ") || "Đang cập nhật";

        const caption = `📖 ${detail.title}\n👤 ${author}\n📑 ${detail.chapters.length} chương\n─────────────────\n${chapList}${more}\n─────────────────\n💡 Reply số chương để đọc.`;

        let buf = null;
        try { buf = await drawMangaDetail(detail); }
        catch (e) { log.warn(`[sayhentai] draw detail fail: ${e.message}`); }

        if (buf) {
            await sendCanvasCard(ctx, buf, caption, 1100, 640);
        } else {
            // Fallback: gửi thumbnail thật nếu canvas fail
            let attachments;
            if (detail.thumbnail) {
                ensureCache();
                const thumb = await downloadImage(detail.thumbnail);
                if (thumb) { attachments = [thumb]; setTimeout(() => safeUnlink(thumb, 0), 8000); }
            }
            await send(ctx, caption, attachments);
        }
        return true;
    } catch (e) {
        log.error("[sayhentai] detail error:", e.message);
        await send(ctx, `❗ Lỗi lấy chi tiết: ${e.message}`);
        return true;
    }
}
