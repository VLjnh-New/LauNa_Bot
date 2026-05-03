import { fs, path, axios, log, uploadToTmpFiles } from "../globals.js";
import { getDesktopUA } from "../utils/core/userAgents.js";
import { ffprobeAsync, ffmpegRun } from "../utils/core/ffmpegHelper.js";
import { drawMovieSearch, drawMovieDetail } from "../utils/canvas/canvasHelper.js";

export const name = "phim";
export const description = "Tìm kiếm và xem phim qua phimapi.com (KKPhim)";

const PHIMAPI = "https://phimapi.com";
const CACHE_DIR = path.join(process.cwd(), "src/modules/cache");
const DEFAULT_MAX_SEND_SIZE = 100 * 1024 * 1024;

const HEADERS = {
    "User-Agent": getDesktopUA(),
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
    "Referer": "https://phimapi.com/"
};

const searchSessions = new Map();   // `${threadId}-${senderId}` → { results, undoData }
const episodeSessions = new Map();  // `${threadId}-${senderId}-ep` → { episodes, movieName, poster, undoData, _timeout }

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function safeUnlink(p, delay = 0) {
    const rm = () => { try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {} };
    delay > 0 ? setTimeout(rm, delay) : rm();
}

function getZaloMaxSendSize(api) {
    const ctx = api?.getContext?.() || api?.context || {};
    const sf = ctx?.settings?.features?.sharefile || {};
    const mb = Number(sf.max_size_share_file_v3 || sf.max_size_share_file || 0);
    if (!Number.isFinite(mb) || mb <= 0) return DEFAULT_MAX_SEND_SIZE;
    return Math.max(32, mb - 5) * 1024 * 1024;
}

function fixImg(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `https://phimimg.com/${String(url).replace(/^\/+/, "")}`;
}

async function getJSON(url, params = {}) {
    const res = await axios.get(url, { headers: HEADERS, params, timeout: 15000, validateStatus: () => true });
    if (res.status < 200 || res.status >= 300) {
        throw new Error(`HTTP ${res.status} từ ${url}`);
    }
    return res.data;
}

async function searchPhim(keyword, limit = 10) {
    const data = await getJSON(`${PHIMAPI}/v1/api/tim-kiem`, { keyword, limit });
    const items = data?.data?.items || data?.items || [];
    return items.slice(0, limit).map(it => ({
        slug: it.slug,
        name: it.name || it.slug,
        origin_name: it.origin_name || "",
        year: it.year || "",
        time: it.time || "",
        quality: it.quality || "",
        lang: it.lang || "",
        episode_current: it.episode_current || "",
        thumb_url: fixImg(it.thumb_url || it.poster_url),
        poster_url: fixImg(it.poster_url || it.thumb_url)
    }));
}

async function getLatest(page = 1) {
    const data = await getJSON(`${PHIMAPI}/danh-sach/phim-moi-cap-nhat-v3`, { page });
    const items = data?.items || [];
    return items.slice(0, 10).map(it => ({
        slug: it.slug,
        name: it.name || it.slug,
        origin_name: it.origin_name || "",
        year: it.year || "",
        thumb_url: fixImg(it.thumb_url || it.poster_url),
        poster_url: fixImg(it.poster_url || it.thumb_url)
    }));
}

async function getMovieDetail(slug) {
    const data = await getJSON(`${PHIMAPI}/phim/${encodeURIComponent(slug)}`);
    if (data?.status === false || data?.status === "false") {
        throw new Error(data?.msg || "Không lấy được chi tiết phim");
    }
    const movie = data?.movie || {};
    const serverList = data?.episodes || [];

    // Gom server đầu + fallback m3u8 từ các server còn lại
    const main = serverList.find(s => Array.isArray(s?.server_data) && s.server_data.length) || serverList[0];
    const others = serverList.filter(s => s !== main);
    const mainData = main?.server_data || [];

    const episodes = mainData.map((ep, i) => {
        const fallbacks = others
            .map(s => s.server_data?.[i]?.link_m3u8)
            .filter(Boolean);
        return {
            name: ep.name || `Tập ${i + 1}`,
            slug: ep.slug || String(i + 1),
            link_m3u8: ep.link_m3u8 || null,
            link_embed: ep.link_embed || null,
            _fallbackM3u8: fallbacks
        };
    });

    const info = {
        slug: movie.slug || slug,
        name: movie.name || slug,
        origin_name: movie.origin_name || "",
        content: (movie.content || "").replace(/<[^>]+>/g, "").trim(),
        thumb_url: fixImg(movie.thumb_url),
        poster_url: fixImg(movie.poster_url),
        year: movie.year || "",
        time: movie.time || "",
        quality: movie.quality || "",
        lang: movie.lang || "",
        status: movie.status || "",
        episode_current: movie.episode_current || "",
        episode_total: movie.episode_total || "",
        category: (movie.category || []).map(c => c.name).filter(Boolean),
        country: (movie.country || []).map(c => c.name).filter(Boolean),
        actors: movie.actor || [],
        directors: movie.director || []
    };

    return { info, episodes };
}

// ─── HLS download (ffmpeg + axios fallback) ─────────────────────────────────
async function downloadHlsFFmpeg(url, outputPath, referer) {
    let origin = "https://phimapi.com";
    try { origin = new URL(referer || url).origin; } catch {}
    await ffmpegRun([
        "-y",
        "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
        "-allowed_extensions", "ALL",
        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
        "-user_agent", HEADERS["User-Agent"],
        "-headers", `Referer: ${referer || ""}\r\nOrigin: ${origin}\r\nAccept: */*\r\n`,
        "-i", url,
        "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart",
        outputPath
    ]);
}

async function downloadHlsManual(m3u8Url, outputPath) {
    const res = await axios.get(m3u8Url, { headers: HEADERS, timeout: 20000, responseType: "text", validateStatus: () => true });
    if (res.status < 200 || res.status >= 300 || !/#EXTM3U/i.test(String(res.data || ""))) {
        throw new Error(`m3u8 không hợp lệ (status=${res.status})`);
    }
    let playlist = String(res.data);

    if (/#EXT-X-STREAM-INF/i.test(playlist)) {
        const lines = playlist.split(/\r?\n/);
        let best = null;
        for (let i = 0; i < lines.length; i++) {
            if (/#EXT-X-STREAM-INF/i.test(lines[i])) {
                const bw = Number((lines[i].match(/BANDWIDTH=(\d+)/i) || [])[1] || 0);
                const next = (lines[i + 1] || "").trim();
                if (next && (!best || bw > best.bw)) best = { bw, url: next };
            }
        }
        if (!best) throw new Error("Master m3u8 không có variant");
        const variantUrl = new URL(best.url, m3u8Url).toString();
        return downloadHlsManual(variantUrl, outputPath);
    }

    if (/#EXT-X-KEY:METHOD=(?!NONE)/i.test(playlist)) {
        throw new Error("HLS có mã hoá, dùng ffmpeg");
    }

    const baseUrl = m3u8Url.replace(/\/[^/]*(\?.*)?$/, "/");
    const segments = playlist.split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"))
        .map(l => new URL(l, baseUrl).toString());

    if (!segments.length) throw new Error("Không tìm thấy segment trong m3u8");

    const tmpDir = path.join(CACHE_DIR, `hls_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
        const concurrency = 6;
        const segPaths = new Array(segments.length);
        let idx = 0;

        async function worker() {
            while (idx < segments.length) {
                const i = idx++;
                const segUrl = segments[i];
                const segPath = path.join(tmpDir, `seg_${String(i).padStart(5, "0")}.ts`);
                let lastErr = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const r = await axios.get(segUrl, { headers: HEADERS, timeout: 30000, responseType: "arraybuffer" });
                        fs.writeFileSync(segPath, Buffer.from(r.data));
                        segPaths[i] = segPath;
                        lastErr = null;
                        break;
                    } catch (e) {
                        lastErr = e;
                        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                    }
                }
                if (lastErr) throw new Error(`segment ${i} fail: ${lastErr.message}`);
            }
        }

        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        const listPath = path.join(tmpDir, "list.txt");
        fs.writeFileSync(listPath, segPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));
        await ffmpegRun([
            "-y", "-f", "concat", "-safe", "0", "-i", listPath,
            "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart",
            outputPath
        ]);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
}

// Đọc m3u8 (master → variant nhỏ nhất nếu có) và tính tổng duration + bandwidth.
// Trả { duration (s), bandwidth (bps), variantUrl, m3u8Body }
async function probeM3u8(m3u8Url) {
    const fetch = async (url) => {
        const r = await axios.get(url, { headers: HEADERS, timeout: 12000, responseType: "text", validateStatus: () => true });
        if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
        return String(r.data || "");
    };

    let body = await fetch(m3u8Url);
    let variantUrl = m3u8Url;
    let bandwidth = 0;

    if (/#EXT-X-STREAM-INF/i.test(body)) {
        // Master: chọn variant THẤP NHẤT để file nhỏ
        const lines = body.split(/\r?\n/);
        let lowest = null;
        for (let i = 0; i < lines.length; i++) {
            if (/#EXT-X-STREAM-INF/i.test(lines[i])) {
                const bw = Number((lines[i].match(/BANDWIDTH=(\d+)/i) || [])[1] || 0);
                const next = (lines[i + 1] || "").trim();
                if (next && (!lowest || bw < lowest.bw)) lowest = { bw, url: next };
            }
        }
        if (lowest) {
            bandwidth = lowest.bw;
            variantUrl = new URL(lowest.url, m3u8Url).toString();
            body = await fetch(variantUrl);
        }
    }

    const matches = [...body.matchAll(/#EXTINF:([\d.]+)/g)];
    const duration = matches.reduce((a, m) => a + parseFloat(m[1] || 0), 0);
    return { duration, bandwidth, variantUrl, m3u8Body: body };
}

function expandCdnAlternates(url) {
    if (!url) return [];
    const out = new Set([url]);
    try {
        const u = new URL(url);
        const host = u.hostname;
        // Hoán đổi subdomain s1..s9 ↔ v1..v9, và domain kkphimplayer6 ↔ kkphimplayer7
        const m = host.match(/^([sv])(\d+)\.(kkphimplayer\d+)\.com$/i);
        if (m) {
            const prefixes = ["s", "v"];
            const domains = ["kkphimplayer6.com", "kkphimplayer7.com", "kkphimplayer8.com"];
            for (const p of prefixes) {
                for (let n = 1; n <= 9; n++) {
                    for (const d of domains) {
                        const alt = new URL(url);
                        alt.hostname = `${p}${n}.${d}`;
                        out.add(alt.toString());
                    }
                }
            }
        }
    } catch {}
    return [...out];
}

async function probeUrlOk(url) {
    try {
        const r = await axios.head(url, { headers: HEADERS, timeout: 7000, validateStatus: () => true });
        if (r.status >= 200 && r.status < 400) return true;
    } catch {}
    try {
        const r = await axios.get(url, { headers: HEADERS, timeout: 8000, responseType: "text", validateStatus: () => true });
        return r.status >= 200 && r.status < 300 && /#EXTM3U/i.test(String(r.data || ""));
    } catch {}
    return false;
}

async function resolveLiveM3u8(urls) {
    const seen = new Set();
    const queue = [];
    for (const u of urls) {
        for (const alt of expandCdnAlternates(u)) {
            if (!seen.has(alt)) { seen.add(alt); queue.push(alt); }
        }
    }
    const live = [];
    const concurrency = 8;
    let idx = 0;
    async function worker() {
        while (idx < queue.length) {
            const i = idx++;
            const u = queue[i];
            if (await probeUrlOk(u)) live.push(u);
        }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    // Ưu tiên thứ tự gốc nếu có
    const orderRank = (u) => {
        const i = urls.indexOf(u);
        return i === -1 ? 999 : i;
    };
    live.sort((a, b) => orderRank(a) - orderRank(b));
    return live;
}

async function downloadEpisode(m3u8Urls, outputPath) {
    let lastErr = null;
    for (const url of m3u8Urls) {
        // Thử ffmpeg với nhiều referer
        for (const ref of [PHIMAPI + "/", "", "https://player.phimapi.com/"]) {
            try {
                safeUnlink(outputPath);
                await downloadHlsFFmpeg(url, outputPath, ref);
                if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10240) return true;
            } catch (e) {
                lastErr = e;
                log.warn(`[phim] ffmpeg fail (ref=${ref || "(none)"}):`, e.message);
            }
        }
        // Fallback manual
        try {
            safeUnlink(outputPath);
            await downloadHlsManual(url, outputPath);
            if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10240) return true;
        } catch (e) {
            lastErr = e;
            log.warn(`[phim] manual HLS fail:`, e.message);
        }
    }
    throw lastErr || new Error("Không tải được video");
}

async function compressVideo(inputPath, outputPath, targetSize) {
    const meta = await ffprobeAsync(inputPath);
    const duration = Number(meta?.format?.duration || 0);
    if (!duration || !Number.isFinite(duration)) throw new Error("Không lấy được thời lượng");
    const audioBr = 48;
    const totalBr = Math.floor((targetSize * 8) / duration / 1000);
    const videoBr = Math.max(220, totalBr - audioBr - 16);
    await ffmpegRun([
        "-y", "-i", inputPath,
        "-c:v", "libx264", "-c:a", "aac",
        "-b:a", `${audioBr}k`, "-b:v", `${videoBr}k`,
        "-vf", "scale=640:-2",
        "-preset", "veryfast", "-crf", "31",
        "-maxrate", "900k", "-bufsize", "1800k",
        "-movflags", "+faststart",
        outputPath
    ]);
}

async function sendCanvasOrText(api, threadId, threadType, buf, caption) {
    if (!buf) {
        await api.sendMessage({ msg: caption }, threadId, threadType);
        return null;
    }
    ensureCacheDir();
    const tmpImg = path.join(CACHE_DIR, `phim_card_${Date.now()}.png`);
    try {
        fs.writeFileSync(tmpImg, buf);
        let sent;
        try {
            const remoteUrl = await uploadToTmpFiles(tmpImg, api, threadId, threadType);
            if (remoteUrl && api.sendImageEnhanced) {
                sent = await api.sendImageEnhanced({ imageUrl: remoteUrl, threadId, threadType, width: 1280, height: 720, msg: caption });
            }
        } catch {}
        if (!sent) {
            sent = await api.sendMessage({ msg: caption, attachments: [tmpImg] }, threadId, threadType);
        }
        safeUnlink(tmpImg, 5000);
        return sent;
    } catch (e) {
        log.warn("[phim] canvas send fail:", e.message);
        safeUnlink(tmpImg, 1000);
        await api.sendMessage({ msg: caption }, threadId, threadType);
        return null;
    }
}

function buildSearchCaption(items, title) {
    const lines = items.map((m, i) => {
        const meta = [m.year, m.episode_current, m.quality, m.lang].filter(Boolean).join(" · ");
        return `${i + 1}. ${m.name}${m.origin_name ? ` (${m.origin_name})` : ""}${meta ? `\n   ${meta}` : ""}`;
    }).join("\n");
    return `🎬 [${title}]\n─────────────────\n${lines}\n─────────────────\n💡 Reply số (1-${items.length}) để xem chi tiết.`;
}

// ─── Commands ────────────────────────────────────────────────────────────────
export const commands = {
    phim: async (ctx) => {
        const { api, args, threadId, threadType, senderId, prefix } = ctx;
        const query = args.join(" ").trim();

        const pageMatch = query.match(/^(?:trang\s*|t|p)(\d+)$/i);
        const isPageOnly = !query || pageMatch || /^\d+$/.test(query);
        const page = pageMatch ? parseInt(pageMatch[1], 10) : (/^\d+$/.test(query) ? parseInt(query, 10) : 1);

        try {
            let items, title;
            if (isPageOnly) {
                await api.sendMessage({ msg: `📡 Đang tải phim mới trang ${Math.max(1, page)}...` }, threadId, threadType);
                items = await getLatest(Math.max(1, page));
                title = `PHIM MỚI - TRANG ${Math.max(1, page)}`;
                if (!items.length) {
                    return api.sendMessage({ msg: `❌ Không có phim ở trang ${page}.` }, threadId, threadType);
                }
            } else {
                await api.sendMessage({ msg: `🔍 Đang tìm: "${query}"...` }, threadId, threadType);
                items = await searchPhim(query, 10);
                title = query.toUpperCase();
                if (!items.length) {
                    return api.sendMessage({ msg: `❌ Không tìm thấy phim: "${query}"\n💡 Dùng: ${prefix}phim trang 2 để xem phim mới.` }, threadId, threadType);
                }
            }

            const caption = buildSearchCaption(items, title);
            let buf = null;
            try {
                const canvasMovies = items.slice(0, 5).map(m => ({
                    name: m.name,
                    origin_name: m.origin_name,
                    thumb_url: m.thumb_url,
                    episode_current: m.episode_current || m.lang || "",
                    quality: m.quality || "HD"
                }));
                buf = await drawMovieSearch(canvasMovies, title);
            } catch (e) {
                log.warn("[phim] draw search fail:", e.message);
            }

            const sent = await sendCanvasOrText(api, threadId, threadType, buf, caption);
            const undoData = sent?.data ? {
                msgId: String(sent.data.msgId || ""),
                cliMsgId: String(sent.data.cliMsgId || "")
            } : null;

            const key = `${threadId}-${senderId}`;
            searchSessions.set(key, { results: items, undoData });
            setTimeout(() => searchSessions.delete(key), 120000);
        } catch (e) {
            log.error("[phim] Command error:", e.message);
            await api.sendMessage({ msg: `❌ Lỗi: ${e.message}` }, threadId, threadType);
        }
    },

    phimmoi: async (ctx) => {
        return commands.phim({ ...ctx, args: ["trang", String(parseInt(ctx.args?.[0] || "1", 10) || 1)] });
    }
};

// ─── Reply numeric handler ───────────────────────────────────────────────────
export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType } = ctx;
    const trimmed = content?.trim();
    const num = parseInt(trimmed, 10);
    if (Number.isNaN(num) || num < 1 || !/^\d+$/.test(trimmed)) return false;

    const searchKey = `${threadId}-${senderId}`;
    const episodeKey = `${threadId}-${senderId}-ep`;

    // ── Chọn tập phim ────────────────────────────────────────────────────
    if (episodeSessions.has(episodeKey)) {
        const data = episodeSessions.get(episodeKey);
        const episodes = data.episodes;
        if (num > episodes.length) {
            await api.sendMessage({ msg: `❌ Không có tập ${num}. Chọn 1-${episodes.length}.` }, threadId, threadType);
            return true;
        }

        if (data._timeout) clearTimeout(data._timeout);
        data._timeout = setTimeout(() => episodeSessions.delete(episodeKey), 20 * 60 * 1000);

        const ep = episodes[num - 1];
        const epName = ep.name || `Tập ${num}`;
        await api.sendMessage({ msg: `⏬ Đang tải "${epName}" - "${data.movieName}"...` }, threadId, threadType);

        // Refetch chi tiết phim để lấy m3u8 mới nhất (phòng trường hợp link cũ chết do CDN đổi)
        let freshM3u8s = [];
        if (data.slug) {
            try {
                const fresh = await getMovieDetail(data.slug);
                const freshEp = fresh.episodes[num - 1];
                if (freshEp) {
                    freshM3u8s = [freshEp.link_m3u8, ...(freshEp._fallbackM3u8 || [])].filter(Boolean);
                    // Cập nhật lại session với data mới
                    data.episodes = fresh.episodes;
                }
            } catch (e) {
                log.warn(`[phim] refetch detail fail: ${e.message}`);
            }
        }

        const candidateM3u8s = [
            ...freshM3u8s,
            ep.link_m3u8,
            ...(ep._fallbackM3u8 || [])
        ].filter(Boolean);
        // Loại trùng
        const seenU = new Set();
        const dedup = candidateM3u8s.filter(u => (seenU.has(u) ? false : (seenU.add(u), true)));

        // Probe và thử các CDN thay thế (s/v subdomains, kkphimplayer6/7/8)
        let m3u8s = await resolveLiveM3u8(dedup);
        if (!m3u8s.length) m3u8s = dedup; // không probe được thì cứ thử

        if (!m3u8s.length) {
            await api.sendMessage({
                msg: `⚠️ Tập "${epName}" không có m3u8 từ nguồn.\n${ep.link_embed ? `🔗 Xem online: ${ep.link_embed}` : ""}`
            }, threadId, threadType);
            return true;
        }

        try {
            const probe = await probeM3u8(m3u8s[0]);
            const estBytes = probe.bandwidth ? Math.floor(probe.bandwidth / 8 * probe.duration) : 0;
            const minutes = Math.round(probe.duration / 60);
            const estMb = estBytes ? (estBytes / 1024 / 1024).toFixed(0) : "?";
            await api.sendMessage({
                msg: `⏱ ${minutes} phút | 📦 ~${estMb} MB — bắt đầu tải...`
            }, threadId, threadType);
        } catch (e) {
            log.warn(`[phim] probe fail (${e.message}), vẫn thử tải:`);
        }

        ensureCacheDir();
        const baseName = `phim_${Date.now()}`;
        const rawPath = path.join(CACHE_DIR, `${baseName}.mp4`);
        const compPath = path.join(CACHE_DIR, `${baseName}_c.mp4`);

        try {
            await downloadEpisode(m3u8s, rawPath);
            const maxSize = getZaloMaxSendSize(api);
            let sendPath = rawPath;
            let stat = fs.statSync(sendPath);

            if (stat.size > maxSize) {
                await api.sendMessage({ msg: `📦 Video gốc ${(stat.size / 1024 / 1024).toFixed(1)}MB, đang nén...` }, threadId, threadType);
                try {
                    safeUnlink(compPath);
                    await compressVideo(rawPath, compPath, maxSize);
                    const cs = fs.statSync(compPath);
                    if (cs.size < stat.size) { sendPath = compPath; stat = cs; }
                } catch (e) {
                    log.warn("[phim] compress fail:", e.message);
                }
            }

            if (stat.size > maxSize) {
                await api.sendMessage({
                    msg: `❌ ${data.movieName} - ${epName}\nFile vẫn quá lớn (${(stat.size / 1024 / 1024).toFixed(1)}MB) sau khi nén.\n${ep.link_embed ? `\n🔗 Xem online: ${ep.link_embed}` : ""}`
                }, threadId, threadType);
            } else if (api.sendVideoUnified) {
                await api.sendVideoUnified({
                    videoPath: sendPath,
                    thumbnailUrl: data.poster,
                    msg: `${data.movieName} - ${epName}`,
                    threadId, threadType
                });
                await api.sendMessage({
                    msg: `✅ Tập ${num}/${episodes.length} | Reply số khác (1-${episodes.length}) để đổi tập.`
                }, threadId, threadType);
            } else {
                await api.sendMessage({ msg: `${data.movieName} - ${epName}`, attachments: [sendPath] }, threadId, threadType);
            }
        } catch (e) {
            log.error("[phim] Download error:", e.message);
            await api.sendMessage({
                msg: `❌ Tải thất bại: ${e.message}${ep.link_embed ? `\n🔗 Xem online: ${ep.link_embed}` : ""}`
            }, threadId, threadType);
        } finally {
            safeUnlink(rawPath, 4000);
            safeUnlink(compPath, 4000);
        }
        return true;
    }

    // ── Chọn phim từ kết quả tìm kiếm ────────────────────────────────────
    if (!searchSessions.has(searchKey)) return false;
    const session = searchSessions.get(searchKey);
    const movie = session.results?.[num - 1];
    if (!movie) return false;

    if (session.undoData?.msgId) {
        api.undo(session.undoData, threadId, threadType).catch(() => {});
    }
    searchSessions.delete(searchKey);

    await api.sendMessage({ msg: `📥 Đang lấy chi tiết "${movie.name}"...` }, threadId, threadType);

    try {
        const { info, episodes } = await getMovieDetail(movie.slug);

        if (!episodes.length) {
            await api.sendMessage({
                msg: [
                    `🎬 ${info.name}${info.origin_name ? ` (${info.origin_name})` : ""}`,
                    info.year ? `📅 Năm: ${info.year}` : "",
                    info.category.length ? `🎭 Thể loại: ${info.category.join(", ")}` : "",
                    info.country.length ? `🌍 Quốc gia: ${info.country.join(", ")}` : "",
                    info.time ? `⏱ Thời lượng: ${info.time}` : "",
                    "",
                    "⚠️ Phim chưa có tập hoặc đang cập nhật."
                ].filter(Boolean).join("\n")
            }, threadId, threadType);
            return true;
        }

        const epNames = episodes.slice(0, 30)
            .map((ep, i) => `${i + 1}.${ep.name}`)
            .join("  ");

        const msgText = [
            `🎬 ${info.name}${info.origin_name ? `\n   (${info.origin_name})` : ""}`,
            info.year ? `📅 ${info.year}` : "",
            info.category.length ? `🎭 ${info.category.join(", ")}` : "",
            info.country.length ? `🌍 ${info.country.join(", ")}` : "",
            info.time ? `⏱ ${info.time}` : "",
            info.quality || info.lang ? `📺 ${[info.quality, info.lang].filter(Boolean).join(" · ")}` : "",
            info.episode_current ? `📊 ${info.episode_current}` : "",
            "─────────────────",
            `${episodes.length} tập:`,
            epNames + (episodes.length > 30 ? `\n...và ${episodes.length - 30} tập nữa` : ""),
            "─────────────────",
            "💡 Reply số tập để tải video (VD: 1, 2, 3...)"
        ].filter(Boolean).join("\n");

        // Vẽ canvas chi tiết phim (poster + danh sách tập)
        let detailBuf = null;
        try {
            detailBuf = await drawMovieDetail({
                name: info.name,
                origin_name: info.origin_name,
                year: info.year,
                quality: info.quality,
                lang: info.lang,
                content: info.content,
                poster_url: info.poster_url,
                thumb_url: info.thumb_url
            }, episodes);
        } catch (e) {
            log.warn("[phim] draw detail fail:", e.message);
        }

        let sent = await sendCanvasOrText(api, threadId, threadType, detailBuf, msgText);
        if (!sent) sent = { data: {} };

        const undoData = sent?.data ? {
            msgId: String(sent.data.msgId || ""),
            cliMsgId: String(sent.data.cliMsgId || "")
        } : null;

        const epEntry = {
            episodes,
            movieName: info.name,
            poster: info.poster_url || info.thumb_url || "",
            slug: movie.slug,
            undoData,
            _timeout: null
        };
        epEntry._timeout = setTimeout(() => episodeSessions.delete(episodeKey), 20 * 60 * 1000);
        episodeSessions.set(episodeKey, epEntry);
    } catch (e) {
        log.error("[phim] Detail error:", e.message);
        await api.sendMessage({ msg: `❌ Lỗi lấy chi tiết: ${e.message}` }, threadId, threadType);
    }

    return true;
}
