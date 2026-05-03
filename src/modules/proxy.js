import axios from "axios";
import * as cheerio from "cheerio";
import { proxyPool } from "../utils/managers/proxyPool.js";
import { getDesktopUA } from "../utils/core/userAgents.js";

export const name = "proxy";
export const description = "Lấy & kiểm tra proxy live/die, xuất link Note. 62+ nguồn tổng hợp. Sub: [số] [https|http] [vn|sg|...] | check <ip:port> | get <số>";

const UA = getDesktopUA();

// ── Helper: parse raw text "ip:port" per line ────────────────────────────────
function parseRawText(text, https = false, src = "unknown") {
    return text.split("\n")
        .map(l => l.trim())
        .filter(l => /^\d+\.\d+\.\d+\.\d+:\d+$/.test(l))
        .map(l => {
            const [ip, port] = l.split(":");
            return { ip, port, code: "??", country: "Unknown", anon: "unknown", https, source: src };
        });
}

// ── Helper: parse dạng "ip:port <bất kỳ>" (opsxcq...) ───────────────────────
function parseLooseText(text, https = false, src = "unknown") {
    const RE = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})/;
    return text.split("\n")
        .map(l => l.trim())
        .map(l => { const m = RE.exec(l); return m ? { ip: m[1], port: m[2], code: "??", country: "Unknown", anon: "unknown", https, source: src } : null; })
        .filter(Boolean);
}

// ── Parser riêng cho spys.me — "ip:port CC-ANONCODE [+/-]" ──────────────────
// ANONCODE: H/HS/HI/HK = elite | A/AS/AI/AK = anonymous | N/NS/NI = transparent
function parseSpysMe(text, src = "spys") {
    const RE = /^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\s+([A-Z]{2})-([A-Z]+)\s*([+\-])?/;
    const ANON_TIER = { H: "elite", A: "anonymous", N: "transparent" };
    return text.split("\n")
        .map(l => l.trim())
        .map(l => {
            const m = RE.exec(l);
            if (!m) return null;
            const [, ip, port, code, anonCode, ssl] = m;
            const tier = ANON_TIER[anonCode[0]] || "unknown"; // H→elite, A→anonymous, N→transparent
            const isHttps = ssl === "+" || anonCode.includes("S");
            return { ip, port, code, country: code, anon: tier, https: isHttps, source: src };
        })
        .filter(Boolean);
}


// ── Parser cho HTML table (free-proxy-list.net, sslproxies.org, ...) ─────────
// Cột: 0=IP, 1=Port, 2=Code, 3=Country, 4=Anonymity, 5=Google, 6=Https, 7=LastChecked
function parseHtmlTable($, https = false, src = "unknown") {
    const results = [];
    $("table tbody tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 2) return;
        const ip   = $(cells[0]).text().trim();
        const port = $(cells[1]).text().trim();
        if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip) || !/^\d+$/.test(port)) return;
        const code    = $(cells[2]).text().trim() || "??";
        const anonRaw = ($(cells[4]).text().trim()).toLowerCase();
        const anon    = anonRaw.includes("elite") ? "elite" : anonRaw.includes("anonymous") ? "anonymous" : "transparent";
        const isHttps = $(cells[6]).text().trim().toLowerCase() === "yes";
        results.push({ ip, port, code, country: code, anon, https: https || isHttps, source: src });
    });
    return results;
}

// ── Nguồn scrape proxy — top 50 theo số lượng, đã loại dead ─────────────────
const SOURCES = [
    // ── proxyscrape v2 (tất cả proxy, không lọc — nhiều nhất) ────────────────
    { name: "ps-v2-http",   url: "https://api.proxyscrape.com/v2/?request=getproxies&protocol=http",   parse: ($) => parseRawText($.root().text().trim(), false, "ps-v2-http")   },
    { name: "ps-v2-socks4", url: "https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks4", parse: ($) => parseRawText($.root().text().trim(), false, "ps-v2-socks4") },
    { name: "ps-v2-socks5", url: "https://api.proxyscrape.com/v2/?request=getproxies&protocol=socks5", parse: ($) => parseRawText($.root().text().trim(), false, "ps-v2-socks5") },

    // ── proxyscrape v3 (elite, timeout 3s lọc sẵn) ────────────────────────
    { name: "ps-elite-https-3s",  url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=https&timeout=3000&country=all&ssl=all&anonymity=elite&simplified=true",    parse: ($) => parseRawText($.root().text().trim(), true,  "ps-elite-https-3s")  },
    { name: "ps-elite-socks5-3s", url: "https://api.proxyscrape.com/v3/free-proxy-list/get?request=displayproxies&protocol=socks5&timeout=3000&country=all&ssl=all&anonymity=elite&simplified=true",   parse: ($) => parseRawText($.root().text().trim(), false, "ps-elite-socks5-3s") },

    // ── zevtyardt/proxy-list (lớn nhất, cập nhật liên tục) ───────────────────
    { name: "zevtyardt (all)",    url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/all.txt",    parse: ($) => parseRawText($.root().text().trim(), false, "zevtyardt-all")    },
    { name: "zevtyardt (http)",   url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "zevtyardt-http")   },
    { name: "zevtyardt (socks4)", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "zevtyardt-socks4") },
    { name: "zevtyardt (socks5)", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "zevtyardt-socks5") },

    // ── MuRongPIG/Proxy-Master (rất lớn) ─────────────────────────────────────
    { name: "MuRongPIG (http)",   url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "MuRongPIG-http")   },
    { name: "MuRongPIG (socks4)", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "MuRongPIG-socks4") },
    { name: "MuRongPIG (socks5)", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "MuRongPIG-socks5") },

    // ── ErcinDedeoglu/proxies ─────────────────────────────────────────────────
    { name: "ErcinDedeoglu (http)",   url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "ErcinDedeoglu-http")   },
    { name: "ErcinDedeoglu (https)",  url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/https.txt",  parse: ($) => parseRawText($.root().text().trim(), true,  "ErcinDedeoglu-https")  },
    { name: "ErcinDedeoglu (socks4)", url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "ErcinDedeoglu-socks4") },
    { name: "ErcinDedeoglu (socks5)", url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "ErcinDedeoglu-socks5") },

    // ── Anonym0usWork1221/Free-Proxies ────────────────────────────────────────
    { name: "Anonym0usWork1221 (http)",   url: "https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/http_proxies.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "Anonym-http")   },
    { name: "Anonym0usWork1221 (socks4)", url: "https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/socks4_proxies.txt", parse: ($) => parseRawText($.root().text().trim(), false, "Anonym-socks4") },
    { name: "Anonym0usWork1221 (socks5)", url: "https://raw.githubusercontent.com/Anonym0usWork1221/Free-Proxies/main/proxy_files/socks5_proxies.txt", parse: ($) => parseRawText($.root().text().trim(), false, "Anonym-socks5") },

    // ── api.openproxylist.xyz ─────────────────────────────────────────────────
    { name: "openproxylist-http",   url: "https://api.openproxylist.xyz/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "openproxy-http")   },
    { name: "openproxylist-socks4", url: "https://api.openproxylist.xyz/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "openproxy-socks4") },
    { name: "openproxylist-socks5", url: "https://api.openproxylist.xyz/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "openproxy-socks5") },

    // ── proxyspace.pro ────────────────────────────────────────────────────────
    { name: "proxyspace-http",   url: "https://proxyspace.pro/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "proxyspace-http")   },
    { name: "proxyspace-https",  url: "https://proxyspace.pro/https.txt",  parse: ($) => parseRawText($.root().text().trim(), true,  "proxyspace-https")  },
    { name: "proxyspace-socks4", url: "https://proxyspace.pro/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "proxyspace-socks4") },
    { name: "proxyspace-socks5", url: "https://proxyspace.pro/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "proxyspace-socks5") },

    // ── TheSpeedX ─────────────────────────────────────────────────────────────
    { name: "TheSpeedX (http)",   url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "TheSpeedX-http")  },
    { name: "TheSpeedX (socks4)", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "TheSpeedX-socks4") },
    { name: "TheSpeedX (socks5)", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "TheSpeedX-socks5") },
    { name: "TheSpeedX-s4",       url: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "TheSpeedX-s4")    },
    { name: "TheSpeedX-s5",       url: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "TheSpeedX-s5")    },

    // ── jetkai/proxy-list ─────────────────────────────────────────────────────
    { name: "jetkai-all",      url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies.txt",       parse: ($) => parseRawText($.root().text().trim(), false, "jetkai-all")    },
    { name: "jetkai (http)",   url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "jetkai-http")   },
    { name: "jetkai (https)",  url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt",  parse: ($) => parseRawText($.root().text().trim(), true,  "jetkai-https")  },
    { name: "jetkai (socks4)", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "jetkai-socks4") },

    // ── ALIILAPRO/Proxy ───────────────────────────────────────────────────────
    { name: "ALIILAPRO (http)",   url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "ALIILAPRO-http")   },
    { name: "ALIILAPRO (socks5)", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "ALIILAPRO-socks5") },

    // ── sunny9577/proxy-scraper ───────────────────────────────────────────────
    { name: "sunny9577",          url: "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt", parse: ($) => parseRawText($.root().text().trim(), false, "sunny9577")        },
    { name: "sunny9577-proxies",  url: "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/proxies.txt",               parse: ($) => parseRawText($.root().text().trim(), false, "sunny9577-proxies") },

    // ── Zaeem20/FREE_PROXIES_LIST ─────────────────────────────────────────────
    { name: "Zaeem20 (https)",  url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/https.txt",  parse: ($) => parseRawText($.root().text().trim(), true,  "Zaeem20-https")  },
    { name: "Zaeem20 (socks5)", url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "Zaeem20-socks5") },

    // ── monosans/proxy-list ───────────────────────────────────────────────────
    { name: "monosans (socks5)", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "monosans-socks5") },

    // ── B4RC0DE-TM/proxy-list ─────────────────────────────────────────────────
    { name: "B4RC0DE-TM (http)",   url: "https://raw.githubusercontent.com/B4RC0DE-TM/proxy-list/main/HTTP.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "B4RC0DE-http")   },
    { name: "B4RC0DE-TM (socks4)", url: "https://raw.githubusercontent.com/B4RC0DE-TM/proxy-list/main/SOCKS4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "B4RC0DE-socks4") },

    // ── ShiftyTR/Proxy-List ───────────────────────────────────────────────────
    { name: "ShiftyTR-mixed", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/proxy.txt",  parse: ($) => parseRawText($.root().text().trim(), false, "ShiftyTR-mixed") },
    { name: "ShiftyTR-s4",   url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "ShiftyTR-s4")   },

    // ── mmpx12/proxy-list ─────────────────────────────────────────────────────
    { name: "mmpx12 (http)",   url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "mmpx12-http")   },
    { name: "mmpx12 (socks4)", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "mmpx12-socks4") },

    // ── proxylist-to/proxy-list ───────────────────────────────────────────────
    { name: "proxylist-to (http)", url: "https://raw.githubusercontent.com/proxylist-to/proxy-list/main/http.txt", parse: ($) => parseRawText($.root().text().trim(), false, "proxylist-to-http") },

    // ── Các nguồn đơn lẻ còn live ────────────────────────────────────────────
    { name: "yuceltoluyag", url: "https://raw.githubusercontent.com/yuceltoluyag/GoodProxy/main/raw.txt",                parse: ($) => parseRawText($.root().text().trim(), false, "yuceltoluyag") },
    { name: "saisuiu",      url: "https://raw.githubusercontent.com/saisuiu/Lionkings-Http-Proxys-Proxies/main/free.txt", parse: ($) => parseRawText($.root().text().trim(), false, "saisuiu")      },
    { name: "rdavydov",     url: "https://raw.githubusercontent.com/rdavydov/proxy-list/main/proxies/http.txt",           parse: ($) => parseRawText($.root().text().trim(), false, "rdavydov")     },
    { name: "vakhov (http)",url: "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt",             parse: ($) => parseRawText($.root().text().trim(), false, "vakhov-http")  },

    // ── spys.me (400+ proxy, có thông tin anonymity H/A/N) ────────────────
    { name: "spys.me/proxy",  url: "https://spys.me/proxy.txt",  parse: ($) => parseSpysMe($.root().text().trim(), "spys-http")  },
    { name: "spys.me/socks",  url: "https://spys.me/socks.txt",  parse: ($) => parseSpysMe($.root().text().trim(), "spys-socks") },

    // ── ShiftyTR (thêm https + socks5) ────────────────────────────────────
    { name: "ShiftyTR (https)",  url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/https.txt",  parse: ($) => parseRawText($.root().text().trim(), true,  "ShiftyTR-https")  },
    { name: "ShiftyTR (socks5)", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "ShiftyTR-socks5") },

    // ── monosans (thêm http + socks4) ─────────────────────────────────────
    { name: "monosans (http)",   url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "monosans-http")  },
    { name: "monosans (socks4)", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "monosans-socks4") },

    // ── clarketm/proxy-list (400 proxy raw) ───────────────────────────────
    { name: "clarketm",          url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt", parse: ($) => parseLooseText($.root().text().trim(), false, "clarketm") },

    // ── hookzof/socks5_list ────────────────────────────────────────────────
    { name: "hookzof (socks5)",  url: "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt", parse: ($) => parseRawText($.root().text().trim(), false, "hookzof-socks5") },

    // ── roosterkid/openproxylist (HTTPS) ──────────────────────────────────
    { name: "roosterkid (https)", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt", parse: ($) => parseRawText($.root().text().trim(), true, "roosterkid-https") },

    // ── opsxcq/proxy-list (343 proxy, dạng "ip:port <country>") ──────────
    { name: "opsxcq",            url: "https://raw.githubusercontent.com/opsxcq/proxy-list/master/list.txt", parse: ($) => parseLooseText($.root().text().trim(), false, "opsxcq") },

    // ── proxyscrape v2 (https) ─────────────────────────────────────────────
    { name: "ps-v2-https", url: "https://api.proxyscrape.com/v2/?request=getproxies&protocol=https", parse: ($) => parseRawText($.root().text().trim(), true, "ps-v2-https") },

    // ── ShiftyTR (http) ────────────────────────────────────────────────────
    { name: "ShiftyTR (http)", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt", parse: ($) => parseRawText($.root().text().trim(), false, "ShiftyTR-http") },

    // ── jetkai (socks5) ────────────────────────────────────────────────────
    { name: "jetkai (socks5)", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-socks5.txt", parse: ($) => parseRawText($.root().text().trim(), false, "jetkai-socks5") },

    // ── almroot/proxylist ──────────────────────────────────────────────────
    { name: "almroot", url: "https://raw.githubusercontent.com/almroot/proxylist/master/list.txt", parse: ($) => parseRawText($.root().text().trim(), false, "almroot") },

    // ── proxy4parsing/proxy-list (http only — socks4/socks5 dead) ─────────
    { name: "proxy4parsing (http)", url: "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt", parse: ($) => parseRawText($.root().text().trim(), false, "proxy4parsing-http") },

    // ── ALIILAPRO (socks4) ─────────────────────────────────────────────────
    { name: "ALIILAPRO (socks4)", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "ALIILAPRO-socks4") },

    // ── Zaeem20 (http + socks4) ────────────────────────────────────────────
    { name: "Zaeem20 (http)",   url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt",   parse: ($) => parseRawText($.root().text().trim(), false, "Zaeem20-http")   },
    { name: "Zaeem20 (socks4)", url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/socks4.txt", parse: ($) => parseRawText($.root().text().trim(), false, "Zaeem20-socks4") },

    // ── free-proxy-list.net / sslproxies / us-proxy / socks-proxy (HTML table) ─
    { name: "free-proxy-list.net", url: "https://free-proxy-list.net/",  parse: ($) => parseHtmlTable($, false, "fpl-net")     },
    { name: "sslproxies.org",      url: "https://www.sslproxies.org/",   parse: ($) => parseHtmlTable($, true,  "sslproxies")  },
    { name: "us-proxy.org",        url: "https://www.us-proxy.org/",     parse: ($) => parseHtmlTable($, false, "us-proxy")    },
    { name: "socks-proxy.net",     url: "https://www.socks-proxy.net/",  parse: ($) => parseHtmlTable($, false, "socks-proxy") },
];


async function fetchFromSource(src) {
    try {
        const res = await axios.get(src.url, {
            headers: { "User-Agent": UA, "Accept": "text/html,text/plain,*/*", ...(src.headers || {}) },
            params: src.params || undefined,
            timeout: 12000
        });
        const $ = cheerio.load(res.data);
        return src.parse($);
    } catch { return []; }
}

// ── Hàm internal: fetch + dedup + filter tất cả nguồn ───────────────────────
async function fetchAllRaw(filterHttps = null, filterCode = null) {
    const results = await Promise.allSettled(SOURCES.map(fetchFromSource));
    let all = [];
    for (const r of results) {
        if (r.status === "fulfilled") all.push(...r.value);
    }
    const seen = new Set();
    all = all.filter(p => {
        const key = `${p.ip}:${p.port}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (filterHttps !== null) all = all.filter(p => p.https === filterHttps);
    if (filterCode)           all = all.filter(p => p.code?.toUpperCase() === filterCode);

    // Shuffle ngẫu nhiên trong từng tier, rồi ghép theo thứ tự ưu tiên:
    // elite (H) → anonymous (A) → unknown → transparent (N)
    const shuffle = arr => {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    };
    const tiers = { elite: [], anonymous: [], unknown: [], transparent: [] };
    for (const p of all) {
        (tiers[p.anon] ?? tiers.unknown).push(p);
    }
    return [
        ...shuffle(tiers.elite),
        ...shuffle(tiers.anonymous),
        ...shuffle(tiers.unknown),
        ...shuffle(tiers.transparent),
    ];
}

// ── Hàm public: lấy danh sách proxy thô (dùng bởi proxyPool) ────────────────
export async function getProxies(limit = 50, filterHttps = null, filterCode = null) {
    const all = await fetchAllRaw(filterHttps, filterCode);
    return all.slice(0, limit);
}

// ── Check URLs fallback (theo thứ tự ưu tiên) ────────────────────────────────
const CHECK_URLS = [
    "http://ip-api.com/json",
    "http://checkip.amazonaws.com",
    "http://httpbin.org/ip",
];

async function proxyAlive(ip, port, timeout = 6000) {
    const proxyConfig = { host: ip, port: parseInt(port) };
    for (const url of CHECK_URLS) {
        try {
            await axios.get(url, { proxy: proxyConfig, timeout });
            return true;
        } catch { }
    }
    return false;
}

// ── Hàm public: lấy đủ proxy LIVE theo số lượng yêu cầu ─────────────────────
// Lấy toàn bộ nguồn → check song song → trả đúng `wantLive` proxy live
export async function getLiveProxies(wantLive = 20, filterHttps = null, filterCode = null, concurrency = 30) {
    const all = await fetchAllRaw(filterHttps, filterCode);

    const live = [];
    let i = 0;

    while (i < all.length && live.length < wantLive) {
        const batch = all.slice(i, i + concurrency);
        i += concurrency;

        const checked = await Promise.all(
            batch.map(async (p) => {
                const start = Date.now();
                const alive = await proxyAlive(p.ip, p.port, 6000);
                return { ...p, alive, ms: Date.now() - start };
            })
        );

        for (const p of checked) {
            if (p.alive && live.length < wantLive) live.push(p);
        }
    }

    return live;
}

// ── Kiểm tra 1 proxy live/die ─────────────────────────────────────────────────
async function checkProxy(ip, port, timeout = 6000) {
    const start = Date.now();
    const alive = await proxyAlive(ip, port, timeout);
    return { alive, ms: Date.now() - start };
}

// ── Upload kết quả lên Note API ──────────────────────────────────────────────
const NOTE_API_BASE = "https://launa-api-vmrm.onrender.com/note";

async function uploadNote(content) {
    const { randomUUID } = await import("node:crypto");
    const id = randomUUID();
    await axios.put(`${NOTE_API_BASE}/${id}`, content, {
        headers: { "Content-Type": "text/plain", "User-Agent": UA },
        timeout: 10000
    });
    return `${NOTE_API_BASE}/${id}`;
}

// ── Flag emoji ─────────────────────────────────────────────────────────────────
const FLAG_MAP = {
    US: "🇺🇸", VN: "🇻🇳", JP: "🇯🇵", SG: "🇸🇬", DE: "🇩🇪",
    FR: "🇫🇷", GB: "🇬🇧", CN: "🇨🇳", KR: "🇰🇷", TH: "🇹🇭",
    ID: "🇮🇩", MY: "🇲🇾", AU: "🇦🇺", CA: "🇨🇦", RU: "🇷🇺",
    BR: "🇧🇷", IN: "🇮🇳", NL: "🇳🇱", PH: "🇵🇭", HK: "🇭🇰",
};
const flag = (code) => FLAG_MAP[code?.toUpperCase()] || "🏳️";

// ── Hàm xử lý sub: get ───────────────────────────────────────────────────────
async function handleGet(ctx, subArgs) {
    const { api, threadId, threadType } = ctx;
    const send = (msg) => api.sendMessage({ msg }, threadId, threadType);

    let wantLive = 20, filterHttps = null, filterCode = null;
    for (const arg of subArgs) {
        const a = arg.toLowerCase();
        if (/^\d+$/.test(a))    { wantLive = Math.min(parseInt(a), 200); }
        else if (a === "https")  { filterHttps = true; }
        else if (a === "http")   { filterHttps = false; }
        else if (a === "vn")     { filterCode = "VN"; }
        else if (a.length === 2) { filterCode = a.toUpperCase(); }
    }

    await send(
        `⏳ Đang lấy đủ ${wantLive} proxy LIVE...\n` +
        `🔄 Thu thập từ ${SOURCES.length} nguồn → check song song 30 luồng\n` +
        `⌛ Có thể mất 1-3 phút tùy số lượng.`
    );

    const live = await getLiveProxies(wantLive, filterHttps, filterCode, 30);

    if (!live.length) return send("❌ Không tìm được proxy live. Thử lại sau!");

    // Inject thẳng vào pool để .doss dùng ngay
    proxyPool.inject(live);

    const now = new Date().toISOString().replace("T", " ").slice(0, 19);

    const liveLines = live.map(p =>
        `${p.ip}:${p.port} | ${p.https ? "HTTPS" : "HTTP"} | ${p.code} | ${p.anon} | ${p.ms}ms`
    ).join("\n");

    // Chỉ xuất danh sách ip:port để dán thẳng
    const rawLines = live.map(p => `${p.ip}:${p.port}`).join("\n");

    const fileContent =
        `# PROXY LIVE — LauNa Bot\n` +
        `# Thời gian : ${now}\n` +
        `# Tổng LIVE : ${live.length}/${wantLive} yêu cầu\n` +
        `# Nguồn     : ${SOURCES.length} nguồn tổng hợp\n` +
        `${"=".repeat(60)}\n\n` +
        `✅ LIVE (${live.length}):\n` +
        `${"-".repeat(50)}\n` +
        `${liveLines}\n\n` +
        `${"=".repeat(60)}\n` +
        `# RAW ip:port (dán thẳng):\n` +
        `${rawLines}\n`;

    const avgMs = Math.round(live.reduce((s, p) => s + p.ms, 0) / live.length);

    try {
        const noteUrl = await uploadNote(fileContent);
        const poolStats = proxyPool.getStats();
        return send(
            `[ 📊 PROXY LIVE ]\n` +
            `─────────────────\n` +
            `✅ LIVE  : ${live.length} proxy (yêu cầu ${wantLive})\n` +
            `⚡ Ping TB: ${avgMs}ms\n` +
            `🌍 Quốc gia: ${[...new Set(live.map(p => p.code))].slice(0, 8).join(", ")}\n` +
            `🌐 Pool DDoS: ${poolStats.total} proxy sẵn sàng\n` +
            `─────────────────\n` +
            `📄 Link:\n${noteUrl}\n` +
            `─────────────────\n` +
            `💡 Top 3: ${live.slice(0, 3).map(p => `${p.ip}:${p.port} (${p.ms}ms)`).join(" | ")}`
        );
    } catch (e) {
        const shortLive = live.slice(0, 20).map((p, i) =>
            `${String(i + 1).padStart(2)}. ${p.ip}:${p.port} (${p.ms}ms)`
        ).join("\n");
        return send(
            `[ 📊 PROXY LIVE ]\n` +
            `─────────────────\n` +
            `✅ LIVE  : ${live.length} | ⚡ ${avgMs}ms TB\n` +
            `─────────────────\n` +
            `${shortLive}` +
            (live.length > 20 ? `\n...(còn ${live.length - 20} nữa)` : "")
        );
    }
}

// ── COMMANDS ──────────────────────────────────────────────────────────────────
export const commands = {
    proxy: async (ctx) => {
        const { api, args, threadId, threadType } = ctx;
        const send = (msg) => api.sendMessage({ msg }, threadId, threadType);
        const sub = (args[0] || "").toLowerCase();

        // ── .proxy get <số> [https|http] [vn|...] ────────────────────────────
        if (sub === "get") {
            return handleGet(ctx, args.slice(1));
        }

        // ── .proxy pool [refresh] — xem / force-refresh pool (admin only) ──────
        if (sub === "pool") {
            if (!ctx.adminIds?.includes(String(ctx.senderId))) {
                return send("⚠️ Chỉ Admin Bot mới được xem pool!");
            }
            // .proxy pool refresh
            if ((args[1] || "").toLowerCase() === "refresh") {
                proxyPool.refresh();
                return send("🔄 Đang refresh proxy pool... Xem lại sau 1 phút bằng .proxy pool");
            }
            const stats = proxyPool.getStats();
            const top = stats.proxies.slice(0, 10).join("\n") || "(trống)";
            return send(
                `[ 🌐 PROXY POOL ]\n` +
                `─────────────────\n` +
                `📦 Tổng   : ${stats.total} proxy live\n` +
                `🔄 Refresh: ${stats.isRefreshing ? "Đang cập nhật..." : "Idle"}\n` +
                `🕐 Lần cuối: ${stats.lastRefresh ? new Date(stats.lastRefresh).toLocaleString("vi-VN") : "Chưa init"}\n` +
                `─────────────────\n` +
                `📋 Top 10:\n${top}\n` +
                `─────────────────\n` +
                `🔁 Force refresh: .proxy pool refresh`
            );
        }

        // ── .proxy check <ip:port> ───────────────────────────────────────────
        if (sub === "check") {
            const target = args[1] || "";
            const [ip, port] = target.split(":");
            if (!ip || !port) return send("❌ Cú pháp: .proxy check <ip:port>\nVí dụ: .proxy check 1.2.3.4:8080");
            await send(`⏳ Đang kiểm tra ${target}...`);
            const r = await checkProxy(ip, port);
            return send(
                `[ 🔍 PROXY CHECK ]\n` +
                `─────────────────\n` +
                `📡 Proxy  : ${target}\n` +
                `${r.alive ? "✅ ALIVE" : "❌ DEAD"}\n` +
                `⏱️  Ping   : ${r.ms}ms\n` +
                `─────────────────`
            );
        }

        // ── .proxy [số] [https|http] [vn|sg|...] ────────────────────────────
        let limit = 10, filterHttps = null, filterCode = null;
        for (const arg of args) {
            const a = arg.toLowerCase();
            if (/^\d+$/.test(a))    { limit = Math.min(parseInt(a), 50); }
            else if (a === "https")  { filterHttps = true; }
            else if (a === "http")   { filterHttps = false; }
            else if (a === "vn")     { filterCode = "VN"; }
            else if (a.length === 2) { filterCode = a.toUpperCase(); }
        }

        await send("⏳ Đang lấy danh sách proxy...");
        const proxies = await getProxies(limit, filterHttps, filterCode);
        if (!proxies.length) return send("❌ Không lấy được proxy. Thử lại sau!");

        const lines = proxies.map((p, i) =>
            `${String(i + 1).padStart(2)}. ${flag(p.code)} ${p.ip}:${p.port} [${p.https ? "HTTPS" : "HTTP"}] ${p.anon}`
        ).join("\n");

        const httpsCount = proxies.filter(p => p.https).length;
        const countries  = [...new Set(proxies.map(p => p.code))].join(", ");

        return send(
            `[ 🌐 PROXY LIST ]\n` +
            `─────────────────\n` +
            `📦 Tổng   : ${proxies.length} proxy\n` +
            `🔒 HTTPS  : ${httpsCount} | 🔓 HTTP: ${proxies.length - httpsCount}\n` +
            `🌍 Quốc gia: ${countries}\n` +
            `─────────────────\n` +
            `${lines}\n` +
            `─────────────────\n` +
            `💡 Lọc  : .proxy 20 https | .proxy vn | .proxy 5 sg\n` +
            `🔍 Check : .proxy check <ip:port>\n` +
            `📥 Get   : .proxy get <số> — check live + link Note`
        );
    }
};
