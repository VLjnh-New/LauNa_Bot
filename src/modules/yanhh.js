import { fs, path, axios, log, uploadToTmpFiles } from "../globals.js";
import { getDesktopUA } from "../utils/core/userAgents.js";
import { load } from "cheerio";
import { execSync } from "node:child_process";
import { ffprobeAsync, ffmpegRun } from "../utils/core/ffmpegHelper.js";
import { drawMovieSearch, drawMovieDetail } from "../utils/canvas/canvasHelper.js";

function _resolvebin(name) {
    try {
        const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
        return execSync(cmd, { encoding: "utf8" }).trim().split(/\r?\n/)[0].trim() || name;
    } catch { return name; }
}

export const name = "yanhh";
export const description = "Search và tải phim từ yanhh3d";

const BASE_URL = "https://yanhh3d.net";
const CACHE_DIR = path.join(process.cwd(), "src/modules/cache");
const DEFAULT_MAX_SEND_SIZE = 100 * 1024 * 1024;
const searchSessions = new Map();
const episodeSessions = new Map();

const DEFAULT_HEADERS = {
    "User-Agent": getDesktopUA(),
    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
};

let cachedCookie = "";
let cachedCsrf = "";

function getZaloMaxSendSize(api) {
    const appCtx = api?.getContext?.() || api?.context || api?.ctx || {};
    const sharefile = appCtx?.settings?.features?.sharefile || {};
    const maxSizeMb = Number(sharefile.max_size_share_file_v3 || sharefile.max_size_share_file || 0);
    if (!Number.isFinite(maxSizeMb) || maxSizeMb <= 0) return DEFAULT_MAX_SEND_SIZE;
    const safeMb = Math.max(32, maxSizeMb - 5);
    return safeMb * 1024 * 1024;
}

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function safeUnlink(filePath, delay = 0) {
    const remove = () => {
        try {
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch {}
    };
    if (delay > 0) setTimeout(remove, delay);
    else remove();
}

function absoluteUrl(url) {
    try {
        return new URL(url, BASE_URL).toString();
    } catch {
        return url;
    }
}

function normalizeCookies(setCookie = []) {
    return setCookie.map((item) => item.split(";")[0]).join("; ");
}

async function bootstrapSession(keyword = "test") {
    const res = await axios.get(`${BASE_URL}/search?keysearch=${encodeURIComponent(keyword)}`, {
        headers: DEFAULT_HEADERS,
        timeout: 15000
    });
    cachedCookie = normalizeCookies(res.headers["set-cookie"] || []);
    const html = typeof res.data === "string" ? res.data : "";
    cachedCsrf = html.match(/meta name="csrf-token" content="([^"]+)"/i)?.[1] || "";
}

async function searchYanhh3d(keyword) {
    if (!cachedCookie || !cachedCsrf) await bootstrapSession(keyword);

    const res = await axios.get(`${BASE_URL}/ajax/search/suggest`, {
        params: { keyword },
        headers: {
            ...DEFAULT_HEADERS,
            "Accept": "*/*",
            "Referer": `${BASE_URL}/search?keysearch=${encodeURIComponent(keyword)}`,
            "X-Requested-With": "XMLHttpRequest",
            "X-CSRF-TOKEN": cachedCsrf,
            "Cookie": cachedCookie
        },
        timeout: 15000
    });

    const html = res.data?.data || "";
    const $ = load(html);
    return $("ul.limit-search li a").map((_, el) => ({
        title: $(el).attr("title")?.trim() || $(el).find(".title-search").text().trim(),
        url: absoluteUrl($(el).attr("href") || ""),
        thumb: absoluteUrl($(el).find("img").attr("src") || ""),
        meta: $(el).find(".ep-search").text().trim()
    })).get().filter((item) => item.title && item.url);
}

async function fetchHtml(url, referer = BASE_URL) {
    const res = await axios.get(absoluteUrl(url), {
        headers: {
            ...DEFAULT_HEADERS,
            "Referer": referer,
            ...(cachedCookie ? { "Cookie": cachedCookie } : {})
        },
        timeout: 20000,
        maxRedirects: 5
    });
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
}

function parseMoviePage(html, pageUrl) {
    const $ = load(html);
    const title = $(".film-name").first().text().trim()
        || $(".film-name a").first().text().trim()
        || $("title").text().trim()
        || "Movie";
    const poster = absoluteUrl(
        $(".film-poster img").first().attr("src")
        || $(".anis-cover").attr("style")?.match(/url\((.*?)\)/)?.[1]
        || $("meta[property='og:image']").attr("content")
        || ""
    );

    const episodeNodes = $("#top-comment .ssl-item.ep-item").length
        ? $("#top-comment .ssl-item.ep-item")
        : $("#episodes-content .ssl-item.ep-item");

    const episodes = episodeNodes.map((_, el) => {
        const href = absoluteUrl($(el).attr("href") || "");
        const name = $(el).find(".ep-name").text().trim()
            || $(el).attr("title")?.trim()
            || $(el).text().replace(/\s+/g, " ").trim();
        return { name, url: href };
    }).get().filter((item) => item.url);

    const seen = new Set();
    const uniqueEpisodes = episodes.filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url);
        return true;
    });

    uniqueEpisodes.sort((a, b) => {
        const an = parseFloat((a.name || "").replace(/[^\d.]/g, "")) || 0;
        const bn = parseFloat((b.name || "").replace(/[^\d.]/g, "")) || 0;
        return an - bn;
    });

    return { title, poster, pageUrl, episodes: uniqueEpisodes };
}

function getWatchUrlFromMoviePage(html) {
    const $ = load(html);
    const links = $(".film-buttons a[href], a.btn-play[href], a[href*='/tap-']").map((_, el) => {
        return absoluteUrl($(el).attr("href") || "");
    }).get().filter(Boolean);

    const preferred = links.find((href) => /\/tap-\d+(\?|$)/i.test(href) && !/\/sever\d+\//i.test(href));
    if (preferred) return preferred;
    return links.find((href) => /\/tap-\d+(\?|$)/i.test(href)) || "";
}

function parseWatchSources(html) {
    const $ = load(html);
    const sources = $("#list_sv a[data-src]").map((_, el) => ({
        label: $(el).text().trim() || $(el).attr("name") || "server",
        url: absoluteUrl($(el).attr("data-src") || "")
    })).get().filter((item) => item.url);

    const unique = [];
    const seen = new Set();
    for (const item of sources) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        unique.push(item);
    }
    return unique;
}

const STREAM_REGEXES = [
    /["'](https?:\/\/[^"' ]+\.(?:m3u8|mp4)(?:[/?][^"' ]*)?)["']/gi,
    /file\s*:\s*["']([^"']+)["']/gi,
    /source\s*:\s*["']([^"']+)["']/gi,
    /hlsUrl\s*[:=]\s*["']([^"']+)["']/gi,
    /url\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/gi
];

const STREAM_URL_RE = /\.(m3u8|mp4)(?:$|[/?#])/i;

// Player page yanhh3d/fbcdn nhúng JSON base64 trong <div id="player" data-obf="...">
// Decode để lấy pU (plain m3u8). sU bị mã hoá AES-GCM nên không dùng.
function extractObfStream(html) {
    const m = html.match(/data-obf=["']([A-Za-z0-9+/=]+)["']/);
    if (!m) return null;
    try {
        const json = JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
        return json.pU || json.sU || null;
    } catch { return null; }
}

async function fetchUrlSmart(url, referer) {
    const res = await axios.get(url, {
        headers: {
            ...DEFAULT_HEADERS,
            "Accept": "*/*",
            "Referer": referer || BASE_URL,
            ...(cachedCookie ? { "Cookie": cachedCookie } : {})
        },
        timeout: 20000,
        responseType: "text",
        maxRedirects: 5,
        validateStatus: () => true
    });
    return { status: res.status, body: typeof res.data === "string" ? res.data : JSON.stringify(res.data), contentType: res.headers?.["content-type"] || "" };
}

async function resolvePlayableUrls(url, referer = BASE_URL, depth = 0) {
    if (!url || depth > 3) return [];
    const abs = absoluteUrl(url);

    let body = "", contentType = "";
    try {
        const r = await fetchUrlSmart(abs, referer);
        body = r.body; contentType = r.contentType;
    } catch { return []; }

    // Nếu chính URL trả về m3u8/mp4 thực sự → dùng luôn
    if (/mpegurl|application\/vnd\.apple|video\/mp4/i.test(contentType) || /^#EXTM3U/m.test(body)) {
        return [abs];
    }

    const found = new Set();

    // 1) Player obfuscated (yanhh3d / fbcdn.cloud)
    const obfUrl = extractObfStream(body);
    if (obfUrl) {
        const clean = absoluteUrl(obfUrl.replace(/\\\//g, "/"));
        if (STREAM_URL_RE.test(clean)) found.add(clean);
    }

    // 2) Regex chung: m3u8/mp4 inline trong HTML/JS
    for (const regex of STREAM_REGEXES) {
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(body)) !== null) {
            const next = absoluteUrl(match[1].replace(/\\\//g, "/"));
            if (STREAM_URL_RE.test(next)) found.add(next);
        }
    }

    if (found.size > 0) return [...found];

    // 3) Đệ quy qua các iframe / data-src lồng nhau
    const nested = [...new Set([
        ...[...body.matchAll(/data-src=["']([^"']+)["']/gi)].map(m => m[1]),
        ...[...body.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)].map(m => m[1])
    ].map(u => absoluteUrl(u.replace(/\\\//g, "/")))
     .filter(u => /^https?:/i.test(u) && u !== abs))];

    for (const nestedUrl of nested) {
        const resolved = await resolvePlayableUrls(nestedUrl, abs, depth + 1);
        if (resolved.length) return resolved;
    }

    return [];
}

function sourcePriority(label) {
    const text = (label || "").toUpperCase();
    if (text.includes("HD")) return 100;
    if (text.includes("1080")) return 90;
    if (text.includes("LINK")) return 80;
    if (text.includes("4K")) return 70;
    return 50;
}

async function getVideoDuration(inputPath) {
    const metadata = await ffprobeAsync(inputPath);
    const duration = Number(metadata?.format?.duration || 0);
    if (!duration || !Number.isFinite(duration)) throw new Error("Không lấy được thời lượng video");
    return duration;
}

async function compressVideo(inputPath, outputPath, targetSize = DEFAULT_MAX_SEND_SIZE) {
    const duration = await getVideoDuration(inputPath);
    const audioBitrateK = 48;
    const targetTotalBitrate = Math.floor((targetSize * 8) / duration / 1000);
    const videoBitrateK = Math.max(220, targetTotalBitrate - audioBitrateK - 16);
    await ffmpegRun([
        "-y", "-i", inputPath,
        "-c:v", "libx264", "-c:a", "aac",
        "-b:a", `${audioBitrateK}k`, "-b:v", `${videoBitrateK}k`,
        "-vf", "scale=640:-2",
        "-preset", "veryfast", "-crf", "31", "-maxrate", "900k", "-bufsize", "1800k", "-movflags", "+faststart",
        outputPath
    ]);
}

async function downloadMp4(url, outputPath, referer = BASE_URL) {
    const writer = fs.createWriteStream(outputPath);
    const response = await axios.get(url, {
        responseType: "stream",
        timeout: 30000,
        headers: {
            ...DEFAULT_HEADERS,
            "Referer": referer
        }
    });

    await new Promise((resolve, reject) => {
        response.data.pipe(writer);
        writer.on("finish", resolve);
        writer.on("error", reject);
    });
}

async function downloadHlsFFmpeg(url, outputPath, referer) {
    let origin = BASE_URL;
    try { origin = new URL(referer || BASE_URL).origin; } catch {}
    await ffmpegRun([
        "-y",
        "-protocol_whitelist", "file,http,https,tcp,tls,crypto",
        "-allowed_extensions", "ALL",
        "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
        "-user_agent", DEFAULT_HEADERS["User-Agent"],
        "-headers", `Referer: ${referer || ""}\r\nOrigin: ${origin}\r\nAccept: */*\r\nAccept-Language: vi-VN,vi;q=0.9\r\n`,
        "-i", url,
        "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart",
        outputPath
    ]);
}

// Tải HLS thủ công qua axios: fetch m3u8 → parse segments → tải song song → concat → mux MP4.
async function fetchM3u8Smart(m3u8Url, referer) {
    const refOrigin = (() => { try { return new URL(referer).origin; } catch { return ""; } })();
    const urlOrigin = (() => { try { return new URL(m3u8Url).origin; } catch { return ""; } })();

    const headerStrategies = [
        { Referer: referer || BASE_URL, Origin: refOrigin || BASE_URL },
        { Referer: BASE_URL, Origin: BASE_URL },
        { Referer: urlOrigin, Origin: urlOrigin },
        {},
        { Referer: "https://www.google.com/", Origin: "https://www.google.com" },
    ];

    let lastBody = "", lastStatus = 0, lastErr = null;
    for (const extra of headerStrategies) {
        try {
            const res = await axios.get(m3u8Url, {
                headers: { ...DEFAULT_HEADERS, "Accept": "*/*", ...extra },
                timeout: 20000, responseType: "text",
                validateStatus: () => true,
                maxRedirects: 5,
            });
            lastStatus = res.status;
            lastBody = String(res.data || "");
            if (lastStatus >= 200 && lastStatus < 300 && /#EXTM3U/i.test(lastBody)) {
                return { body: lastBody, headers: { ...DEFAULT_HEADERS, "Accept": "*/*", ...extra } };
            }
        } catch (e) { lastErr = e; }
    }
    const preview = lastBody.slice(0, 120).replace(/\s+/g, " ");
    throw new Error(`m3u8 không hợp lệ (status=${lastStatus}, body="${preview}") ${lastErr ? "| " + lastErr.message : ""}`);
}

async function downloadHlsManual(m3u8Url, outputPath, referer) {
    const { body: playlist, headers } = await fetchM3u8Smart(m3u8Url, referer);

    // Nếu là master playlist, chọn variant cao nhất
    if (/#EXT-X-STREAM-INF/i.test(playlist)) {
        const variantLines = playlist.split(/\r?\n/);
        let best = null;
        for (let i = 0; i < variantLines.length; i++) {
            if (/#EXT-X-STREAM-INF/i.test(variantLines[i])) {
                const bw = Number((variantLines[i].match(/BANDWIDTH=(\d+)/i) || [])[1] || 0);
                const next = (variantLines[i + 1] || "").trim();
                if (next && (!best || bw > best.bw)) best = { bw, url: next };
            }
        }
        if (!best) throw new Error("Master m3u8 không có variant");
        const variantUrl = new URL(best.url, m3u8Url).toString();
        return downloadHlsManual(variantUrl, outputPath, referer);
    }

    const baseUrl = m3u8Url.replace(/\/[^/]*(\?.*)?$/, "/");
    const segments = playlist.split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"))
        .map(l => new URL(l, baseUrl).toString());

    if (!segments.length) throw new Error("Không tìm thấy segment trong m3u8");
    if (/#EXT-X-KEY:METHOD=(?!NONE)/i.test(playlist)) throw new Error("HLS có mã hoá, dùng ffmpeg");

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
                        const r = await axios.get(segUrl, { headers, timeout: 30000, responseType: "arraybuffer" });
                        fs.writeFileSync(segPath, Buffer.from(r.data));
                        segPaths[i] = segPath;
                        lastErr = null;
                        break;
                    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 500 * (attempt + 1))); }
                }
                if (lastErr) throw new Error(`segment ${i} fail: ${lastErr.message}`);
            }
        }

        await Promise.all(Array.from({ length: concurrency }, () => worker()));

        // Ghép các .ts → MP4 qua ffmpeg concat protocol
        const concatList = segPaths.map(p => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
        const listPath = path.join(tmpDir, "list.txt");
        fs.writeFileSync(listPath, concatList);
        await ffmpegRun([
            "-y", "-f", "concat", "-safe", "0", "-i", listPath,
            "-c", "copy", "-bsf:a", "aac_adtstoasc", "-movflags", "+faststart",
            outputPath
        ]);
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
}

async function downloadHls(url, outputPath, referer = BASE_URL) {
    let origin = "";
    try { origin = new URL(url).origin; } catch {}
    const refCandidates = [...new Set([referer, BASE_URL, origin, ""].filter(Boolean).concat([""]))];

    let lastErr = null;
    for (const ref of refCandidates) {
        try {
            await downloadHlsFFmpeg(url, outputPath, ref);
            return;
        } catch (e) {
            lastErr = e;
            log.warn(`[yanhh] ffmpeg HLS fail (referer="${ref || "(none)"}"):`, e.message);
        }
    }

    // Fallback cuối: tải thủ công từng segment qua axios
    try {
        log.warn("[yanhh] Thử fallback: tải HLS thủ công qua axios");
        await downloadHlsManual(url, outputPath, referer);
        return;
    } catch (e) {
        log.warn("[yanhh] manual HLS fail:", e.message);
        throw lastErr || e;
    }
}

async function downloadPlayableUrl(url, outputPath, referer = BASE_URL) {
    if (/\.mp4(\?|$)/i.test(url)) {
        try { await downloadMp4(url, outputPath, referer); return; }
        catch (e) {
            log.warn("[yanhh] mp4 direct fail, thử mp4 không referer:", e.message);
            try { await downloadMp4(url, outputPath, ""); return; } catch {}
            // Có URL mp4 nhưng tải fail — coi như HLS-style fallback không áp dụng
            throw e;
        }
    }
    await downloadHls(url, outputPath, referer);
}

async function pickPlayableSource(sources, referer) {
    const sorted = [...sources].sort((a, b) => sourcePriority(b.label) - sourcePriority(a.label));
    for (const source of sorted) {
        const resolved = await resolvePlayableUrls(source.url, referer);
        if (resolved.length) {
            return {
                label: source.label,
                pageUrl: source.url,
                playableUrls: resolved
            };
        }
    }
    return null;
}

function formatEpisodeList(episodes) {
    return episodes.slice(0, 30).map((ep, index) =>
        `${index + 1}. ${ep.name || `Tập ${index + 1}`}`
    ).join("\n");
}

async function sendCanvasCard(api, threadId, threadType, buf, width, height, caption) {
    if (!buf) return false;
    const tmpImg = path.join(CACHE_DIR, `yanhh_card_${Date.now()}.png`);
    try {
        ensureCacheDir();
        fs.writeFileSync(tmpImg, buf);
        const remoteUrl = await uploadToTmpFiles(tmpImg, api, threadId, threadType);
        if (remoteUrl) {
            await api.sendImageEnhanced({ imageUrl: remoteUrl, threadId, threadType, width, height, msg: caption });
            safeUnlink(tmpImg, 3000);
        } else {
            await api.sendMessage({ msg: caption, attachments: [tmpImg] }, threadId, threadType);
            safeUnlink(tmpImg, 8000);
        }
        return true;
    } catch (e) {
        log.warn("[yanhh] canvas send fail:", e.message);
        safeUnlink(tmpImg, 1000);
        return false;
    }
}

export const commands = {
    yanhh: async (ctx) => {
        const { api, args, threadId, threadType, senderId, prefix } = ctx;
        const query = args.join(" ").trim();

        if (!query) {
            return api.sendMessage({
                msg: `Dùng: ${prefix}yanhh <từ khóa>\nVí dụ: ${prefix}yanhh tu la vo than`
            }, threadId, threadType);
        }

        try {
            await api.sendMessage({ msg: `🔍 Đang tìm trên yanhh3d: "${query}"...` }, threadId, threadType);
            const items = await searchYanhh3d(query);

            if (!items.length) {
                return api.sendMessage({ msg: `❌ Không tìm thấy kết quả cho "${query}".` }, threadId, threadType);
            }

            const results = items.slice(0, 5);
            searchSessions.set(`${threadId}-${senderId}`, results);
            setTimeout(() => searchSessions.delete(`${threadId}-${senderId}`), 120000);

            const textList = results.map((item, index) =>
                `${index + 1}. ${item.title}${item.meta ? ` — ${item.meta}` : ""}`
            ).join("\n");
            const caption = `🎌 [YANHH3D TÌM KIẾM]\n─────────────────\n${textList}\n─────────────────\n💡 Reply số (1-${results.length}) để xem danh sách tập.`;

            const canvasMovies = results.map(item => ({
                name: item.title,
                origin_name: "",
                thumb_url: item.thumb,
                episode_current: item.meta || ""
            }));

            try {
                const buf = await drawMovieSearch(canvasMovies, query);
                const sent = await sendCanvasCard(api, threadId, threadType, buf, 1280, 720, caption);
                if (!sent) throw new Error("canvas failed");
            } catch {
                await api.sendMessage({ msg: caption }, threadId, threadType);
            }
        } catch (error) {
            log.error("[yanhh] Search error:", error.message);
            await api.sendMessage({ msg: `❌ Lỗi tìm kiếm: ${error.message}` }, threadId, threadType);
        }
    }
};

export async function handle(ctx) {
    const { content, senderId, threadId, api, threadType } = ctx;
    const num = parseInt(content?.trim(), 10);
    if (Number.isNaN(num) || num < 1) return false;

    const searchKey = `${threadId}-${senderId}`;
    const episodeKey = `${threadId}-${senderId}-yanhh-ep`;

    if (episodeSessions.has(episodeKey)) {
        const data = episodeSessions.get(episodeKey);
        const episode = data.episodes[num - 1];
        const maxSendSize = getZaloMaxSendSize(api);

        if (!episode) {
            await api.sendMessage({ msg: `❌ Không có tập ${num}. Chọn 1-${data.episodes.length}.` }, threadId, threadType);
            return true;
        }

        ensureCacheDir();
        const baseName = `yanhh_${Date.now()}`;
        const rawPath = path.join(CACHE_DIR, `${baseName}.mp4`);
        const compressedPath = path.join(CACHE_DIR, `${baseName}_compressed.mp4`);

        try {
            await api.sendMessage({ msg: `⏳ Đang lấy source cho ${data.title} - ${episode.name}...` }, threadId, threadType);

            const watchHtml = await fetchHtml(episode.url, data.pageUrl);
            const sources = parseWatchSources(watchHtml);
            if (!sources.length) {
                return api.sendMessage({ msg: "❌ Không tìm thấy nguồn phát trên trang tập này." }, threadId, threadType);
            }

            const picked = await pickPlayableSource(sources, episode.url);
            if (!picked) {
                return api.sendMessage({ msg: "❌ Không resolve được link m3u8/mp4." }, threadId, threadType);
            }

            await api.sendMessage({ msg: `⬇️ Đang tải video từ server ${picked.label}...` }, threadId, threadType);

            let downloaded = false;
            for (const playableUrl of picked.playableUrls) {
                try {
                    safeUnlink(rawPath);
                    await downloadPlayableUrl(playableUrl, rawPath, picked.pageUrl || episode.url);
                    if (fs.existsSync(rawPath) && fs.statSync(rawPath).size > 10240) {
                        downloaded = true;
                        break;
                    }
                } catch (error) {
                    log.warn(`[yanhh] download fail ${playableUrl}: ${error.message}`);
                }
            }

            if (!downloaded) {
                return api.sendMessage({
                    msg: `❌ Tải video thất bại.\n🔗 Trang tập: ${episode.url}\n📡 Nguồn: ${picked.pageUrl || "N/A"}`
                }, threadId, threadType);
            }

            let sendPath = rawPath;
            let stat = fs.statSync(sendPath);

            if (stat.size > maxSendSize) {
                await api.sendMessage({
                    msg: `📦 Video gốc ${(stat.size / 1024 / 1024).toFixed(1)} MB, đang nén lại...`
                }, threadId, threadType);
                try {
                    safeUnlink(compressedPath);
                    await compressVideo(rawPath, compressedPath, maxSendSize);
                    const compressedStat = fs.statSync(compressedPath);
                    if (compressedStat.size < stat.size) {
                        sendPath = compressedPath;
                        stat = compressedStat;
                    }
                } catch (error) {
                    log.warn(`[yanhh] compress fail: ${error.message}`);
                }
            }

            if (stat.size > maxSendSize) {
                await api.sendMessage({
                    msg: `[ 🎌 ${data.title} ]\n📺 ${episode.name} — File vẫn quá lớn (${(stat.size / 1024 / 1024).toFixed(1)} MB).\n⚠️ Giới hạn: ${(maxSendSize / 1024 / 1024).toFixed(1)} MB.\n🔗 Xem online: ${episode.url}`
                }, threadId, threadType);
                return true;
            }

            await api.sendVideoUnified({
                videoPath: sendPath,
                msg: `🎌 ${data.title} - ${episode.name}`,
                threadId,
                threadType
            });

            await api.sendMessage({
                msg: `✅ Đã gửi tập ${num}/${data.episodes.length}. Gõ số tập khác để tải tiếp!`
            }, threadId, threadType);
            return true;
        } catch (error) {
            log.error("[yanhh] Episode error:", error.message);
            await api.sendMessage({ msg: `❌ Lỗi tải tập: ${error.message}` }, threadId, threadType);
            return true;
        } finally {
            safeUnlink(rawPath, 3000);
            safeUnlink(compressedPath, 3000);
        }
    }

    if (!searchSessions.has(searchKey)) return false;

    const movie = searchSessions.get(searchKey)[num - 1];
    if (!movie) return false;
    searchSessions.delete(searchKey);

    try {
        await api.sendMessage({ msg: `📡 Đang lấy danh sách tập cho "${movie.title}"...` }, threadId, threadType);
        const html = await fetchHtml(movie.url);
        let info = parseMoviePage(html, movie.url);

        if (!info.episodes.length) {
            const watchUrl = getWatchUrlFromMoviePage(html);
            if (watchUrl) {
                const watchHtml = await fetchHtml(watchUrl, movie.url);
                const watchInfo = parseMoviePage(watchHtml, watchUrl);
                info = {
                    ...info,
                    title: watchInfo.title || info.title,
                    poster: watchInfo.poster || info.poster,
                    pageUrl: watchInfo.pageUrl || info.pageUrl,
                    episodes: watchInfo.episodes
                };
            }
        }

        if (!info.episodes.length) {
            return api.sendMessage({ msg: "❌ Phim này không có danh sách tập." }, threadId, threadType);
        }

        episodeSessions.set(episodeKey, info);
        setTimeout(() => episodeSessions.delete(episodeKey), 15 * 60 * 1000);

        const epCaption = `🎌 [YANHH3D]\n${info.title}\n📺 Tổng số tập: ${info.episodes.length}\n─────────────────\n${formatEpisodeList(info.episodes)}${info.episodes.length > 30 ? `\n...và ${info.episodes.length - 30} tập nữa` : ""}\n─────────────────\n💡 Reply số tập để bot tải MP4!`;

        const canvasMovie = {
            name: info.title,
            origin_name: "",
            poster_url: info.poster,
            thumb_url: info.poster,
            year: "", quality: "", lang: "", content: ""
        };

        try {
            const buf = await drawMovieDetail(canvasMovie, info.episodes);
            const sent = await sendCanvasCard(api, threadId, threadType, buf, 1100, 600, epCaption);
            if (!sent) throw new Error("canvas failed");
        } catch {
            await api.sendMessage({ msg: epCaption }, threadId, threadType);
        }
        return true;
    } catch (error) {
        log.error("[yanhh] Detail error:", error.message);
        await api.sendMessage({ msg: `❌ Lỗi lấy danh sách tập: ${error.message}` }, threadId, threadType);
        return true;
    }
}
