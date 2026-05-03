import axios from "axios";
import http from "http";
import https from "https";
import vm from "node:vm";
import { load } from "cheerio";
import { log } from "../../logger.js";
import { getDesktopUA } from "../core/userAgents.js";

const _httpAgent = new http.Agent({ keepAlive: true, maxSockets: 8 });
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 8 });
const _ax = axios.create({ httpAgent: _httpAgent, httpsAgent: _httpsAgent, timeout: 30000 });

const BASE_URL = "https://snapsave.app";

const HEADERS = {
    "User-Agent": getDesktopUA(),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": `${BASE_URL}/`,
    "Origin": BASE_URL,
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
};

function _decodePacked(body) {
    if (!body || typeof body !== "string") return null;
    if (!/eval\(function\(/.test(body)) return body;

    const sandbox = {
        captured: null,
        console: { log: () => {}, error: () => {}, warn: () => {} },
        setTimeout: () => {},
        clearTimeout: () => {},
        unescape: (s) => decodeURIComponent(s),
        escape: (s) => encodeURIComponent(s),
        atob: (s) => Buffer.from(s, "base64").toString("binary"),
        btoa: (s) => Buffer.from(s, "binary").toString("base64"),
        window: {},
        document: { getElementById: () => ({}) },
        navigator: { userAgent: "Mozilla/5.0" },
        location: { hostname: "snapsave.app" },
        Buffer,
        globalThis: null,
    };
    sandbox.globalThis = sandbox;
    sandbox.window = sandbox;
    vm.createContext(sandbox);

    try {
        vm.runInContext(
            'globalThis.eval = function(arg) { globalThis.captured = arg; return arg; };' + body,
            sandbox,
            { timeout: 1500 }
        );
    } catch (e) {
        log.warn(`[SnapSave] decode fail: ${e.message}`);
    }

    return sandbox.captured || null;
}

function _extractStringLiteral(source, search) {
    const idx = source.indexOf(search);
    if (idx === -1) return null;

    let pos = idx + search.length;
    while (pos < source.length && /\s/.test(source[pos])) pos++;
    const quote = source[pos];
    if (quote !== '"' && quote !== "'" && quote !== "`") return null;

    let i = pos + 1;
    let escaped = false;
    let literal = quote;

    while (i < source.length) {
        const ch = source[i];
        literal += ch;
        if (escaped) {
            escaped = false;
        } else if (ch === "\\") {
            escaped = true;
        } else if (ch === quote) {
            break;
        }
        i++;
    }

    if (!literal.endsWith(quote)) return null;
    try {
        return vm.runInContext(`tmp=${literal}`, vm.createContext({}));
    } catch {
        return literal.slice(1, -1)
            .replace(/\\x([0-9A-Fa-f]{2})/g, (_, m) => String.fromCharCode(parseInt(m, 16)))
            .replace(/\\u([0-9A-Fa-f]{4})/g, (_, m) => String.fromCharCode(parseInt(m, 16)))
            .replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, "\n");
    }
}

function _findDownloadHtml(source) {
    if (!source || typeof source !== "string") return null;

    for (const pattern of [
        'document.getElementById("download-section").innerHTML =',
        "document.getElementById('download-section').innerHTML =",
        'document.querySelector("#download-section").innerHTML =',
        "document.querySelector('#download-section').innerHTML =",
    ]) {
        const html = _extractStringLiteral(source, pattern);
        if (html) return html;
    }

    const directMatch = source.match(/href=["'](https?:\/\/(?:d\.rapidcdn\.app|rapidcdn\.app)\/v2\?token=[^"'\s<>]+)["']/i)
        || source.match(/href=["'](https?:\/\/[^"'\s<>]+[?&]dl=1[^"'\s<>]*)["']/i);
    if (directMatch) return `<a href="${directMatch[1]}">Download</a>`;

    if (/<div[^>]+id=["']download-section["']/i.test(source)) return source;

    return null;
}

function _extractErrorMessage(source) {
    if (!source || typeof source !== "string") return null;
    const alertMatch = source.match(/(?:document\.querySelector|document\.getElementById)\(\s*(['"`])#?alert\1\s*\)\s*\.\s*innerHTML\s*=\s*(['"`])([\s\S]*?)\2/i);
    if (alertMatch) {
        const msg = alertMatch[3]
            .replace(/\\x([0-9A-Fa-f]{2})/g, (_, m) => String.fromCharCode(parseInt(m, 16)))
            .replace(/\\u([0-9A-Fa-f]{4})/g, (_, m) => String.fromCharCode(parseInt(m, 16)))
            .replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\n/g, " ")
            .replace(/<[^>]*>/g, "").trim();
        if (msg) return msg;
    }
    const errorMatch = source.match(/Error\s*:\s*([^<"\n]+?)(?:<|$)/i);
    if (errorMatch) return errorMatch[1].trim();
    return null;
}

function _isValidDownloadUrl(url, titleAttr) {
    if (!url || typeof url !== "string") return false;
    const n = url.trim();
    if (!/^https?:\/\//i.test(n)) return false;
    if (/https?:\/\/(?:d\.)?rapidcdn\.app\/v2\?token=/i.test(n)) return true;
    if (/dl=1/i.test(n)) return true;
    if (/\.(mp4|webm)(\?|$)/i.test(n)) return true;
    if (/download/i.test(titleAttr || "") && n.length > 10) return true;
    return false;
}

function _parseDownloadHtml(html) {
    if (!html) return null;
    const $ = load(html);
    const title = $("strong").first().text().trim() || "Facebook Video";
    const thumb = $(".image img").attr("src") || null;
    const medias = [];

    $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        const titleAttr = ($(el).attr("title") || $(el).text() || "").trim();
        if (!href || !_isValidDownloadUrl(href.trim(), titleAttr)) return;
        const quality = titleAttr.replace(/Download/i, "").replace(/Now/i, "").trim() || "HD";
        medias.push({
            type: "video",
            quality,
            url: href.trim(),
            extension: href.match(/\.([a-zA-Z0-9]{2,4})(?:[?&#]|$)/)?.[1] || "mp4",
        });
    });

    return { title, author: "SnapSave", thumbnail: thumb, medias };
}

export async function downloadAll(link) {
    const url = (link || "").trim();
    if (!url) return { error: true, message: "URL rỗng" };

    if (!/facebook\.com|fb\.watch|fb\.me|m\.facebook\.com/.test(url)) {
        return { error: true, message: "snapsaveDownloader chỉ hỗ trợ Facebook" };
    }

    //log.info(`[SnapSave] downloading Facebook: ${url}`);
    try {
        const form = new URLSearchParams({ url }).toString();
        const res = await _ax.post(`${BASE_URL}/action.php?lang=en`, form, {
            headers: { ...HEADERS, "Content-Type": "application/x-www-form-urlencoded" },
            validateStatus: () => true,
        });

        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

        const raw = res.data;
        const decoded = _decodePacked(raw) || raw;

        const errMsg = _extractErrorMessage(decoded);
        if (errMsg) {
            log.warn(`[SnapSave] ${errMsg}`);
            return { error: true, message: errMsg };
        }

        const html = _findDownloadHtml(decoded);
        if (!html) return { error: true, message: "Không tìm thấy link download" };

        const data = _parseDownloadHtml(html);
        if (data?.medias?.length) return data;

        const fallback = decoded.match(/https?:\/\/[^"'\s<>]+(?:dl=1|\.mp4|rapidcdn\.app\/v2\?token=[^"'\s<>]+)/i)?.[0];
        if (fallback) {
            return {
                title: "Facebook Video",
                author: "SnapSave",
                thumbnail: null,
                medias: [{ type: "video", quality: "HD", url: fallback, extension: fallback.match(/\.([a-zA-Z0-9]{2,4})(?:[?&#]|$)/)?.[1] || "mp4" }],
            };
        }

        return { error: true, message: "Không tìm thấy link download" };
    } catch (err) {
        log.warn(`[SnapSave] ${err.message}`);
        return { error: true, message: err.message || "SnapSave lỗi" };
    }
}

export function pickBestVideo(medias) {
    if (!Array.isArray(medias)) return null;
    return medias[0] || null;
}
