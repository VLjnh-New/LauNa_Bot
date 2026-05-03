import { createHash, randomUUID } from "crypto";
import { JSDOM } from "jsdom";
import vm from "vm";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { log } from "../globals.js";
import { tempDir, readJSON } from "../utils/core/io-json.js";

// ── Đọc keys từ tokens.json ────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { getDesktopUA, UA_DESKTOP as UA_POOL } from "../utils/core/userAgents.js";
const TOKEN_PATH = path.resolve(process.cwd(), "src/data/tokens.json");
function getTokens() {
    return readJSON(TOKEN_PATH) || {};
}

export const name = "duckai";
export const description = "Chat AI miễn phí qua duck.ai (GPT-5, GPT-4o, Claude, Llama...) — direct HTTP API";

// ── Endpoints (reverse-engineered từ duck.ai bundle) ──────────────────────────
const BASE_URL      = "https://duckduckgo.com";
const STATUS_URL    = `${BASE_URL}/duckchat/v1/status`;
const CHAT_URL      = `${BASE_URL}/duckchat/v1/chat`;
const IMAGE_GEN_URL = "https://duck.ai/duckchat/v1/images";


// Headers cơ bản — dùng lowercase để match bundle
const BASE_HEADERS = {
    "User-Agent":      getDesktopUA(),
    "Accept-Language": "en-US,en;q=0.9",
    "Origin":          BASE_URL,
    "Referer":         `${BASE_URL}/`,
    "Cache-Control":   "no-cache",
    "Pragma":          "no-cache",
    // x-fe-version theo bundle: "${__DDG_BE_VERSION__||'dev'}-${__DDG_FE_CHAT_HASH__||'hash'}"
    "x-fe-version":    "dev-hash",
};

// ── Model map (reverse-engineered từ duck.ai JS bundle) ───────────────────────
// Reasoning models cần reasoningEffort trong request body
const REASONING_MODELS = new Set(["gpt-5-mini", "o3-mini"]);

const MODEL_MAP = {
    // GPT-5 (free, modelType:"reasoning") — model ID: gpt-5-mini
    gpt5:     "gpt-5-mini",
    "gpt-5":  "gpt-5-mini",
    "5":      "gpt-5-mini",
    g5:       "gpt-5-mini",

    // GPT-4o
    "4o":     "gpt-4o",
    gpt4o:    "gpt-4o",
    "gpt-4o": "gpt-4o",

    // GPT-4o Mini (mặc định)
    gpt:      "gpt-4o-mini",
    mini:     "gpt-4o-mini",
    "4omini": "gpt-4o-mini",

    // Claude 3 Haiku
    claude:   "claude-3-haiku-20240307",
    haiku:    "claude-3-haiku-20240307",

    // Llama 3.1 70B
    llama:    "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
    llama3:   "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",

    // Mixtral
    mixtral:  "mistralai/Mixtral-8x7B-Instruct-v0.1",
    mix:      "mistralai/Mixtral-8x7B-Instruct-v0.1",

    // o3-mini (reasoning)
    o3:       "o3-mini",
};

const MODEL_LABELS = {
    "gpt-5-mini":                                    "GPT-5 Mini 🆕",
    "gpt-4o":                                        "GPT-4o",
    "gpt-4o-mini":                                   "GPT-4o Mini",
    "claude-3-haiku-20240307":                       "Claude 3 Haiku",
    "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo":  "Llama 3.1 70B",
    "mistralai/Mixtral-8x7B-Instruct-v0.1":          "Mixtral 8x7B",
    "o3-mini":                                        "o3-mini",
};

const DEFAULT_MODEL = "gpt-4o-mini";

// Các status code cho thấy proxy không forward được HTTPS (không phải lỗi từ server thật)
// 418 được DuckDuckGo dùng để block proxy/bot IP — cần fallback sang proxy khác hoặc direct
const PROXY_BAD_STATUSES = new Set([404, 407, 418, 502, 503, 504]);

// ── CroxyProxy — web proxy công khai, dùng khi proxy pool + direct đều bị 418 ─
const CROXY_GET_EP = "https://www.croxyproxy.com/requests/get";

async function fetchViaCroxyProxy(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const ua = getDesktopUA();
    const croxyCommonHeaders = {
        "User-Agent": ua,
        "Referer":    "https://www.croxyproxy.com/",
        "Origin":     "https://www.croxyproxy.com",
        "Cache-Control": "no-cache",
    };

    if (method === "POST") {
        // Encode body + headers thêm vào query; CroxyProxy sẽ forward GET → target POST không hỗ trợ
        // → Thay vào đó gọi target qua base URL của CroxyProxy với method override
        // Thực tế CroxyProxy chỉ hỗ trợ GET proxy tốt — POST ta encode body vào param data
        const bodyStr   = typeof options.body === "string" ? options.body : JSON.stringify(options.body || {});
        const bodyB64   = Buffer.from(bodyStr).toString("base64");
        const croxyUrl  = `${CROXY_GET_EP}?url=${encodeURIComponent(url)}&method=POST&content-type=application%2Fjson&data=${encodeURIComponent(bodyB64)}`;
        return undiciFetch(croxyUrl, {
            headers: { ...croxyCommonHeaders, ...(options.headers || {}) },
            signal:  options.signal,
        });
    }

    // GET
    const croxyUrl = `${CROXY_GET_EP}?url=${encodeURIComponent(url)}&data=none`;
    return undiciFetch(croxyUrl, {
        headers: { ...croxyCommonHeaders, ...(options.headers || {}) },
        signal:  options.signal,
    });
}

// ── fetch qua proxy pool (tự rotate, fallback direct nếu proxy fail) ───────────
async function fetchWithProxy(url, options = {}, retries = 3) {
    const pool = global.proxyPool;
    const proxy = pool?.pick?.();
    if (!proxy) return undiciFetch(url, options);

    const dispatcher = new ProxyAgent(`http://${proxy.ip}:${proxy.port}`);
    try {
        const res = await undiciFetch(url, { ...options, dispatcher });
        // Proxy không forward được HTTPS → retry proxy khác
        if (PROXY_BAD_STATUSES.has(res.status)) {
            pool?.markFail?.(proxy.ip, proxy.port);
            if (retries > 0) return fetchWithProxy(url, options, retries - 1);
            // Hết retry → gọi thẳng không qua proxy
            return undiciFetch(url, options);
        }
        return res;
    } catch (e) {
        pool?.markFail?.(proxy.ip, proxy.port);
        if (retries > 0) return fetchWithProxy(url, options, retries - 1);
        return undiciFetch(url, options);
    }
}

// ── Giải VQD JavaScript challenge ─────────────────────────────────────────────
// fetcher: "proxy" | "direct" | "croxy" | function
async function solveVqdChallenge(retry = 3, mode = "proxy") {
    const fetcher = mode === "croxy"  ? fetchViaCroxyProxy
                  : mode === "direct" ? undiciFetch
                  : typeof mode === "function" ? mode
                  : fetchWithProxy;
    let lastErr;
    for (let attempt = 1; attempt <= retry; attempt++) {
        try {
            const res = await fetcher(STATUS_URL, {
                headers: { ...BASE_HEADERS, "accept": "application/json", "x-vqd-accept": "1" },
            });
            if (!res.ok) throw new Error(`Status endpoint HTTP ${res.status}`);

            const challengeB64 = res.headers.get("x-vqd-hash-1");
            if (!challengeB64) throw new Error("Không nhận được VQD challenge (IP bị chặn?)");

            // Dùng Buffer thay atob — an toàn trong Node.js
            const challengeJS = Buffer.from(challengeB64, "base64").toString("utf8");

            const jsdom = new JSDOM("", { userAgent: getDesktopUA() });
            const win   = jsdom.window;

            // Patch querySelector: trả null-safe object
            const origQS = win.document.querySelector.bind(win.document);
            win.document.querySelector = (selector) => {
                const el = origQS(selector);
                if (el !== null) return el;
                return {
                    contentDocument: { querySelector: () => ({ getAttribute: () => null }) },
                    contentWindow:   { document: null, self: null },
                    getAttribute:    () => null,
                };
            };

            // Patch createElement iframe
            const origCreate = win.document.createElement.bind(win.document);
            win.document.createElement = (tag, ...args) => {
                const el = origCreate(tag, ...args);
                if (tag.toLowerCase() === "iframe") {
                    Object.defineProperty(el, "contentWindow",   { get: () => ({ self: null }), configurable: true });
                    Object.defineProperty(el, "contentDocument", { get: () => null,             configurable: true });
                }
                return el;
            };

            // Patch globals thiếu trong jsdom
            win.TextEncoder = TextEncoder;
            win.TextDecoder = TextDecoder;
            if (!win.crypto?.subtle) {
                try {
                    const { webcrypto } = await import("node:crypto");
                    win.crypto = webcrypto;
                } catch {}
            }

            const ctx = vm.createContext(win);
            let result = vm.runInContext(challengeJS, ctx);
            if (result && typeof result.then === "function") result = await result;

            if (!result?.client_hashes) throw new Error("Challenge trả về kết quả không hợp lệ");

            return {
                ...result,
                client_hashes: result.client_hashes.map(c =>
                    createHash("sha256").update(c).digest("base64")
                ),
            };
        } catch (e) {
            lastErr = e;
            const is429 = /429/.test(e.message);
            if (is429) {
                log.warn(`[DuckAI] Rate-limited (429) — bỏ qua duck.ai trong lần này.`);
                break;
            }
            if (attempt < retry) await new Promise(r => setTimeout(r, 1200 * attempt));
        }
    }
    throw lastErr;
}

// ── Build chat request body ────────────────────────────────────────────────────
function buildChatBody(messages, model, extraFields = {}) {
    const body = {
        model,
        messages,
        canUseTools:         true,
        canUseApproxLocation: false,
        metadata: {
            toolChoice: {
                LocalSearch:     false,
                NewsSearch:      false,
                VideoSearch:     false,
                WeatherForecast: false,
            },
        },
    };

    // Reasoning models (gpt-5-mini, o3-mini) cần reasoningEffort
    if (REASONING_MODELS.has(model)) {
        body.reasoningEffort = "low";
    }

    return Object.assign(body, extraFields);
}

// ── Parse SSE stream → text ────────────────────────────────────────────────────
function parseSseText(rawText) {
    let full = "";
    for (const line of rawText.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const p = t.slice(5).trim();
        if (p === "[DONE]") break;
        try {
            const obj = JSON.parse(p);
            // duck.ai dùng obj.message, OpenAI dùng choices[].delta.content
            const d = obj?.message ?? obj?.choices?.[0]?.delta?.content ?? "";
            if (d) full += d;
        } catch {}
    }
    return full.trim();
}

// ── Tách mime + raw base64 từ data URI hoặc raw base64 ───────────────────────
function extractBase64(raw) {
    if (!raw || typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (trimmed.startsWith("data:")) {
        // data:<mime>;base64,<data>
        const commaIdx = trimmed.indexOf(",");
        if (commaIdx === -1) return null;
        const meta     = trimmed.slice(5, commaIdx);          // "image/jpeg;base64"
        const parts    = meta.split(";");
        const mime     = parts[0].trim() || "image/jpeg";
        const encoding = parts[1]?.trim().toLowerCase();
        if (encoding !== "base64") return null;               // không phải base64 encoding → bỏ
        const b64data  = trimmed.slice(commaIdx + 1).replace(/\s/g, "");
        return { mime, b64: b64data };
    }
    // Raw base64 — không có header
    // Kiểm tra ký tự hợp lệ (chỉ chứa base64 alphabet + padding)
    if (/^[A-Za-z0-9+/\r\n]+=*$/.test(trimmed)) {
        return { mime: "image/jpeg", b64: trimmed.replace(/\s/g, "") };
    }
    return null;
}

// Đoán MIME từ magic bytes đầu chuỗi base64
function guessMimeFromB64(b64) {
    try {
        // 24 ký tự base64 ≈ 18 byte — đủ để đọc WEBP signature ở offset 8-11
        const header = Buffer.from(b64.slice(0, 24), "base64");
        if (header[0] === 0xFF && header[1] === 0xD8) return "image/jpeg";
        if (header[0] === 0x89 && header[1] === 0x50) return "image/png";
        if (header[0] === 0x47 && header[1] === 0x49) return "image/gif";
        // WebP: "RIFF" tại [0-3], "WEBP" tại [8-11]
        if (header[0] === 0x52 && header[1] === 0x49 &&
            header[8] === 0x57 && header[9] === 0x45) return "image/webp";
    } catch {}
    return "image/jpeg";
}

function mimeToExt(mime) {
    const map = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
    return map[mime] || "jpg";
}

// ── Parse SSE image response → base64 chunks + text ──────────────────────────
// duck.ai trả về: {"action":"success","role":"partial-image","result":"<base64>"}
// Có thể nhiều chunk partial-image → ghép lại thành 1 ảnh đầy đủ
function parseImageSseResponse(rawText) {
    const imageChunks = [];  // raw base64 chunks (chưa có prefix)
    const imageUrls   = [];  // URL thẳng hoặc data URI hoàn chỉnh
    let   detectedMime = null;
    let   textMsg      = "";

    for (const line of rawText.split("\n")) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const p = t.slice(5).trim();
        if (p === "[DONE]") break;
        if (p.startsWith("[")) continue;
        try {
            const obj = JSON.parse(p);

            // Chunk base64 ảnh (partial-image hoặc image)
            if (obj?.result && (obj.role === "partial-image" || obj.role === "image" || obj.action === "success")) {
                const extracted = extractBase64(obj.result);
                if (extracted) {
                    if (!detectedMime) detectedMime = extracted.mime;
                    imageChunks.push(extracted.b64);
                } else {
                    // Fallback: đẩy thẳng nếu là URL ảnh
                    if (typeof obj.result === "string" && obj.result.startsWith("http")) {
                        imageUrls.push(obj.result);
                    }
                }
                continue;
            }

            // URL ảnh thẳng hoặc data URI trong message/url
            const msg = obj?.message ?? obj?.url ?? "";
            if (!msg) continue;
            if (msg.startsWith("data:image") || msg.startsWith("https://") || msg.startsWith("http://")) {
                imageUrls.push(msg);
            } else {
                textMsg += msg;
            }
        } catch {}
    }

    // Duck.ai gửi progressive frames: mỗi chunk là ảnh HOÀN CHỈNH chất lượng tăng dần
    // → Chỉ lấy chunk CUỐI CÙNG (chất lượng cao nhất), KHÔNG ghép lại
    if (imageChunks.length > 0) {
        const lastB64 = imageChunks[imageChunks.length - 1];
        const mime    = detectedMime || guessMimeFromB64(lastB64);
        imageUrls.unshift(`data:${mime};base64,${lastB64}`);
    }

    return { imageUrls, textMsg };
}

// ── Lấy VQD token riêng cho duck.ai image endpoint ───────────────────────────
const DUCKAI_STATUS_URL = "https://duck.ai/duckchat/v1/status";
const IMG_HEADERS = {
    "User-Agent":      getDesktopUA(),
    "Accept-Language": "vi,en-US;q=0.9,en;q=0.8",
    "Origin":          "https://duck.ai",
    "Referer":         "https://duck.ai/",
    "Cache-Control":   "no-cache",
    "Pragma":          "no-cache",
    "x-fe-version":   "dev-hash",
};

async function solveImageVqd(direct = false, retry = 3) {
    const fetcher = direct ? undiciFetch : fetchWithProxy;
    let lastErr;
    for (let attempt = 1; attempt <= retry; attempt++) {
        try {
            const res = await fetcher(DUCKAI_STATUS_URL, {
                headers: { ...IMG_HEADERS, "User-Agent": getDesktopUA(), "accept": "application/json", "x-vqd-accept": "1" },
            });
            if (!res.ok) throw new Error(`duck.ai status HTTP ${res.status}`);

            const challengeB64 = res.headers.get("x-vqd-hash-1");
            if (!challengeB64) throw new Error("Không nhận được VQD từ duck.ai (IP bị chặn?)");

            // Thử parse JSON trước
            try {
                const parsed = JSON.parse(Buffer.from(challengeB64, "base64").toString("utf8"));
                if (parsed?.server_hashes) return challengeB64;
            } catch {}

            // JS challenge — dùng đầy đủ patch giống solveVqdChallenge
            const challengeJS = Buffer.from(challengeB64, "base64").toString("utf8");
            const jsdom = new JSDOM("", { userAgent: IMG_HEADERS["User-Agent"] });
            const win   = jsdom.window;

            const origQS = win.document.querySelector.bind(win.document);
            win.document.querySelector = (selector) => {
                const el = origQS(selector);
                if (el !== null) return el;
                return {
                    contentDocument: { querySelector: () => ({ getAttribute: () => null }) },
                    contentWindow:   { document: null, self: null },
                    getAttribute:    () => null,
                };
            };
            const origCreate = win.document.createElement.bind(win.document);
            win.document.createElement = (tag, ...args) => {
                const el = origCreate(tag, ...args);
                if (tag.toLowerCase() === "iframe") {
                    Object.defineProperty(el, "contentWindow",   { get: () => ({ self: null }), configurable: true });
                    Object.defineProperty(el, "contentDocument", { get: () => null,             configurable: true });
                }
                return el;
            };
            win.TextEncoder = TextEncoder;
            win.TextDecoder = TextDecoder;
            if (!win.crypto?.subtle) {
                try { const { webcrypto } = await import("node:crypto"); win.crypto = webcrypto; } catch {}
            }

            const ctx = vm.createContext(win);
            let result = vm.runInContext(challengeJS, ctx);
            if (result && typeof result.then === "function") result = await result;
            if (!result?.client_hashes) throw new Error("Challenge kết quả không hợp lệ");

            const final = {
                ...result,
                client_hashes: result.client_hashes.map(c =>
                    createHash("sha256").update(c).digest("base64")
                ),
            };
            return Buffer.from(JSON.stringify(final)).toString("base64");
        } catch (e) {
            lastErr = e;
            const is429 = /429/.test(e.message);
            if (is429) {
                log.warn(`[DuckImg] Rate-limited (429) — bỏ qua duck.ai image.`);
                break;
            }
            if (attempt < retry) await new Promise(r => setTimeout(r, 1200 * attempt));
        }
    }
    throw lastErr;
}

// ── Tạo ảnh qua duck.ai /images endpoint (proxy pool → direct fallback) ───────
async function duckGenerateImage(prompt, _attempt = 0) {
    const MAX_ATTEMPTS = UA_POOL.length + 1;
    const direct = _attempt > 0;
    const ua = getDesktopUA();

    const vqdHash = await solveImageVqd(direct).catch(e => {
        throw new Error(`Không lấy được VQD image token: ${e.message}`);
    });

    const body = {
        model:    "image-generation",
        metadata: {
            toolChoice: {
                NewsSearch:      false,
                VideosSearch:    false,
                LocalSearch:     false,
                WeatherForecast: false,
            },
        },
        messages:             [{ role: "user", content: prompt }],
        canUseTools:          true,
        canUseApproxLocation: null,
        durableStream: {
            messageId:      randomUUID(),
            conversationId: randomUUID(),
            publicKey: {
                alg:     "RSA-OAEP-256",
                e:       "AQAB",
                ext:     true,
                key_ops: ["encrypt"],
                kty:     "RSA",
                n:       "waUfNP7m5R09LTqrNWY5LSoQ0hkHvR8Tfyn-Al6EZTHuB_jRfY7MZmnujRphHHMLtrmL0UwfVGOBLWuok9O-AnS3B4Spcor_8o_5sRtCeH2nHUr0m7SEXCaA4Xl4SshKvlQMerbLKi7wcfUgDAzLrkBxnXgsPvcTd9NbvHi1eo2FBouW-O5T4eHZy_7P31ACd3w64P0uIk7VMof_TmLI6cVePgY2uQoidcCGk2xg4cC5qAkRVcEBKQhmaD-TRundwazh6up1w-NV72zg44mrPj1CcsfehydAzBfpaCdQbCLo7E70e9ffKqxYYIefQEX__zIidq91FbsqF1LJkYpygQ",
                use:     "enc",
            },
        },
    };

    const fetcher = direct ? undiciFetch : fetchWithProxy;
    const res = await fetcher(IMAGE_GEN_URL, {
        method:  "POST",
        headers: {
            ...IMG_HEADERS,
            "User-Agent":   ua,
            "Content-Type": "application/json",
            "accept":       "text/event-stream",
            "X-Vqd-Hash-1": vqdHash,
        },
        body: JSON.stringify(body),
    }).catch(e => { throw new Error(`Lỗi kết nối duck.ai image: ${e.message}`); });

    if (!res.ok) {
        const status  = res.status;
        const errBody = await res.text().catch(() => "");
        if (status === 418) {
            if (_attempt < MAX_ATTEMPTS) {
                log.warn(`[DuckImg] 418 (lần ${_attempt + 1}/${MAX_ATTEMPTS}) → đổi UA và thử lại...`);
                await new Promise(r => setTimeout(r, 1000 * (_attempt + 1)));
                return duckGenerateImage(prompt, _attempt + 1);
            }
            throw new Error("duck.ai image tạm thời bị giới hạn (418). Thử lại sau ít phút.");
        }
        if (status === 429) throw new Error("duck.ai image đang bị rate-limit, thử lại sau.");
        throw new Error(`duck.ai image HTTP ${status}. ${errBody.slice(0, 120)}`);
    }

    const rawText = await res.text();
    return parseImageSseResponse(rawText);
}

// ── Tải ảnh về tmp và gửi qua Zalo ────────────────────────────────────────────
async function sendDuckImage(api, src, caption, threadId, threadType) {
    let tmpPath = null;
    try {
        if (src.startsWith("data:")) {
            // data URI — tách mime và base64
            const extracted = extractBase64(src);
            if (!extracted || !extracted.b64) throw new Error("Data URI ảnh không hợp lệ");
            const mime    = extracted.mime || guessMimeFromB64(extracted.b64);
            const ext     = mimeToExt(mime);
            tmpPath = path.join(tempDir, `duckimg_${Date.now()}.${ext}`);
            const buf = Buffer.from(extracted.b64, "base64");
            if (buf.length < 100) throw new Error("Ảnh giải mã rỗng hoặc quá nhỏ");
            fs.writeFileSync(tmpPath, buf);
        } else if (src.startsWith("http")) {
            // HTTP URL — tải về qua axios + proxy
            const proxyConf = global.proxyPool?.getAxiosProxy?.() || {};
            const resp = await axios.get(src, {
                ...proxyConf,
                responseType: "arraybuffer",
                timeout:      30000,
                headers: { "User-Agent": getDesktopUA() },
            });
            const buf = Buffer.from(resp.data);
            const ct  = resp.headers?.["content-type"] || "image/jpeg";
            const ext = mimeToExt(ct.split(";")[0].trim());
            tmpPath = path.join(tempDir, `duckimg_${Date.now()}.${ext}`);
            fs.writeFileSync(tmpPath, buf);
        } else {
            throw new Error("Nguồn ảnh không hợp lệ (không phải data URI hay HTTP URL)");
        }
        await api.sendMessage({ msg: caption, attachments: [tmpPath] }, threadId, threadType);
    } finally {
        if (tmpPath) try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
}

// ── Conversation history (auto memory per thread) ─────────────────────────────
const MAX_HISTORY_TURNS = 10;
const conversationHistory = new Map();

export function getDuckHistory(threadId) {
    return conversationHistory.get(String(threadId)) || [];
}

export function clearDuckHistory(threadId) {
    conversationHistory.delete(String(threadId));
}

function appendHistory(threadId, role, content) {
    const key = String(threadId);
    const hist = conversationHistory.get(key) || [];
    hist.push({ role, content });
    if (hist.length > MAX_HISTORY_TURNS * 2) hist.splice(0, 2);
    conversationHistory.set(key, hist);
}


// ── Internal: gửi messages tới duck.ai qua CroxyProxy ────────────────────────
async function duckChat(messages, model) {
    const vqd = await solveVqdChallenge(3, "croxy").catch(e => {
        throw new Error(`Không lấy được VQD token: ${e.message}`);
    });
    const vqdHash = Buffer.from(JSON.stringify(vqd)).toString("base64");
    const body    = buildChatBody(messages, model);

    const chatRes = await fetchViaCroxyProxy(CHAT_URL, {
        method: "POST",
        headers: {
            ...BASE_HEADERS,
            "Content-Type":  "application/json",
            "accept":        "text/event-stream",
            "X-Vqd-Hash-1":  vqdHash,
        },
        body: JSON.stringify(body),
    }).catch(e => { throw new Error(`Lỗi kết nối duck.ai qua CroxyProxy: ${e.message}`); });

    if (!chatRes.ok) {
        const status  = chatRes.status;
        const errBody = await chatRes.text().catch(() => "");
        if (status === 429) throw new Error("Duck.ai đang bị rate-limit, thử lại sau.");
        if (status === 400) throw new Error(`Duck.ai từ chối request (400). ${errBody.slice(0, 100)}`);
        throw new Error(`Duck.ai HTTP ${status}`);
    }

    const rawText = await chatRes.text();
    const text    = parseSseText(rawText);
    if (!text) throw new Error("Duck.ai không trả về nội dung — thử lại.");
    return text;
}

// ── Core: chat với duck.ai ─────────────────────────────────────────────────────
async function askDuckAI(prompt, model = DEFAULT_MODEL) {
    return duckChat([{ role: "user", content: prompt }], model);
}

// ── Auto: chat với duck.ai kèm lịch sử hội thoại per-thread ──────────────────
async function askDuckAIAuto(threadId, userMsg, model = DEFAULT_MODEL) {
    appendHistory(threadId, "user", userMsg);
    const messages = getDuckHistory(threadId);

    let reply;
    try {
        reply = await duckChat([...messages], model);
    } catch (e) {
        conversationHistory.get(String(threadId))?.pop();
        throw e;
    }

    appendHistory(threadId, "assistant", reply);
    return reply;
}

// ── Trích xuất URL ảnh từ Zalo message data ────────────────────────────────────
function extractImageUrl(raw) {
    if (!raw) return null;

    const pickUrl = (...candidates) => {
        for (const u of candidates) {
            if (typeof u === "string" && u.startsWith("http")) return u;
        }
        return null;
    };

    const fromExtra = (obj) => {
        if (!obj || typeof obj !== "object") return null;
        const e = obj.extra || {};
        return pickUrl(e.hdUrl, e.url, e.normalUrl, e.thumbUrl,
                       obj.hdUrl, obj.url, obj.normalUrl, obj.thumbUrl);
    };

    const fromAttachments = (arr) => {
        if (!Array.isArray(arr)) return null;
        for (const a of arr) {
            const u = pickUrl(a?.hd, a?.hdUrl, a?.url, a?.fileUrl, a?.href, a?.normalUrl);
            if (u) return u;
        }
        return null;
    };

    const fromAttach = (attach) => {
        if (!attach) return null;
        try {
            const a = typeof attach === "string" ? JSON.parse(attach) : attach;
            const params = typeof a.params === "string" ? JSON.parse(a.params) : (a.params || {});
            return pickUrl(params.hd, params.url, params.normalUrl, a.hdUrl, a.url, a.href);
        } catch { return null; }
    };

    return fromExtra(raw)
        || fromAttachments(raw.attachments)
        || fromAttach(raw.attach)
        || fromExtra(raw.quote)
        || fromAttachments(raw.quote?.attachments)
        || fromAttach(raw.quote?.attach)
        || null;
}

// ── Core: phân tích ảnh qua duck.ai GPT-4o Vision ─────────────────────────────
async function askDuckAIVision(imageBase64, mimeType, prompt, model = "gpt-4o") {
    // Duck.ai không hỗ trợ vision (400 ERR_BAD_REQUEST khi gửi image_url)
    // → Dùng Pollinations free API (hỗ trợ OpenAI vision format)
    const messages = [{
        role: "user",
        content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
            { type: "text", text: prompt },
        ],
    }];
    const res = await axios.post("https://text.pollinations.ai/openai", {
        model: "openai",
        messages,
        stream: false,
    }, {
        headers: { "Content-Type": "application/json" },
        timeout: 60000,
    });
    const content = res.data?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Pollinations Vision không trả về nội dung — thử lại.");
    return content;
}

// ── LauNa TTS — giọng cô gái 19 tuổi (Edge TTS → Pollinations → Google TTS) ──
// Chuỗi ưu tiên: Edge TTS HoaiMy (ngọt nhất) → Pollinations nova → Google TTS vi
const LAUNA_VOICE       = "nova";           // Pollinations fallback voice
const LAUNA_VOICE_MODEL = "elevenlabs";
const EDGE_TTS_VOICE    = "vi-VN-HoaiMyNeural"; // Microsoft Edge TTS — ngọt, tự nhiên nhất
// Pitch & rate cho giọng cô gái 19 tuổi: hơi cao, vừa phải
const EDGE_PITCH        = "+8Hz";
const EDGE_RATE         = "-5%";

/**
 * Chia text thành chunks ≤ maxLen ký tự theo dấu câu
 */
function splitTextChunks(text, maxLen = 180) {
    const chunks = [];
    const sentences = text.split(/(?<=[.!?,;—\n])\s+|(?<=[\u002e\u003f\u0021\u002c\uff0c\u3002\uff01\uff1f])\s*/);
    let cur = "";
    for (const s of sentences) {
        if ((cur + s).length > maxLen && cur) {
            chunks.push(cur.trim());
            cur = s;
        } else {
            cur += (cur ? " " : "") + s;
        }
    }
    if (cur.trim()) chunks.push(cur.trim());
    return chunks.filter(Boolean);
}

/**
 * Microsoft Edge TTS — giọng vi-VN-HoaiMyNeural (ngọt, tự nhiên, miễn phí)
 * Dùng package msedge-tts (tự xử lý auth + WebSocket)
 * Pitch +8Hz, Rate -5% → giọng cô gái 19 tuổi, nhẹ ngọt
 * @returns {Promise<Buffer>} MP3 buffer
 */
async function edgeTTSViBuffer(text) {
    const { MsEdgeTTS, OUTPUT_FORMAT } = await import("msedge-tts");

    const safeText = text.replace(/[<>&"']/g, c =>
        ({ "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;","'":"&apos;" }[c]));

    const tts = new MsEdgeTTS();
    await tts.setMetadata(EDGE_TTS_VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // Truyền pitch/rate qua options → _SSMLTemplate tự wrap đúng cách
    const { audioStream } = await tts.toStream(safeText, {
        pitch: EDGE_PITCH,
        rate: EDGE_RATE,
        volume: "100%",
    });

    return new Promise((resolve, reject) => {
        const chunks = [];
        const timer = setTimeout(() => {
            // Nếu đã có dữ liệu thì trả về luôn khi timeout
            if (chunks.length > 0) resolve(Buffer.concat(chunks));
            else reject(new Error("Edge TTS stream timeout"));
        }, 35000);

        audioStream.on("data", (chunk) => chunks.push(chunk));
        audioStream.on("end",   () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
        audioStream.on("close", () => { if (chunks.length > 0) { clearTimeout(timer); resolve(Buffer.concat(chunks)); } });
        audioStream.on("error", (e) => { clearTimeout(timer); reject(new Error(`Edge TTS stream lỗi: ${e.message}`)); });
    });
}

/**
 * Google Translate TTS (tiếng Việt, nữ, free) — trả về Buffer MP3
 * Tự động chunk và ghép qua ffmpeg nếu text > 180 ký tự
 */
async function googleTTSViBuffer(text) {
    const { execSync } = await import("child_process");
    const chunks = splitTextChunks(text.slice(0, 3000), 180);
    const tmpFiles = [];

    try {
        for (let i = 0; i < chunks.length; i++) {
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunks[i])}&tl=vi&client=tw-ob`;
            const res = await axios.get(url, {
                responseType: "arraybuffer",
                timeout: 15000,
                headers: { "User-Agent": getDesktopUA() },
            });
            const buf = Buffer.from(res.data);
            if (buf.length < 500) continue;
            const tmpChunk = path.join(tempDir, `gtts_chunk_${Date.now()}_${i}.mp3`);
            fs.writeFileSync(tmpChunk, buf);
            tmpFiles.push(tmpChunk);
        }

        if (!tmpFiles.length) throw new Error("Google TTS không có chunk nào hợp lệ");

        if (tmpFiles.length === 1) {
            const buf = fs.readFileSync(tmpFiles[0]);
            return buf;
        }

        // Ghép nhiều chunk bằng ffmpeg
        const listFile = path.join(tempDir, `gtts_list_${Date.now()}.txt`);
        fs.writeFileSync(listFile, tmpFiles.map(f => `file '${f}'`).join("\n"), "utf8");
        const outFile = path.join(tempDir, `gtts_merged_${Date.now()}.mp3`);
        execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outFile}"`, { timeout: 20000 });
        const merged = fs.readFileSync(outFile);
        // Dọn dẹp file tạm
        try { fs.unlinkSync(listFile); fs.unlinkSync(outFile); } catch {}
        return merged;
    } finally {
        for (const f of tmpFiles) try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
}

/**
 * duckTTS — TTS cho LauNa (cô gái 19 tuổi)
 * Chuỗi ưu tiên:
 *   1. Pollinations ElevenLabs "nova" (trẻ, nữ)  — cần Pollinations API key
 *   2. Pollinations OpenAI TTS "nova"             — fallback endpoint
 *   3. Google Translate TTS tiếng Việt (free)     — luôn hoạt động, phát âm vi chuẩn
 *
 * @param {string} text       Văn bản cần đọc
 * @param {string} [apiKey]   Pollinations API key (optional)
 * @returns {Promise<Buffer>} Buffer MP3
 */
async function duckTTS(text, apiKey = "") {
    const input = text.slice(0, 3000);

    // ── 1. Microsoft Edge TTS — vi-VN-HoaiMyNeural (ngọt, tự nhiên nhất) ─────
    try {
        const buf = await edgeTTSViBuffer(input);
        if (buf.length > 1000) {
            log.info(`[LaunaTTS] Edge TTS ${EDGE_TTS_VOICE} — ${buf.length} bytes`);
            return buf;
        }
        throw new Error(`Edge TTS trả về quá nhỏ: ${buf.length} bytes`);
    } catch (e0) {
        log.warn(`[LaunaTTS] Edge TTS lỗi: ${e0.message} — thử Pollinations`);
    }

    // ── 2. Pollinations ElevenLabs nova ──────────────────────────────────────
    try {
        const headers = { "Content-Type": "application/json" };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
        const res = await axios.post(
            "https://gen.pollinations.ai/v1/audio/speech",
            { model: LAUNA_VOICE_MODEL, input, voice: LAUNA_VOICE },
            { headers, responseType: "arraybuffer", timeout: 35000 },
        );
        const buf = Buffer.from(res.data);
        if (buf.length > 1000) {
            log.info(`[LaunaTTS] Pollinations ElevenLabs ${LAUNA_VOICE} — ${buf.length} bytes`);
            return buf;
        }
        throw new Error(`Pollinations EL quá nhỏ: ${buf.length} bytes`);
    } catch (e1) {
        log.warn(`[LaunaTTS] Pollinations EL lỗi: ${e1.message} — thử Google TTS vi`);
    }

    // ── 3. Google Translate TTS tiếng Việt (chunked + ffmpeg) ────────────────
    const buf = await googleTTSViBuffer(input);
    log.info(`[LaunaTTS] Google TTS vi — ${buf.length} bytes`);
    return buf;
}

// ── Export: tất cả hàm duck.ai để dùng global ────────────────────────────────
export {
    askDuckAI,
    askDuckAIAuto,
    askDuckAIVision,
    duckGenerateImage,
    sendDuckImage,
    duckChat,
    duckTTS,
};


// ── Commands ───────────────────────────────────────────────────────────────────
// ── Private handlers ──────────────────────────────────────────────────────────

async function handleDuckAi(ctx) {
    const { api, args, threadId, threadType, prefix, raw, message } = ctx;
    const msgData = raw || message?.data || {};

    if (!args.length) {
        const histLen = Math.floor(getDuckHistory(threadId).length / 2);
        return api.sendMessage({
            msg: [
                `🦆 Duck.ai Chat — có nhớ lịch sử hội thoại`,
                `Cú pháp: ${prefix}duck ai [model] <câu hỏi>`,
                ``,
                `Model (tuỳ chọn):`,
                `  gpt5 / 5         — GPT-5 Mini 🆕 (reasoning, free)`,
                `  4o / gpt4o       — GPT-4o`,
                `  gpt / mini       — GPT-4o Mini (mặc định)`,
                `  claude / haiku   — Claude 3 Haiku`,
                `  llama / llama3   — Llama 3.1 70B`,
                `  mixtral / mix    — Mixtral 8x7B`,
                `  o3               — o3-mini (reasoning)`,
                ``,
                `Ví dụ:`,
                `  ${prefix}duck ai gpt5 Giải thích lượng tử`,
                `  ${prefix}duck ai 4o Viết code Python`,
                `  ${prefix}duck ai claude Viết thơ về mùa thu`,
                ``,
                `🧠 Lịch sử: ${histLen} tin nhắn — xoá bằng ${prefix}duck reset`,
            ].join("\n"),
        }, threadId, threadType);
    }

    let model  = DEFAULT_MODEL;
    let prompt = args.join(" ").trim();

    const firstWord = args[0]?.toLowerCase();
    if (MODEL_MAP[firstWord]) {
        model  = MODEL_MAP[firstWord];
        prompt = args.slice(1).join(" ").trim();
        if (!prompt) return api.sendMessage({ msg: `🦆 Nhập câu hỏi sau tên model!` }, threadId, threadType);
    }

    if (!prompt && msgData?.quote?.msg) prompt = msgData.quote.msg.trim();
    if (!prompt) return api.sendMessage({ msg: `🦆 Nhập câu hỏi đi bạn ơi!` }, threadId, threadType);

    const label    = MODEL_LABELS[model] || model;
    const histLen  = getDuckHistory(threadId).length;
    const histNote = histLen > 0 ? ` (${Math.floor(histLen / 2)} tin nhắn trong lịch sử)` : "";
    const thinking = await api.sendMessage({ msg: `🦆 [${label}] đang trả lời...${histNote}` }, threadId, threadType);

    try {
        const reply = await askDuckAIAuto(threadId, prompt, model);
        await api.sendMessage({ msg: `🦆 [${label}]\n${reply}`, quote: msgData }, threadId, threadType);
    } catch (e) {
        log.error("[DuckAI]", e.message);
        await api.sendMessage({ msg: `❌ Lỗi duck.ai: ${e.message}` }, threadId, threadType);
    } finally {
        try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
    }
}

async function handleDuckImg(ctx) {
    const { api, args, threadId, threadType, prefix, raw } = ctx;

    const prompt = args.join(" ").trim()
        || (raw?.quote?.msg ? raw.quote.msg.trim() : "");

    if (!prompt) {
        return api.sendMessage({
            msg: [
                `🦆🎨 Duck.ai Image — Tạo ảnh AI miễn phí`,
                `Cú pháp: ${prefix}duck img <mô tả ảnh>`,
                ``,
                `Ví dụ:`,
                `  ${prefix}duck img một con mèo đang ngủ trên mặt trăng`,
                `  ${prefix}duck img cyberpunk city at night, neon lights, rain`,
                ``,
                `📡 Gọi qua proxy để ẩn IP — miễn phí, không cần key.`,
            ].join("\n"),
        }, threadId, threadType);
    }

    const thinking = await api.sendMessage(
        { msg: `🦆🎨 Đang tạo ảnh... "${prompt.slice(0, 60)}${prompt.length > 60 ? "…" : ""}"` },
        threadId, threadType
    );

    try {
        const { imageUrls, textMsg } = await duckGenerateImage(prompt);

        if (!imageUrls.length) {
            const fallback = textMsg.trim() || "Duck.ai không trả về ảnh. Thử lại hoặc đổi prompt.";
            await api.sendMessage({ msg: `🦆🎨 ${fallback}` }, threadId, threadType);
            return;
        }

        for (let i = 0; i < imageUrls.length; i++) {
            const caption = imageUrls.length > 1
                ? `🦆🎨 Ảnh ${i + 1}/${imageUrls.length}`
                : `🦆🎨 Duck.ai Image`;
            await sendDuckImage(api, imageUrls[i], caption, threadId, threadType);
        }

        if (textMsg.trim()) {
            await api.sendMessage({ msg: `🦆🎨 ${textMsg.trim()}` }, threadId, threadType);
        }
    } catch (e) {
        log.warn("[DuckImg]", e.message);
        await api.sendMessage({ msg: `❌ Duck.ai image lỗi: ${e.message}` }, threadId, threadType);
    } finally {
        try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
    }
}

async function handleDuckView(ctx) {
    const { api, args, threadId, threadType, prefix, raw, message } = ctx;

    const msgData = raw || message?.data || {};
    let imageUrl = null;
    let remainingArgs = [...args];

    if (remainingArgs.length && (remainingArgs[0].startsWith("http://") || remainingArgs[0].startsWith("https://"))) {
        imageUrl = remainingArgs.shift();
    } else {
        imageUrl = extractImageUrl(msgData);
    }

    if (!imageUrl) {
        return api.sendMessage({
            msg: [
                `🦆🖼️ Duck.ai View — Phân tích ảnh bằng GPT-4o`,
                `Cú pháp: ${prefix}duck view [câu hỏi]`,
                ``,
                `Cách dùng:`,
                `  • Gửi ảnh kèm lệnh: ${prefix}duck view mô tả ảnh này`,
                `  • Reply vào ảnh rồi gõ: ${prefix}duck view`,
                `  • Paste URL ảnh: ${prefix}duck view https://... [câu hỏi]`,
                ``,
                `Ví dụ:`,
                `  ${prefix}duck view đây là ảnh gì?`,
                `  ${prefix}duck view https://example.com/img.jpg mô tả chi tiết`,
            ].join("\n"),
        }, threadId, threadType);
    }

    const prompt   = remainingArgs.join(" ").trim() || "Hãy mô tả chi tiết nội dung trong ảnh này bằng tiếng Việt.";
    const thinking = await api.sendMessage({ msg: `🦆🖼️ [GPT-4o Vision] Đang phân tích ảnh...` }, threadId, threadType);

    try {
        const imgRes = await undiciFetch(imageUrl, { headers: { "User-Agent": getDesktopUA() } });
        if (!imgRes.ok) throw new Error(`Không tải được ảnh (HTTP ${imgRes.status})`);
        const ct        = imgRes.headers.get("content-type") || "image/jpeg";
        const mimeType  = ct.split(";")[0].trim() || "image/jpeg";
        const arrayBuf  = await imgRes.arrayBuffer();
        const imageBase64 = Buffer.from(arrayBuf).toString("base64");

        const answer = await askDuckAIVision(imageBase64, mimeType, prompt, "gpt-4o");
        await api.sendMessage({ msg: `🦆🖼️ [GPT-4o Vision]\n${answer}`, quote: msgData }, threadId, threadType);
    } catch (e) {
        log.error("[DuckView]", e.message);
        await api.sendMessage({ msg: `❌ Duck.ai Vision thất bại: ${e.message}` }, threadId, threadType);
    } finally {
        try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
    }
}

async function handleDuckReset(ctx) {
    const { api, threadId, threadType } = ctx;
    const histLen = Math.floor(getDuckHistory(threadId).length / 2);
    clearDuckHistory(threadId);
    await api.sendMessage({
        msg: `🦆 Đã xoá lịch sử hội thoại${histLen > 0 ? ` (${histLen} tin nhắn)` : ""}.`,
    }, threadId, threadType);
}

async function handleDuckModel(ctx) {
    const { api, threadId, threadType, prefix } = ctx;
    await api.sendMessage({
        msg: [
            `🦆 Duck.ai — Danh sách model`,
            `─────────────────────────────────────`,
            `💬 Chat (${prefix}duck ai [model] <câu hỏi>):`,
            `  gpt5 / 5         — GPT-5 Mini 🆕 (free, reasoning)`,
            `  4o / gpt4o       — GPT-4o`,
            `  gpt / mini       — GPT-4o Mini (mặc định)`,
            `  claude / haiku   — Claude 3 Haiku`,
            `  llama / llama3   — Llama 3.1 70B`,
            `  mixtral / mix    — Mixtral 8x7B`,
            `  o3               — o3-mini (reasoning)`,
            `─────────────────────────────────────`,
            `🎨 Tạo ảnh (${prefix}duck img <mô tả>):`,
            `  Duck.ai Image Generation — free, qua proxy ẩn IP`,
            `─────────────────────────────────────`,
            `🖼️ Phân tích ảnh (${prefix}duck view [câu hỏi]):`,
            `  Duck.ai GPT-4o Vision`,
            `─────────────────────────────────────`,
            `🧹 Xoá lịch sử: ${prefix}duck reset`,
        ].join("\n"),
    }, threadId, threadType);
}

// ── Router: .duck <sub> [...args] ─────────────────────────────────────────────

export const commands = {
    duck: async (ctx) => {
        const { api, args, threadId, threadType, prefix } = ctx;
        const sub = args[0]?.toLowerCase();
        const subCtx = { ...ctx, args: args.slice(1) };

        switch (sub) {
            case "ai":    return handleDuckAi(subCtx);
            case "img":   return handleDuckImg(subCtx);
            case "view":  return handleDuckView(subCtx);
            case "reset": return handleDuckReset(subCtx);
            case "model": return handleDuckModel(subCtx);
            default:
                return api.sendMessage({
                    msg: [
                        `🦆 Duck.ai — Trợ lý AI miễn phí`,
                        `─────────────────────────────────────`,
                        `${prefix}duck ai [model] <câu hỏi>  — Chat AI (nhớ lịch sử)`,
                        `${prefix}duck img <mô tả>            — Tạo ảnh AI`,
                        `${prefix}duck view [câu hỏi]         — Phân tích ảnh`,
                        `${prefix}duck model                  — Xem danh sách model`,
                        `${prefix}duck reset                  — Xoá lịch sử hội thoại`,
                        `─────────────────────────────────────`,
                        `Ví dụ nhanh:`,
                        `  ${prefix}duck ai Giải thích về AI`,
                        `  ${prefix}duck ai gpt5 Viết code Python đọc file JSON`,
                        `  ${prefix}duck img a cat sleeping on the moon`,
                    ].join("\n"),
                }, threadId, threadType);
        }
    },
};
