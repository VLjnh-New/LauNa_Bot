import { fs, path, axios } from "../globals.js";
import { drawTokenStatus } from "../utils/canvas/canvasHelper.js";
import { uploadToTmpFiles } from "../utils/core/tmpFiles.js";
import { readJSON, writeJSON } from "../utils/core/io-json.js";

export const name = "token";
export const description = "Quản lý toàn bộ token/API key: check, thêm, xóa. Tự nhận dạng loại key khi thêm mới.";

// ── Đường dẫn file ────────────────────────────────────────────────────────────
const TOKEN_PATH = path.join(process.cwd(), "src/data/tokens.json");

function loadTokens() {
    return readJSON(TOKEN_PATH) || {};
}
function saveTokens(data) {
    writeJSON(TOKEN_PATH, data);
}

const OK   = "✅";
const FAIL = "❌";
const SKIP = "⚠️";

function maskKey(key) {
    if (!key || key.length < 8) return "***";
    return key.slice(0, 6) + "..." + key.slice(-4);
}

// ── Nhận dạng dịch vụ theo pattern key ───────────────────────────────────────
const KEY_PATTERNS = [
    { service: "gemini",       field: "geminiKeys",      test: k => k.startsWith("AIzaSy") },
    { service: "openrouter",   field: "openrouterKeys",  test: k => k.startsWith("sk-or-v1-") },
    { service: "groq",         field: "groqKeys",        test: k => k.startsWith("gsk_") },
    { service: "huggingface",  field: "huggingfaceKeys", test: k => k.startsWith("hf_") },
    { service: "cloudflare",   field: "cloudflare",      test: k => k.startsWith("cfut_") || (k.length === 40 && /^[a-zA-Z0-9_-]+$/.test(k) && !k.startsWith("rK")) },
    { service: "cohere",       field: "cohereKeys",      test: k => /^[a-zA-Z0-9]{40}$/.test(k) && k.startsWith("rK") },
    { service: "mistral",      field: "mistralKeys",     test: k => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k) },
    { service: "pixverse",     field: "pixverse",        test: k => k.startsWith("sk-") && !k.startsWith("sk-or-v1-") },
];

function detectService(key) {
    for (const p of KEY_PATTERNS) {
        if (p.test(key)) return p;
    }
    return null;
}

// ── Lưu key vào tokens.json theo loại field ──────────────────────────────────
function saveKeyToTokens(tk, pattern, key) {
    switch (pattern.field) {
        case "cloudflare":
            if (!tk.cloudflare) tk.cloudflare = { tokens: [], accountId: "" };
            if (!tk.cloudflare.tokens) tk.cloudflare.tokens = [];
            if (tk.cloudflare.tokens.includes(key)) return "Key đã tồn tại";
            tk.cloudflare.tokens.push(key);
            break;
        case "pixverse":
            if (!tk.pixverse) tk.pixverse = {};
            tk.pixverse.token = key;
            break;
        default:
            if (!tk[pattern.field]) tk[pattern.field] = [];
            if (tk[pattern.field].includes(key)) return `Key đã tồn tại trong ${pattern.service}`;
            tk[pattern.field].push(key);
    }
    return null;
}

// ── Thêm key vào đúng field ───────────────────────────────────────────────────
function addKey(key) {
    const pattern = detectService(key);
    if (!pattern) return { ok: false, msg: "Không nhận dạng được loại key. Hãy chỉ định: token add <dịch_vụ> <key>" };

    const tk = loadTokens();
    const err = saveKeyToTokens(tk, pattern, key);
    if (err) return { ok: false, msg: err };
    saveTokens(tk);

    return { ok: true, msg: `Đã thêm key vào **${pattern.service}** (${maskKey(key)})` };
}

function addKeyToService(service, key) {
    const svc = service.toLowerCase();
    const pattern = KEY_PATTERNS.find(p => p.service === svc);
    if (!pattern) return { ok: false, msg: `Không tìm thấy dịch vụ: ${service}\nCác dịch vụ: ${KEY_PATTERNS.map(p => p.service).join(", ")}` };

    const tk = loadTokens();
    const err = saveKeyToTokens(tk, pattern, key);
    if (err) return { ok: false, msg: err };
    saveTokens(tk);

    return { ok: true, msg: `Đã thêm key vào **${pattern.service}** (${maskKey(key)})` };
}

function delKey(service, indexOrKey) {
    const svc = service.toLowerCase();
    const pattern = KEY_PATTERNS.find(p => p.service === svc);
    if (!pattern) return { ok: false, msg: `Không tìm thấy dịch vụ: ${service}\nCác dịch vụ: ${KEY_PATTERNS.map(p => p.service).join(", ")}` };

    const tk = loadTokens();

    if (pattern.field === "cloudflare") {
        const arr = tk.cloudflare?.tokens || [];
        const idx = isNaN(indexOrKey) ? arr.findIndex(k => k.includes(indexOrKey)) : parseInt(indexOrKey) - 1;
        if (idx < 0 || idx >= arr.length) return { ok: false, msg: "Không tìm thấy key" };
        const removed = arr.splice(idx, 1)[0];
        tk.cloudflare.tokens = arr;
        saveTokens(tk);
        return { ok: true, msg: `Đã xóa key Cloudflare: ${maskKey(removed)}` };
    }
    if (pattern.field === "pixverse") {
        const old = tk.pixverse?.token || "";
        if (!old) return { ok: false, msg: "Chưa có key Pixverse" };
        tk.pixverse.token = "";
        saveTokens(tk);
        return { ok: true, msg: `Đã xóa key Pixverse: ${maskKey(old)}` };
    }

    const arr = tk[pattern.field] || [];
    const idx = isNaN(indexOrKey) ? arr.findIndex(k => k.includes(indexOrKey)) : parseInt(indexOrKey) - 1;
    if (idx < 0 || idx >= arr.length) return { ok: false, msg: "Không tìm thấy key" };
    const removed = arr.splice(idx, 1)[0];
    tk[pattern.field] = arr;
    saveTokens(tk);
    return { ok: true, msg: `Đã xóa key ${pattern.service}: ${maskKey(removed)}` };
}

function listKeys() {
    const tk = loadTokens();

    const lines = ["[ 🗝️ DANH SÁCH KEY ]\n" + "─".repeat(32)];
    const listArr = (label, arr) => {
        if (!arr?.length) return `  ${label}: ${SKIP}`;
        return arr.map((k, i) => `  ${label}[${i + 1}]: ${maskKey(k)}`).join("\n");
    };

    lines.push("📌 tokens.json");
    lines.push(`  pixverse    : ${tk.pixverse?.token ? maskKey(tk.pixverse.token) : SKIP}`);
    lines.push(`  pollinations: ${tk.pollinations?.apiKey ? maskKey(tk.pollinations.apiKey) : SKIP}`);
    lines.push(`  kieai       : ${tk.kieai?.apiKey ? maskKey(tk.kieai.apiKey) : SKIP}`);
    lines.push(`  removebg    : ${tk.removebg?.apiKey ? maskKey(tk.removebg.apiKey) : SKIP}`);
    lines.push(`  sightengine : ${tk.antinude?.sightengine_user ? `user: ${tk.antinude.sightengine_user}` : SKIP}`);
    lines.push("─".repeat(32));
    lines.push(listArr("gemini      ", tk.geminiKeys));
    lines.push(listArr("openrouter  ", tk.openrouterKeys));
    lines.push(listArr("groq        ", tk.groqKeys));
    lines.push(listArr("mistral     ", tk.mistralKeys));
    lines.push(listArr("cohere      ", tk.cohereKeys));
    lines.push(listArr("huggingface ", tk.huggingfaceKeys));
    lines.push(listArr("cloudflare  ", tk.cloudflare?.tokens || []));

    lines.push("─".repeat(32));
    lines.push(`Dùng: .token add <key> | .token del <dịch_vụ> <số|chuỗi_tìm>`);

    return lines.join("\n");
}

// ── Kiểm tra token ────────────────────────────────────────────────────────────
async function checkZalo(api) {
    try { return { status: OK, detail: `ID: ${api.getOwnId()}` }; }
    catch (e) { return { status: FAIL, detail: e.message }; }
}

async function checkPixverse(token) {
    if (!token) return { status: SKIP, detail: "Chưa cấu hình" };
    try {
        const headers = { "API-KEY": token, "Content-Type": "application/json" };
        const res = await axios.get("https://app-api.pixverse.ai/openapi/v2/video/result/1", {
            headers, timeout: 8000, validateStatus: s => true,
        });
        const errCode = res.data?.ErrCode;
        if (errCode === 10004) return { status: FAIL, detail: "API Key trống hoặc không hợp lệ" };
        if (errCode === 10001) return { status: FAIL, detail: "API Key không được phép (unauthorized)" };

        try {
            const cr = await axios.get("https://app-api.pixverse.ai/openapi/v2/account/credit/detail", {
                headers, timeout: 8000, validateStatus: s => true,
            });
            if (cr.data?.ErrCode === 0) {
                const r = cr.data.Resp || {};
                const credits = r.remain_credits ?? r.credits ?? r.total ?? null;
                if (credits !== null) return { status: OK, detail: `${maskKey(token)} • credits: ${credits}` };
            }
        } catch { }

        return { status: OK, detail: maskKey(token) };
    } catch (e) { return { status: FAIL, detail: e.message }; }
}

async function checkCloudinary(cfg) {
    if (!cfg?.cloud) return { status: SKIP, detail: "Chưa cấu hình" };
    if (!cfg?.preset) return { status: SKIP, detail: `cloud: ${cfg.cloud} — chưa có upload preset` };
    try {
        const tiny = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        const form = new URLSearchParams();
        form.append("file", tiny);
        form.append("upload_preset", cfg.preset);
        const res = await axios.post(
            `https://api.cloudinary.com/v1_1/${cfg.cloud}/image/upload`,
            form.toString(),
            { headers: { "Content-Type": "application/x-www-form-urlencoded" }, timeout: 12000, validateStatus: s => true }
        );
        if (res.status === 200 && res.data?.public_id)
            return { status: OK, detail: `cloud: ${cfg.cloud} • preset: ${cfg.preset}` };
        const errMsg = res.data?.error?.message || `HTTP ${res.status}`;
        if (errMsg.includes("upload preset")) return { status: FAIL, detail: `Preset không hợp lệ: ${cfg.preset}` };
        if (errMsg.includes("cloud")) return { status: FAIL, detail: `Cloud name không hợp lệ: ${cfg.cloud}` };
        return { status: FAIL, detail: errMsg };
    } catch (e) { return { status: FAIL, detail: e.message }; }
}

// verifyFn phải trả về: null (OK) hoặc string lý do lỗi
async function checkMultiKey(keys, verifyFn) {
    if (!keys?.length) return { status: SKIP, detail: "Chưa cấu hình" };
    let ok = 0;
    const failReasons = [];
    for (const key of keys) {
        try {
            const reason = await verifyFn(key);
            if (reason === null) { ok++; }
            else { failReasons.push(reason); }
        } catch (e) { failReasons.push(e.message?.slice(0, 40) || "lỗi"); }
    }
    const fail = failReasons.length;
    if (ok === 0) {
        const uniq = [...new Set(failReasons)].join(" / ");
        return { status: FAIL, detail: `${fail}/${keys.length} key lỗi — ${uniq}` };
    }
    if (fail > 0) {
        const uniq = [...new Set(failReasons)].join(" / ");
        return { status: SKIP, detail: `${ok} OK / ${fail} lỗi (${uniq})` };
    }
    return { status: OK, detail: `${ok}/${keys.length} key hợp lệ` };
}

async function checkGemini(keys) {
    return checkMultiKey(keys, async k => {
        const res = await axios.get(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`,
            { timeout: 8000, validateStatus: s => true }
        );
        if (res.status === 200) return null;
        const msg = res.data?.error?.message || "";
        if (msg.includes("leaked")) return "Key bị báo cáo leaked";
        if (res.status === 403) return "Không có quyền truy cập (403)";
        if (res.status === 400) return "Key không đúng định dạng";
        if (res.status === 401) return "Key không hợp lệ";
        return `HTTP ${res.status}`;
    });
}

async function checkOpenRouter(keys) {
    return checkMultiKey(keys, async k => {
        const res = await axios.get("https://openrouter.ai/api/v1/auth/key", {
            headers: { Authorization: `Bearer ${k}` }, timeout: 8000, validateStatus: s => true,
        });
        if (res.status === 200) return null;
        const msg = res.data?.error?.message || "";
        if (res.status === 401) return msg.includes("not found") ? "Key không tồn tại" : "Key không hợp lệ";
        if (res.status === 429) return "Vượt rate limit";
        return `HTTP ${res.status}`;
    });
}

async function checkGroq(keys) {
    return checkMultiKey(keys, async k => {
        const res = await axios.get("https://api.groq.com/openai/v1/models", {
            headers: { Authorization: `Bearer ${k}` }, timeout: 8000, validateStatus: s => true,
        });
        if (res.status === 200) return null;
        const msg = res.data?.error?.message || "";
        if (msg.includes("restricted")) return "Tài khoản bị restricted";
        if (res.status === 401) return "Key không hợp lệ";
        if (res.status === 400) return "Key bị vô hiệu hóa/restricted";
        if (res.status === 429) return "Vượt rate limit";
        return `HTTP ${res.status}`;
    });
}

async function checkMistral(keys) {
    return checkMultiKey(keys, async k => {
        const res = await axios.get("https://api.mistral.ai/v1/models", {
            headers: { Authorization: `Bearer ${k}` }, timeout: 8000, validateStatus: s => true,
        });
        if (res.status === 200) return null;
        if (res.status === 401) return "Key không hợp lệ hoặc hết hạn";
        if (res.status === 429) return "Vượt rate limit";
        return `HTTP ${res.status}`;
    });
}

async function checkCloudflare(cfg) {
    const tokens = cfg?.tokens || [];
    const accountId = cfg?.accountId;
    if (!tokens.length) return { status: SKIP, detail: "Chưa cấu hình" };
    let ok = 0, fail = 0;
    for (const token of tokens) {
        try {
            const res = await axios.get("https://api.cloudflare.com/client/v4/user/tokens/verify", {
                headers: { Authorization: `Bearer ${token}` }, timeout: 8000, validateStatus: s => true,
            });
            if (res.data?.success) { ok++; continue; }
            if (accountId) {
                const r2 = await axios.get(
                    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search?per_page=1`,
                    { headers: { Authorization: `Bearer ${token}` }, timeout: 8000, validateStatus: s => true }
                );
                if (r2.data?.success) { ok++; continue; }
            }
            fail++;
        } catch { fail++; }
    }
    if (ok === 0) return { status: FAIL, detail: `${fail}/${tokens.length} token không hợp lệ` };
    if (fail > 0) return { status: SKIP, detail: `${ok} OK / ${fail} lỗi` };
    return { status: OK, detail: `${ok}/${tokens.length} token OK${accountId ? ` • acc: ${accountId.slice(0, 8)}...` : ""}` };
}

async function checkCohere(keys) {
    return checkMultiKey(keys, async k => {
        const res = await axios.get("https://api.cohere.com/v1/models", {
            headers: { Authorization: `Bearer ${k}` }, timeout: 8000, validateStatus: s => true,
        });
        if (res.status === 200) return null;
        if (res.status === 401) return "Key không hợp lệ";
        if (res.status === 429) return "Vượt rate limit";
        return `HTTP ${res.status}`;
    });
}

async function checkHuggingFace(keys) {
    return checkMultiKey(keys, async k => {
        const res = await axios.get("https://huggingface.co/api/whoami-v2", {
            headers: { Authorization: `Bearer ${k}` }, timeout: 8000, validateStatus: s => true,
        });
        if (res.status === 200) return null;
        if (res.status === 401) return "Key không hợp lệ";
        const err = res.data?.error || "";
        return err || `HTTP ${res.status}`;
    });
}

async function checkPollinations(apiKey) {
    if (!apiKey) return { status: SKIP, detail: "Chưa cấu hình" };
    try {
        const res = await axios.get("https://gen.pollinations.ai/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 8000, validateStatus: s => true,
        });
        if (res.status === 200) return { status: OK, detail: maskKey(apiKey) };
        if (res.status === 401) return { status: FAIL, detail: "API Key không hợp lệ" };
        return { status: FAIL, detail: `HTTP ${res.status}` };
    } catch (e) { return { status: FAIL, detail: e.message }; }
}

async function checkKieai(apiKey) {
    if (!apiKey) return { status: SKIP, detail: "Chưa cấu hình" };
    try {
        const res = await axios.get("https://api.kie.ai/api/v1/flux-pro/task/list?page=1&size=1", {
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            timeout: 8000, validateStatus: s => true,
        });
        if (res.status === 200 || res.data?.code === 0) return { status: OK, detail: maskKey(apiKey) };
        if (res.status === 401 || res.data?.code === 401) return { status: FAIL, detail: "API Key không hợp lệ hoặc hết hạn" };
        return { status: OK, detail: maskKey(apiKey) };
    } catch (e) { return { status: FAIL, detail: e.message }; }
}

async function checkRemovebg(apiKey) {
    if (!apiKey) return { status: SKIP, detail: "Chưa cấu hình" };
    try {
        const res = await axios.get("https://api.remove.bg/v1.0/account", {
            headers: { "X-Api-Key": apiKey },
            timeout: 8000, validateStatus: s => true,
        });
        if (res.status === 200) {
            const credits = res.data?.data?.credits?.total ?? null;
            return { status: OK, detail: `${maskKey(apiKey)}${credits !== null ? ` • credits: ${credits}` : ""}` };
        }
        if (res.status === 401 || res.status === 403) return { status: FAIL, detail: "API Key không hợp lệ" };
        return { status: FAIL, detail: `HTTP ${res.status}` };
    } catch (e) { return { status: FAIL, detail: e.message }; }
}

async function checkSightengine(cfg) {
    const user   = cfg?.sightengine_user;
    const secret = cfg?.sightengine_secret;
    if (!user || !secret) return { status: SKIP, detail: "Chưa cấu hình" };
    try {
        // Dùng check.json với ảnh test nhỏ — nếu auth sai sẽ trả error.type = "auth_error"
        const { default: FormData } = await import("form-data");
        const form = new FormData();
        form.append("url", "https://picsum.photos/10/10");
        form.append("models", "nudity-2.1");
        form.append("api_user", user);
        form.append("api_secret", secret);
        const res = await axios.post("https://api.sightengine.com/1.0/check.json", form, {
            headers: form.getHeaders(),
            timeout: 10000, validateStatus: s => true,
        });
        const d = res.data;
        if (d?.error?.type === "auth_error") return { status: FAIL, detail: "api_user hoặc api_secret không hợp lệ" };
        if (d?.status === "success" || d?.nudity) return { status: OK, detail: `user: ${user}` };
        // Nếu request_id có, nghĩa là auth OK nhưng có lỗi khác (ảnh lỗi, model, v.v.)
        if (d?.request?.id) return { status: OK, detail: `user: ${user}` };
        return { status: FAIL, detail: d?.error?.message || `HTTP ${res.status}` };
    } catch (e) { return { status: FAIL, detail: e.message }; }
}

async function runCheck(api, tk) {
    const [
        zalo, pixverse, cloudinary, pollinations, kieai, removebg, sightengine,
        gemini, openrouter, groq, mistral, cloudflare, cohere, huggingface,
    ] = await Promise.all([
        checkZalo(api),
        checkPixverse(tk.pixverse?.token),
        checkCloudinary(tk.cloudinary),
        checkPollinations(tk.pollinations?.apiKey),
        checkKieai(tk.kieai?.apiKey),
        checkRemovebg(tk.removebg?.apiKey),
        checkSightengine(tk.antinude),
        checkGemini(tk.geminiKeys),
        checkOpenRouter(tk.openrouterKeys),
        checkGroq(tk.groqKeys),
        checkMistral(tk.mistralKeys),
        checkCloudflare(tk.cloudflare),
        checkCohere(tk.cohereKeys),
        checkHuggingFace(tk.huggingfaceKeys),
    ]);

    const now = new Date().toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", hour12: false });

    const LABELS = [
        ["Zalo Cookies", zalo],
        ["Pixverse",     pixverse],
        ["Cloudinary",   cloudinary],
        ["Pollinations", pollinations],
        ["KieAI",        kieai],
        ["Remove.bg",    removebg],
        ["Sightengine",  sightengine],
        ["Gemini",       gemini],
        ["OpenRouter",   openrouter],
        ["Groq",         groq],
        ["Mistral",      mistral],
        ["Cloudflare",   cloudflare],
        ["Cohere",       cohere],
        ["HuggingFace",  huggingface],
    ];

    const items = LABELS.map(([label, r]) => ({ label, status: r.status, detail: r.detail }));
    const okCount   = items.filter(r => r.status === OK).length;
    const failCount = items.filter(r => r.status === FAIL).length;
    const skipCount = items.filter(r => r.status === SKIP).length;

    if (failCount > 0) console.warn(`[token] ${failCount} token/key có vấn đề!`);
    return { items, okCount, failCount, skipCount, timestamp: now };
}

// ── Help ──────────────────────────────────────────────────────────────────────
const HELP =
    `[ 🔑 QUẢN LÝ TOKEN ]\n` +
    `${"─".repeat(30)}\n` +
    `.token            — Kiểm tra toàn bộ key\n` +
    `.token list       — Xem danh sách key\n` +
    `.token add <key>  — Thêm key (tự nhận dạng)\n` +
    `.token add <dịch_vụ> <key> — Thêm thủ công\n` +
    `.token del <dịch_vụ> <số|chuỗi> — Xóa key\n` +
    `${"─".repeat(30)}\n` +
    `Dịch vụ: ${KEY_PATTERNS.map(p => p.service).join(", ")}`;

// ── Export ────────────────────────────────────────────────────────────────────
export const commands = {
    token: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;
        const send = (msg) => api.sendMessage({ msg }, threadId, threadType);

        const sub = (args?.[0] || "").toLowerCase();

        // .token hoặc .token check → kiểm tra tất cả
        if (!sub || sub === "check") {
            await send("🔍 Đang kiểm tra tất cả token/API key...");
            const tk   = loadTokens();
            const data = await runCheck(api, tk);

            try {
                const buffer   = await drawTokenStatus(data);
                const imgPath  = path.join(process.cwd(), `token_status_${Date.now()}.png`);
                fs.writeFileSync(imgPath, buffer);
                const imgUrl   = await uploadToTmpFiles(imgPath, api, threadId, threadType);
                await api.sendImageEnhanced({ imageUrl: imgUrl, threadId, threadType, width: 920, height: 110 + data.items.length * 58 + 72 });
                if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
            } catch (canvasErr) {
                const line = (item) => `${item.status} ${item.label}\n   └ ${item.detail}`;
                const textMsg =
                    `[ 🔐 KIỂM TRA TOKEN / API KEY ]\n` +
                    `${"─".repeat(34)}\n` +
                    data.items.map(line).join("\n") +
                    `\n${"─".repeat(34)}\n` +
                    `✅ ${data.okCount}  ❌ ${data.failCount}  ⚠️ ${data.skipCount}\n` +
                    `🕐 ${data.timestamp}`;
                await send(textMsg);
            }
            return;
        }

        // .token list → danh sách
        if (sub === "list") {
            return await send(listKeys());
        }

        // .token add <key> hoặc .token add <dịch_vụ> <key>
        if (sub === "add") {
            const a1 = args?.[1];
            const a2 = args?.[2];
            if (!a1) return await send("❌ Thiếu key. Dùng: .token add <key>");

            let result;
            if (a2) {
                result = addKeyToService(a1, a2);
            } else {
                result = addKey(a1);
            }
            return await send(result.ok ? `${OK} ${result.msg}` : `${FAIL} ${result.msg}`);
        }

        // .token del <dịch_vụ> <số|chuỗi>
        if (sub === "del" || sub === "xoa" || sub === "xóa") {
            const service = args?.[1];
            const target  = args?.[2];
            if (!service || !target)
                return await send("❌ Thiếu thông tin. Dùng: .token del <dịch_vụ> <số thứ tự hoặc chuỗi key>");
            const result = delKey(service, target);
            return await send(result.ok ? `${OK} ${result.msg}` : `${FAIL} ${result.msg}`);
        }

        // Không khớp lệnh nào
        return await send(HELP);
    },
};
