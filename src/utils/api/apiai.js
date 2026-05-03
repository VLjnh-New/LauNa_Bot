import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import FormData from "form-data";
import { log } from "../../globals.js";
import { readJSON } from "../../utils/core/io-json.js";

const TOKEN_PATH = path.resolve(process.cwd(), "src/data/tokens.json");
function getTokens() {
    return readJSON(TOKEN_PATH) || {};
}

export function getKieaiKey() {
    return getTokens()?.kieai?.apiKey || "";
}

export function getPollinationsKey() {
    return getTokens()?.pollinations?.apiKey || "";
}

// ── Pollinations: Chat (text) ─────────────────────────────────────────────────
const POLL_CHAT = "https://text.pollinations.ai/openai";

/**
 * Chat với Pollinations AI (OpenAI-compatible)
 * @param {string} systemPrompt  - System prompt
 * @param {string} userPrompt    - Tin nhắn người dùng (prompt hiện tại)
 * @param {Array}  history       - [{role,content}] lịch sử hội thoại
 * @param {string} model         - openai | openai-large | openai-reasoning | mistral | llama | phi | gemini | deepseek-reasoning
 * @param {string} [apiKey]      - Optional Bearer token
 * @returns {Promise<string>}    - Nội dung phản hồi
 */
export async function pollinationsChat(systemPrompt, userPrompt, history = [], model = "openai", apiKey = "") {
    const histMsgs = history.map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
    const headers = { "Content-Type": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    const res = await axios.post(POLL_CHAT, {
        model,
        messages: [
            { role: "system",    content: systemPrompt },
            ...histMsgs,
            { role: "user",      content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens:  1200,
        private:     true,
    }, { headers, timeout: 30000 });
    const text = res.data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Pollinations chat trả về rỗng");
    return text;
}

// ── Translate prompt to English ───────────────────────────────────────────────
/**
 * Dịch prompt sang tiếng Anh chuẩn nhất để tạo ảnh tốt hơn.
 * Nếu prompt đã là tiếng Anh hoặc dịch thất bại, trả về nguyên bản.
 */
export async function translateToEnglish(prompt) {
    try {
        const res = await axios.post(POLL_CHAT, {
            model: "openai",
            messages: [
                {
                    role: "system",
                    content: "You are a professional translator. Translate the user's text into natural, vivid English optimized for image generation prompts. Output ONLY the translated English text, nothing else.",
                },
                { role: "user", content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 400,
            private: true,
        }, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
        const translated = res.data?.choices?.[0]?.message?.content?.trim();
        return translated || prompt;
    } catch {
        return prompt;
    }
}

// ── Pollinations: Image ───────────────────────────────────────────────────────
const POLL_IMG        = "https://gen.pollinations.ai/image";
const POLL_IMG_PUBLIC = "https://image.pollinations.ai/prompt";
const POLL_VIDEO      = "https://gen.pollinations.ai/video";

function imageResponseError(label, res) {
    const ct = res.headers?.["content-type"] || "unknown";
    const body = Buffer.from(res.data || []).toString("utf8", 0, 160).replace(/\s+/g, " ").trim();
    return new Error(`${label} không trả về ảnh (HTTP ${res.status}, content-type: ${ct}${body ? `, body: ${body}` : ""})`);
}

function assertImageResponse(label, res) {
    const ct = (res.headers?.["content-type"] || "").toLowerCase();
    const buf = Buffer.from(res.data || []);
    const isMagicImage =
        (buf[0] === 0xFF && buf[1] === 0xD8) ||
        (buf[0] === 0x89 && buf[1] === 0x50) ||
        (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57 && buf[9] === 0x45);
    if (res.status !== 200 || buf.length <= 100 || (!ct.startsWith("image/") && !isMagicImage)) {
        throw imageResponseError(label, res);
    }
    return buf;
}

/**
 * Tạo ảnh bằng Pollinations → trả về Buffer
 * model: flux (mặc định), zimage, gptimage, grok, qwen, klein
 * Nếu key-based API thất bại (4xx), tự fallback về public URL (không cần key).
 */
export async function pollinationsImage(apiKey, prompt, model = "flux", width = 1024, height = 1024) {
    const seed = Math.floor(Math.random() * 999999);

    // Thử trước với key-based API (gen.pollinations.ai)
    if (apiKey) {
        try {
            const url = `${POLL_IMG}/${encodeURIComponent(prompt)}?model=${model}&width=${width}&height=${height}&nologo=true&seed=${seed}`;
            const res = await axios.get(url, {
                headers: { Authorization: `Bearer ${apiKey}` },
                responseType: "arraybuffer",
                timeout: 60000,
                validateStatus: () => true,
            });
            return assertImageResponse("Pollinations key API", res);
        } catch (e) {
            const status = e?.response?.status;
            if (status && status < 400) throw e;
        }
    }

    const publicUrl = `${POLL_IMG_PUBLIC}/${encodeURIComponent(prompt)}?model=${model}&width=${width}&height=${height}&nologo=true&seed=${seed}`;
    const res = await axios.get(publicUrl, {
        responseType: "arraybuffer",
        timeout: 60000,
        validateStatus: () => true,
    });
    return assertImageResponse("Pollinations public API", res);
}

/**
 * Tạo video bằng Pollinations → trả về Buffer
 * model: wan-fast (mặc định), ltx-2
 */
export async function pollinationsVideo(apiKey, prompt, model = "wan-fast") {
    const url = `${POLL_VIDEO}/${encodeURIComponent(prompt)}?model=${model}&nologo=true`;
    const res = await axios.get(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        responseType: "arraybuffer",
        timeout: 120000,
    });
    const ct = res.headers?.["content-type"] || "";
    if (!ct.includes("video")) throw new Error(`API trả về: ${ct}`);
    return Buffer.from(res.data);
}

const BASE = "https://api.kie.ai/api/v1";

function authHeaders(key) {
    return { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" };
}

export const KIE_MODELS = {
    "4o": {
        label: "GPT-4o Image",
        createPath: `${BASE}/gpt4o-image/generate`,
        pollPath:   `${BASE}/gpt4o-image/record-info`,
        extractUrls: (resp) => resp?.resultUrls || [],
    },
    "flux-pro": {
        label: "Flux Kontext Pro",
        createPath: `${BASE}/flux/kontext/generate`,
        pollPath:   `${BASE}/flux/kontext/record-info`,
        model:      "flux-kontext-pro",
        extractUrls: (resp) => resp?.resultImageUrl ? [resp.resultImageUrl] : [],
    },
    "flux-max": {
        label: "Flux Kontext Max",
        createPath: `${BASE}/flux/kontext/generate`,
        pollPath:   `${BASE}/flux/kontext/record-info`,
        model:      "flux-kontext-max",
        extractUrls: (resp) => resp?.resultImageUrl ? [resp.resultImageUrl] : [],
    },
};

export const DEFAULT_MODEL = "4o";

/**
 * Tạo task sinh ảnh, trả về { taskId, cfg }
 * opts: { model, size, inputImage, nVariants, isEnhance }
 */
export async function kieaiCreateTask(apiKey, prompt, opts = {}) {
    const modelKey = opts.model || DEFAULT_MODEL;
    const cfg = KIE_MODELS[modelKey] || KIE_MODELS[DEFAULT_MODEL];

    let body;
    if (modelKey === "4o") {
        body = {
            prompt,
            size:       opts.size || "1:1",
            nVariants:  opts.nVariants || 1,
            isEnhance:  opts.isEnhance || false,
            enableFallback: false,
        };
        if (opts.inputImage) body.filesUrl = [opts.inputImage];
    } else {
        body = {
            prompt,
            model:             cfg.model,
            aspectRatio:       opts.size || "1:1",
            enableTranslation: true,
            outputFormat:      "jpeg",
        };
        if (opts.inputImage) body.inputImage = opts.inputImage;
    }

    const res = await axios.post(cfg.createPath, body, {
        headers: authHeaders(apiKey),
        timeout: 30000,
    });
    const data = res.data;
    if (data?.code !== 200) throw new Error(data?.msg || `KIE API error code=${data?.code}`);
    const taskId = data?.data?.taskId;
    if (!taskId) throw new Error("KIE API không trả về taskId: " + JSON.stringify(data?.data));
    return { taskId, cfg };
}

/**
 * Poll 1 lần — trả về { done, urls, failed, error, progress }
 */
export async function kieaiPollOnce(apiKey, taskId, cfg) {
    const res = await axios.get(cfg.pollPath, {
        params:  { taskId },
        headers: { "Authorization": `Bearer ${apiKey}` },
        timeout: 20000,
    });
    const data = res.data?.data;
    const flag = data?.successFlag;

    if (flag === 1) {
        const urls = cfg.extractUrls(data?.response);
        if (!urls.length) throw new Error("Task xong nhưng không có URL ảnh nào!");
        return { done: true, urls, progress: "1.00" };
    }
    if (flag === 2) {
        return { done: true, failed: true, error: data?.errorMessage || "Tạo ảnh thất bại" };
    }
    return { done: false, progress: data?.progress || "0" };
}

/**
 * Poll liên tục đến khi xong, trả về mảng URL ảnh
 * maxAttempts=30, intervalMs=5000 → tối đa ~2.5 phút
 */
export async function kieaiPollUntilDone(apiKey, taskId, cfg, maxAttempts = 30, intervalMs = 5000) {
    for (let i = 0; i < maxAttempts; i++) {
        if (i > 0) await new Promise(r => setTimeout(r, intervalMs));
        const result = await kieaiPollOnce(apiKey, taskId, cfg);
        if (result.failed) throw new Error(result.error || "Tạo ảnh thất bại");
        if (result.done) return result.urls;
    }
    throw new Error("Quá thời gian chờ — kie.ai chưa trả ảnh sau 2.5 phút.");
}

/**
 * All-in-one: tạo task → poll → trả về mảng URL ảnh
 * opts: { model, size, inputImage, nVariants }
 */
export async function kieaiGenerateAndWait(prompt, opts = {}) {
    const apiKey = getKieaiKey();
    if (!apiKey) throw new Error("Chưa cấu hình kieai.apiKey trong tokens.json!");
    const { taskId, cfg } = await kieaiCreateTask(apiKey, prompt, opts);
    return kieaiPollUntilDone(apiKey, taskId, cfg);
}

/**
 * Global draw: tạo ảnh bằng kieai → tải về → trả về Buffer
 * opts: { model, size, inputImage, nVariants }
 * Dùng chung cho launa.js, stk.js và bất kỳ module nào cần.
 */
export async function kieaiDraw(prompt, opts = {}) {
    const urls = await kieaiGenerateAndWait(prompt, opts);
    if (!urls?.length) throw new Error("kie.ai không trả về ảnh nào");
    const res = await axios.get(urls[0], { responseType: "arraybuffer", timeout: 30000 });
    return Buffer.from(res.data);
}

// ─────────────────────────────────────────────────────────────────────────────
// Module: ai — chat, tạo ảnh, video, TTS, STT
// ─────────────────────────────────────────────────────────────────────────────

export const name = "ai";
export const description = "AI đa năng: chat, tạo ảnh, video, TTS, STT — powered by Pollinations + kie.ai";

const BASE_TEXT  = "https://gen.pollinations.ai/v1";
const BASE_AUDIO = "https://gen.pollinations.ai/v1/audio";

// ─── Model aliases ───────────────────────────────────────────────────────────

const TEXT_MODELS = {
    gpt: "openai", chatgpt: "openai", "4o": "openai",
    fast: "openai-fast", "gpt-fast": "openai-fast",
    gemini: "gemini-fast", google: "gemini-fast",
    search: "gemini-search", "gemini-search": "gemini-search",
    deepseek: "deepseek", ds: "deepseek",
    mistral: "mistral",
    coder: "qwen-coder", qwen: "qwen-coder",
    openai: "openai", "openai-fast": "openai-fast",
};

const IMG_MODELS = {
    flux: "flux", default: "flux",
    zimage: "zimage", z: "zimage", turbo: "zimage",
    "gpt-img": "gptimage", gptimage: "gptimage", "gpt-image": "gptimage",
    grok: "grok-imagine", "grok-imagine": "grok-imagine",
    qwen: "qwen-image", "qwen-image": "qwen-image",
    klein: "klein",
};

const VIDEO_MODELS = {
    wan: "wan-fast", "wan-fast": "wan-fast", fast: "wan-fast",
    ltx: "ltx-2", "ltx-2": "ltx-2",
};

const TTS_VOICES = ["nova", "alloy", "echo", "fable", "onyx", "shimmer", "ash",
    "ballad", "coral", "sage", "verse", "rachel", "domi", "bella", "elli",
    "sarah", "emily", "lily", "matilda", "adam", "josh", "sam"];

function resolveTextModel(alias) {
    return TEXT_MODELS[alias?.toLowerCase()] || alias || "openai";
}
function resolveImgModel(alias) {
    return IMG_MODELS[alias?.toLowerCase()] || "flux";
}
function resolveVideoModel(alias) {
    return VIDEO_MODELS[alias?.toLowerCase()] || "wan-fast";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeader(key) {
    return { Authorization: `Bearer ${key}` };
}

function extractQuoteImageUrl(raw) {
    const att = raw?.quote?.attach;
    if (!att) return null;
    const url = att.hdUrl || att.url || att.href || att.thumbUrl || att.normalUrl;
    return url && typeof url === "string" && url.startsWith("http") ? url : null;
}

function extractQuoteVoiceUrl(raw) {
    const q = raw?.quote;
    if (!q) return null;
    const att = q.attach;
    if (!att) return null;
    const url = att.href || att.url || att.normalUrl;
    if (!url) return null;
    const isAudio = typeof url === "string" &&
        (url.includes(".aac") || url.includes(".m4a") || url.includes(".mp3") || url.includes(".ogg")
            || q.msgType?.includes("voice") || att.type === "voice");
    return isAudio ? url : null;
}

async function downloadToTemp(url, ext) {
    const tmpPath = path.join(process.cwd(), `src/modules/cache/ai_${Date.now()}.${ext}`);
    const res = await axios({ method: "get", url, responseType: "arraybuffer", timeout: 30000 });
    fs.writeFileSync(tmpPath, Buffer.from(res.data));
    return tmpPath;
}

function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch {}
    }
}

const CACHE_DIR = path.join(process.cwd(), "src/modules/cache");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

// ─── API calls ───────────────────────────────────────────────────────────────

async function chatCompletion(apiKey, model, messages) {
    const res = await axios.post(`${BASE_TEXT}/chat/completions`, {
        model, messages, stream: false,
    }, {
        headers: { ...authHeader(apiKey), "Content-Type": "application/json" },
        timeout: 60000,
    });
    return res.data.choices?.[0]?.message?.content?.trim() || "";
}

async function textToSpeech(apiKey, text, voice = "nova") {
    const res = await axios.post(`${BASE_AUDIO}/speech`, {
        model: "elevenlabs", input: text, voice,
    }, {
        headers: { ...authHeader(apiKey), "Content-Type": "application/json" },
        responseType: "arraybuffer",
        timeout: 60000,
    });
    return Buffer.from(res.data);
}

async function speechToText(apiKey, audioPath) {
    const form = new FormData();
    form.append("file", fs.createReadStream(audioPath), {
        filename: path.basename(audioPath),
        contentType: "audio/aac",
    });
    form.append("model", "whisper");
    form.append("language", "vi");
    const res = await axios.post(`${BASE_AUDIO}/transcriptions`, form, {
        headers: { ...authHeader(apiKey), ...form.getHeaders() },
        timeout: 60000,
    });
    return res.data?.text?.trim() || res.data?.transcript?.trim() || "";
}

// ─── Command: .ai ─────────────────────────────────────────────────────────────

async function cmdChat(ctx) {
    const { api, threadId, threadType, args, raw } = ctx;
    const apiKey = getPollinationsKey();
    if (!apiKey) return api.sendMessage({ msg: "⚠️ Chưa cấu hình pollinations.apiKey trong tokens.json!" }, threadId, threadType);

    const send = (msg) => api.sendMessage({ msg, quote: raw }, threadId, threadType);

    let model = "openai";
    let prompt = args.join(" ").trim();

    if (!prompt) {
        const quoteText = raw?.quote?.msg || raw?.quote?.content;
        if (typeof quoteText === "string" && quoteText.trim()) {
            prompt = quoteText.trim();
        } else {
            return send(`💬 Cách dùng:\n.ai [model] [câu hỏi]\n\nModel: gpt (mặc định), gemini, deepseek, mistral, coder, search, fast\nVD: .ai gemini Giải thích lượng tử\n    .ai Hà Nội có gì hay?`);
        }
    }

    const firstWord = args[0]?.toLowerCase();
    if (TEXT_MODELS[firstWord]) {
        model = TEXT_MODELS[firstWord];
        prompt = args.slice(1).join(" ").trim();
        if (!prompt) return send(`💬 Nhập nội dung sau tên model!`);
    }

    const messages = [{ role: "user", content: prompt }];
    const imgUrl = extractQuoteImageUrl(raw);
    if (imgUrl && (model === "openai" || model === "gemini-fast" || model === "openai-fast")) {
        messages[0].content = [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imgUrl } },
        ];
    }

    const thinking = await api.sendMessage({ msg: `🤖 Đang suy nghĩ...` }, threadId, threadType);

    try {
        const reply = await chatCompletion(apiKey, model, messages);
        const modelLabel = `[${model}]`;
        await api.sendMessage({ msg: `${modelLabel}\n${reply}`, quote: raw }, threadId, threadType);
    } catch (e) {
        log.error("[AI] chat error:", e.message);
        await send(`❌ Lỗi: ${e.response?.data?.error?.message || e.message}`);
    } finally {
        try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
    }
}

// ─── Command: .vẽ / .imagine ─────────────────────────────────────────────────

async function cmdImage(ctx) {
    const { api, threadId, threadType, args, raw } = ctx;
    const pollKey = getPollinationsKey();
    const send = (msg) => api.sendMessage({ msg, quote: raw }, threadId, threadType);

    let prompt = args.join(" ").trim();
    let model = "flux";

    if (!prompt) return send(
        `🖼️ Cách dùng:\n.vẽ [model] [mô tả]\n\nModel: flux (mặc định), zimage, gptimage, grok, qwen, klein\nVD: .vẽ mèo dễ thương đang ngủ\n    .vẽ gptimage cô gái anime tóc xanh`
    );

    const firstWord = args[0]?.toLowerCase();
    if (IMG_MODELS[firstWord]) {
        model = IMG_MODELS[firstWord];
        prompt = args.slice(1).join(" ").trim();
        if (!prompt) return send(`🖼️ Nhập mô tả hình ảnh sau tên model!`);
    }

    const thinking = await api.sendMessage({ msg: `🎨 Đang vẽ với ${model}...` }, threadId, threadType);
    let tmpPath = null;

    try {
        let imgBuf = null;

        const englishPrompt = await translateToEnglish(prompt);

        if (pollKey) {
            try {
                imgBuf = await pollinationsImage(pollKey, englishPrompt, model);
            } catch (e) {
                log.warn(`[AI] Pollinations image lỗi: ${e?.message || String(e) || "unknown error"} — thử kieai`);
            }
        }

        if (!imgBuf && getKieaiKey()) {
            imgBuf = await kieaiDraw(englishPrompt, { model: "flux-pro", size: "1:1" });
        }

        if (!imgBuf) throw new Error("Cả Pollinations lẫn kie.ai đều không tạo được ảnh!");

        tmpPath = path.join(CACHE_DIR, `ai_img_${Date.now()}.jpg`);
        fs.writeFileSync(tmpPath, imgBuf);
        await api.sendMessage({ msg: `🖼️ [${model}] ${prompt}`, attachments: [tmpPath], quote: raw }, threadId, threadType);
    } catch (e) {
        const msg = e.response?.data?.error?.message || e?.message || String(e) || "unknown error";
        log.error("[AI] image error:", msg);
        await send(`❌ Lỗi tạo ảnh: ${msg}`);
    } finally {
        try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
        cleanup(tmpPath);
    }
}

// ─── Command: .video ─────────────────────────────────────────────────────────

async function cmdVideo(ctx) {
    const { api, threadId, threadType, args, raw } = ctx;
    const apiKey = getPollinationsKey();
    if (!apiKey) return api.sendMessage({ msg: "⚠️ Chưa cấu hình pollinations.apiKey trong tokens.json!" }, threadId, threadType);

    const send = (msg) => api.sendMessage({ msg, quote: raw }, threadId, threadType);

    let prompt = args.join(" ").trim();
    let model = "wan-fast";

    if (!prompt) return send(
        `🎬 Cách dùng:\n.aivideo [model] [mô tả]\n\nModel: wan-fast (mặc định, 5s-480p), ltx-2\nVD: .aivideo mèo đang chơi với bóng\n⚠️ Video beta — có thể mất 30-60 giây`
    );

    const firstWord = args[0]?.toLowerCase();
    if (VIDEO_MODELS[firstWord]) {
        model = VIDEO_MODELS[firstWord];
        prompt = args.slice(1).join(" ").trim();
        if (!prompt) return send(`🎬 Nhập mô tả video sau tên model!`);
    }

    const thinking = await api.sendMessage({ msg: `🎬 Đang tạo video [${model}]... (~30-60 giây)` }, threadId, threadType);
    let tmpPath = null;

    try {
        const vidBuf = await pollinationsVideo(apiKey, prompt, model);
        tmpPath = path.join(CACHE_DIR, `ai_vid_${Date.now()}.mp4`);
        fs.writeFileSync(tmpPath, vidBuf);
        await api.sendMessage({ msg: `🎬 [${model}] ${prompt}`, attachments: [tmpPath], quote: raw }, threadId, threadType);
    } catch (e) {
        log.error("[AI] video error:", e.message);
        const msg = e.response?.status === 402
            ? `❌ Video cần credits Pollinations. Tài khoản chưa đủ credits.`
            : `❌ Lỗi tạo video: ${e.response?.data?.error?.message || e.message}`;
        await send(msg);
    } finally {
        try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
        cleanup(tmpPath);
    }
}

// ─── Command: .tts ───────────────────────────────────────────────────────────

async function cmdTTS(ctx) {
    const { api, threadId, threadType, args, raw } = ctx;
    const apiKey = getPollinationsKey();
    if (!apiKey) return api.sendMessage({ msg: "⚠️ Chưa cấu hình pollinations.apiKey trong tokens.json!" }, threadId, threadType);

    const send = (msg) => api.sendMessage({ msg, quote: raw }, threadId, threadType);

    let voice = "nova";
    let text = args.join(" ").trim();

    if (!text) {
        const quoteText = raw?.quote?.msg || raw?.quote?.content;
        if (typeof quoteText === "string" && quoteText.trim()) {
            text = quoteText.trim();
        } else {
            return send(
                `🔊 Cách dùng:\n.tts [giọng] [văn bản]\n.tts [văn bản] (giọng mặc định: nova)\nHoặc reply vào tin nhắn + .tts\n\nGiọng: nova, alloy, echo, fable, onyx, shimmer, sarah, emily, adam, josh`
            );
        }
    }

    const firstWord = args[0]?.toLowerCase();
    if (TTS_VOICES.includes(firstWord)) {
        voice = firstWord;
        text = args.slice(1).join(" ").trim();
        if (!text) return send(`🔊 Nhập văn bản sau tên giọng!`);
    }

    if (text.length > 2000) return send(`❌ Văn bản quá dài! Tối đa 2000 ký tự.`);

    const thinking = await api.sendMessage({ msg: `🔊 Đang chuyển văn bản thành giọng nói [${voice}]...` }, threadId, threadType);
    let tmpPath = null;

    try {
        const audioBuf = await textToSpeech(apiKey, text, voice);
        tmpPath = path.join(CACHE_DIR, `ai_tts_${Date.now()}.mp3`);
        fs.writeFileSync(tmpPath, audioBuf);

        await api.sendVoiceUnified({ filePath: tmpPath, threadId, threadType });
    } catch (e) {
        log.error("[AI] TTS error:", e.message);
        await send(`❌ Lỗi TTS: ${e.message}`);
    } finally {
        try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
        cleanup(tmpPath);
    }
}

// ─── Command: .stt ───────────────────────────────────────────────────────────

async function cmdSTT(ctx) {
    const { api, threadId, threadType, raw } = ctx;
    const apiKey = getPollinationsKey();
    if (!apiKey) return api.sendMessage({ msg: "⚠️ Chưa cấu hình pollinations.apiKey trong tokens.json!" }, threadId, threadType);

    const send = (msg) => api.sendMessage({ msg, quote: raw }, threadId, threadType);

    const voiceUrl = extractQuoteVoiceUrl(raw);
    if (!voiceUrl) return send(`🎤 Reply vào tin nhắn thoại rồi gõ .stt để phiên âm!`);

    const thinking = await api.sendMessage({ msg: `🎤 Đang nhận diện giọng nói...` }, threadId, threadType);
    let tmpPath = null;

    try {
        tmpPath = await downloadToTemp(voiceUrl, "aac");
        const transcript = await speechToText(apiKey, tmpPath);
        if (!transcript) return await send(`❌ Không nhận diện được nội dung.`);
        await send(`🎤 Phiên âm:\n${transcript}`);
    } catch (e) {
        log.error("[AI] STT error:", e.message);
        await send(`❌ Lỗi phiên âm: ${e.message}`);
    } finally {
        try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
        cleanup(tmpPath);
    }
}

// ─── Command: .aimodel ───────────────────────────────────────────────────────

async function cmdAiModel(ctx) {
    const { api, threadId, threadType } = ctx;
    const msg = [
        "🤖 Models Chat (dùng: .ai [model] [prompt]):",
        "  gpt / openai  — GPT-4o (mặc định)",
        "  fast          — GPT-4o Fast",
        "  gemini        — Gemini 1.5",
        "  search        — Gemini + tìm web",
        "  deepseek / ds — DeepSeek R1",
        "  mistral       — Mistral",
        "  coder         — Qwen Coder",
        "",
        "🖼️ Models Ảnh (dùng: .vẽ [model] [mô tả]):",
        "  flux          — Flux Schnell (nhanh, mặc định)",
        "  zimage        — Z-Image Turbo",
        "  gptimage      — GPT Image 1 Mini",
        "  grok          — Grok Imagine",
        "  qwen          — Qwen Image",
        "  klein         — FLUX.2 Klein",
        "  (fallback → kie.ai nếu Pollinations lỗi)",
        "",
        "🎬 Models Video (dùng: .aivideo [model] [mô tả]):",
        "  wan-fast      — Wan 2.2 (5s, 480p, mặc định)",
        "  ltx-2         — LTX-2",
        "",
        "🔊 TTS: .tts [giọng] [text]",
        "  Giọng: nova, alloy, echo, fable, onyx, shimmer...",
        "",
        "🎤 STT: Reply vào tin nhắn thoại → .stt",
    ].join("\n");
    await api.sendMessage({ msg }, threadId, threadType);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const commands = {
    ai: cmdChat,
    chat: cmdChat,
    gpt: cmdChat,
    "vẽ": cmdImage,
    ve: cmdImage,
    imagine: cmdImage,
    img: cmdImage,
    aivideo: cmdVideo,
    aivid: cmdVideo,
    tts: cmdTTS,
    doc: cmdTTS,
    stt: cmdSTT,
    aimodel: cmdAiModel,
    aihelp: cmdAiModel,
};
