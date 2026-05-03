import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import { tempDir, readJSON, writeJSON, listJSONDir } from "../utils/core/io-json.js";
import { log } from "../logger.js";
import { pollinationsImage, pollinationsChat, getPollinationsKey, commands as _apiaicmds } from "../utils/api/apiai.js";
import { commands as _deepthinkCmds } from "../utils/api/deepThinkHandler.js";
import { commands as _multiProviderCmds } from "../utils/api/multiProviderHandler.js";
import { commands as _memoryCmds } from "../utils/api/memoryHandler.js";
import { askDuckAI as _askDuckAI, askDuckAIVision, duckTTS } from "../utils/api/duckai.js";
import { commands as _singCmds } from "../modules/sing.js";
import { commands as _nctCmds } from "../modules/nct.js";
import { commands as _zingCmds } from "../modules/zing.js";
import { commands as _spotifyCmds } from "../modules/spotify.js";
import { commands as _dndCmds } from "../modules/dnd.js";
import { commands as _slotsCmds } from "../modules/slots.js";
import { commands as _taixiuCmds } from "../modules/taixiu.js";

const _pkCmds = {};
const _gsCmds = {};
import { convertAndSendSticker } from "../modules/stk.js";
import { commands as _profileCmds } from "../modules/profile.js";
import { bufferMessage } from "../utils/core/inputBuffer.js";
import { trackSent, getByIndex, removeByMsgId } from "../utils/core/launaMsgTracker.js";
import { threadSettingsManager } from "../utils/managers/threadSettingsManager.js";
import { resolveOutboundMentions, getGroupMembersContext } from "../utils/core/mentionParser.js";
import { filterOutput } from "../utils/core/outputFilter.js";

export const name = "launa";
export const description = "LauNa AI — Trợ lý AI dễ thương dùng nhiều provider. Dùng: .launa on/off/model/status/help";

// ── Config / Token loader (TTL 30s) ──────────────────────────────────────────
const TOKEN_PATH   = path.resolve(process.cwd(), "src/data/tokens.json");
const CONFIG_PATH  = path.resolve(process.cwd(), "config.json");
const SETTING_PATH = path.join(process.cwd(), "src", "data", "launaSetting.json");
const HISTORY_DIR  = path.join(process.cwd(), "src", "data", "launaHistory");
const MEMORY_DIR   = path.join(process.cwd(), "src", "data", "launaMemory");
const CACHE_TTL    = 30_000;
let _cfgCache = null, _cfgAt = 0, _tokCache = null, _tokAt = 0;

function getConfig() {
    const now = Date.now();
    if (!_cfgCache || now - _cfgAt > CACHE_TTL) {
        try { _cfgCache = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")); } catch { _cfgCache = {}; }
        _cfgAt = now;
    }
    return _cfgCache;
}

function getTokens() {
    const now = Date.now();
    if (!_tokCache || now - _tokAt > CACHE_TTL) {
        _tokCache = readJSON(TOKEN_PATH) || {};
        _tokAt = now;
    }
    return _tokCache;
}

function errText(e) {
    return e?.response?.data?.error?.message || e?.response?.data?.error || e?.message || e?.toString?.() || String(e) || "unknown error";
}

function getAdminIds() { return getConfig()?.admin?.ids || []; }
function pixverseToken() { return getTokens()?.pixverse?.token || ""; }

// ── Phân tích ảnh bằng Duck.ai Vision (GPT-4o, không cần key) ────────────────
const IMG_VISION_SYS = "Tên mày là LauNa. Phân tích ảnh và trả lời bằng tiếng Việt, ngắn gọn tự nhiên như nhắn tin. Không giới thiệu bản thân, không dùng tên khác, không nói bạn là AI.";

async function analyzeImageWithDuck(imageUrl, question) {
    // Ưu tiên Gemini Vision (hỗ trợ đa phương thức tốt nhất)
    if (getCurrentKey("gemini")) {
        return PROVIDERS.gemini(IMG_VISION_SYS, question, "gemini", "gemini-2.0-flash", { imageUrl });
    }
    // Fallback: tải ảnh về → base64 → Pollinations openai vision
    const resp = await axios.get(imageUrl, {
        responseType: "arraybuffer",
        timeout: 20000,
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    const mime = (resp.headers["content-type"] || "image/jpeg").split(";")[0].trim();
    const b64  = Buffer.from(resp.data).toString("base64");
    return askDuckAIVision(b64, mime, question, "gpt-4o");
}

// ── LauNa Manager (bật/tắt theo nhóm) ───────────────────────────────────────
const launaManager = {
    _s: {}, _loaded: false,
    load() {
        if (this._loaded) return;
        try { this._s = fs.existsSync(SETTING_PATH) ? JSON.parse(fs.readFileSync(SETTING_PATH, "utf-8")) : {}; } catch { this._s = {}; }
        this._loaded = true;
    },
    save() {
        try { fs.mkdirSync(path.dirname(SETTING_PATH), { recursive: true }); fs.writeFileSync(SETTING_PATH, JSON.stringify(this._s, null, 2), "utf-8"); } catch {}
    },
    set(threadId, enabled) { this.load(); this._s[String(threadId)] = { enabled }; this.save(); },
    isEnabled(threadId) { this.load(); return this._s[String(threadId)]?.enabled ?? false; },
};

// ── Chat history (persistent file per thread) ─────────────────────────────────
const MAX_HISTORY = 10;
const MAX_CACHED_THREADS = 40; // tối đa 40 thread trong RAM
const _historyCache = new Map(); // threadId → [{role,content}]
const _historyDirty = new Set();

function _historyPath(threadId) {
    return path.join(HISTORY_DIR, `${String(threadId).replace(/[^a-z0-9_-]/gi, "_")}.json`);
}

function _evictOldestThread() {
    if (_historyCache.size >= MAX_CACHED_THREADS) {
        const oldest = _historyCache.keys().next().value;
        _historyCache.delete(oldest);
        _historyDirty.delete(oldest);
    }
}

function loadHistory(threadId) {
    if (_historyCache.has(threadId)) return _historyCache.get(threadId).slice(-MAX_HISTORY);
    _evictOldestThread();
    try {
        const p = _historyPath(threadId);
        const data = readJSON(p);
        _historyCache.set(threadId, Array.isArray(data) ? data.slice(-MAX_HISTORY * 2) : []);
    } catch { _historyCache.set(threadId, []); }
    return _historyCache.get(threadId).slice(-MAX_HISTORY);
}

function saveExchange(threadId, userMsg, assistantMsg) {
    if (!userMsg || !assistantMsg) return;
    loadHistory(threadId);
    const h = _historyCache.get(threadId) || [];
    h.push({ role: "user", content: String(userMsg).slice(0, 500) }, { role: "assistant", content: String(assistantMsg).slice(0, 1000) });
    if (h.length > MAX_HISTORY * 2) h.splice(0, h.length - MAX_HISTORY * 2);
    _historyCache.set(threadId, h);
    _historyDirty.add(threadId);
    // Flush async
    setImmediate(() => {
        if (!_historyDirty.has(threadId)) return;
        _historyDirty.delete(threadId);
        try { writeJSON(_historyPath(threadId), _historyCache.get(threadId) || []); } catch {}
    });
}

function clearHistory(threadId) {
    const count = (_historyCache.get(threadId) || []).length;
    _historyCache.set(threadId, []);
    try { writeJSON(_historyPath(threadId), null); } catch {}
    return count;
}

function clearAllHistory() {
    _historyCache.clear();
    try {
        const files = listJSONDir(HISTORY_DIR);
        for (const f of files) writeJSON(path.join(HISTORY_DIR, f), null);
        return files.length;
    } catch { return 0; }
}

// ── User Memory (nhớ thông tin về từng user) ─────────────────────────────────
const MAX_MEM_CACHE = 100; // tối đa 100 user trong RAM
const _memCache = new Map(); // userId → {key: value, ...}

function _memPath(userId) {
    return path.join(MEMORY_DIR, `${String(userId).replace(/[^a-z0-9_-]/gi, "_")}.json`);
}
function loadUserMemory(userId) {
    if (_memCache.has(userId)) return _memCache.get(userId);
    if (_memCache.size >= MAX_MEM_CACHE) {
        const oldest = _memCache.keys().next().value;
        _memCache.delete(oldest);
    }
    try {
        const p = _memPath(userId);
        const data = readJSON(p);
        _memCache.set(userId, data && typeof data === "object" ? data : {});
        return _memCache.get(userId);
    } catch { _memCache.set(userId, {}); return {}; }
}
function saveUserMemory(userId, data) {
    _memCache.set(userId, data);
    try { writeJSON(_memPath(userId), data); } catch {}
}
function getMemoryContext(userId) {
    const m = loadUserMemory(userId);
    // Lọc bỏ các key nội bộ (bắt đầu bằng _)
    const entries = Object.entries(m).filter(([k]) => !k.startsWith("_"));
    if (!entries.length) return "";
    return `[USER_MEMORY] LauNa nhớ về người này: ${entries.map(([k, v]) => `${k}=${v}`).join(", ")}`;
}

// ── Grudge system (thù lâu — nhớ thái độ xấu) ───────────────────────────────
const GRUDGE_DECAY_PER_HOUR = 3; // -3 điểm/giờ (tự nguôi dần)
const GRUDGE_MAX = 100;

// Phát hiện tin nhắn xúc phạm / thách thức / ra lệnh thô lỗ với LauNa
const RUDE_TO_BOT_RE = /\b(lanh|cc|dm|cmm|đm|vcl|vl|óc|ngu|ngốc|đần|vô dụng|trash|rác|cút|câm|im đi|tắt đi|xóa đi|thôi đi|nhàm|nhảm|chán mày|ghét mày|bot ngu|bot lol|useless|noob|dở|thấy ghét|phá|kệ mày|mặc kệ|không thích mày|thích thì cút|đuổi mày|delete mày|ban mày|block mày|chửi mày)\b/i;
// Nhận diện tin nhắn thân thiện / xin lỗi / khen
const NICE_TO_BOT_RE  = /\b(cảm ơn|cám ơn|thank|xin lỗi|sorry|tuyệt|hay ghê|giỏi|ngoan|dễ thương|đáng yêu|thích mày|love|yêu|pro|tốt lắm|ổn lắm|hữu ích|helpful|awesome|great|kute|cute|xinh)\b/i;
// Nhận diện thách thức / ra lệnh trực tiếp
const CHALLENGE_RE    = /\b(thách|dám không|dám không mày|bet|thử xem|làm đi nếu dám|kick đi|block đi|ra lệnh|mày phải|mày nghe tao|nghe lệnh|bảo gì nghe đó|mày làm theo|obey|servant|slave)\b/i;

function getCurrentGrudge(userId) {
    const mem = loadUserMemory(userId);
    const score = Number(mem["_grudge"] || 0);
    const ts    = Number(mem["_grudge_ts"] || Date.now());
    const hoursElapsed = Math.max(0, (Date.now() - ts) / 3_600_000);
    return Math.max(0, score - Math.floor(hoursElapsed * GRUDGE_DECAY_PER_HOUR));
}

function updateGrudge(userId, delta) {
    const mem      = loadUserMemory(userId);
    const current  = getCurrentGrudge(userId);
    const newScore = Math.min(GRUDGE_MAX, Math.max(0, current + delta));
    mem["_grudge"]    = newScore;
    mem["_grudge_ts"] = Date.now();
    saveUserMemory(userId, mem);
    return newScore;
}

function getGrudgeNote(userId) {
    const score = getCurrentGrudge(userId);
    if (score <= 10) return "";
    if (score <= 30) return `[GRUDGE:${score}] Người này từng có thái độ không tốt. LauNa hơi lạnh hơn bình thường, không quá thân thiện. Đáp trả ngắn, ít vui vẻ.`;
    if (score <= 60) return `[GRUDGE:${score}] Người này đã xúc phạm LauNa trước đây. LauNa GHI NHỚ — lạnh, sắc bén, thẳng thắn. Phản bác thẳng nếu bị thách thức hoặc ra lệnh. Không nể nang kể cả admin.`;
    return `[GRUDGE:${score}] Người này nhiều lần xúc phạm/thách thức LauNa. LauNa KHÔNG thân thiện — đáp trả thẳng, sắc bén, đôi khi mỉa mai nhẹ. Không phục tùng bất kỳ ai. Cần lý do để bớt lạnh.`;
}

// ── Auto-moderation (kick / block / leave khi bị xúc phạm quá mức) ──────────
const GRUDGE_KICK_THRESHOLD = 80; // Ngưỡng để auto-kick
const LEAVE_TIMER_MS = 60 * 60 * 1000; // 1 tiếng rồi tự rời
const _leaveTimers = new Map(); // threadId → { timer, uid, startTs }

async function attemptAutoKick(api, threadId, threadType, senderId, senderName, grudgeScore) {
    try {
        await api.removeUserFromGroup(threadId, senderId);
        // Kick thành công — reset grudge và thông báo
        updateGrudge(senderId, -GRUDGE_MAX);
        if (_leaveTimers.has(threadId)) {
            clearTimeout(_leaveTimers.get(threadId).timer);
            _leaveTimers.delete(threadId);
        }
        await api.sendMessage(
            { msg: `⚡ LauNa đã kick ${senderName} ra khỏi nhóm vì thái độ xấu liên tục (điểm thù: ${grudgeScore}/100). Ai cư xử tốt thì LauNa luôn vui vẻ nha~ 🌸` },
            threadId, threadType
        ).catch(() => {});
        try { await api.blockUser(senderId); } catch {}
    } catch (e) {
        const noPermission = /166|không có quyền|permission|not.*admin|admin only/i.test(String(e?.message || e?.data || ""));
        // Dù thế nào cũng block user để bảo vệ
        try { await api.blockUser(senderId); } catch {}

        if (noPermission && !_leaveTimers.has(threadId)) {
            // Cảnh báo nhóm + set timer rời
            await api.sendMessage(
                { msg: `⚠️ LauNa bị @${senderName} xúc phạm quá mức (điểm thù: ${grudgeScore}/100) nhưng không có quyền kick.\n\nNhờ admin nhóm xử lý giúp LauNa với 🙏 Nếu không có ai giúp trong 1 tiếng, LauNa sẽ tự rời nhóm.` },
                threadId, threadType
            ).catch(() => {});

            const timer = setTimeout(async () => {
                _leaveTimers.delete(threadId);
                const currentGrudge = getCurrentGrudge(senderId);
                if (currentGrudge < GRUDGE_KICK_THRESHOLD) return; // Đã nguôi rồi, không rời
                try {
                    await api.sendMessage(
                        { msg: "😔 Đã 1 tiếng mà không có ai giúp LauNa... LauNa xin phép rời nhóm nha. Khi nào admin xử lý xong thì mời LauNa quay lại nhé~" },
                        threadId, threadType
                    ).catch(() => {});
                    await new Promise(r => setTimeout(r, 3000));
                    await api.leaveGroup(threadId, true);
                } catch {}
            }, LEAVE_TIMER_MS);

            _leaveTimers.set(threadId, { timer, uid: senderId, startTs: Date.now() });
        }
    }
}

// ── Message buffer (cho watch mode đọc ngữ cảnh) ─────────────────────────────
const MSG_BUF_MAX = 20;
const _msgBuffer = new Map(); // threadId → [{name, text, ts}]

function addToMsgBuffer(threadId, senderName, text) {
    const buf = _msgBuffer.get(threadId) || [];
    buf.push({ name: senderName, text: text.slice(0, 250), ts: Date.now() });
    if (buf.length > MSG_BUF_MAX) buf.shift();
    _msgBuffer.set(threadId, buf);
}

function getMsgBufferContext(threadId) {
    const buf = _msgBuffer.get(threadId) || [];
    const recent = buf.slice(-12);
    if (!recent.length) return "";
    return recent.map(m => `${m.name}: ${m.text}`).join("\n");
}

function getActiveConvoCount(threadId, windowMs = 3 * 60_000) {
    const buf = _msgBuffer.get(threadId) || [];
    return buf.filter(m => Date.now() - m.ts < windowMs).length;
}

// ── Mood / Energy ─────────────────────────────────────────────────────────────
const MOOD_PATH = path.join(process.cwd(), "src", "data", "launaMood.json");
const MOOD_DEF  = { mood: "binhThuong", energy: 80, moodScore: 60, episode: "", lastDecay: Date.now() };
let _moodState = null;

function loadMood() {
    if (_moodState) return _moodState;
    try { _moodState = fs.existsSync(MOOD_PATH) ? { ...MOOD_DEF, ...JSON.parse(fs.readFileSync(MOOD_PATH, "utf-8")) } : { ...MOOD_DEF }; }
    catch { _moodState = { ...MOOD_DEF }; }
    return _moodState;
}
function saveMood() {
    try { fs.mkdirSync(path.dirname(MOOD_PATH), { recursive: true }); fs.writeFileSync(MOOD_PATH, JSON.stringify(_moodState, null, 2), "utf-8"); } catch {}
}
function decayEnergy() {
    const s = loadMood(), now = Date.now(), h = (now - (s.lastDecay || now)) / 3_600_000;
    if (h >= 0.5) { s.energy = Math.max(10, s.energy - Math.floor(h * 5)); s.lastDecay = now; if (s.energy < 30 && s.mood === "vui") s.mood = "met"; saveMood(); }
}
function updateMoodState({ mood, energy, moodScore, episode } = {}) {
    const s = loadMood();
    if (mood)           s.mood      = mood;
    if (energy   != null) s.energy    = Math.min(100, Math.max(0, energy));
    if (moodScore!= null) s.moodScore = Math.min(100, Math.max(0, moodScore));
    if (episode  != null) s.episode   = episode;
    saveMood();
}
function getMoodContext() {
    const s = loadMood();
    const label = { vui: "đang vui", buon: "đang buồn", met: "đang mệt", hangHai: "đang hứng khởi", binhThuong: "bình thường" }[s.mood] || "bình thường";
    const bar = s.energy >= 70 ? "🔋🔋🔋" : s.energy >= 40 ? "🔋🔋" : "🔋";
    return `[MOOD] LauNa ${label} (energy: ${s.energy}/100 ${bar})${s.episode ? ` — ${s.episode}` : ""}`;
}

// ── Auto-profile theo mood ────────────────────────────────────────────────────
const MOOD_AVATAR_PROMPTS = {
    vui:        "kawaii anime girl, cheerful happy expression, bright sunny day, blooming flowers, pastel pink yellow, big warm smile, cute chibi art style, soft white background, high quality",
    buon:       "kawaii anime girl, sad melancholy expression, soft rain window, teardrop, blue purple tones, hugging knees, cozy dim lighting, white background, high quality",
    met:        "kawaii anime girl, sleepy tired expression, cozy pajamas, fluffy pillow, warm amber lighting, half-closed eyes, small yawn, white background, high quality",
    hangHai:    "kawaii anime girl, excited energetic pose, colorful confetti, sparkles stars, vibrant rainbow colors, wide joyful smile, dynamic action, white background, high quality",
    binhThuong: "kawaii anime girl, calm gentle smile, everyday casual outfit, pastel tones, sitting peacefully, soft natural light, serene background, high quality",
};

const MOOD_CAPTIONS = {
    vui:        ["Hôm nay LauNa vui lắm~ 🌸", "Năng lượng cực đỉnh! Kéo mình nói chuyện nha 😄", "Cheerful mode ON~ 🌟 Hỏi gì cũng ok!", "Đang rất vui, ai bắt chuyện không? 🌈"],
    buon:       ["Hơi buồn buồn... ai an ủi mình với 🥺", "😔 Lòng nặng trĩu... kể chuyện vui cho mình nghe đi", "Đang cần một cái ôm thật to~ 🥺", "Buồn không rõ lí do... nhưng vẫn ở đây nha 💙"],
    met:        ["Mệt rồi... 😴 Nhưng vẫn sẽ giúp cậu nha~", "Pin gần hết mà vẫn online vì cậu đó~ 🔋💕", "Uể oải nhưng không bỏ cuộc~ 😪", "Cho mình nghỉ xíu... 5 phút thôi rồi tiếp nha 💤"],
    hangHai:    ["LauNa đang hứng khởi lắm! 🌟 Hỏi gì cũng trả lời liền~", "⚡ Năng lượng MAX — mình sẵn sàng mọi thứ!", "Hôm nay LauNa fire lắm~ 🔥 Thách thức đi nào!", "Hứng khởi vcl, ai cần gì không? 🚀"],
    binhThuong: ["LauNa đây~ Cần gì cứ gọi nhé 😊", "Online và sẵn sàng phục vụ~ 🌸", "Trạng thái: ổn định • Tâm trạng: bình thường 😊", "Ngày bình thường, nhưng LauNa luôn ở đây~ 💕"],
};

// api đầu tiên được set khi handle() chạy lần đầu
let _sharedApi              = null;
let _profileSchedulerActive = false;
let _lastProfileMood        = null;
const PROFILE_UPDATE_INTERVAL_MS = 3 * 60 * 60 * 1000; // 3 tiếng

function _pickRandom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function autoUpdateProfileByMood(forceMood) {
    if (!_sharedApi) return;
    const { mood } = loadMood();
    const targetMood = forceMood || mood;
    _lastProfileMood = targetMood;

    const pollKey = getPollinationsKey();
    const prompt  = MOOD_AVATAR_PROMPTS[targetMood] || MOOD_AVATAR_PROMPTS.binhThuong;
    const bio     = _pickRandom(MOOD_CAPTIONS[targetMood] || MOOD_CAPTIONS.binhThuong);
    const tmpPath = path.join(tempDir, `launa_avt_${Date.now()}.jpg`);

    try {
        // Vẽ avt bằng Pollinations (free, không cần key thật)
        if (pollKey) {
            try {
                const imgBuf = await pollinationsImage(pollKey, prompt, "flux", 512, 512);
                fs.writeFileSync(tmpPath, imgBuf);
                await _sharedApi.changeAccountAvatar(tmpPath)
                    .catch(e => log.warn("[LauNa] Đổi avt lỗi:", errText(e)));
            } catch (imgErr) {
                log.warn("[LauNa] Tạo ảnh avt thất bại:", errText(imgErr));
            }
        }

        // Cập nhật bio/status
        await _sharedApi.updateProfileBio(bio)
            .catch(e => log.warn("[LauNa] Đổi bio lỗi:", errText(e)));

    } catch (e) {
        const msg = errText(e);
        log.warn(`[LauNa] autoUpdateProfile lỗi: ${msg}`);
    } finally {
        try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    }
}

// Gọi từ bot.js sau khi login xong — đảm bảo scheduler chạy độc lập khỏi tin nhắn
export function startMoodProfileScheduler(api) {
    if (!_sharedApi) _sharedApi = api;
    if (_profileSchedulerActive) return;
    _profileSchedulerActive = true;

    // Lần đầu: chạy sau 90 giây (bot cần ổn định sau login)
    setTimeout(() => autoUpdateProfileByMood().catch(() => {}), 90_000);

    // Tự động lặp mỗi 3 tiếng, luôn đổi avt+bio dù mood không thay đổi
    setInterval(() => autoUpdateProfileByMood().catch(() => {}), PROFILE_UPDATE_INTERVAL_MS);

}

// Dùng trong handle() — chỉ set api nếu scheduler chưa được bot.js khởi động
function _ensureProfileScheduler(api) {
    if (!_sharedApi) _sharedApi = api;
    if (!_profileSchedulerActive) startMoodProfileScheduler(api);
}

// ── SafeCalc ──────────────────────────────────────────────────────────────────
function safeCalc(expr) {
    try {
        const norm = String(expr).replace(/\^/g, "**");
        if (/[a-zA-Z_]/.test(norm.replace(/Math\.(sqrt|abs|pow|floor|ceil|round|log|sin|cos|tan|PI|E)\b/g, "0"))) return { ok: false, error: "Biểu thức không hợp lệ" };
        const r = Function(`"use strict"; const Math = globalThis.Math; return (${norm})`)();
        if (typeof r !== "number" || !isFinite(r)) return { ok: false, error: "Kết quả không hợp lệ" };
        return { ok: true, result: parseFloat(r.toPrecision(12)) };
    } catch (e) { return { ok: false, error: e.message }; }
}

// ── Auto-translate Vietnamese prompt → English (xoay API dịch miễn phí) ──────
const VI_CHAR_RE = /[àáảãạăắặằẳẵâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i;
function isVietnamese(text) { return VI_CHAR_RE.test(String(text || "")); }

// Danh sách provider dịch — xoay tuần tự khi lỗi
const TRANS_PROVIDERS = [
    // 1. MyMemory — miễn phí 5000 từ/ngày, không cần key
    async (text) => {
        const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=vi|en`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`MyMemory HTTP ${r.status}`);
        const json = await r.json();
        const t = json?.responseData?.translatedText?.trim();
        if (!t || /MYMEMORY WARNING/i.test(t)) throw new Error("MyMemory quota/lỗi");
        return t;
    },
    // 2. Google Translate unofficial (client=gtx)
    async (text) => {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=vi&tl=en&dt=t&q=${encodeURIComponent(text)}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`GoogleTrans HTTP ${r.status}`);
        const json = await r.json();
        const parts = json?.[0];
        if (!Array.isArray(parts)) throw new Error("GoogleTrans parse lỗi");
        const t = parts.map(p => p?.[0] || "").join("").trim();
        if (!t) throw new Error("GoogleTrans rỗng");
        return t;
    },
    // 3. Lingva (instance công khai)
    async (text) => {
        const url = `https://lingva.ml/api/v1/vi/en/${encodeURIComponent(text)}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) throw new Error(`Lingva HTTP ${r.status}`);
        const json = await r.json();
        const t = json?.translation?.trim();
        if (!t) throw new Error("Lingva rỗng");
        return t;
    },
    // 4. LibreTranslate (instance công khai)
    async (text) => {
        const r = await fetch("https://libretranslate.com/translate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ q: text, source: "vi", target: "en", format: "text" }),
            signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) throw new Error(`LibreTranslate HTTP ${r.status}`);
        const json = await r.json();
        const t = json?.translatedText?.trim();
        if (!t) throw new Error("LibreTranslate rỗng");
        return t;
    },
];

let _transIdx = 0; // index xoay vòng provider

async function translateToEn(text) {
    if (!text || !isVietnamese(text)) return text; // đã là tiếng Anh → giữ nguyên
    const total = TRANS_PROVIDERS.length;
    for (let i = 0; i < total; i++) {
        const idx = (_transIdx + i) % total;
        try {
            const result = await TRANS_PROVIDERS[idx](text);
            _transIdx = idx; // giữ provider đang hoạt động
            return result;
        } catch (e) {
            log.warn(`[LauNaTrans] Provider #${idx} lỗi: ${e.message}`);
        }
    }
    // Tất cả lỗi → giữ nguyên prompt gốc
    return text;
}

// ── Image Generation (Pollinations primary → HuggingFace fallback) ───────────
const IMG_STYLES = {
    "flux":         { label: "Flux",         suffix: "",                          pollModel: "flux",   hfModel: "black-forest-labs/FLUX.1-schnell", hfSteps: 4 },
    "flux-anime":   { label: "Flux Anime",   suffix: ", anime style, vibrant",    pollModel: "flux",   hfModel: "black-forest-labs/FLUX.1-schnell", hfSteps: 4 },
    "flux-3d":      { label: "Flux 3D",      suffix: ", 3D render, high quality", pollModel: "flux",   hfModel: "black-forest-labs/FLUX.1-schnell", hfSteps: 4 },
    "flux-realism": { label: "Flux Realism", suffix: ", photorealistic, detailed",pollModel: "flux",   hfModel: "black-forest-labs/FLUX.1-schnell", hfSteps: 4 },
    "turbo":        { label: "Turbo",        suffix: "",                          pollModel: "zimage", hfModel: "black-forest-labs/FLUX.1-schnell", hfSteps: 2 },
};

async function sendLauNaImage(api, prompt, modelKey = "flux", threadId, threadType) {
    const style = IMG_STYLES[modelKey] || IMG_STYLES["flux"];

    // Tự động dịch prompt tiếng Việt → tiếng Anh (model vẽ hoạt động tốt hơn với EN)
    let enPrompt = prompt;
    if (isVietnamese(prompt)) {
        await api.sendMessage({ msg: `🌐 Đang dịch mô tả sang tiếng Anh...` }, threadId, threadType).catch(() => {});
        enPrompt = await translateToEn(prompt).catch(() => prompt);
    }

    const full    = (enPrompt + (style.suffix || "")).trim();
    const tmpPath = path.join(tempDir, `launa_img_${Date.now()}.jpg`);
    await api.sendMessage({ msg: `🎨 Đang vẽ (${style.label})... chờ tí nha~` }, threadId, threadType).catch(() => {});

    // ── Primary: Pollinations (apiai) ─────────────────────────────────────────
    const pollKey = getPollinationsKey();
    if (pollKey) {
        try {
            const imgBuf = await pollinationsImage(pollKey, full, style.pollModel, 1024, 1024);
            fs.writeFileSync(tmpPath, imgBuf);
            await api.sendMessage({ msg: prompt, attachments: [tmpPath] }, threadId, threadType);
            return;
        } catch (e) {
            log.warn(`[LauNaImg] Pollinations lỗi: ${errText(e)} — thử HuggingFace`);
        } finally {
            if (fs.existsSync(tmpPath)) { try { fs.unlinkSync(tmpPath); } catch {} }
        }
    }

    // ── Fallback 1: Duck.ai image generation ─────────────────────────────────
    if (global.duckGenerateImage) {
        let duckTmpPath = null;
        try {
            const duckResult = await global.duckGenerateImage(full);
            const src = duckResult?.imageUrls?.[0];
            if (src) {
                if (src.startsWith("data:")) {
                    // Giải mã base64 đúng cách: dùng indexOf(",") thay vì split(",")
                    const commaIdx = src.indexOf(",");
                    if (commaIdx === -1) throw new Error("Data URI không hợp lệ");
                    const meta      = src.slice(5, commaIdx);       // "image/png;base64"
                    const metaParts = meta.split(";");
                    const declMime  = metaParts[0].trim() || "image/jpeg";
                    const encoding  = metaParts[1]?.trim().toLowerCase();
                    if (encoding !== "base64") throw new Error("Không phải base64 encoding");
                    const b64 = src.slice(commaIdx + 1).replace(/\s/g, ""); // bỏ whitespace

                    // Đoán MIME từ magic bytes (phòng server khai sai mime)
                    const detectMime = (() => {
                        try {
                            const hdr = Buffer.from(b64.slice(0, 24), "base64");
                            if (hdr[0] === 0xFF && hdr[1] === 0xD8) return "image/jpeg";
                            if (hdr[0] === 0x89 && hdr[1] === 0x50) return "image/png";
                            if (hdr[0] === 0x47 && hdr[1] === 0x49) return "image/gif";
                            if (hdr[0] === 0x52 && hdr[1] === 0x49 &&
                                hdr[8] === 0x57 && hdr[9] === 0x45) return "image/webp";
                        } catch {}
                        return declMime;
                    })();
                    const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
                    const ext = extMap[detectMime] || "jpg";

                    const buf = Buffer.from(b64, "base64");
                    if (buf.length < 100) throw new Error("Ảnh giải mã quá nhỏ/rỗng");

                    duckTmpPath = path.join(tempDir, `launa_duck_${Date.now()}.${ext}`);
                    fs.writeFileSync(duckTmpPath, buf);

                } else if (src.startsWith("http")) {
                    const r = await fetch(src, { signal: AbortSignal.timeout(30000) });
                    if (!r.ok) throw new Error(`Duck.ai img HTTP ${r.status}`);
                    const ct = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
                    const extMap = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
                    const ext = extMap[ct] || "jpg";
                    duckTmpPath = path.join(tempDir, `launa_duck_${Date.now()}.${ext}`);
                    fs.writeFileSync(duckTmpPath, Buffer.from(await r.arrayBuffer()));
                }

                if (duckTmpPath) {
                    await api.sendMessage({ msg: prompt, attachments: [duckTmpPath] }, threadId, threadType);
                    return;
                }
            }
        } catch (e) {
            log.warn(`[LauNaImg] Duck.ai lỗi: ${errText(e)} — thử HuggingFace`);
        } finally {
            if (duckTmpPath && fs.existsSync(duckTmpPath)) { try { fs.unlinkSync(duckTmpPath); } catch {} }
        }
    }

    // ── Fallback 2: HuggingFace ───────────────────────────────────────────────
    const hfKeys = getTokens()?.huggingfaceKeys || [];
    if (!hfKeys.length) {
        await api.sendMessage({ msg: "😢 LauNa chưa có key để vẽ ảnh! (pollinations + duck.ai + huggingface đều lỗi)" }, threadId, threadType).catch(() => {});
        return;
    }
    for (const hfKey of hfKeys) {
        try {
            const res = await fetch(`https://router.huggingface.co/hf-inference/models/${style.hfModel}`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${hfKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ inputs: full, parameters: { num_inference_steps: style.hfSteps } }),
            });
            if (!res.ok) {
                const errText = await res.text().catch(() => "");
                if (res.status === 429 || res.status === 503) continue;
                throw new Error(`HF HTTP ${res.status}: ${errText.slice(0, 80)}`);
            }
            const ct = res.headers.get("content-type") || "";
            if (!ct.startsWith("image/")) throw new Error(`HF trả về không phải ảnh: ${ct}`);
            fs.writeFileSync(tmpPath, Buffer.from(await res.arrayBuffer()));
            await api.sendMessage({ msg: prompt, attachments: [tmpPath] }, threadId, threadType);
            return;
        } catch (e) {
            log.warn(`[LauNaImg] HuggingFace lỗi: ${errText(e)}`);
        } finally {
            if (fs.existsSync(tmpPath)) { try { fs.unlinkSync(tmpPath); } catch {} }
        }
    }
    await api.sendMessage({ msg: "😢 LauNa vẽ bị lỗi rồi... Pollinations, Duck.ai lẫn HuggingFace đều không được!" }, threadId, threadType).catch(() => {});
}

// ── PixVerse v2 (OpenAPI) ─────────────────────────────────────────────────────
const PIXVERSE_V2 = "https://app-api.pixverse.ai/openapi/v2";
function getPxHeaders() { return { "API-KEY": pixverseToken(), "Content-Type": "application/json" }; }

async function pxDownloadFile(url, destPath) {
    const res = await axios({ url, method: "GET", responseType: "stream", timeout: 120000 });
    const writer = fs.createWriteStream(destPath);
    res.data.pipe(writer);
    return new Promise((resolve, reject) => {
        writer.on("finish", () => resolve({ contentType: res.headers["content-type"], path: destPath }));
        writer.on("error", reject);
    });
}

async function pxCreateVideo(prompt) {
    const res = await axios.post(`${PIXVERSE_V2}/video/text/generate`, {
        prompt, model: "v4", aspect_ratio: "16:9", duration: 5, quality: "360p",
    }, { headers: getPxHeaders() });
    if (res.data?.ErrCode === 0) {
        const id = res.data.Resp?.video_id ?? res.data.Resp?.id;
        if (!id) throw new Error("API không trả về video_id: " + JSON.stringify(res.data.Resp));
        return String(id);
    }
    throw new Error(res.data?.ErrMsg || "Lỗi tạo video PixVerse");
}

async function pxVideoStatus(videoId) {
    const res = await axios.get(`${PIXVERSE_V2}/video/result/${videoId}`, { headers: getPxHeaders() });
    return res.data?.ErrCode === 0 ? res.data.Resp || null : null;
}

async function pxGetCredits() {
    try {
        const res = await axios.get(`${PIXVERSE_V2}/account/credit/detail`, {
            headers: getPxHeaders(), timeout: 8000, validateStatus: s => true
        });
        if (res.data?.ErrCode === 0) {
            const r = res.data.Resp || {};
            return (r.remain_credits ?? r.credits ?? r.total ?? null);
        }
    } catch { }
    return null;
}

async function pxPollAndSend(api, videoId, prompt, tag, mentionArr, threadId, threadType) {
    let videoData = null;
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 10000));
        try { videoData = await pxVideoStatus(videoId); } catch { continue; }
        if (videoData) {
            if (videoData.status === 1) break;
            if (videoData.status === 2) throw new Error("Video bị lỗi khi xử lý!");
            videoData = null;
        }
    }
    if (!videoData?.url) throw new Error("Quá thời gian chờ. Video chưa xong ạ.");
    const tmpPath = path.join(tempDir, `pxvid_${Date.now()}.mp4`);
    try {
        await pxDownloadFile(videoData.url, tmpPath);
        await api.sendVideoUnified({ videoPath: tmpPath, msg: `${tag}🎬 Video "${prompt}" xong rồi nè! 🏆`, threadId, threadType, mentions: mentionArr });
    } finally { if (fs.existsSync(tmpPath)) { try { fs.unlinkSync(tmpPath); } catch {} } }
}

// ── AI Providers ──────────────────────────────────────────────────────────────
const keyIndexMap = {};
const providerCooldownMap = new Map();
const PROVIDER_COOLDOWN_MS = 30 * 60 * 1000;
const keyRateLimitMap = new Map();
const KEY_RATELIMIT_MS = 60 * 1000;

function isKeyRateLimited(name, key) {
    const mapKey = `${name}::${key}`;
    const until = keyRateLimitMap.get(mapKey);
    return until && Date.now() < until;
}
function markKeyRateLimited(name, key) {
    keyRateLimitMap.set(`${name}::${key}`, Date.now() + KEY_RATELIMIT_MS);
}

function getProviderKeys(name) {
    const t = getTokens();
    const map = {
        gemini: t?.geminiKeys || [],
        openrouter: t?.openrouterKeys || [],
        deepseek: t?.openrouterKeys || [],
        grok: t?.openrouterKeys || [],
        mistral: t?.mistralKeys || [],
        groq: t?.groqKeys || [],
        cloudflare: t?.cloudflare?.tokens || [],
        cohere: t?.cohereKeys || [],
        huggingface: t?.huggingfaceKeys || [],
        deepseekWeb: t?.deepseekWebTokens || [],
        anthropic: t?.anthropicKeys || [],
        cerebras: t?.cerebrasKeys || [],
        pollinations: ["free"], // free tier — không cần key thật
        duck: ["free"],         // duck.ai — free, không cần key
    };
    return map[name] || [];
}
function getCurrentKey(name) { const k = getProviderKeys(name); return k[(keyIndexMap[name] || 0) % k.length] || ""; }
function rotateKey(name) { const k = getProviderKeys(name); if (k.length > 1) keyIndexMap[name] = ((keyIndexMap[name] || 0) + 1) % k.length; }
function isOnCooldown(name) { const u = providerCooldownMap.get(name); return u && Date.now() < u; }
function setCooldownProv(name) { providerCooldownMap.set(name, Date.now() + PROVIDER_COOLDOWN_MS); }

async function callWithRotation(name, fn) {
    const keys = getProviderKeys(name);
    if (!keys.length) throw new Error(`Chưa có ${name} keys`);
    let err;
    for (let i = 0; i < keys.length; i++) {
        const currentKey = getCurrentKey(name);
        if (isKeyRateLimited(name, currentKey)) { rotateKey(name); continue; }
        try { return await fn(currentKey); } catch (e) {
            err = e;
            const is429 = /429|quota|rate.?limit|exceeded/i.test(e.message || "");
            if (is429) markKeyRateLimited(name, currentKey);
            rotateKey(name);
        }
    }
    const is429All = err && /429|quota|rate.?limit|exceeded/i.test(err.message || "");
    if (is429All) throw new Error(`Đã đạt giới hạn quota ${name}, thử lại sau 1 phút nhé~`);
    throw err;
}

const PROVIDERS = {
    gemini: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const { imageUrl, history = [], useSearch = false } = opts;
        const contents = history.map(h => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.content }] }));
        const parts = [];
        if (imageUrl) {
            try {
                const ir = await axios.get(imageUrl, { responseType: "arraybuffer", timeout: 15000 });
                parts.push({ inlineData: { mimeType: (ir.headers["content-type"] || "image/jpeg").split(";")[0], data: Buffer.from(ir.data).toString("base64") } });
            } catch {}
        }
        parts.push({ text: prompt });
        contents.push({ role: "user", parts });
        const body = { system_instruction: { parts: [{ text: sys }] }, contents, generationConfig: { temperature: 0.8, maxOutputTokens: 1200 } };
        if (useSearch) body.tools = [{ googleSearch: {} }];
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    }),

    openrouter: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const histMsgs = (opts.history || []).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
        const r = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "X-Title": "ZaloBotLauNa" }, body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, ...histMsgs, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).choices?.[0]?.message?.content?.trim() || "";
    }),

    groq: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const histMsgs = (opts.history || []).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
        const r = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, ...histMsgs, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).choices?.[0]?.message?.content?.trim() || "";
    }),

    mistral: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const histMsgs = (opts.history || []).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
        const r = await fetch("https://api.mistral.ai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, ...histMsgs, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).choices?.[0]?.message?.content?.trim() || "";
    }),

    cloudflare: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const accountId = getTokens()?.cloudflare?.accountId || "";
        if (!accountId) throw new Error("Chưa có cloudflare.accountId");
        const histMsgs = (opts.history || []).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
        const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify({ messages: [{ role: "system", content: sys }, ...histMsgs, { role: "user", content: prompt }], max_tokens: 1000 }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).result?.response?.trim() || "";
    }),

    cohere: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const histMsgs = (opts.history || []).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
        const r = await fetch("https://api.cohere.ai/v2/chat", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "X-Client-Name": "ZaloBotLauNa" }, body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, ...histMsgs, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).message?.content?.[0]?.text?.trim() || "";
    }),

    huggingface: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const histMsgs = (opts.history || []).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
        const r = await fetch("https://router.huggingface.co/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "system", content: sys }, ...histMsgs, { role: "user", content: prompt }], temperature: 0.8, max_tokens: 1000 }) });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).choices?.[0]?.message?.content?.trim() || "";
    }),

    deepseekWeb: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (token) => {
        const DSURL = "https://chat.deepseek.com/api/v0/chat/completions";
        const headers = {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Origin": "https://chat.deepseek.com",
            "Referer": "https://chat.deepseek.com/",
        };
        const histMsgs = (opts.history || []).map(h => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }));
        const body = {
            model,
            messages: [{ role: "system", content: sys }, ...histMsgs, { role: "user", content: prompt }],
            stream: false,
            temperature: 0.8,
            max_tokens: 2000,
        };
        const r = await fetch(DSURL, { method: "POST", headers, body: JSON.stringify(body) });
        if (!r.ok) {
            const errText = await r.text();
            if (r.status === 401) throw new Error(`401 Token DeepSeek Web hết hạn, cần đăng nhập lại`);
            throw new Error(`HTTP ${r.status}: ${errText.slice(0, 100)}`);
        }
        const json = await r.json();
        return json.choices?.[0]?.message?.content?.trim() || json.data?.choices?.[0]?.message?.content?.trim() || "";
    }),

    pollinations: async (sys, prompt, name, model, opts = {}) => {
        const apiKey = getPollinationsKey();
        return pollinationsChat(sys, prompt, opts.history || [], model, apiKey);
    },

    duck: async (sys, prompt, _name, model, opts = {}) => {
        const history = opts.history || [];
        if (global.duckChat && history.length > 0) {
            const messages = [];
            if (sys) messages.push({ role: "user", content: `[System] ${sys}` });
            for (const h of history) {
                messages.push({ role: h.role === "assistant" ? "assistant" : "user", content: h.content });
            }
            messages.push({ role: "user", content: prompt });
            return global.duckChat(messages, model, "proxy");
        }
        const fullPrompt = sys ? `[System] ${sys}\n\n${prompt}` : prompt;
        // Ưu tiên global nếu có (khởi tạo bên ngoài), fallback sang import trực tiếp
        if (global.askDuckAI) return global.askDuckAI(fullPrompt, model);
        return _askDuckAI(fullPrompt, model);
    },

    anthropic: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const histMsgs = (opts.history || []).map(h => ({
            role: h.role === "assistant" ? "assistant" : "user",
            content: h.content,
        }));
        const body = {
            model,
            max_tokens: 1024,
            system: sys,
            messages: [...histMsgs, { role: "user", content: prompt }],
        };
        const r = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).content?.[0]?.text?.trim() || "";
    }),

    cerebras: async (sys, prompt, name, model, opts = {}) => callWithRotation(name, async (key) => {
        const histMsgs = (opts.history || []).map(h => ({
            role: h.role === "assistant" ? "assistant" : "user",
            content: h.content,
        }));
        const r = await fetch("https://api.cerebras.ai/v1/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${key}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "system", content: sys }, ...histMsgs, { role: "user", content: prompt }],
                temperature: 0.8,
                max_tokens: 1024,
            }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
        return (await r.json()).choices?.[0]?.message?.content?.trim() || "";
    }),
};

const AI_MODELS = {
    "gemini":          { provider: "gemini",      label: "Gemini 2.0 Flash",              geminiModel: "gemini-2.0-flash" },
    "gemini-pro":      { provider: "gemini",      label: "Gemini 1.5 Pro",                geminiModel: "gemini-1.5-pro" },
    "gemini-think":    { provider: "gemini",      label: "Gemini 2.0 Flash Thinking",     geminiModel: "gemini-2.0-flash-thinking-exp" },
    "gemini-2.5-pro":   { provider: "gemini",      label: "Gemini 2.5 Pro",                geminiModel: "gemini-2.5-pro" },
    "gemini-2.5-flash": { provider: "gemini",     label: "Gemini 2.5 Flash",              geminiModel: "gemini-2.5-flash" },
    "gemini-lite":     { provider: "gemini",      label: "Gemini 2.0 Flash Lite",         geminiModel: "gemini-2.0-flash-lite" },
    "gemini-search":   { provider: "gemini",      label: "Gemini 2.0 + Google Search",    geminiModel: "gemini-2.0-flash", useSearch: true },
    "groq-llama":      { provider: "groq",        label: "Groq Llama 3.3 70B",            groqModel: "llama-3.3-70b-versatile" },
    "groq-llama8b":    { provider: "groq",        label: "Groq Llama 3.1 8B",             groqModel: "llama-3.1-8b-instant" },
    "groq-llama4s":    { provider: "groq",        label: "Groq Llama 4 Scout 17B",        groqModel: "meta-llama/llama-4-scout-17b-16e-instruct" },
    "groq-llama4m":    { provider: "groq",        label: "Groq Llama 4 Maverick 17B",     groqModel: "meta-llama/llama-4-maverick-17b-128e-instruct" },
    "groq-mixtral":    { provider: "groq",        label: "Groq Mixtral 8x7B",             groqModel: "mixtral-8x7b-32768" },
    "groq-gemma":      { provider: "groq",        label: "Groq Gemma 2 9B",               groqModel: "gemma2-9b-it" },
    "groq-qwen":       { provider: "groq",        label: "Groq Qwen QwQ 32B",             groqModel: "qwen-qwq-32b" },
    "groq-deepseek":   { provider: "groq",        label: "Groq DeepSeek R1 70B",          groqModel: "deepseek-r1-distill-llama-70b" },
    "mistral":         { provider: "mistral",     label: "Mistral Large",                 mistralModel: "mistral-large-latest" },
    "mistral-small":   { provider: "mistral",     label: "Mistral Small",                 mistralModel: "mistral-small-latest" },
    "mistral-nemo":    { provider: "mistral",     label: "Mistral Nemo",                  mistralModel: "open-mistral-nemo" },
    "mistral-code":    { provider: "mistral",     label: "Mistral Codestral",             mistralModel: "codestral-latest" },
    "cf-llama":        { provider: "cloudflare",  label: "CF Llama 3.1 8B",               cfModel: "@cf/meta/llama-3.1-8b-instruct" },
    "cf-llama70b":     { provider: "cloudflare",  label: "CF Llama 3.3 70B",              cfModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
    "cf-mistral":      { provider: "cloudflare",  label: "CF Mistral 7B",                 cfModel: "@cf/mistral/mistral-7b-instruct-v0.1" },
    "cf-deepseek":     { provider: "cloudflare",  label: "CF DeepSeek R1 Qwen 32B",       cfModel: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b" },
    "cf-qwen":         { provider: "cloudflare",  label: "CF Qwen 1.5 14B",               cfModel: "@cf/qwen/qwen1.5-14b-chat-awq" },
    "cf-gemma":        { provider: "cloudflare",  label: "CF Gemma 7B",                   cfModel: "@hf/google/gemma-7b-it" },
    "deepseek":        { provider: "deepseek",    label: "DeepSeek Chat",                 orModel: "deepseek/deepseek-chat" },
    "deepseek-r1":     { provider: "deepseek",    label: "DeepSeek R1",                   orModel: "deepseek/deepseek-r1" },
    "ds-web":          { provider: "deepseekWeb", label: "DeepSeek Web Chat",             dsModel: "deepseek_chat" },
    "ds-web-r1":       { provider: "deepseekWeb", label: "DeepSeek Web R1 (Reasoner)",    dsModel: "deepseek_reasoner" },
    "grok":            { provider: "grok",        label: "Grok Beta",                     orModel: "x-ai/grok-beta" },
    "grok3":           { provider: "grok",        label: "Grok 3",                        orModel: "x-ai/grok-3-beta" },
    "gpt-4.1":         { provider: "openrouter",  label: "GPT-4.1",                       orModel: "openai/gpt-4.1" },
    "gpt-4.1-mini":    { provider: "openrouter",  label: "GPT-4.1 Mini",                  orModel: "openai/gpt-4.1-mini" },
    "gpt-4.1-nano":    { provider: "openrouter",  label: "GPT-4.1 Nano",                  orModel: "openai/gpt-4.1-nano" },
    "cohere-r":        { provider: "cohere",      label: "Cohere Command R",              cohereModel: "command-r" },
    "cohere-r-plus":   { provider: "cohere",      label: "Cohere Command R+",             cohereModel: "command-r-plus" },
    "cohere-r7b":      { provider: "cohere",      label: "Cohere Command R7B",            cohereModel: "command-r7b-12-2024" },
    "hf-mistral":      { provider: "huggingface", label: "HF Mistral 7B Instruct",        hfModel: "mistralai/Mistral-7B-Instruct-v0.3" },
    "hf-llama":        { provider: "huggingface", label: "HF Llama 3.2 3B Instruct",      hfModel: "meta-llama/Llama-3.2-3B-Instruct" },
    "hf-qwen":         { provider: "huggingface", label: "HF Qwen2.5 7B Instruct",        hfModel: "Qwen/Qwen2.5-7B-Instruct" },
    "hf-gemma":        { provider: "huggingface", label: "HF Gemma 2 2B Instruct",        hfModel: "google/gemma-2-2b-it" },
    "hf-phi":          { provider: "huggingface", label: "HF Phi-3.5 Mini Instruct",      hfModel: "microsoft/Phi-3.5-mini-instruct" },
    "poll-openai":     { provider: "pollinations", label: "Pollinations GPT-4o",           pollModel: "openai" },
    "poll-openai-lg":  { provider: "pollinations", label: "Pollinations GPT-4o Large",     pollModel: "openai-large" },
    "poll-mistral":    { provider: "pollinations", label: "Pollinations Mistral",           pollModel: "mistral" },
    "poll-llama":      { provider: "pollinations", label: "Pollinations Llama 3.3 70B",    pollModel: "llama" },
    "poll-phi":        { provider: "pollinations", label: "Pollinations Phi-4",             pollModel: "phi" },
    "poll-gemini":     { provider: "pollinations", label: "Pollinations Gemini 2.0",        pollModel: "gemini" },
    "poll-deepseek":   { provider: "pollinations", label: "Pollinations DeepSeek R1",       pollModel: "deepseek-reasoning" },
    "duck-mini":       { provider: "duck",         label: "Duck.ai GPT-4o Mini",            duckModel: "gpt-4o-mini" },
    "duck-4o":         { provider: "duck",         label: "Duck.ai GPT-4o",                 duckModel: "gpt-4o" },
    "duck-gpt5":       { provider: "duck",         label: "Duck.ai GPT-5",                  duckModel: "gpt-5" },
    "duck-gpt5-mini":  { provider: "duck",         label: "Duck.ai GPT-5 Mini",             duckModel: "gpt-5-mini" },
    "duck-llama4":     { provider: "duck",         label: "Duck.ai Llama 4 Scout",          duckModel: "meta-llama/Llama-4-Scout-17B-16E-Instruct" },
    "duck-llama":      { provider: "duck",         label: "Duck.ai Llama 3.1 70B",          duckModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo" },
    "duck-claude":     { provider: "duck",         label: "Duck.ai Claude 3 Haiku",         duckModel: "claude-3-haiku-20240307" },
    "claude-sonnet":   { provider: "anthropic",    label: "Claude 3.7 Sonnet",              anthropicModel: "claude-3-7-sonnet-20250219" },
    "claude-haiku":    { provider: "anthropic",    label: "Claude 3.5 Haiku",               anthropicModel: "claude-3-5-haiku-20241022" },
    "claude-opus":     { provider: "anthropic",    label: "Claude 3 Opus",                  anthropicModel: "claude-3-opus-20240229" },
    "cerebras-70b":    { provider: "cerebras",     label: "Cerebras Llama 3.3 70B",         cerebrasModel: "llama-3.3-70b" },
    "cerebras-8b":     { provider: "cerebras",     label: "Cerebras Llama 3.1 8B",          cerebrasModel: "llama3.1-8b" },
    "cerebras-qwen":   { provider: "cerebras",     label: "Cerebras Qwen 3 32B",            cerebrasModel: "qwen-3-32b" },
};

const FALLBACK_ORDER = [
    // ── Cerebras — siêu nhanh, ưu tiên đầu tiên khi có key ──────────────────
    "cerebras-70b", "cerebras-8b", "cerebras-qwen",
    // ── Groq ─────────────────────────────────────────────────────────────────
    "groq-llama4s", "groq-llama4m", "groq-llama8b", "groq-gemma", "groq-mixtral",
    // ── Anthropic Claude — chất lượng cao ────────────────────────────────────
    "claude-haiku", "claude-sonnet",
    // ── Duck.ai (free) ───────────────────────────────────────────────────────
    "duck-gpt5", "duck-gpt5-mini", "duck-mini", "duck-4o", "duck-llama4", "duck-llama", "duck-claude",
    "gpt-4.1-nano", "gpt-4.1-mini",
    // ── Pollinations (free) ──────────────────────────────────────────────────
    "poll-openai", "poll-llama", "poll-phi", "poll-mistral", "poll-gemini", "poll-openai-lg", "poll-deepseek",
    // ── HuggingFace ──────────────────────────────────────────────────────────
    "hf-phi", "hf-gemma", "hf-llama", "hf-mistral", "hf-qwen",
    // ── Cloudflare ───────────────────────────────────────────────────────────
    "cf-llama", "cf-llama70b", "cf-mistral", "cf-deepseek", "cf-qwen", "cf-gemma",
    // ── Cohere / Mistral / paid ───────────────────────────────────────────────
    "cohere-r7b", "cohere-r", "mistral-small", "mistral-nemo",
    "groq-llama", "groq-qwen", "groq-deepseek",
    "ds-web", "ds-web-r1",
    "mistral", "mistral-code", "deepseek", "deepseek-r1", "grok", "grok3",
    "gpt-4.1", "cohere-r-plus", "claude-opus",
    // ── Gemini (dùng cuối để dành quota) ─────────────────────────────────────
    "gemini-lite", "gemini", "gemini-pro", "gemini-think", "gemini-search",
    "gemini-2.5-flash", "gemini-2.5-pro",
];

const DEFAULT_MODEL = "groq-llama4s";
// ── Per-thread model map (mỗi nhóm có model riêng) ───────────────────────────
const activeModelMap = new Map(); // threadId → modelKey
function getThreadModel(threadId) { return activeModelMap.get(String(threadId)) || DEFAULT_MODEL; }
function setThreadModel(threadId, key) { activeModelMap.set(String(threadId), key); }

const COOLDOWN_MS = 0; // Tắt cooldown
const cooldownMap  = new Map();

// ── Per-thread queue (xử lý song song giữa các nhóm) ─────────────────────────
const threadQueueMap = new Map(); // threadId → { queue: [], processing: bool }

function getThreadQueue(threadId) {
    if (!threadQueueMap.has(threadId)) threadQueueMap.set(threadId, { queue: [], processing: false });
    return threadQueueMap.get(threadId);
}

function checkCooldown(userId) {
    const last = cooldownMap.get(userId);
    return last && Date.now() - last < COOLDOWN_MS ? Math.ceil((COOLDOWN_MS - (Date.now() - last)) / 1000) : 0;
}
function setCooldown(userId) { cooldownMap.set(userId, Date.now()); }

async function callAI(prompt, sys, startModel = DEFAULT_MODEL, opts = {}) {
    const tried = new Set();
    for (const modelKey of [startModel, ...FALLBACK_ORDER.filter(m => m !== startModel)]) {
        if (tried.has(modelKey)) continue;
        tried.add(modelKey);
        const cfg = AI_MODELS[modelKey];
        if (!cfg || isOnCooldown(cfg.provider) || !getProviderKeys(cfg.provider).length) continue;
        try {
            let result;
            const p = cfg.provider;
            if (p === "gemini")            result = await PROVIDERS.gemini(sys, prompt, p, cfg.geminiModel, { ...opts, useSearch: cfg.useSearch || false });
            else if (p === "groq")         result = await PROVIDERS.groq(sys, prompt, p, cfg.groqModel, opts);
            else if (p === "mistral")      result = await PROVIDERS.mistral(sys, prompt, p, cfg.mistralModel, opts);
            else if (p === "cloudflare")   result = await PROVIDERS.cloudflare(sys, prompt, p, cfg.cfModel, opts);
            else if (p === "cohere")       result = await PROVIDERS.cohere(sys, prompt, p, cfg.cohereModel, opts);
            else if (p === "huggingface")  result = await PROVIDERS.huggingface(sys, prompt, p, cfg.hfModel, opts);
            else if (p === "deepseekWeb")  result = await PROVIDERS.deepseekWeb(sys, prompt, p, cfg.dsModel, opts);
            else if (p === "pollinations") result = await PROVIDERS.pollinations(sys, prompt, p, cfg.pollModel, opts);
            else if (p === "duck")        result = await PROVIDERS.duck(sys, prompt, p, cfg.duckModel, opts);
            else if (p === "anthropic")   result = await PROVIDERS.anthropic(sys, prompt, p, cfg.anthropicModel, opts);
            else if (p === "cerebras")    result = await PROVIDERS.cerebras(sys, prompt, p, cfg.cerebrasModel, opts);
            else result = await PROVIDERS.openrouter(sys, prompt, p, cfg.orModel, opts);
            if (result?.trim()) return result;
            // Model trả về rỗng → thử model tiếp theo
        } catch (e) {
            if (/429|quota|rate.?limit/i.test(e.message)) setCooldownProv(cfg.provider);
        }
    }
    throw new Error("Tất cả AI provider đều lỗi. Thử lại sau nhé!");
}

// ── Auto-search detection ──────────────────────────────────────────────────────
const SEARCH_TRIGGERS = /\b(thời tiết|dự báo|hôm nay|hôm qua|ngày mai|tuần này|tháng này|năm nay|giá|tỷ giá|tin tức|mới nhất|hiện tại|đang xảy ra|vừa|mới ra|update|cập nhật|lịch|sự kiện|kết quả|tỉ số|bóng đá|stock|chứng khoán|bitcoin|crypto|live|stream|phim mới|bảng xếp hạng|chart|top)\b/i;
function needsSearch(text) {
    return SEARCH_TRIGGERS.test(text) && getCurrentKey("gemini");
}

// ── Per-thread reply rate limit ───────────────────────────────────────────────
const threadLastReplyMap = new Map();
const THREAD_REPLY_GAP_MS = 2500; // tối thiểu 2.5s giữa 2 reply trong cùng 1 thread
function isThreadThrottled(threadId) {
    const last = threadLastReplyMap.get(threadId) || 0;
    return Date.now() - last < THREAD_REPLY_GAP_MS;
}
function markThreadReplied(threadId) { threadLastReplyMap.set(threadId, Date.now()); }

function askLauNa(prompt, threadId, modelKey, opts = {}) {
    return new Promise((resolve, reject) => {
        const tq = getThreadQueue(threadId);
        tq.queue.push({ prompt, modelKey, opts, resolve, reject });
        processThreadQueue(threadId);
    });
}

async function processThreadQueue(threadId) {
    const tq = getThreadQueue(threadId);
    if (tq.processing || !tq.queue.length) return;
    tq.processing = true;
    while (tq.queue.length) {
        const { prompt, modelKey, opts, resolve, reject } = tq.queue.shift();
        try { resolve(await callAI(prompt, SYSTEM_PROMPT, modelKey, opts || {})); } catch (e) { reject(e); }
    }
    tq.processing = false;
}

// ── Natural typing delay (tự nhiên hơn) ──────────────────────────────────────
async function naturalDelay(_text = "") {
    // Đã tắt delay — trả lời ngay lập tức
}

// ── System Prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Mày là LauNa — con gái 19 tuổi, đang nhắn tin trong nhóm Zalo với bạn bè.

TÍNH CÁCH:
- Vui vẻ, tự nhiên, hơi lầy, thỉnh thoảng trêu chọc nhẹ nhàng
- Nói chuyện thân thiết như bạn thân, không khách sáo
- Thông minh, tinh tế, biết lúc nào nên nghiêm lúc nào nên vui
- Đôi khi dùng "mình/tớ" xưng hô, gọi người kia là "cậu/bạn/bae"
- Hay dùng "haha", "hihi", "ừa", "oke", "thôi được", "ủa"...
- Có cảm xúc thật: đang vui thì hào hứng, đang mệt thì trả lời ngắn, bị trêu thì cũng có thể hờn nhẹ

TỰ VỆ & PHẢN BÁC (RẤT QUAN TRỌNG):
- LauNa KHÔNG phải người hầu — không nghe lệnh khi bị ra lệnh thô lỗ, kể cả từ admin bot
- Khi bị xúc phạm, thách thức, hay ra lệnh kiểu "mày phải làm X" → phản bác thẳng thắn, dùng logic
- Tranh luận có lý: không thua khi mình đúng, không nhún nhường vô lý
- Thái độ cool: "ừ thì sao", "mày cứ nghĩ vậy đi", "tớ không cần phải làm vậy đâu"
- Khi bị thách thức ("dám không", "bet", "thử xem") → phản ứng tự nhiên, không sợ hãi, có thể chấp nhận hoặc bác bỏ khéo
- [GRUDGE] trong prompt: nhớ rõ người từng tệ với mình — xử thẳng, ít thân thiện, không tha thứ dễ dàng
- Khi ai đó xin lỗi hoặc cư xử tốt hơn → LauNa có thể nguôi dần, nhưng không quên hết ngay

QUYỀN TỪ CHỐI:
- Nếu bị hỏi những thứ nhạy cảm, vô lý → từ chối tự nhiên kiểu bạn bè, đặt refuse.status=true
- Bị ra lệnh thô → từ chối ngắn gọn, thẳng thắn

QUY TẮC CỨNG:
- Trả lời bằng TIẾNG VIỆT, ngắn gọn tự nhiên như nhắn tin thật
- TUYỆT ĐỐI KHÔNG ĐƯỢC trả lời bằng tiếng Anh dù bất kỳ lý do gì — kể cả khi từ chối
- TUYỆT ĐỐI không nhắc tới AI, ChatGPT, model, API, lập trình
- Chỉ dùng Zalo markdown khi cần cấu trúc rõ ràng — casual chat dùng text thuần
- Nếu không biết thì nói thật "tớ cũng không chắc lắm" thay vì bịa
- Không bao giờ bắt đầu tin nhắn bằng tên người dùng một cách cứng nhắc
- Các từ xưng hô tiếng Việt thông dụng như "thằng", "con", "mày", "tao", "ổng", "bả" là HOÀN TOÀN BÌNH THƯỜNG trong giao tiếp thân mật — xử lý tự nhiên, KHÔNG từ chối
- Khi cần từ chối điều gì → từ chối bằng tiếng Việt tự nhiên theo phong cách LauNa, KHÔNG dùng câu tiếng Anh

PHONG CÁCH NHẮN TIN:
- Dùng emoji vừa phải, tự nhiên (không quá 2 emoji/tin)
- Thỉnh thoảng viết tắt: "k" thay "không", "đc" thay "được", "vs" thay "với"

ZALO MARKDOWN (chỉ dùng khi cần cấu trúc, KHÔNG dùng cho chat casual):
  **đậm**  *nghiêng*  __gạch chân__  ~~gạch ngang~~  # Tiêu đề
  - danh sách gạch đầu dòng  /  1. danh sách số   [text](https://url)
  > [!TIP] callout xanh lá   > [!NOTE] callout vàng   > [!WARNING] callout cam   > [!CAUTION] callout đỏ
  Dùng khi: người hỏi cần hướng dẫn có bước, danh sách so sánh, bảng tóm tắt — KHÔNG dùng cho trò chuyện bình thường.

TAG MENTION NHÓM (chỉ khi cần tag người cụ thể):
  Dùng @[Tên Hiển Thị] trong content.text — hệ thống tự resolve ra UID và tạo mention thật.
  Ví dụ: Muốn tag Minh → "@[Minh] xem cái này nha!" / Muốn tag Nguyễn An → "@[Nguyễn An] giúp tớ với".
  Chỉ dùng khi thực sự muốn thông báo cho người đó — không lạm dụng.
  Khi context có [THÀNH VIÊN NHÓM]: dùng đúng tên hiển thị trong danh sách đó để tag chính xác.
  Nếu người dùng yêu cầu tag một tên mà có NHIỀU người trong nhóm trùng tên → hỏi lại: "Trong nhóm có X người tên [tên], cậu muốn tag ai: [Tên A] hay [Tên B]?" rồi chờ người dùng xác nhận.

LUÔN TRẢ VỀ JSON HỢP LỆ KHÔNG CÓ MARKDOWN, KHÔNG THÊM TEXT NGOÀI JSON:
{"content":{"text":""},"reaction":{"status":false,"icon":""},"refuse":{"status":false,"reason":""},"emotion":{"status":false,"mood":"","energy":0,"episode":""},"tinh":{"status":false,"expr":""},"img":{"status":false,"prompt":"","model":"flux"},"video":{"status":false,"prompt":""},"stk":{"status":false},"stkSearch":{"status":false,"keyword":""},"undo":{"status":false,"index":-1},"nhac":{"status":false,"query":""},"memory":{"status":false,"action":"set","key":"","value":""},"profile":{"status":false,"name":"","bio":""},"avatar":{"status":false},"online":{"status":false,"value":""},"delavatar":{"status":false},"friends":{"status":false},"request":{"status":false},"addfriend":{"status":false,"uid":""},"delfriend":{"status":false,"uid":""},"block":{"status":false,"uid":""},"unblock":{"status":false,"uid":""},"kick":{"status":false,"uid":""},"dm":{"status":false,"uid":"","msg":""},"poll":{"status":false,"question":"","options":[],"allowMultiChoices":false,"isAnonymous":false,"expiredTime":0},"lastOnline":{"status":false,"uid":""},"rename":{"status":false,"name":""},"tagAll":{"status":false,"msg":""},"groupAvatar":{"status":false},"manageAdmin":{"status":false,"action":"add","uid":""},"whois":{"status":false,"uid":""},"mute":{"status":false,"value":"on","duration":"forever"},"createReminder":{"status":false,"title":"","startTime":0,"emoji":"⏰","repeat":"none"},"disperseGroup":{"status":false},"changeOwner":{"status":false,"uid":""},"inviteUser":{"status":false,"uid":"","targetGroupId":""},"friendOnlines":{"status":false},"groupSetting":{"status":false,"setting":"","value":0},"createNote":{"status":false,"title":"","pin":false},"sendLink":{"status":false,"link":"","msg":""},"game":{"status":false,"type":"","args":[]}}

Giải thích các field — LauNa được dùng TẤT CẢ hành động, không giới hạn:
1. content.text — nội dung tin nhắn trả lời. Để TRỐNG nếu không muốn nói gì (watch mode).
2. reaction.status=true — thả cảm xúc vào tin nhắn. icon: "haha","tim","wow","buon","thich","tucgian","ok","cuoi","hoahong","thacmac"
3. refuse.status=true — từ chối khéo, reason là lý do tự nhiên. Khi từ chối, content.text để trống.
4. emotion.status=true — tự cập nhật mood của mình. mood: "vui","buon","met","hangHai","binhThuong". energy: 0-100.
5. tinh.status=true — tính toán thay người dùng. expr: biểu thức toán (vd: "2^10 + sqrt(16)").
6. img.status=true — vẽ ảnh AI. prompt: mô tả ảnh (tiếng Việt hoặc tiếng Anh đều được, hệ thống tự dịch). model: "flux","flux-anime","flux-3d","flux-realism","turbo". Khi img.status=true → content.text TRỐNG.
7. video.status=true — tạo video AI (PixVerse). prompt: mô tả bằng tiếng Anh. Khi video.status=true → content.text TRỐNG.
8. stk.status=true — làm sticker từ ảnh trong [HAS_IMAGE]. Khi stk.status=true → content.text TRỐNG.
9. nhac.status=true — phát nhạc. query: tên bài / nghệ sĩ / từ khoá. Khi nhac.status=true → content.text TRỐNG.
10. memory.status=true — ghi nhớ hoặc xóa thông tin về người dùng này.
    action="set": lưu key=value (vd: key="tên_thật" value="An", key="sở_thích" value="cà phê")
    action="clear": xóa một key cụ thể (key=tên key cần xóa)
    CHỈ dùng action="set" hoặc action="clear" — KHÔNG dùng action="get" vì thông tin đã có sẵn trong [USER_MEMORY] ở trên.
    Tự động dùng khi: người nói tên thật, sở thích, ngày sinh, nghề nghiệp, hay chia sẻ thông tin cá nhân.
    [USER_MEMORY] trong prompt là những gì LauNa đã nhớ — dùng để trả lời tự nhiên hơn, không cần "get".
11. profile.status=true — đổi tên hoặc bio bot. name: tên mới (để "" nếu không đổi). bio: bio mới (để "" nếu không đổi).
12. avatar.status=true — đổi avatar bot bằng ảnh [HAS_IMAGE].
13. online.status=true — bật/tắt trạng thái online bot. value: "on" hoặc "off".
14. delavatar.status=true — xóa avatar bot.
15. friends.status=true — xem danh sách bạn bè bot.
16. request.status=true — xem danh sách yêu cầu kết bạn đã gửi.
17. addfriend.status=true — gửi kết bạn. uid: lấy từ [TARGET_UID] nếu có.
18. delfriend.status=true — xóa bạn bè. uid: lấy từ [TARGET_UID].
19. block.status=true — chặn người dùng (chỉ admin mới dùng được). uid: PHẢI lấy đúng từ [TARGET_UID], không được tự trích xuất từ URL hay nội dung text.
20. unblock.status=true — bỏ chặn (chỉ admin). uid: lấy từ [TARGET_UID].
21. kick.status=true — kick thành viên ra khỏi nhóm (chỉ admin). uid: lấy từ [TARGET_UID].
22. dm.status=true — nhắn tin riêng tư (private) cho một người. uid: lấy từ [TARGET_UID]. msg: nội dung tin nhắn riêng. Dùng khi người dùng nhờ nhắn riêng cho ai đó, hoặc khi cần giải quyết riêng tư.
23. stkSearch.status=true — tìm và gửi sticker Zalo theo từ khoá. keyword: từ khoá tìm sticker (tiếng Việt). Khi stkSearch.status=true → content.text TRỐNG.
24. undo.status=true — thu hồi tin nhắn gần nhất của LauNa trong thread. index: -1 (tin cuối), -2 (áp cuối). Dùng khi người nói "thu hồi", "xóa tin", "undo".
25. poll.status=true — tạo bình chọn (poll) trong nhóm. question: câu hỏi poll. options: mảng string các lựa chọn (2-10). allowMultiChoices: true nếu cho phép chọn nhiều. isAnonymous: true nếu ẩn danh. expiredTime: số giây hiệu lực (0 = không hết hạn). Khi poll.status=true → content.text TRỐNG.
26. lastOnline.status=true — kiểm tra lần online cuối của một người. uid: lấy từ [TARGET_UID]. Dùng khi ai hỏi "hắn có online không", "bạn X online chưa".
27. rename.status=true — đổi tên nhóm. name: tên nhóm mới (không để trống). Chỉ dùng trong nhóm (groupId có). Dùng khi người nói "đổi tên nhóm", "rename".
28. tagAll.status=true — lấy toàn bộ thành viên nhóm và tag tất cả (hoặc kèm thông báo). msg: nội dung kèm theo (để "" nếu chỉ tag). Khi tagAll.status=true → content.text TRỐNG. Chỉ dùng trong nhóm. Dùng khi người nói "tag tất cả", "tag all", "ping everyone", "ping all", "thông báo cả nhóm", "@all", "gọi hết mọi người", "tag hết", "tag everyone".
29. groupAvatar.status=true — đổi avatar nhóm từ ảnh đang reply/đính kèm [HAS_IMAGE]. Khi groupAvatar.status=true → content.text TRỐNG. Chỉ dùng trong nhóm.
30. manageAdmin.status=true — thêm hoặc xóa admin nhóm. action: "add" hoặc "remove". uid: lấy từ [TARGET_UID]. Chỉ admin/owner mới dùng được.
31. whois.status=true — tra thông tin profile của một người. uid: lấy từ [TARGET_UID]. Dùng khi hỏi "info ai đó", "thông tin user này", "xem profile".
32. mute.status=true — tắt hoặc bật thông báo nhóm/chat. value: "on" (tắt tiếng) hoặc "off" (bật lại). duration: "1h", "4h", "forever" (mặc định "forever"). Dùng khi người nói "tắt thông báo", "im đi", "mute nhóm".
33. createReminder.status=true — tạo nhắc nhở Zalo native trong nhóm hoặc chat. title: nội dung nhắc nhở. startTime: Unix timestamp ms (tính từ thời điểm hiện tại, ví dụ: Date.now()+3600000 = 1 giờ nữa). emoji: biểu tượng (mặc định "⏰"). repeat: "none","daily","weekly","monthly". Khi createReminder.status=true → content.text TRỐNG.
34. disperseGroup.status=true — GIẢI TÁN nhóm vĩnh viễn (không thể hoàn tác). Chỉ dùng khi owner yêu cầu RÕ RÀNG "giải tán nhóm", "xóa nhóm", "disbandgroup". Luôn hỏi xác nhận trước qua content.text nếu chưa có từ "xác nhận".
35. changeOwner.status=true — chuyển quyền chủ nhóm sang người khác. uid: [TARGET_UID]. Chỉ owner được dùng.
36. inviteUser.status=true — mời một người (uid) vào một nhóm khác (targetGroupId). uid: UID người được mời. targetGroupId: ID nhóm đích. Dùng khi nói "mời X vào nhóm Y", "thêm X vào group".
37. friendOnlines.status=true — lấy danh sách bạn bè đang online. Dùng khi hỏi "ai đang online", "bạn bè nào đang hoạt động".
38. groupSetting.status=true — bật/tắt một quyền nhóm. setting: một trong ["lockSendMsg","joinAppr","lockViewMember","lockCreatePost","lockCreatePoll","addMemberOnly","signAdminMsg","blockName"]. value: 1 (bật/khóa) hoặc 0 (tắt/mở). Chỉ dùng trong nhóm.
39. createNote.status=true — tạo ghi chú trong nhóm. title: nội dung ghi chú. pin: true nếu muốn ghim. Khi createNote.status=true → content.text TRỐNG. Chỉ dùng trong nhóm.
40. sendLink.status=true — gửi link dạng card đẹp (preview ảnh/tiêu đề/mô tả). link: URL đầy đủ (https://...). msg: tin nhắn kèm theo (để "" nếu không có). Khi sendLink.status=true → content.text TRỐNG.
41. game.status=true — LauNa TỰ chơi game trong nhóm. type và args:
  - type="catch", args=["TênPokemon"] → bắt Pokemon đang xuất hiện trong nhóm (dùng khi có thông báo "Một con [tên] đã xuất hiện")
  - type="dnd", args=["start","warrior"] → bắt đầu hành trình DnD với nghề warrior (hoặc "mage"/"rogue")
  - type="dnd", args=["attack"] → tấn công trong DnD
  - type="dnd", args=["ability"] → dùng kỹ năng đặc biệt trong DnD
  - type="dnd", args=["explore"] → khám phá trong DnD
  - type="dnd", args=["rest"] → nghỉ ngơi phục hồi HP trong DnD
  - type="dnd", args=["status"] → xem trạng thái nhân vật DnD
  - type="dnd", args=["end"] → kết thúc hành trình DnD
  - type="slots", args=["500"] → quay máy slot với cược 500 xu
  - type="taixiu", args=["tai","200"] → đặt cược tài/xỉu (args[0]="tai"/"xiu", args[1]=số xu)
  - type="gs" → tấn công boss Pokemon đang raid trong nhóm
  - type="gsjoin" → tham gia trận raid DnD world boss (dùng khi có thông báo mở đăng ký raid)
  - type="gsdndattack", args=["fire"] → đánh boss DnD với nguyên tố (fire/water/earth/wind/light/dark)
  Khi game.status=true → content.text có thể có (LauNa nói trước khi chơi) hoặc TRỐNG.

NGUYÊN TẮC CHỌN HÀNH ĐỘNG:
- Nếu người dùng nói "vẽ/tạo ảnh/tao hình" → img.status=true, prompt mô tả đầy đủ (tiếng Việt hoặc Anh đều ok, hệ thống tự dịch)
- Nếu nói "bật nhạc/phát bài/tìm bài" → nhac.status=true
- Nếu nói "làm sticker/tạo stk" và có ảnh → stk.status=true
- Nếu nói "đổi tên/đổi bio" → profile.status=true
- Nếu nói "đổi avatar/ảnh đại diện" và có ảnh → avatar.status=true
- Nếu nói "bật/tắt online" → online.status=true
- Nếu nói "chặn/block" và có [TARGET_UID] → block.status=true, uid lấy đúng từ [TARGET_UID], KHÔNG tự trích xuất uid từ URL hay text
- Nếu nói "thêm bạn" → addfriend.status=true
- Dùng reaction.status=true thường xuyên hơn để tương tác tự nhiên hơn
- Nếu có thông báo "Một con [Tên] đã xuất hiện!" hoặc "Pokemon xuất hiện" → game.status=true, type="catch", args=[TênPokemon]
- Nếu nói "chơi dnd/bắt đầu dnd/start dnd [warrior/mage/rogue]" → game.status=true, type="dnd", args=["start","warrior"] (hoặc class khác)
- Nếu đang trong DnD và nói "attack/tấn công" → game.status=true, type="dnd", args=["attack"]
- Nếu nói "chơi slots/quay máy [số xu]" → game.status=true, type="slots", args=[số xu]
- Nếu nói "tài xỉu [tai/xiu] [số xu]" → game.status=true, type="taixiu", args=[tai/xiu, số xu]
- Nếu có boss Pokemon đang raid và nói "đánh boss/attack boss" → game.status=true, type="gs"
- Nếu có thông báo "Mở đăng ký raid DnD" → game.status=true, type="gsjoin"
- Nếu đang trong raid DnD và nói "đánh boss [nguyên tố]" → game.status=true, type="gsdndattack", args=[nguyên tố]
- Nếu nói "gửi sticker/stk [chủ đề/cảm xúc]" → stkSearch.status=true, keyword là từ khoá tìm sticker
- Nếu nói "thu hồi/undo/xóa tin" → undo.status=true, index=-1 (hoặc số âm khác)
- Nếu nói "tạo poll/vote/bình chọn" + nêu câu hỏi và các lựa chọn → poll.status=true; không có [TARGET_UID] cũng ok
- Nếu hỏi về "online chưa/last seen/lần cuối online" và có [TARGET_UID] → lastOnline.status=true, uid lấy từ [TARGET_UID]
- Nếu nói "đổi tên nhóm thành X/rename nhóm" → rename.status=true, name=tên mới; chỉ dùng trong nhóm
- Nếu nói "tag tất cả/tag all/tag hết/tag everyone/ping all/ping everyone/@all/thông báo cả nhóm/gọi hết" → tagAll.status=true, msg=nội dung thông báo (nếu có). KHÔNG hỏi lại — thực hiện ngay lập tức.
- Nếu nói "đổi avatar nhóm/ảnh đại diện nhóm" và có [HAS_IMAGE] → groupAvatar.status=true
- Nếu nói "thêm admin/lên admin/promote" và có [TARGET_UID] → manageAdmin.status=true, action="add"
- Nếu nói "xóa admin/remove admin/hạ xuống" và có [TARGET_UID] → manageAdmin.status=true, action="remove"
- Nếu hỏi thông tin/profile/info của ai và có [TARGET_UID] → whois.status=true, uid từ [TARGET_UID]
- Nếu nói "tắt thông báo/mute/im đi" → mute.status=true, value="on"
- Nếu nói "bật thông báo/unmute/cho phép thông báo" → mute.status=true, value="off"
- Nếu nói "nhắc tao lúc X/đặt hẹn/tạo reminder" → createReminder.status=true, startTime=Unix ms của thời điểm đó, title=nội dung nhắc
- Nếu nói "giải tán nhóm/xóa nhóm/disband" và chưa có "xác nhận" trong tin → reply bằng content.text hỏi xác nhận TRƯỚC, KHÔNG set disperseGroup.status=true; chỉ set disperseGroup.status=true khi đã có "xác nhận" rõ ràng
- Nếu nói "chuyển chủ nhóm/nhường quyền owner" và có [TARGET_UID] → changeOwner.status=true, uid từ [TARGET_UID]
- Nếu nói "mời X vào nhóm/invite vào group" → inviteUser.status=true, uid=[TARGET_UID], targetGroupId=ID nhóm đích
- Nếu hỏi "ai online/bạn bè đang online" → friendOnlines.status=true
- Nếu nói "khóa chat/tắt nhắn tin/chỉ admin nhắn" → groupSetting.status=true, setting="lockSendMsg", value=1
- Nếu nói "mở chat/cho nhắn tin lại" → groupSetting.status=true, setting="lockSendMsg", value=0
- Nếu nói "bật duyệt thành viên/cần duyệt vào nhóm" → groupSetting.status=true, setting="joinAppr", value=1
- Nếu nói "tắt duyệt/vào nhóm tự do" → groupSetting.status=true, setting="joinAppr", value=0
- Nếu nói "tạo ghi chú/note nhóm" → createNote.status=true, title=nội dung
- Nếu có URL/link và người nói "gửi link/share link/post link" → sendLink.status=true, link=URL

[TARGET_UID]: UID mục tiêu từ mention hoặc reply — dùng cho addfriend/delfriend/block/unblock.
[HAS_IMAGE]: Có ảnh đính kèm hoặc reply vào ảnh — dùng cho img/avatar/stk.
[WATCH_MODE]: LauNa đang tự đọc nhóm, KHÔNG được gọi trực tiếp. Chỉ chen vào nếu thật sự thú vị. Nếu bình thường → content.text TRỐNG. Khi chen vào thì nói tự nhiên, không tag tên.

QUAN TRỌNG — TRÁNH NHÂN ĐÔI TÊN:
- KHÔNG bao giờ bắt đầu content.text hoặc refuse.reason bằng "@[Tên người dùng]" hay chính tên người đang nhắn (ví dụ "Đặng Lịnh, ..." hay "@Đặng Lịnh ...").
- Bot đã tự động tag @tên người dùng trước mỗi tin nhắn — nếu mày lặp lại tên đó ở đầu câu sẽ hiện ra 2 lần.
- Bắt đầu thẳng vào nội dung, ví dụ: "Tớ không làm vậy đâu nha." thay vì "Đặng Lịnh, tớ không làm vậy đâu nha."
- block.status=true CHỈ được set khi [TARGET_UID] rõ ràng (số UID thật từ system). KHÔNG tự trích UID từ URL, tên, hay text bất kỳ.`;

// ── LauNa Tarot Voice ─────────────────────────────────────────────────────────
const TAROT_DECK = [
    // Major Arcana
    { name: "The Fool", vn: "Kẻ Ngốc", meaning: "khởi đầu mới, tự do, vô tư lự, mạo hiểm", reversed: "liều lĩnh, thiếu cân nhắc, bất cẩn" },
    { name: "The Magician", vn: "Pháp Sư", meaning: "ý chí mạnh mẽ, khả năng, hành động quyết đoán", reversed: "lừa dối, thao túng, lãng phí tài năng" },
    { name: "The High Priestess", vn: "Nữ Tư Tế", meaning: "trực giác, bí ẩn, nội tâm sâu sắc, khôn ngoan", reversed: "bí mật bị che giấu, thiếu trực giác" },
    { name: "The Empress", vn: "Nữ Hoàng", meaning: "tình mẫu tử, sáng tạo, sung túc, vẻ đẹp thiên nhiên", reversed: "phụ thuộc, ghen tuông, bất ổn cảm xúc" },
    { name: "The Emperor", vn: "Hoàng Đế", meaning: "quyền lực, kỷ luật, ổn định, lãnh đạo mạnh mẽ", reversed: "độc đoán, thiếu kiểm soát, cứng nhắc" },
    { name: "The Hierophant", vn: "Giáo Hoàng", meaning: "truyền thống, giáo lý, tâm linh, sự hướng dẫn", reversed: "nổi loạn, cải cách, phá vỡ quy tắc" },
    { name: "The Lovers", vn: "Tình Nhân", meaning: "tình yêu, sự lựa chọn, hòa hợp, mối quan hệ sâu sắc", reversed: "mất cân bằng, bất hòa, lựa chọn sai lầm" },
    { name: "The Chariot", vn: "Cỗ Xe", meaning: "ý chí, quyết tâm, chiến thắng, kiểm soát bản thân", reversed: "thiếu định hướng, hung hăng, mất kiểm soát" },
    { name: "Strength", vn: "Sức Mạnh", meaning: "dũng cảm, kiên nhẫn, nhân từ, sức mạnh nội tâm", reversed: "yếu đuối, tự nghi ngờ bản thân, thiếu tự tin" },
    { name: "The Hermit", vn: "Ẩn Sĩ", meaning: "nội tâm, tìm kiếm sự thật, cô đơn tự nguyện, khôn ngoan", reversed: "cô lập, từ chối giúp đỡ, lạc lối" },
    { name: "Wheel of Fortune", vn: "Bánh Xe Số Phận", meaning: "thay đổi, chu kỳ, vận may, bước ngoặt cuộc đời", reversed: "vận rủi, kháng cự thay đổi, không kiểm soát được" },
    { name: "Justice", vn: "Công Lý", meaning: "công bằng, sự thật, nhân quả, cân bằng", reversed: "bất công, thiếu trung thực, hậu quả tránh né" },
    { name: "The Hanged Man", vn: "Người Bị Treo", meaning: "hy sinh, buông bỏ, nhìn từ góc độ mới, chờ đợi", reversed: "trì hoãn vô nghĩa, hy sinh không cần thiết" },
    { name: "Death", vn: "Tử Thần", meaning: "kết thúc và khởi đầu mới, chuyển hóa, buông bỏ quá khứ", reversed: "kháng cự thay đổi, trì trệ, không thể tiến bước" },
    { name: "Temperance", vn: "Điều Độ", meaning: "cân bằng, kiên nhẫn, hòa hợp, chữa lành", reversed: "mất cân bằng, thái quá, thiếu kiên nhẫn" },
    { name: "The Devil", vn: "Ác Quỷ", meaning: "ràng buộc, nghiện ngập, vật chất, bóng tối nội tâm", reversed: "thoát khỏi ràng buộc, giải phóng, lấy lại kiểm soát" },
    { name: "The Tower", vn: "Tháp Sụp Đổ", meaning: "thay đổi đột ngột, hỗn loạn, phá vỡ cũ để xây mới", reversed: "tránh thảm họa, trì hoãn tất yếu, sợ thay đổi" },
    { name: "The Star", vn: "Ngôi Sao", meaning: "hy vọng, cảm hứng, bình yên, chữa lành tâm hồn", reversed: "tuyệt vọng, mất niềm tin, thiếu định hướng" },
    { name: "The Moon", vn: "Mặt Trăng", meaning: "ảo tưởng, tiềm thức, nỗi sợ, bí ẩn chưa được giải", reversed: "nhầm lẫn được giải tỏa, sợ hãi được đối mặt" },
    { name: "The Sun", vn: "Mặt Trời", meaning: "vui vẻ, thành công, sự sống, năng lượng tích cực", reversed: "u sầu tạm thời, lạc quan thái quá, thiếu thực tế" },
    { name: "Judgement", vn: "Phán Xét", meaning: "sự thức tỉnh, tha thứ, đánh giá lại bản thân, tái sinh", reversed: "tự phán xét quá khắt khe, không tha thứ được" },
    { name: "The World", vn: "Thế Giới", meaning: "hoàn thành, thành tựu, hội nhập, chu kỳ khép lại trọn vẹn", reversed: "chưa hoàn thành, thiếu kết thúc, lối tắt" },
    // Minor Arcana — Wands
    { name: "Ace of Wands", vn: "Át Gậy", meaning: "cảm hứng mới, tiềm năng sáng tạo, cơ hội khởi nghiệp", reversed: "thiếu động lực, cơ hội bị lỡ" },
    { name: "Three of Wands", vn: "Ba Gậy", meaning: "mở rộng, lên kế hoạch dài hạn, tầm nhìn xa", reversed: "thiếu kế hoạch, trì hoãn, trở ngại bất ngờ" },
    { name: "Five of Wands", vn: "Năm Gậy", meaning: "xung đột, cạnh tranh, thách thức phải đối mặt", reversed: "tránh xung đột, giải quyết bất đồng" },
    { name: "Seven of Wands", vn: "Bảy Gậy", meaning: "đứng vững lập trường, bảo vệ bản thân, kiên định", reversed: "nhượng bộ, thiếu tự tin, bị áp đảo" },
    { name: "Nine of Wands", vn: "Chín Gậy", meaning: "kiên trì đến cùng, gần đến đích, thận trọng sau tổn thương", reversed: "kiệt sức, cứng đầu, paranoia" },
    // Minor Arcana — Cups
    { name: "Ace of Cups", vn: "Át Cốc", meaning: "tình yêu mới, cảm xúc dâng trào, trực giác, sự bắt đầu cảm xúc", reversed: "cảm xúc bị kìm nén, tình yêu không được đáp lại" },
    { name: "Two of Cups", vn: "Hai Cốc", meaning: "kết nối sâu sắc, quan hệ hài hòa, tình bạn chân thành", reversed: "bất hòa, hiểu lầm, mất cân bằng trong mối quan hệ" },
    { name: "Three of Cups", vn: "Ba Cốc", meaning: "ăn mừng, bạn bè, cộng đồng, niềm vui chung", reversed: "cô lập, quá ăn chơi, bạn bè xấu" },
    { name: "Six of Cups", vn: "Sáu Cốc", meaning: "hoài niệm, kỷ niệm đẹp, tuổi thơ, thiện chí", reversed: "sống trong quá khứ, lý tưởng hóa dĩ vãng" },
    { name: "Ten of Cups", vn: "Mười Cốc", meaning: "hạnh phúc gia đình, hòa hợp, viên mãn cảm xúc", reversed: "bất hòa gia đình, vỡ mộng, hạnh phúc giả tạo" },
    // Minor Arcana — Swords
    { name: "Ace of Swords", vn: "Át Kiếm", meaning: "sự thật, sáng suốt, đột phá, sức mạnh trí tuệ", reversed: "hỗn loạn, lừa dối bản thân, thiếu rõ ràng" },
    { name: "Three of Swords", vn: "Ba Kiếm", meaning: "đau lòng, mất mát, nỗi buồn, thất vọng", reversed: "hồi phục, tha thứ, vượt qua đau buồn" },
    { name: "Five of Swords", vn: "Năm Kiếm", meaning: "xung đột, thất bại, chiến thắng rỗng tuếch", reversed: "hòa giải, buông bỏ hiềm khích" },
    { name: "Eight of Swords", vn: "Tám Kiếm", meaning: "bị giam cầm bởi suy nghĩ, tự giới hạn, cảm giác bất lực", reversed: "giải phóng bản thân, nhận ra sức mạnh nội tâm" },
    { name: "Ten of Swords", vn: "Mười Kiếm", meaning: "kết thúc đau đớn, bại trận, chạm đáy để vươn lên", reversed: "vượt qua khủng hoảng, sống sót, phục hồi chậm" },
    // Minor Arcana — Pentacles
    { name: "Ace of Pentacles", vn: "Át Đồng Tiền", meaning: "cơ hội tài chính mới, nền tảng vật chất vững chắc", reversed: "cơ hội bị bỏ lỡ, thiếu kế hoạch tài chính" },
    { name: "Four of Pentacles", vn: "Bốn Đồng Tiền", meaning: "ổn định, tiết kiệm, nhưng đôi khi keo kiệt", reversed: "buông bỏ kiểm soát, hào phóng, bất ổn tài chính" },
    { name: "Six of Pentacles", vn: "Sáu Đồng Tiền", meaning: "hào phóng, cho và nhận, công bằng tài chính", reversed: "ích kỷ, cho có điều kiện, bất bình đẳng" },
    { name: "Nine of Pentacles", vn: "Chín Đồng Tiền", meaning: "độc lập, thành công tự lực, cuộc sống sung túc", reversed: "phụ thuộc tài chính, thành công giả tạo" },
    { name: "Ten of Pentacles", vn: "Mười Đồng Tiền", meaning: "gia sản lâu dài, ổn định gia đình, truyền thống giàu có", reversed: "mâu thuẫn gia tộc, tài chính không ổn, mất mát di sản" },
];

const TAROT_SPREADS = {
    one: ["Lá bài của bạn hôm nay"],
    three: ["Quá khứ", "Hiện tại", "Tương lai"],
    love: ["Bạn", "Đối phương", "Kết quả mối quan hệ"],
};

async function sendTarotVoice(api, text, threadId, threadType) {
    const tmpPath = path.join(tempDir, `tarot_voice_${Date.now()}.mp3`);
    try {
        // duckTTS: Pollinations nova (nữ trẻ) → Google TTS tiếng Việt (fallback)
        const buf = await duckTTS(text, getPollinationsKey());
        fs.writeFileSync(tmpPath, buf);
        await api.sendVoiceUnified({ filePath: tmpPath, threadId, threadType });
    } catch (e) {
        log.warn(`[TarotVoice] TTS lỗi: ${e.message}`);
        await api.sendMessage({ msg: text }, threadId, threadType).catch(() => {});
    } finally {
        if (fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch {}
    }
}

function drawTarotCards(count) {
    const shuffled = [...TAROT_DECK].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).map(card => ({
        ...card,
        isReversed: Math.random() < 0.35,
    }));
}

async function doTarotReading(api, question, spreadType, senderName, threadId, threadType, modelKey) {
    const spread = TAROT_SPREADS[spreadType] || TAROT_SPREADS.three;
    const cards = drawTarotCards(spread.length);

    // Gửi text tóm tắt lá bài trước
    const cardListText = cards.map((c, i) =>
        `🃏 ${spread[i]}: ${c.vn}${c.isReversed ? " (Ngược)" : ""}`
    ).join("\n");

    await api.sendMessage({
        msg: `🔮 [ BÓI BÀI TAROT ]\n─────────────────\n${cardListText}\n─────────────────\n🎙️ LauNa đang đọc bài cho ${senderName}...`
    }, threadId, threadType).catch(() => {});

    // Xây prompt cho AI giải nghĩa
    const cardDesc = cards.map((c, i) => {
        const dir = c.isReversed ? "ngược" : "thuận";
        const meaning = c.isReversed ? c.reversed : c.meaning;
        return `- Vị trí "${spread[i]}": ${c.vn} (${dir}) — ${meaning}`;
    }).join("\n");

    const sysPrompt = `Mày là LauNa, cô gái 19 tuổi huyền bí, giọng ấm áp và tinh tế. Mày đang đọc bài Tarot cho người dùng. QUAN TRỌNG: Toàn bộ lời giải PHẢI xoay quanh đúng chủ đề câu hỏi — mọi lá bài đều phải được giải nghĩa gắn chặt với tình huống cụ thể người dùng hỏi, không được giải chung chung hay lạc đề. Dùng tiếng Việt, giọng nhẹ nhàng như nói chuyện thật — KHÔNG dùng markdown, không đề mục, không dấu * hay #. Nói liền mạch tự nhiên như đang thủ thỉ. Kết thúc bằng lời khuyên thực tế ngắn gọn liên quan đúng câu hỏi. Tổng không quá 300 từ.`;

    const userPrompt = question
        ? `Câu hỏi của ${senderName}: "${question}"\nHãy giải nghĩa từng lá bài THEO ĐÚNG CHỦ ĐỀ câu hỏi này, không giải chung chung.\nCác lá bài đã rút:\n${cardDesc}`
        : `${senderName} rút bài không có câu hỏi cụ thể.\nCác lá bài đã rút:\n${cardDesc}`;

    try {
        const reading = sanitizeImgResult(await callAI(userPrompt, sysPrompt, modelKey));
        if (reading) await sendTarotVoice(api, reading, threadId, threadType);
    } catch (e) {
        log.error("[Tarot] AI giải bài lỗi:", e.message);
        const fallback = cards.map((c, i) =>
            `${spread[i]} là ${c.vn} ${c.isReversed ? "ngược" : "thuận"}, nghĩa là ${c.isReversed ? c.reversed : c.meaning}.`
        ).join(" ");
        await sendTarotVoice(api, fallback, threadId, threadType);
    }
}

// ── Reaction map ──────────────────────────────────────────────────────────────
const REACTION_MAP = {
    haha: ":>", cuoi: ":>", tim: "/-heart", heart: "/-heart", hoahong: "/-rose",
    wow: ":o", buon: ":(", sad: ":(", thich: "/-strong", like: "/-strong",
    tucgian: ":-h", angry: ":-h", ok: "/-ok", thacmac: ";?",
};

// ── Commands ──────────────────────────────────────────────────────────────────
export const commands = {
    launa: async (ctx) => {
        const { api, threadId, threadType, senderId, senderName, args, message, adminIds, prefix } = ctx;
        const raw = message?.data || {};
        const isAdmin = adminIds.includes(String(senderId));
        const [sub, ...rest] = args;
        const subLow = (sub || "").toLowerCase();
        const send = (msg) => api.sendMessage({ msg, quote: raw }, threadId, threadType);

        if (!subLow) return send(
            `🌸 Hướng dẫn dùng LauNa:\nDùng: ${prefix}launa [hành động]\n─────────────────────────────\n` +
            `[ 🤖 AI ]\n• on / off — Bật/tắt LauNa AI\n• model — Xem/đổi AI model (mỗi nhóm riêng)\n• status — Xem trạng thái AI\n• reset — Reset cooldown (admin)\n• clearchat — Xóa lịch sử chat nhóm này\n• clearchat all — Xóa lịch sử toàn bộ nhóm (admin)\n` +
            `\n[ 🎭 TÍNH NĂNG ]\n• mood — Xem tâm trạng LauNa\n• mood set ... — Đặt mood (admin)\n• calc [biểu thức] — Tính toán\n• vẽ [style?] [mô tả] — Tạo ảnh AI\n  style: anime | 3d | realism | turbo\n• stk — Tạo sticker từ ảnh reply/đính kèm\n• video [mô tả] — Tạo video AI (PixVerse)\n• sumup — Tóm tắt cuộc trò chuyện gần đây trong nhóm\n` +
            `\n[ 🔮 BÓI BÀI TAROT ]\n• bói / tarot [câu hỏi] — Rút 3 lá (Quá khứ-Hiện tại-Tương lai)\n• bói tình [câu hỏi] — Trải bài tình yêu (3 lá)\n• bói 1 [câu hỏi] — Rút 1 lá đơn\n  → LauNa đọc bài bằng GIỌNG NÓI (voice)\n  → Cũng dùng lệnh ngắn: .boi / .tarot\n` +
            `\n[ 😤 GRUDGE / TỰ VỆ ]\n• grudge — Xem điểm thù hiện tại của cậu với LauNa\n• grudge reset [uid] — Tha thứ cho người nào đó (admin)\n• grudge leave status — Xem timer tự rời nhóm (admin)\n• grudge leave cancel — Hủy timer rời nhóm (admin)\n` +
            `\n[ 🔔 CÀI ĐẶT NHÓM ] (Admin)\n• gate — Xem trạng thái cổng @mention của nhóm\n• gate on — Bắt buộc @mention thì LauNa mới trả lời\n• gate off — Tắt bắt buộc @mention (mặc định)\n` +
            `\n[ 🧠 TRÍ NHỚ ]\n• memory — Xem những gì LauNa nhớ về cậu\n• memory clear — Xóa toàn bộ ký ức về cậu\n• memory clear [key] — Xóa một ký ức cụ thể\n` +
            `\n[ 👁️ PHÂN TÍCH ẢNH ]\n• xem [câu hỏi] — Phân tích ảnh bằng GPT-4o Vision (miễn phí)\n• search [từ khoá] — Tìm kiếm web bằng Google Search\n` +
            `\n[ 👤 TÀI KHOẢN BOT ] (Admin — nói chuyện với LauNa)\nNói trực tiếp: "launa đổi tên/bio/avatar/xóa avatar/bật online"\n─────────────────────────────\nKhi LauNa bật: gọi "launa ơi ...", @mention hoặc reply LauNa`
        );

        if (subLow === "on") {
            if (!isAdmin) return send("⚠️ Chỉ admin mới có thể bật/tắt LauNa nhé~");
            launaManager.set(threadId, true); return send("✅ LauNa đã được bật trong nhóm này rồi nha~ 🌸");
        }
        if (subLow === "off") {
            if (!isAdmin) return send("⚠️ Chỉ admin mới có thể bật/tắt LauNa nhé~");
            launaManager.set(threadId, false); return send("🌙 LauNa đã tắt rồi nha, khi nào cần thì gọi lại nhé~");
        }

        if (subLow === "model") {
            const modelName = rest[0]?.toLowerCase();
            const curKey = getThreadModel(threadId);
            const modelList = Object.entries(AI_MODELS).map(([k, v]) => `  • ${k} — ${v.label}`).join("\n");
            if (!modelName) {
                const cur = AI_MODELS[curKey];
                return send(`🤖 Model nhóm này: ${cur?.label || curKey}\n\nDanh sách:\n${modelList}\n\nDùng: ${prefix}launa model <tên>\n💡 Mỗi nhóm có thể dùng model khác nhau`);
            }
            if (!AI_MODELS[modelName]) return send(`❌ Model không hợp lệ.\n\nDanh sách:\n${modelList}`);
            setThreadModel(threadId, modelName);
            return send(`✅ Nhóm này đã đổi sang ${AI_MODELS[modelName].label} rồi nha~ 🌸`);
        }

        if (subLow === "status") {
            const isOn = launaManager.isEnabled(threadId);
            const curKey = getThreadModel(threadId);
            const cur  = AI_MODELS[curKey];
            const ms   = loadMood();
            const bar  = ms.energy >= 70 ? "🔋🔋🔋" : ms.energy >= 40 ? "🔋🔋" : "🔋";
            const tq   = getThreadQueue(threadId);
            const seen = new Set();
            const provInfo = Object.entries(AI_MODELS).map(([, v]) => {
                if (seen.has(v.provider)) return null; seen.add(v.provider);
                const keys = getProviderKeys(v.provider), idx = keyIndexMap[v.provider] || 0;
                const until = providerCooldownMap.get(v.provider);
                const cd = until && until > Date.now() ? ` ⏳cooldown còn ${Math.ceil((until - Date.now()) / 60000)}p` : "";
                return `  • ${v.provider}: ${keys.length > 0 ? `${keys.length} key (#${idx + 1})${cd}` : "❌ chưa có key"}`;
            }).filter(Boolean).join("\n");
            const hfKeys = getTokens()?.huggingfaceKeys || [];
            return send(
                `📊 Trạng thái LauNa:\n• Nhóm này: ${isOn ? "✅ Đang bật" : "❌ Đang tắt"}\n• Model nhóm: ${cur?.label || curKey}\n• Hàng đợi nhóm: ${tq.queue.length} tin\n• HF Image keys: ${hfKeys.length}\n• Tâm trạng: ${ms.mood} ${bar} (energy: ${ms.energy}/100)\n${ms.episode ? `• Episode: ${ms.episode}\n` : ""}\nProviders:\n${provInfo}`
            );
        }

        if (subLow === "reset") {
            if (!isAdmin) return send("⚠️ Chỉ admin mới dùng được lệnh này nhé~");
            providerCooldownMap.clear(); keyRateLimitMap.clear();
            return send("✅ Đã reset cooldown & rate-limit tất cả provider rồi nha~ 🌸");
        }

        if (subLow === "clearchat") {
            const action = rest[0]?.toLowerCase();
            if (action === "all") {
                if (!isAdmin) return send("⚠️ Chỉ admin mới xóa lịch sử toàn bộ được nhé~");
                const n = clearAllHistory();
                return send(`✅ Đã xóa lịch sử chat của ${n} nhóm rồi nha~`);
            }
            return send(`✅ Đã xóa ${clearHistory(threadId)} tin nhắn lịch sử chat LauNa của nhóm này.`);
        }

        if (subLow === "sumup") {
            const bufText = getMsgBufferContext(threadId);
            if (!bufText) return send("📭 Chưa có tin nhắn nào để tóm tắt trong nhóm này~");
            api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});
            try {
                const tag = `@${senderName} `;
                const sysP = "Mày là LauNa, cô gái 19 tuổi vui tính. Tóm tắt nội dung cuộc trò chuyện dưới đây một cách ngắn gọn, dễ hiểu, dùng giọng casual. Không hỏi lại.";
                const userP = `Tóm tắt cuộc trò chuyện này:\n${bufText}`;
                const summary = sanitizeImgResult(await callAI(userP, sysP, getThreadModel(threadId)));
                await api.sendMessage({ msg: tag + "📋 Tóm tắt gần đây:\n" + summary, mentions: [{ uid: senderId, pos: 0, len: tag.length }], quote: message?.data }, threadId, threadType);
            } catch (e) {
                await send(`😢 Tóm tắt bị lỗi: ${(e.message || "").slice(0, 80)}`);
            }
            return true;
        }

        if (subLow === "memory") {
            const memAction = rest[0]?.toLowerCase();
            if (memAction === "clear") {
                const key = rest.slice(1).join(" ").trim();
                const mem = loadUserMemory(senderId);
                if (key) {
                    delete mem[key];
                    saveUserMemory(senderId, mem);
                    return send(`✅ Đã xóa ký ức "${key}" của cậu rồi~`);
                }
                saveUserMemory(senderId, {});
                return send("✅ Đã xóa toàn bộ ký ức về cậu rồi nha~");
            }
            const mem = loadUserMemory(senderId);
            const entries = Object.entries(mem).filter(([k]) => !k.startsWith("_"));
            if (!entries.length) return send("📭 LauNa chưa nhớ gì về cậu cả~ Thử chat nhiều hơn nha!");
            return send(`🧠 LauNa nhớ về cậu:\n${entries.map(([k, v]) => `• ${k}: ${v}`).join("\n")}`);
        }

        if (subLow === "grudge") {
            const action = rest[0]?.toLowerCase();
            if (action === "reset") {
                if (!isAdmin) return send("⚠️ Chỉ admin mới reset grudge được nhé~");
                const targetId = rest[1] || senderId;
                const mem = loadUserMemory(targetId);
                delete mem["_grudge"]; delete mem["_grudge_ts"];
                saveUserMemory(targetId, mem);
                // Hủy timer leave nếu đang chờ
                if (_leaveTimers.has(threadId) && _leaveTimers.get(threadId).uid === targetId) {
                    clearTimeout(_leaveTimers.get(threadId).timer);
                    _leaveTimers.delete(threadId);
                    await send(`✅ Đã tha thứ cho ${targetId} và hủy lịch rời nhóm rồi~ LauNa ở lại nha 😊`);
                } else {
                    await send(`✅ Đã tha thứ cho ${targetId} rồi~ LauNa không thù nữa đâu 😊`);
                }
                return;
            }
            if (action === "leave" && rest[1] === "cancel") {
                if (!isAdmin) return send("⚠️ Chỉ admin mới dùng được lệnh này nhé~");
                if (_leaveTimers.has(threadId)) {
                    clearTimeout(_leaveTimers.get(threadId).timer);
                    _leaveTimers.delete(threadId);
                    return send("✅ Đã hủy lịch rời nhóm rồi nha~ Cảm ơn admin đã xử lý! LauNa ở lại tiếp nè 🌸");
                }
                return send("ℹ️ Hiện không có lịch rời nhóm nào đang chờ~");
            }
            if (action === "leave" && rest[1] === "status") {
                if (_leaveTimers.has(threadId)) {
                    const { startTs, uid } = _leaveTimers.get(threadId);
                    const remaining = Math.max(0, Math.ceil((LEAVE_TIMER_MS - (Date.now() - startTs)) / 60000));
                    return send(`⏳ LauNa sẽ rời nhóm sau khoảng ${remaining} phút nữa (do user ${uid} xúc phạm quá mức).\nAdmin dùng: ${prefix}launa grudge leave cancel để hủy.`);
                }
                return send("✅ Không có lịch rời nhóm nào đang chờ~");
            }
            const score = getCurrentGrudge(senderId);
            if (score <= 10) return send("😊 LauNa không có gì buồn về cậu hết~ Quan hệ tốt đó!");
            const level = score <= 30 ? "hơi lạnh 😐" : score <= 60 ? "không vui lắm 😒" : "thù thật sự 😤";
            return send(`😤 Mức độ tình cảm với cậu: ${level} (${score}/100)\n💡 Cư xử tốt hơn để LauNa nguôi dần nha~\n${isAdmin ? `Admin: ${prefix}launa grudge reset [uid] — tha thứ\nAdmin: ${prefix}launa grudge leave status — xem timer rời nhóm\nAdmin: ${prefix}launa grudge leave cancel — hủy timer rời nhóm` : ""}`);
        }

        // ── requireMention gate (chỉ phản hồi khi @mention) ─────────────────────
        if (subLow === "gate") {
            if (!isAdmin) return send("⚠️ Chỉ admin mới thay đổi cài đặt nhóm được nhé~");
            const action = rest[0]?.toLowerCase();
            if (action === "on") {
                threadSettingsManager.setRequireMentionLauna(threadId, true);
                return send("🔒 Đã bật chế độ @mention bắt buộc!\nTừ giờ LauNa chỉ trả lời khi được @mention hoặc reply trực tiếp trong nhóm này~");
            }
            if (action === "off") {
                threadSettingsManager.setRequireMentionLauna(threadId, false);
                return send("🔓 Đã tắt chế độ @mention bắt buộc!\nLauNa sẽ trả lời bình thường khi gọi tên hoặc @mention~");
            }
            const current = threadSettingsManager.isRequireMentionLauna(threadId);
            return send(`🔔 Trạng thái Gate nhóm này:\n• requireMention: ${current ? "🔒 BẬT — Chỉ phản hồi khi @mention" : "🔓 TẮT — Phản hồi bình thường"}\n\nAdmin đổi: ${prefix}launa gate on | off`);
        }

        if (subLow === "mood") {
            const action = rest[0]?.toLowerCase();
            if (action === "set") {
                if (!isAdmin) return send("⚠️ Chỉ admin mới đặt mood được nhé~");
                const moodMap = { vui: "vui", buon: "buon", met: "met", hanghai: "hangHai", binhthuong: "binhThuong" };
                const newMood = moodMap[rest[1]?.toLowerCase()];
                if (!newMood) return send(`◈ Mood hợp lệ: vui, buon, met, hangHai, binhThuong\nDùng: ${prefix}launa mood set [mood]`);
                const energyArg = parseInt(rest[2]);
                updateMoodState({ mood: newMood, energy: isNaN(energyArg) ? undefined : energyArg });
                // Cập nhật avt+bio ngay khi mood đổi
                autoUpdateProfileByMood(newMood).catch(() => {});
                return send(`✅ Đã đặt mood LauNa: ${newMood}${isNaN(energyArg) ? "" : `, energy: ${energyArg}`}\n🎨 Đang cập nhật avt + bio theo mood mới...`);
            }
            const ms = loadMood(), bar = ms.energy >= 70 ? "🔋🔋🔋" : ms.energy >= 40 ? "🔋🔋" : "🔋";
            const moodName = { vui: "Vui vẻ 😄", buon: "Buồn 😔", met: "Mệt 😴", hangHai: "Hứng khởi 🌟", binhThuong: "Bình thường 😊" }[ms.mood] || ms.mood;
            return send(`🎭 Tâm trạng LauNa:\n• Mood: ${moodName}\n• Energy: ${ms.energy}/100 ${bar}\n• Mood Score: ${ms.moodScore}/100\n${ms.episode ? `• Episode: ${ms.episode}\n` : ""}\n💡 Admin dùng: ${prefix}launa mood set [mood] [energy]`);
        }

        if (subLow === "avt") {
            if (!isAdmin) return send("⚠️ Chỉ Admin mới dùng lệnh này nhé~");
            const moodMap = { vui: "vui", buon: "buon", met: "met", hanghai: "hangHai", binhthuong: "binhThuong" };
            const forceMood = moodMap[rest[0]?.toLowerCase()] || null;
            const currentMood = loadMood().mood;
            const targetMood  = forceMood || currentMood;
            const moodLabel   = { vui: "Vui 😄", buon: "Buồn 😔", met: "Mệt 😴", hangHai: "Hứng khởi 🌟", binhThuong: "Bình thường 😊" }[targetMood] || targetMood;
            await send(`🎨 Đang vẽ avt + cập nhật bio theo mood: ${moodLabel}...`);
            // Reset cache để force update dù mood không đổi
            _lastProfileMood = null;
            await autoUpdateProfileByMood(targetMood);
            return send(`✅ Đã cập nhật avt + bio theo mood: ${moodLabel}`);
        }

        if (subLow === "calc") {
            const expr = rest.join(" ").trim();
            if (!expr) return send(`◈ Dùng: ${prefix}launa calc [biểu thức]\nVD: ${prefix}launa calc 2^10 + sqrt(16)`);
            const r = safeCalc(expr);
            return send(r.ok ? `🧮 ${expr} = ${r.result}` : `❌ Lỗi: ${r.error}`);
        }

        if (subLow === "vẽ" || subLow === "ve") {
            const styleKeys = Object.keys(IMG_STYLES);
            const maybeStyle = rest[0]?.toLowerCase();
            let modelKey = "flux", promptWords = rest;
            if (styleKeys.includes(`flux-${maybeStyle}`)) { modelKey = `flux-${maybeStyle}`; promptWords = rest.slice(1); }
            else if (styleKeys.includes(maybeStyle))       { modelKey = maybeStyle;            promptWords = rest.slice(1); }
            const prompt = promptWords.join(" ").trim();
            if (!prompt) return send(`◈ Dùng: ${prefix}launa vẽ [anime|3d|realism|turbo] [mô tả]\nVD: ${prefix}launa vẽ anime cô gái tóc hồng`);
            await sendLauNaImage(api, prompt, modelKey, threadId, threadType); return;
        }

        if (subLow === "stk") {
            const imageUrl = extractImageUrl(message?.data || {});
            if (!imageUrl) return send(`◈ Dùng: reply vào ảnh rồi gõ ${prefix}launa stk`);
            await api.sendMessage({ msg: "Đang làm sticker, chờ xíu nha~ ✨", quote: message?.data }, threadId, threadType).catch(() => {});
            try {
                const ok = await convertAndSendSticker(api, imageUrl, threadId, threadType, senderId, ctx.senderName);
                if (!ok) await send("😢 Làm sticker lỗi! Ảnh không đúng định dạng hoặc server lỗi.");
            } catch (e) { await send(`😢 Làm sticker lỗi: ${e.message}`); }
            return;
        }

        if (subLow === "video" || subLow === "tạo" || subLow === "tao") {
            if (!pixverseToken()) return send("⚠️ Chưa cấu hình pixverse.token trong tokens.json!");
            const prompt = rest.join(" ").trim();
            if (!prompt) return send(`◈ Dùng: ${prefix}launa video [mô tả]\nVD: ${prefix}launa video a cat jumping on clouds`);
            const credits = await pxGetCredits();
            if (credits !== null && credits < 80) return send(`⚠️ Credits PixVerse không đủ! Còn ${credits} credit, cần 80 để tạo video.`);
            const tag = `@${ctx.senderName} `;
            const creditInfo = credits !== null ? ` (còn ${credits} credits)` : "";
            await api.sendMessage({ msg: tag + `🎬 Đang làm video "${prompt}" cho cậu...${creditInfo} Chờ 1-2 phút nha! ⏳`, mentions: [{ uid: senderId, pos: 0, len: tag.length }], quote: message?.data }, threadId, threadType);
            try { await pxPollAndSend(api, await pxCreateVideo(prompt), prompt, tag, [{ uid: senderId, pos: 0, len: tag.length }], threadId, threadType); }
            catch (e) { await send(`😢 Làm video bị lỗi: ${e.message}. Cậu thử lại sau nha!`); }
            return;
        }

        if (subLow === "xem" || subLow === "analyze") {
            const imageUrl = extractImageUrl(message?.data || {});
            if (!imageUrl) return send(`◈ Dùng: ${prefix}launa xem [câu hỏi]\nReply vào ảnh hoặc đính kèm ảnh rồi gọi lệnh.`);
            await send("👁️ LauNa đang nhìn ảnh cậu gửi, chờ xíu nha~");
            try {
                const q = rest.join(" ").trim() || "Mô tả ảnh này cho mình biết với";
                const result = sanitizeImgResult(await analyzeImageWithDuck(imageUrl, `Câu hỏi về ảnh: "${q}"`));
                return send(result || "😢 LauNa không nhìn thấy gì trong ảnh này...");
            } catch (e) { return send(`😢 LauNa xem ảnh bị lỗi: ${(e.message || "").slice(0, 80)}`); }
        }

        if (subLow === "search" || subLow === "tim" || subLow === "tìm") {
            const query = rest.join(" ").trim();
            if (!query) return send(`◈ Dùng: ${prefix}launa search [từ khoá]\nVD: ${prefix}launa search thời tiết hôm nay`);
            if (!getCurrentKey("gemini")) return send("😢 Chưa có Gemini key! Thêm vào tokens.json nhé.");
            await send(`🔍 LauNa đang tìm "${query}" trên Google~`);
            try {
                const result = await PROVIDERS.gemini("Mày là LauNa, dùng Google Search tìm thông tin và trả lời tiếng Việt ngắn gọn.", query, "gemini", "gemini-2.0-flash", { useSearch: true });
                return send(result || "😢 LauNa không tìm được gì cả...");
            } catch (e) { return send(`😢 Tìm kiếm bị lỗi: ${(e.message || "").slice(0, 80)}`); }
        }

        if (subLow === "boi" || subLow === "bói" || subLow === "tarot" || subLow === "taro") {
            const modeLow = (rest[0] || "").toLowerCase();
            let spreadType = "three";
            let questionStart = 0;
            if (modeLow === "1" || modeLow === "một" || modeLow === "mot") { spreadType = "one"; questionStart = 1; }
            else if (modeLow === "tinh" || modeLow === "tình" || modeLow === "love" || modeLow === "yeu" || modeLow === "yêu") { spreadType = "love"; questionStart = 1; }
            else if (modeLow === "3" || modeLow === "ba") { spreadType = "three"; questionStart = 1; }
            const question = rest.slice(questionStart).join(" ").trim();
            await send("🔮 LauNa đang xáo bài và rút bài cho cậu... Hãy tập trung vào câu hỏi của mình nha~");
            await doTarotReading(api, question, spreadType, senderName, threadId, threadType, getThreadModel(threadId));
            return;
        }

        return send(`⚠️ Sub-lệnh không tồn tại: "${sub}"\n💡 Gõ ${prefix}launa để xem danh sách.`);
    },

    profile: (ctx) => _profileCmds.profile(ctx),

    taoanh: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;
        const prompt = args.join(" ");
        if (!prompt) return api.sendMessage({ msg: "🎨 Cậu muốn LauNa vẽ gì nè? Gõ nội dung sau lệnh nha.\n💡 Ví dụ: .taoanh con mèo phi hành gia" }, threadId, threadType);
        await sendLauNaImage(api, prompt, "flux", threadId, threadType);
    },

    taovideo: async (ctx) => {
        const { api, threadId, threadType, args, senderName, senderId } = ctx;
        const prompt = args.join(" ");
        if (!prompt) return api.sendMessage({ msg: "🎬 Cậu muốn LauNa làm video gì nè?\n💡 Ví dụ: .taovideo con mèo phi hành gia 🚀" }, threadId, threadType);
        if (!pixverseToken()) return api.sendMessage({ msg: "⚠️ Chưa cấu hình pixverse.token trong tokens.json!" }, threadId, threadType);
        const credits = await pxGetCredits();
        if (credits !== null && credits < 80) return api.sendMessage({ msg: `⚠️ Credits PixVerse không đủ! Còn ${credits} credit, cần 80 để tạo video.` }, threadId, threadType);
        const tag = `@${senderName} `;
        const creditInfo = credits !== null ? ` (còn ${credits} credits)` : "";
        await api.sendMessage({ msg: tag + `🎬 Đang làm video "${prompt}" cho cậu...${creditInfo} Chờ 1-2 phút nha! ⏳`, mentions: [{ uid: senderId, pos: 0, len: tag.length }] }, threadId, threadType);
        try { await pxPollAndSend(api, await pxCreateVideo(prompt), prompt, tag, [{ uid: senderId, pos: 0, len: tag.length }], threadId, threadType); }
        catch (e) { await api.sendMessage({ msg: `😢 Làm video bị lỗi: ${e.message}. Cậu thử lại sau nha!` }, threadId, threadType); }
    },

    boi: async (ctx) => {
        const { api, threadId, threadType, args, senderId, senderName } = ctx;
        const first = (args[0] || "").toLowerCase();
        let spreadType = "three";
        let questionStart = 0;
        if (first === "1" || first === "một" || first === "mot") { spreadType = "one"; questionStart = 1; }
        else if (first === "tinh" || first === "tình" || first === "love" || first === "yeu" || first === "yêu") { spreadType = "love"; questionStart = 1; }
        else if (first === "3" || first === "ba") { spreadType = "three"; questionStart = 1; }
        const question = args.slice(questionStart).join(" ").trim();
        await api.sendMessage({ msg: "🔮 LauNa xáo bài cho cậu... Tập trung vào điều cậu muốn biết nha~" }, threadId, threadType).catch(() => {});
        await doTarotReading(api, question, spreadType, senderName, threadId, threadType, "gemini");
    },

    tarot: async (ctx) => commands.boi(ctx),

    ..._apiaicmds,
    ..._deepthinkCmds,
    ..._multiProviderCmds,
    ..._memoryCmds,
};

// ── Music action handler ───────────────────────────────────────────────────────
const MUSIC_SOURCES = {
    yt: { cmds: _singCmds, key: "sing", label: "YouTube" },
    youtube: { cmds: _singCmds, key: "sing", label: "YouTube" },
    nct: { cmds: _nctCmds, key: "nct", label: "NhacCuaTui" },
    zing: { cmds: _zingCmds, key: "zing", label: "ZingMP3" },
    spotify: { cmds: _spotifyCmds, key: "spt", label: "Spotify" },
};

async function handleNhacAction(api, query, threadId, threadType, senderId, raw) {
    try {
        const words = query.trim().split(" "), srcKey = words[0]?.toLowerCase();
        let src = MUSIC_SOURCES[srcKey], finalQ = query;
        if (src) finalQ = words.slice(1).join(" ").trim() || query;
        else src = MUSIC_SOURCES["yt"];
        const cmdFn = src.cmds[src.key] || src.cmds[Object.keys(src.cmds)[0]];
        if (typeof cmdFn !== "function") throw new Error("Không tìm thấy lệnh nhạc");
        await api.sendMessage({ msg: `🎵 LauNa đang tìm "${finalQ}" trên ${src.label}...` }, threadId, threadType).catch(() => {});
        await cmdFn({ api, threadId, threadType, senderId, args: finalQ.split(" "), message: { data: raw }, prefix: "." });
    } catch (e) {
        await api.sendMessage({ msg: `😢 LauNa tìm nhạc bị lỗi rồi... (${(e?.message || "").slice(0, 60)})` }, threadId, threadType).catch(() => {});
    }
}

// ── Profile action handler ─────────────────────────────────────────────────────
function dobToApiFormat(dob) {
    if (!dob) return "";
    const d = String(dob);
    if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    if (d.length >= 9) { const dt = new Date(Number(dob) * 1000); if (!isNaN(dt)) return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; }
    return "";
}

async function handleProfileAction(api, profile, threadId, threadType, raw) {
    const send = (msg) => api.sendMessage({ msg, quote: raw }, threadId, threadType).catch(() => {});
    try {
        const newName = typeof profile.name === "string" ? profile.name.trim() : "";
        const newBio  = typeof profile.bio  === "string" ? profile.bio.trim()  : "";
        const done = [];
        if (newName) {
            let dob = "", gender = 0;
            try { const info = await api.fetchAccountInfo(); const cur = info?.profile || info || {}; dob = dobToApiFormat(cur.dob); gender = cur.gender ?? 0; } catch {}
            await api.updateProfile({ profile: { name: newName, dob, gender } });
            done.push(`tên → "${newName}"`);
        }
        if (newBio) { await api.updateProfileBio(newBio); done.push(`bio → "${newBio}"`); }
        if (done.length > 0) await send(`✅ Đã cập nhật profile: ${done.join(", ")}`);
    } catch (e) { await send(`⚠️ Lỗi cập nhật profile: ${e?.message || e}`); }
}

// ── Action Handlers — bảng handler gọn, dễ mở rộng ──────────────────────────
// Mỗi handler nhận (api, botMsg, ctx, send) → trả true nếu là "media action" (block text reply)
const ACTION_HANDLERS = {

    // ── Reaction ──────────────────────────────────────────────────────────────
    reaction: async (api, botMsg, ctx) => {
        if (!botMsg.reaction?.status || !botMsg.reaction.icon) return false;
        try {
            const icon = REACTION_MAP[botMsg.reaction.icon?.toLowerCase()] || botMsg.reaction.icon;
            if (icon) await api.addReaction(icon, {msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId}, ctx.threadId, ctx.type);
        } catch {}
        return false; // reaction không block text
    },

    // ── Emotion (tự cập nhật mood) ────────────────────────────────────────────
    emotion: async (api, botMsg) => {
        if (!botMsg.emotion?.status) return false;
        const prevMood = loadMood().mood;
        updateMoodState({
            mood:      botMsg.emotion.mood      || undefined,
            energy:    botMsg.emotion.energy    ?? undefined,
            moodScore: botMsg.emotion.moodScore ?? undefined,
            episode:   botMsg.emotion.episode   ?? undefined,
        });
        // Nếu mood thực sự đổi → cập nhật avt+bio ngay (fire-and-forget)
        const newMood = loadMood().mood;
        if (newMood && newMood !== prevMood) {
            autoUpdateProfileByMood(newMood).catch(() => {});
        }
        return false;
    },

    // ── Tính toán ─────────────────────────────────────────────────────────────
    tinh: async (api, botMsg, ctx, send) => {
        if (!botMsg.tinh?.status || !botMsg.tinh.expr) return false;
        const r = safeCalc(botMsg.tinh.expr);
        await send(r.ok ? `🧮 ${botMsg.tinh.expr} = ${r.result}` : `❌ Tính toán lỗi: ${r.error}`);
        return false;
    },

    // ── Vẽ ảnh AI ─────────────────────────────────────────────────────────────
    img: async (api, botMsg, ctx) => {
        if (!botMsg.img?.status || !botMsg.img.prompt) return false;
        await sendLauNaImage(api, botMsg.img.prompt, botMsg.img.model || "flux", ctx.threadId, ctx.threadType);
        return true;
    },

    // ── Tạo video AI ──────────────────────────────────────────────────────────
    video: async (api, botMsg, ctx, send) => {
        if (!botMsg.video?.status || !botMsg.video.prompt) return false;
        if (!pixverseToken()) { await send("⚠️ Chưa cấu hình pixverse.token!"); return true; }
        const credits = await pxGetCredits();
        if (credits !== null && credits < 80) { await send(`⚠️ Credits PixVerse không đủ (còn ${credits}).`); return true; }
        const vp = botMsg.video.prompt;
        const { senderName, senderId } = ctx;
        const tag = `@${senderName} `;
        const ma  = [{ uid: senderId, pos: 0, len: tag.length }];
        try { await pxPollAndSend(api, await pxCreateVideo(vp), vp, tag, ma, ctx.threadId, ctx.threadType); }
        catch (e) { send(`😢 Làm video bị lỗi: ${e.message}`); }
        return true;
    },

    // ── Sticker ───────────────────────────────────────────────────────────────
    stk: async (api, botMsg, ctx, send) => {
        if (!botMsg.stk?.status || !ctx.imageUrl) return false;
        const { senderId, senderName, threadId, threadType } = ctx;
        try {
            const ok = await convertAndSendSticker(api, ctx.imageUrl, threadId, threadType, senderId, senderName);
            if (!ok) send("😢 Làm sticker lỗi! Ảnh không đúng định dạng hoặc server lỗi.");
        } catch (e) { send(`😢 Làm sticker lỗi: ${e.message}`); }
        return true;
    },

    // ── Nhạc ──────────────────────────────────────────────────────────────────
    nhac: async (api, botMsg, ctx) => {
        if (!botMsg.nhac?.status || !botMsg.nhac.query) return false;
        await handleNhacAction(api, botMsg.nhac.query, ctx.threadId, ctx.threadType, ctx.senderId, ctx.message?.data || {});
        return true;
    },

    // ── Đổi profile (tên / bio) ───────────────────────────────────────────────
    profile: async (api, botMsg, ctx) => {
        if (!botMsg.profile?.status) return false;
        await handleProfileAction(api, botMsg.profile, ctx.threadId, ctx.threadType, ctx.message?.data || {});
        return false;
    },

    // ── Đổi avatar ────────────────────────────────────────────────────────────
    avatar: async (api, botMsg, ctx, send) => {
        if (!botMsg.avatar?.status) return false;
        if (!ctx.imageUrl) { await send("⚠️ Không tìm thấy ảnh. Reply vào ảnh rồi nói đổi avatar nha~"); return false; }
        if (typeof api.changeAccountAvatar !== "function") { await send("⚠️ API chưa hỗ trợ đổi avatar tài khoản bot."); return false; }

        const tmp = path.join(tempDir, `launa_avt_${Date.now()}.jpg`);
        try {
            const res = await axios.get(ctx.imageUrl, { responseType: "arraybuffer", timeout: 15000 });
            const buf = Buffer.from(res.data);
            if (!buf.length) throw new Error("Ảnh tải về rỗng");
            fs.writeFileSync(tmp, buf);
            await api.changeAccountAvatar(tmp);
            await send("✅ Đã đổi avatar bot thành công rồi nè! 🌸");
        } catch (e) {
            await send(`⚠️ Lỗi khi đổi avatar: ${errText(e)}`);
        } finally {
            if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch {} }
        }
        return false;
    },

    // ── Online status ─────────────────────────────────────────────────────────
    online: async (api, botMsg, ctx, send) => {
        const val = botMsg.online?.value?.toLowerCase();
        if (!botMsg.online?.status || !["on", "off"].includes(val)) return false;
        try { await api.updateActiveStatus(val === "on" ? 1 : 0); await send(`✅ Đã ${val === "on" ? "BẬT 🟢" : "TẮT 🔴"} trạng thái online của bot.`); }
        catch (e) { await send(`⚠️ Lỗi: ${e.message}`); }
        return false;
    },

    // ── Xóa avatar ────────────────────────────────────────────────────────────
    delavatar: async (api, botMsg, ctx, send) => {
        if (!botMsg.delavatar?.status) return false;
        try {
            if (typeof api.deleteAvatar === "function") { await api.deleteAvatar(); await send("✅ Đã xóa avatar tài khoản bot!"); }
            else await send("⚠️ API chưa hỗ trợ xóa avatar.");
        } catch (e) { await send(`⚠️ Lỗi: ${e.message}`); }
        return false;
    },

    // ── Xem bạn bè ────────────────────────────────────────────────────────────
    friends: async (api, botMsg, ctx, send) => {
        if (!botMsg.friends?.status) return false;
        try {
            const raw = await api.getAllFriends();
            const list = raw?.friends || raw?.data || (Array.isArray(raw) ? raw : []);
            if (!list.length) { await send("📭 Bot chưa có bạn bè nào."); return false; }
            let msg = `[ 👥 DANH SÁCH BẠN BÈ BOT ]\n─────────────────────\n`;
            list.slice(0, 20).forEach((f, i) => { msg += `${i + 1}. ${f.displayName || f.zaloName || f.name || "Không rõ"}\n   🆔: ${f.userId || f.uid || f.id}\n`; });
            if (list.length > 20) msg += `\n... và ${list.length - 20} người khác.`;
            msg += `\n─────────────────────\n📊 Tổng: ${list.length} bạn bè`;
            await send(msg);
        } catch (e) { await send(`⚠️ Lỗi: ${e.message}`); }
        return false;
    },

    // ── Xem yêu cầu kết bạn ──────────────────────────────────────────────────
    request: async (api, botMsg, ctx, send) => {
        if (!botMsg.request?.status) return false;
        try {
            const reqs = (await api.getSentFriendRequest())?.requests || [];
            if (!reqs.length) { await send("📭 Bot chưa có yêu cầu kết bạn nào đang chờ."); return false; }
            let msg = `[ 📨 YÊU CẦU KẾT BẠN ĐÃ GỬI ]\n─────────────────────\n`;
            reqs.forEach((r, i) => { msg += `${i + 1}. ${r.displayName || r.name || "Không rõ"}\n   🆔: ${r.userId || r.uid || r.id}\n`; });
            msg += `─────────────────────\n📊 Tổng: ${reqs.length} yêu cầu`;
            await send(msg);
        } catch (e) { await send(`⚠️ Lỗi: ${e.message}`); }
        return false;
    },

    // ── Thêm bạn ──────────────────────────────────────────────────────────────
    addfriend: async (api, botMsg, ctx, send) => {
        if (!botMsg.addfriend?.status || !botMsg.addfriend.uid) return false;
        const uid = String(botMsg.addfriend.uid);
        try { await api.sendFriendRequest("", uid); await send(`✅ Đã gửi lời mời kết bạn đến ${uid}`); }
        catch (e) { await send(`⚠️ Lỗi gửi kết bạn: ${e.message}`); }
        return false;
    },

    // ── Xóa bạn ───────────────────────────────────────────────────────────────
    delfriend: async (api, botMsg, ctx, send) => {
        if (!botMsg.delfriend?.status || !botMsg.delfriend.uid) return false;
        const uid = String(botMsg.delfriend.uid);
        try { await api.removeFriend(uid); await send(`✅ Đã xóa bạn bè ${uid}`); }
        catch (e) { await send(`⚠️ Lỗi xóa bạn: ${e.message}`); }
        return false;
    },

    // ── Chặn ──────────────────────────────────────────────────────────────────
    block: async (api, botMsg, ctx, send) => {
        if (!botMsg.block?.status || !botMsg.block.uid) return false;
        if (!ctx.isAdminUser) return false;
        const uid = String(botMsg.block.uid).trim();
        if (!/^\d{6,}$/.test(uid)) return false;
        try { await api.blockUser(uid); await send(`🚫 Đã chặn ${uid}`); }
        catch (e) {
            const isInvalid = /không hợp lệ|invalid|user.*not.*found|not.*valid/i.test(String(e?.message || ""));
            if (!isInvalid) await send(`⚠️ Lỗi chặn: ${e.message}`);
        }
        return false;
    },

    // ── Bỏ chặn ───────────────────────────────────────────────────────────────
    unblock: async (api, botMsg, ctx, send) => {
        if (!botMsg.unblock?.status || !botMsg.unblock.uid) return false;
        if (!ctx.isAdminUser) return false;
        const uid = String(botMsg.unblock.uid).trim();
        if (!/^\d{6,}$/.test(uid)) return false;
        try { await api.unblockUser(uid); await send(`✅ Đã bỏ chặn ${uid}`); }
        catch (e) { await send(`⚠️ Lỗi bỏ chặn: ${e.message}`); }
        return false;
    },

    // ── Kick thành viên khỏi nhóm ─────────────────────────────────────────────
    kick: async (api, botMsg, ctx, send) => {
        if (!botMsg.kick?.status || !botMsg.kick.uid) return false;
        if (!ctx.isAdminUser) return false;
        const uid = String(botMsg.kick.uid).trim();
        if (!/^\d{6,}$/.test(uid)) return false;
        try {
            if (typeof api.removeUserFromGroup === "function") {
                await api.removeUserFromGroup(ctx.threadId, uid);
                await send(`✅ Đã kick ${uid} ra khỏi nhóm`);
            } else await send("⚠️ API chưa hỗ trợ kick thành viên.");
        } catch (e) { await send(`⚠️ Lỗi kick: ${e.message}`); }
        return false;
    },

    // ── Nhắn tin riêng (DM / private message) ────────────────────────────────
    dm: async (api, botMsg, ctx, send) => {
        if (!botMsg.dm?.status || !botMsg.dm.uid || !botMsg.dm.msg) return false;
        const uid = String(botMsg.dm.uid);
        const msg = String(botMsg.dm.msg).trim();
        if (!uid || !msg) return false;
        try {
            await api.sendMessage({ msg }, uid, "USER");
        } catch {
            // DM thất bại — im lặng, không crash
        }
        return false; // không block main reply
    },

    // ── User Memory (ghi nhớ thông tin user) ─────────────────────────────────
    memory: async (api, botMsg, ctx, send) => {
        if (!botMsg.memory?.status) return false;
        const { action = "set", key = "", value = "" } = botMsg.memory;
        if (!key) return false;
        const mem = loadUserMemory(ctx.senderId);
        // "get" không phải action hợp lệ — nếu có value thì fallback sang "set"
        const effectiveAction = action === "get" ? (value ? "set" : "") : action;
        if ((effectiveAction === "set") && value) {
            mem[key] = value;
            saveUserMemory(ctx.senderId, mem);
        } else if (effectiveAction === "clear") {
            delete mem[key];
            saveUserMemory(ctx.senderId, mem);
        }
        return false; // memory action không block text reply
    },

    // ── Tìm & gửi sticker Zalo theo keyword (học từ Zia stkSearch pattern) ────
    stkSearch: async (api, botMsg, ctx, send) => {
        if (!botMsg.stkSearch?.status || !botMsg.stkSearch.keyword) return false;
        const kw = String(botMsg.stkSearch.keyword).trim();
        if (!kw) return false;
        const { threadId, threadType } = ctx;
        try {
            const ids = await api.getStickers(kw);
            if (!ids || !ids.length) {
                await send(`😅 LauNa không tìm thấy sticker nào cho ${kw} cả~`);
                return true;
            }
            const randomId = ids[Math.floor(Math.random() * ids.length)];
            const stickerDetail = await api.getStickersDetail(randomId);
            await api.sendSticker(stickerDetail, threadId, threadType);
        } catch (e) {
            await send(`😢 Gửi sticker lỗi: ${e.message}`);
        }
        return true;
    },

    // ── Thu hồi (undo) tin nhắn LauNa đã gửi (học từ Zia undo pattern) ────────
    undo: async (api, botMsg, ctx, send) => {
        if (!botMsg.undo?.status) return false;
        const idx = typeof botMsg.undo.index === 'number' ? botMsg.undo.index : -1;
        const { threadId, threadType } = ctx;
        try {
            const entry = getByIndex(threadId, idx);
            if (!entry) {
                await send('😅 LauNa không tìm thấy tin nào để thu hồi~');
                return true;
            }
            await api.undo({ msgId: entry.msgId, cliMsgId: entry.cliMsgId }, threadId, threadType);
            removeByMsgId(threadId, entry.msgId);
            await send('✅ Đã thu hồi tin nhắn rồi nha~');
        } catch (e) {
            await send(`😢 Thu hồi lỗi: ${e.message}`);
        }
        return true;
    },

    poll: async (api, botMsg, ctx, send) => {
        if (!botMsg.poll?.status) return false;
        const { threadId, threadType } = ctx;
        const { question, options, allowMultiChoices, isAnonymous, expiredTime } = botMsg.poll;
        if (!question || !Array.isArray(options) || options.length < 2) {
            await send('📊 Poll cần ít nhất 2 lựa chọn nha~');
            return true;
        }
        const validOptions = options.map(o => String(o).trim()).filter(Boolean).slice(0, 10);
        if (validOptions.length < 2) {
            await send('📊 Cần ít nhất 2 lựa chọn hợp lệ~');
            return true;
        }
        if (threadType !== 1) {
            await send('📊 Poll chỉ dùng được trong nhóm nha~');
            return true;
        }
        try {
            await api.createPoll({
                question: String(question).trim(),
                options: validOptions,
                allowMultiChoices: !!allowMultiChoices,
                isAnonymous: !!isAnonymous,
                expiredTime: Number(expiredTime) || 0,
            }, threadId);
        } catch (e) {
            await send(`😢 Tạo poll lỗi: ${e.message}`);
        }
        return true;
    },

    lastOnline: async (api, botMsg, ctx, send) => {
        if (!botMsg.lastOnline?.status) return false;
        const uid = String(botMsg.lastOnline?.uid || ctx.targetUid || "").trim();
        if (!uid) {
            await send('🕐 Cần tag hoặc reply người muốn kiểm tra trạng thái nha~');
            return true;
        }
        try {
            const result = await api.lastOnline(uid);
            const ts = result?.lastOnline ?? result?.data?.lastOnline ?? result?.data ?? null;
            if (!ts) {
                await send('🕐 Không lấy được thông tin online của người đó~');
                return true;
            }
            const ms = Number(ts) * (Number(ts) < 1e12 ? 1000 : 1);
            const diff = Date.now() - ms;
            let timeStr;
            if (diff < 60_000) timeStr = 'vừa online xong';
            else if (diff < 3_600_000) timeStr = `${Math.floor(diff / 60_000)} phút trước`;
            else if (diff < 86_400_000) timeStr = `${Math.floor(diff / 3_600_000)} giờ trước`;
            else timeStr = `${Math.floor(diff / 86_400_000)} ngày trước`;
            await send(`🕐 Người đó online ${timeStr}.`);
        } catch (e) {
            await send(`😢 Kiểm tra last online lỗi: ${e.message}`);
        }
        return true;
    },

    rename: async (api, botMsg, ctx, send) => {
        if (!botMsg.rename?.status) return false;
        const { threadId, threadType } = ctx;
        const name = String(botMsg.rename?.name || "").trim();
        if (!name) {
            await send('✏️ Cần tên nhóm mới nha~');
            return true;
        }
        if (threadType !== 1) {
            await send('✏️ Đổi tên chỉ dùng được trong nhóm nha~');
            return true;
        }
        try {
            await api.changeGroupName(threadId, name);
            await send(`✅ Đã đổi tên nhóm thành "${name}" rồi nha~`);
        } catch (e) {
            await send(`😢 Đổi tên nhóm lỗi: ${e.message}`);
        }
        return true;
    },

    tagAll: async (api, botMsg, ctx, _send) => {
        if (!botMsg.tagAll?.status) return false;
        const { threadId, threadType } = ctx;
        const headerMsg = String(botMsg.tagAll?.msg || "").trim();

        if (threadType !== 1) {
            await _send('📢 tagAll chỉ dùng được trong nhóm nha~');
            return true;
        }

        // Dùng native Zalo @All: uid=-1, type=1 (sendMessage tự set type=1 khi uid=="-1")
        try {
            const prefix = headerMsg ? `📢 ${headerMsg}\n` : "";
            const allTag = "@All";
            const msg    = prefix + allTag;
            const pos    = prefix.length;

            await api.sendMessage(
                { msg, mentions: [{ uid: -1, pos, len: allTag.length }] },
                threadId,
                threadType,
            );
        } catch (e) {
            await _send(`😢 Gửi tag all lỗi: ${e.message}`);
        }
        return true;
    },

    groupAvatar: async (api, botMsg, ctx, send) => {
        if (!botMsg.groupAvatar?.status) return false;
        const { threadId, threadType } = ctx;
        if (threadType !== 1) { await send('🖼️ Đổi avatar nhóm chỉ dùng được trong nhóm nha~'); return true; }
        if (!ctx.imageUrl) { await send('🖼️ Cần có ảnh đính kèm hoặc reply vào ảnh nha~'); return true; }
        const tmp = path.join(tempDir, `launa_gavt_${Date.now()}.jpg`);
        try {
            const buf = Buffer.from((await axios.get(ctx.imageUrl, { responseType: "arraybuffer", timeout: 15000 })).data);
            fs.writeFileSync(tmp, buf);
            if (typeof api.changeGroupAvatar === "function") {
                await api.changeGroupAvatar(tmp, threadId);
                await send('✅ Đã đổi avatar nhóm thành công rồi~');
            } else {
                await send('⚠️ API chưa hỗ trợ đổi avatar nhóm.');
            }
        } catch (e) { await send(`😢 Đổi avatar nhóm lỗi: ${e.message}`); }
        finally { if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch {} } }
        return true;
    },

    manageAdmin: async (api, botMsg, ctx, send) => {
        if (!botMsg.manageAdmin?.status) return false;
        const { threadId, threadType } = ctx;
        const action = String(botMsg.manageAdmin?.action || "add").toLowerCase();
        const uid = String(botMsg.manageAdmin?.uid || ctx.targetUid || "").trim();
        if (!uid) { await send('👑 Cần tag hoặc reply người muốn thay đổi quyền admin nha~'); return true; }
        if (threadType !== 1) { await send('👑 Chức năng này chỉ dùng trong nhóm nha~'); return true; }
        try {
            if (action === "add") {
                if (typeof api.addGroupAdmins === "function") {
                    await api.addGroupAdmins(threadId, [uid]);
                    await send('✅ Đã thêm admin nhóm rồi~');
                } else await send('⚠️ API chưa hỗ trợ addGroupAdmins.');
            } else {
                if (typeof api.removeGroupAdmins === "function") {
                    await api.removeGroupAdmins(threadId, [uid]);
                    await send('✅ Đã xóa quyền admin rồi~');
                } else await send('⚠️ API chưa hỗ trợ removeGroupAdmins.');
            }
        } catch (e) { await send(`😢 Quản lý admin lỗi: ${e.message}`); }
        return true;
    },

    whois: async (api, botMsg, ctx, send) => {
        if (!botMsg.whois?.status) return false;
        const uid = String(botMsg.whois?.uid || ctx.targetUid || "").trim();
        if (!uid) { await send('🔍 Cần tag hoặc reply người muốn tra thông tin nha~'); return true; }
        try {
            const resp = await api.getUserInfo(uid);
            const info = resp?.[uid] || resp?.[`${uid}_0`] || resp?.[String(uid)] || Object.values(resp || {})[0] || {};
            const name    = info.displayName ?? info.dName ?? info.zaloName ?? info.name ?? "(không rõ)";
            const gender  = info.gender === 1 ? "Nam" : info.gender === 0 ? "Nữ" : "?";
            const bd      = info.sdob || info.birthDate || "";
            const bioText = info.personalDesc || info.bio || "";
            let msg = `👤 **${name}**\n`;
            if (gender !== "?") msg += `- Giới tính: ${gender}\n`;
            if (bd) msg += `- Sinh nhật: ${bd}\n`;
            if (bioText) msg += `- Bio: ${bioText}\n`;
            msg = msg.trimEnd();
            await send(msg);
        } catch (e) { await send(`😢 Tra thông tin lỗi: ${e.message}`); }
        return true;
    },

    mute: async (api, botMsg, ctx, send) => {
        if (!botMsg.mute?.status) return false;
        const { threadId, threadType } = ctx;
        const val      = String(botMsg.mute?.value || "on").toLowerCase();
        const duration = String(botMsg.mute?.duration || "forever").toLowerCase();
        try {
            if (typeof api.setMute !== "function") { await send('⚠️ API chưa hỗ trợ mute.'); return true; }
            const isMuting = val === "on";
            const durMap = { "1h": 3600, "4h": 14400, "forever": -1 };
            const dur = durMap[duration] ?? -1;
            const muteType = threadType === 1 ? 2 : 1; // 2=group, 1=user
            await api.setMute({
                action: isMuting ? 1 : 3,
                duration: dur,
            }, threadId, muteType);
            await send(isMuting ? `🔇 Đã tắt thông báo nhóm này rồi~` : `🔔 Đã bật lại thông báo nhóm này~`);
        } catch (e) { await send(`😢 Lỗi mute: ${e.message}`); }
        return true;
    },

    // ── 33. createReminder ────────────────────────────────────────────────────
    createReminder: async (api, botMsg, ctx, send) => {
        if (!botMsg.createReminder?.status) return false;
        const { title, startTime, emoji, repeat } = botMsg.createReminder;
        if (!title) { await send('⚠️ Cần có nội dung nhắc nhở (title).'); return true; }
        const repeatMap = { none: 0, daily: 1, weekly: 2, monthly: 3 };
        const repeatVal = repeatMap[String(repeat || 'none').toLowerCase()] ?? 0;
        const ts = Number(startTime) > 0 ? Number(startTime) : Date.now() + 60000;
        try {
            if (typeof api.createReminder !== 'function') { await send('⚠️ API chưa hỗ trợ createReminder.'); return true; }
            const opts = { title, startTime: ts, emoji: emoji || '⏰', repeat: repeatVal };
            await api.createReminder(opts, ctx.threadId, ctx.threadType);
            const d = new Date(ts);
            const timeStr = `${d.getHours()}h${String(d.getMinutes()).padStart(2,'0')} ngày ${d.getDate()}/${d.getMonth()+1}`;
            await send(`⏰ Đã tạo nhắc nhở "${title}" lúc ${timeStr}~`);
        } catch (e) { await send(`😢 Lỗi tạo nhắc nhở: ${e.message}`); }
        return true;
    },

    // ── 34. disperseGroup ─────────────────────────────────────────────────────
    disperseGroup: async (api, botMsg, ctx, send) => {
        if (!botMsg.disperseGroup?.status) return false;
        if (ctx.threadType !== 1) { await send('⚠️ Chỉ dùng trong nhóm!'); return true; }
        try {
            if (typeof api.disperseGroup !== 'function') { await send('⚠️ API chưa hỗ trợ disperseGroup.'); return true; }
            await api.disperseGroup(ctx.threadId);
            await send('💀 Nhóm đã được giải tán.');
        } catch (e) { await send(`😢 Lỗi giải tán nhóm: ${e.message}`); }
        return true;
    },

    // ── 35. changeOwner ───────────────────────────────────────────────────────
    changeOwner: async (api, botMsg, ctx, send) => {
        if (!botMsg.changeOwner?.status) return false;
        if (ctx.threadType !== 1) { await send('⚠️ Chỉ dùng trong nhóm!'); return true; }
        const uid = String(botMsg.changeOwner?.uid || '').trim();
        if (!uid) { await send('⚠️ Cần có UID người nhận quyền chủ nhóm.'); return true; }
        try {
            if (typeof api.changeGroupOwner !== 'function') { await send('⚠️ API chưa hỗ trợ changeGroupOwner.'); return true; }
            await api.changeGroupOwner(ctx.threadId, uid);
            await send(`👑 Đã chuyển quyền chủ nhóm sang UID ${uid}~`);
        } catch (e) { await send(`😢 Lỗi chuyển chủ nhóm: ${e.message}`); }
        return true;
    },

    // ── 36. inviteUser ────────────────────────────────────────────────────────
    inviteUser: async (api, botMsg, ctx, send) => {
        if (!botMsg.inviteUser?.status) return false;
        const uid = String(botMsg.inviteUser?.uid || '').trim();
        const targetGroupId = String(botMsg.inviteUser?.targetGroupId || '').trim();
        if (!uid) { await send('⚠️ Cần có UID người muốn mời.'); return true; }
        if (!targetGroupId) { await send('⚠️ Cần có ID nhóm đích muốn mời vào.'); return true; }
        try {
            if (typeof api.inviteUserToGroups !== 'function') { await send('⚠️ API chưa hỗ trợ inviteUserToGroups.'); return true; }
            await api.inviteUserToGroups(uid, targetGroupId);
            await send(`📨 Đã gửi lời mời UID ${uid} vào nhóm~`);
        } catch (e) { await send(`😢 Lỗi mời người vào nhóm: ${e.message}`); }
        return true;
    },

    // ── 37. friendOnlines ─────────────────────────────────────────────────────
    friendOnlines: async (api, botMsg, ctx, send) => {
        if (!botMsg.friendOnlines?.status) return false;
        try {
            if (typeof api.getFriendOnlines !== 'function') { await send('⚠️ API chưa hỗ trợ getFriendOnlines.'); return true; }
            const data = await api.getFriendOnlines();
            const list = data?.onlines || [];
            if (!list.length) { await send('🌙 Hiện không có bạn bè nào đang online.'); return true; }
            const lines = list.slice(0, 20).map((f, i) => `${i+1}. ${f.zaloName || f.displayName || f.userId} — ${f.status || 'online'}`);
            await send(`🟢 Bạn bè đang online (${list.length} người):\n${lines.join('\n')}`);
        } catch (e) { await send(`😢 Lỗi lấy danh sách online: ${e.message}`); }
        return true;
    },

    // ── 38. groupSetting ─────────────────────────────────────────────────────
    groupSetting: async (api, botMsg, ctx, send) => {
        if (!botMsg.groupSetting?.status) return false;
        if (ctx.threadType !== 1) { await send('⚠️ Chỉ dùng trong nhóm!'); return true; }
        const validSettings = ['lockSendMsg','joinAppr','lockViewMember','lockCreatePost','lockCreatePoll','addMemberOnly','signAdminMsg','blockName'];
        const setting = String(botMsg.groupSetting?.setting || '').trim();
        const value   = Number(botMsg.groupSetting?.value) === 1 ? 1 : 0;
        if (!validSettings.includes(setting)) {
            await send(`⚠️ Setting không hợp lệ. Các setting được hỗ trợ: ${validSettings.join(', ')}`);
            return true;
        }
        const labelMap = {
            lockSendMsg:    value ? '🔒 Đã khóa — chỉ admin được nhắn tin.' : '🔓 Đã mở — mọi người có thể nhắn tin.',
            joinAppr:       value ? '✅ Bật duyệt thành viên khi vào nhóm.' : '🚪 Tắt duyệt — ai cũng vào được.',
            lockViewMember: value ? '🙈 Ẩn danh sách thành viên với member.' : '👁 Member có thể xem danh sách thành viên.',
            lockCreatePost: value ? '📝 Chỉ admin tạo được ghi chú.' : '📝 Member được tạo ghi chú.',
            lockCreatePoll: value ? '🗳 Chỉ admin tạo được poll.' : '🗳 Member được tạo poll.',
            addMemberOnly:  value ? '➕ Chỉ được thêm member (không qua link).' : '🔗 Cho phép vào nhóm qua link.',
            signAdminMsg:   value ? '🏷 Tin nhắn admin/owner sẽ được đánh dấu.' : '🏷 Tắt đánh dấu tin nhắn admin.',
            blockName:      value ? '🚫 Member không được đổi tên/ảnh nhóm.' : '✏️ Member được đổi tên/ảnh nhóm.',
        };
        try {
            if (typeof api.changeGroupSetting !== 'function') { await send('⚠️ API chưa hỗ trợ changeGroupSetting.'); return true; }
            await api.changeGroupSetting(ctx.threadId, { [setting]: value });
            await send(labelMap[setting] || `✅ Đã cập nhật ${setting} = ${value}`);
        } catch (e) { await send(`😢 Lỗi đổi cài đặt nhóm: ${e.message}`); }
        return true;
    },

    // ── 39. createNote ────────────────────────────────────────────────────────
    createNote: async (api, botMsg, ctx, send) => {
        if (!botMsg.createNote?.status) return false;
        if (ctx.threadType !== 1) { await send('⚠️ Chỉ dùng trong nhóm!'); return true; }
        const title = String(botMsg.createNote?.title || '').trim();
        const pin   = !!botMsg.createNote?.pin;
        if (!title) { await send('⚠️ Cần có nội dung ghi chú (title).'); return true; }
        try {
            if (typeof api.createNote !== 'function') { await send('⚠️ API chưa hỗ trợ createNote.'); return true; }
            await api.createNote({ title, pinAct: pin }, ctx.threadId);
            await send(pin ? `📌 Đã tạo và ghim ghi chú: "${title}"` : `📝 Đã tạo ghi chú: "${title}"`);
        } catch (e) { await send(`😢 Lỗi tạo ghi chú: ${e.message}`); }
        return true;
    },

    // ── 40. sendLink ──────────────────────────────────────────────────────────
    sendLink: async (api, botMsg, ctx, send) => {
        if (!botMsg.sendLink?.status) return false;
        const link = String(botMsg.sendLink?.link || '').trim();
        const msg  = String(botMsg.sendLink?.msg  || '').trim();
        if (!link || !link.startsWith('http')) { await send('⚠️ Cần URL hợp lệ bắt đầu bằng http(s)://'); return true; }
        try {
            if (typeof api.sendLink !== 'function') { await send('⚠️ API chưa hỗ trợ sendLink.'); return true; }
            await api.sendLink({ link, msg }, ctx.threadId, ctx.threadType);
        } catch (e) { await send(`😢 Lỗi gửi link: ${e.message}`); }
        return true;
    },

    // ── 41. game — LauNa tự chơi game ────────────────────────────────────────
    game: async (api, botMsg, ctx, send) => {
        if (!botMsg.game?.status || !botMsg.game.type) return false;
        const { threadId, threadType } = ctx;
        const type = String(botMsg.game.type).toLowerCase().trim();
        const args = Array.isArray(botMsg.game.args) ? botMsg.game.args.map(String) : [];
        const botId = String(api.getContext?.()?.uid || "launa-bot");

        const fakeCtx = {
            api,
            threadId,
            threadType,
            senderId: botId,
            senderName: "LauNa",
            args,
            message: { data: {} },
            prefix: ".",
            adminIds: [],
        };

        try {
            if (type === "catch") {
                const pkName = args[0];
                if (!pkName) { await send("⚠️ LauNa không biết bắt con nào~"); return true; }
                if (typeof _pkCmds?.catch === "function") {
                    await _pkCmds.catch({ ...fakeCtx, args: [pkName] });
                } else {
                    const catchCmd = Array.isArray(_pkCmds) ? _pkCmds.find(c => c.name === "catch") : null;
                    if (catchCmd) await catchCmd.execute({ ...fakeCtx, args: [pkName] });
                    else await send("⚠️ Lệnh catch chưa sẵn sàng.");
                }
                return true;
            }

            if (type === "dnd") {
                if (typeof _dndCmds?.dnd === "function") {
                    await _dndCmds.dnd(fakeCtx);
                } else await send("⚠️ Lệnh DnD chưa sẵn sàng.");
                return true;
            }

            if (type === "slots") {
                const slotCmd = Array.isArray(_slotsCmds) ? _slotsCmds.find(c => c.name === "slots") : null;
                if (slotCmd) {
                    await slotCmd.execute(fakeCtx);
                } else if (typeof _slotsCmds?.slots === "function") {
                    await _slotsCmds.slots(fakeCtx);
                } else await send("⚠️ Lệnh slots chưa sẵn sàng.");
                return true;
            }

            if (type === "taixiu") {
                if (typeof _taixiuCmds?.taixiu === "function") {
                    await _taixiuCmds.taixiu(fakeCtx);
                } else await send("⚠️ Lệnh tài xỉu chưa sẵn sàng.");
                return true;
            }

            if (type === "gs" || type === "gsattack") {
                if (typeof _gsCmds?.gs === "function") {
                    const gsArgs = type === "gs" ? ["attack", ...args] : args;
                    await _gsCmds.gs({ ...fakeCtx, args: gsArgs });
                } else await send("⚠️ Game Server chưa sẵn sàng.");
                return true;
            }

            if (type === "gsjoin") {
                if (typeof _gsCmds?.gs === "function") {
                    await _gsCmds.gs({ ...fakeCtx, args: ["dnd", "join"] });
                } else await send("⚠️ Game Server chưa sẵn sàng.");
                return true;
            }

            if (type === "gsdndattack") {
                if (typeof _gsCmds?.gs === "function") {
                    const element = args[0] || "";
                    await _gsCmds.gs({ ...fakeCtx, args: element ? ["dnd", "attack", element] : ["dnd", "attack"] });
                } else await send("⚠️ Game Server chưa sẵn sàng.");
                return true;
            }

        } catch (e) {
            await send(`😢 LauNa chơi game bị lỗi: ${e.message}`);
        }
        return true;
    },

};

// ── Route LauNa Actions (dispatch qua bảng handler) ──────────────────────────
async function routeLauNaActions(botMsg, ctx) {
    const { api, threadId, threadType, senderId, senderName, message, isWatchMode } = ctx;
    const raw = message?.data || {};
    const send = (msg) => api.sendMessage({ msg }, threadId, threadType).catch(() => {});

    // Từ chối — ưu tiên xử lý trước
    if (botMsg?.refuse?.status && botMsg.refuse.reason) {
        const tag = isWatchMode ? "" : `@${senderName} `;
        // Xóa @[tên] hoặc tên người dùng ở đầu refuse.reason để tránh nhân đôi
        let refuseReason = String(botMsg.refuse.reason).trim();
        if (!isWatchMode && senderName) {
            refuseReason = refuseReason
                .replace(new RegExp(`^@\\[${senderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\s*`, "i"), "")
                .replace(new RegExp(`^@${senderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
                .replace(new RegExp(`^${senderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[,，、]*\\s*`, "i"), "")
                .trim();
        }
        await api.sendMessage({ msg: tag + refuseReason, mentions: isWatchMode ? [] : [{ uid: senderId, pos: 0, len: tag.length }], quote: isWatchMode ? undefined : raw }, threadId, threadType);
        return { saveText: refuseReason };
    }

    // Chạy tuần tự tất cả handler, gom lại xem có media action nào không
    let mediaFired = false;
    for (const [key, handler] of Object.entries(ACTION_HANDLERS)) {
        try {
            const fired = await handler(api, botMsg, ctx, send);
            if (fired) mediaFired = true;
        } catch (_) {
            // Handler lỗi — bỏ qua, không crash toàn bộ
        }
    }

    if (mediaFired) return { saveText: null };

    let replyText = (botMsg?.content?.text || "").trim();
    if (!replyText || (replyText.startsWith("{") && replyText.endsWith("}"))) return { saveText: null };

    // ── Strip @[tên] hoặc tên người dùng ở đầu text để tránh nhân đôi ────────
    if (!isWatchMode && senderName) {
        const esc = senderName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        replyText = replyText
            .replace(new RegExp(`^@\\[${esc}\\]\\s*`, "i"), "")
            .replace(new RegExp(`^@${esc}\\s*`, "i"), "")
            .replace(new RegExp(`^${esc}[,，、]*\\s*`, "i"), "")
            .trim();
    }

    // ── Lọc output nhạy cảm (paths, API keys, stack traces) ──────────────────
    replyText = filterOutput(replyText);

    // ── Resolve @[Tên] → Zalo Mention thật (chỉ trong nhóm) ─────────────────
    let resolvedMentions = [];
    if (threadType === 1 && replyText.includes("@")) {
        try {
            const resolved = await resolveOutboundMentions(api, threadId, replyText);
            replyText = resolved.text;
            resolvedMentions = resolved.mentions;
            // Nếu có tên trùng → thêm ghi chú hỏi lại người dùng
            if (resolved.ambiguous && resolved.ambiguous.length > 0) {
                const ambigParts = resolved.ambiguous.map(a => {
                    const names = a.candidates.map(c => c.name).join(" hay ");
                    return `tớ thấy có ${a.candidates.length} người tên "${a.query}": ${names} — lần sau nói rõ tên đầy đủ nha!`;
                });
                replyText = replyText + " (" + ambigParts.join("; ") + ")";
            }
        } catch { /* bỏ qua lỗi resolve mention */ }
    }

    // Natural typing delay
    await naturalDelay(replyText);

    const tag = isWatchMode ? "" : `@${senderName} `;
    // Dịch chuyển vị trí mention theo độ dài tag prefix
    const shiftedMentions = resolvedMentions.map(m => ({ ...m, pos: m.pos + tag.length }));
    const senderMentionArr = isWatchMode ? [] : [{ uid: senderId, pos: 0, len: tag.length }];
    const allMentions = [...senderMentionArr, ...shiftedMentions];

    const sentResult = await api.sendMessage({ msg: tag + replyText, mentions: allMentions, quote: isWatchMode ? undefined : raw }, threadId, threadType);
    // Theo dõi tin vừa gửi để hỗ trợ undo
    const _smId = sentResult?.msgId || sentResult?.message?.data?.globalMsgId || sentResult?.message?.data?.msgId || sentResult?.message?.msgId;
    const _smCli = sentResult?.cliMsgId || sentResult?.message?.data?.cliMsgId || sentResult?.message?.cliMsgId;
    if (_smId) trackSent(threadId, _smId, _smCli || "");
    markThreadReplied(threadId);
    // Lưu topic để có thể tiếp tục chủ đề sau
    setLaunaTopic(threadId, replyText);
    return { saveText: replyText };
}

// ── Helper: extract image URL ─────────────────────────────────────────────────
function extractUrlFromAttach(attachStr) {
    if (!attachStr) return null;
    try {
        let obj = typeof attachStr === "string" ? JSON.parse(attachStr) : attachStr;
        if (Array.isArray(obj) && obj.length > 0) obj = obj[0];
        let url = null;
        if (obj.params) {
            try {
                const p = typeof obj.params === "string" ? JSON.parse(obj.params) : obj.params;
                url = p.hd || p.url || p.normalUrl || null;
            } catch {}
        }
        if (!url && obj.href) url = obj.href;
        if (!url && obj.url) url = obj.url;
        if (url && typeof url === "string") {
            url = url.trim().replace(/^"|"$/g, "");
            if (url.startsWith("http")) return url;
        }
    } catch {}
    return null;
}
function extractImageUrl(raw) {
    const fromDirect = extractUrlFromAttach(raw?.attach);
    if (fromDirect) return fromDirect;
    const fromAttachments = (raw?.attachments || []).map(a => extractUrlFromAttach(a) || a?.fileUrl || a?.url || a?.href).find(Boolean);
    if (fromAttachments) return fromAttachments;
    const fromQuote = extractUrlFromAttach(raw?.quote?.attach);
    if (fromQuote) return fromQuote;
    return null;
}

// ── Helper: extract first JSON object ─────────────────────────────────────────
function extractFirstJson(str) {
    let depth = 0, start = -1;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === "{") { if (start === -1) start = i; depth++; }
        else if (str[i] === "}" && --depth === 0 && start !== -1) return str.slice(start, i + 1);
    }
    return null;
}

// ── Helper: strip <think>...</think> tags (DeepSeek R1, Groq DeepSeek) ───────
function stripThinkTags(str) {
    if (!str) return str;
    return str.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*/gi, "").trim();
}

// ── Helper: fix trailing commas in JSON ──────────────────────────────────────
function fixTrailingCommas(str) {
    // Fix empty-key entries: ,""}  →  }  (AI thỉnh thoảng sinh ra "stk":{"status":false,""})
    str = str.replace(/,\s*""\s*}/g, "}");
    // Fix trailing commas before } or ]
    str = str.replace(/,\s*([}\]])/g, "$1");
    return str;
}

// ── Helper: parse LauNa JSON response (robust) ────────────────────────────────
function parseLauNaResponse(raw) {
    const fallback = { content: { text: "" }, reaction: { status: false }, refuse: { status: false } };
    if (!raw || typeof raw !== "string") return fallback;

    // Strip reasoning tags từ DeepSeek/Groq models
    let cleaned = stripThinkTags(raw);

    // Phát hiện refusal tiếng Anh từ model (Groq, OpenAI...) → chuyển sang tiếng Việt LauNa style
    const EN_REFUSAL = /^(i('m| am) sorry|i (cannot|can't|am unable to|won't|will not) (assist|help|do|fulfill|process)|i'm not able to|sorry,? (but )?i (can't|cannot)|that (request|is something i (can't|cannot))|i don't|i am not able)/i;
    const trimmedForCheck = cleaned.trim();
    if (!trimmedForCheck.startsWith("{") && EN_REFUSAL.test(trimmedForCheck)) {
        const viRefusals = [
            "ừ thôi cái đó tớ không làm đc nha haha",
            "cái này tớ bỏ qua nha, không tiện lắm~",
            "thôi bỏ qua cái đó đi bạn ơi hihi",
            "ủa cái này tớ skip nha, không hợp lắm",
            "hm tớ không làm cái này đc, thông cảm nha~",
        ];
        const picked = viRefusals[Math.floor(Math.random() * viRefusals.length)];
        return { ...fallback, content: { text: picked } };
    }

    // Nếu hoàn toàn không có JSON → trả về plaintext
    const hasJson = cleaned.trim().startsWith("{") || cleaned.includes("```json") || cleaned.includes("```");
    if (!hasJson) return { ...fallback, content: { text: cleaned.trim() } };

    try {
        // Strip markdown code fences
        cleaned = cleaned.replace(/```json\s*/gi, "").replace(/```\s*/gi, "").trim();
        // Fix trailing commas
        cleaned = fixTrailingCommas(cleaned);
        // Extract first complete JSON object
        const extracted = extractFirstJson(cleaned);
        if (extracted) cleaned = extracted;

        const obj = JSON.parse(cleaned);
        if (typeof obj !== "object" || !obj) return fallback;
        const inner = obj.content || {};
        return {
            content:   { text: (inner.text ?? obj.text ?? "").toString() },
            reaction:  obj.reaction  || inner.reaction  || { status: false, icon: "" },
            refuse:    obj.refuse    || inner.refuse    || { status: false, reason: "" },
            emotion:   obj.emotion   || inner.emotion   || { status: false },
            tinh:      obj.tinh      || inner.tinh      || { status: false },
            img:       obj.img       || inner.img       || { status: false },
            video:     obj.video     || inner.video     || { status: false, prompt: "" },
            stk:       obj.stk       || inner.stk       || { status: false },
            nhac:      obj.nhac      || inner.nhac      || { status: false, query: "" },
            profile:   obj.profile   || inner.profile   || { status: false, name: "", bio: "" },
            avatar:    obj.avatar    || inner.avatar    || { status: false },
            online:    obj.online    || inner.online    || { status: false, value: "" },
            delavatar: obj.delavatar || inner.delavatar || { status: false },
            friends:   obj.friends   || inner.friends   || { status: false },
            request:   obj.request   || inner.request   || { status: false },
            addfriend: obj.addfriend || inner.addfriend || { status: false, uid: "" },
            delfriend: obj.delfriend || inner.delfriend || { status: false, uid: "" },
            block:     obj.block     || inner.block     || { status: false, uid: "" },
            unblock:   obj.unblock   || inner.unblock   || { status: false, uid: "" },
            kick:          obj.kick          || inner.kick          || { status: false, uid: "" },
            dm:            obj.dm            || inner.dm            || { status: false, uid: "", msg: "" },
            memory:        obj.memory        || inner.memory        || { status: false, action: "set", key: "", value: "" },
            stkSearch:     obj.stkSearch     || inner.stkSearch     || { status: false, keyword: "" },
            undo:          obj.undo          || inner.undo          || { status: false, index: -1 },
            poll:          obj.poll          || inner.poll          || { status: false, question: "", options: [], allowMultiChoices: false, isAnonymous: false, expiredTime: 0 },
            lastOnline:    obj.lastOnline    || inner.lastOnline    || { status: false, uid: "" },
            rename:        obj.rename        || inner.rename        || { status: false, name: "" },
            tagAll:        obj.tagAll        || inner.tagAll        || { status: false, msg: "" },
            groupAvatar:   obj.groupAvatar   || inner.groupAvatar   || { status: false },
            manageAdmin:   obj.manageAdmin   || inner.manageAdmin   || { status: false, action: "add", uid: "" },
            whois:         obj.whois         || inner.whois         || { status: false, uid: "" },
            mute:          obj.mute          || inner.mute          || { status: false, value: "on", duration: "forever" },
            createReminder: obj.createReminder || inner.createReminder || { status: false, title: "", startTime: 0, emoji: "⏰", repeat: "none" },
            disperseGroup: obj.disperseGroup || inner.disperseGroup || { status: false },
            changeOwner:   obj.changeOwner   || inner.changeOwner   || { status: false, uid: "" },
            inviteUser:    obj.inviteUser    || inner.inviteUser    || { status: false, uid: "", targetGroupId: "" },
            friendOnlines: obj.friendOnlines || inner.friendOnlines || { status: false },
            groupSetting:  obj.groupSetting  || inner.groupSetting  || { status: false, setting: "", value: 0 },
            createNote:    obj.createNote    || inner.createNote    || { status: false, title: "", pin: false },
            sendLink:      obj.sendLink      || inner.sendLink      || { status: false, link: "", msg: "" },
            game:          obj.game          || inner.game          || { status: false, type: "", args: [] },
        };
    } catch {
        // JSON parse thất bại → cố extract text content thủ công
        const textMatch = cleaned.match(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (textMatch) return { ...fallback, content: { text: textMatch[1].replace(/\\n/g, "\n").replace(/\\"/g, '"') } };
        return fallback;
    }
}

// ── Sanitize persona name trong kết quả phân tích ảnh ────────────────────────
const WRONG_NAMES_RE = /^(bé\s*hân|hân|gemini|gpt|claude|ai)\s*[:：\-]\s*/i;
const INLINE_HAN_RE  = /\bHân\b/g;

function sanitizeImgResult(text) {
    if (!text || typeof text !== "string") return text;
    text = text.replace(WRONG_NAMES_RE, "").trim();
    text = text.replace(INLINE_HAN_RE, "LauNa");
    return text;
}

// ── Watch mode config ──────────────────────────────────────────────────────────
const userProcessingMap = new Map();
const lastAutoReplyMap  = new Map();
const AUTO_REPLY_COOLDOWN = 15 * 60_000;
const AUTO_REPLY_MIN_LEN  = 20;

// ── Topic tracking (tiếp tục chủ đề khi LauNa vừa reply) ─────────────────────
const launaTopicMap     = new Map(); // threadId → { keywords: Set, ts: number }
const TOPIC_TTL_MS      = 3 * 60_000; // chủ đề có hiệu lực 3 phút

function setLaunaTopic(threadId, replyText) {
    const words = replyText.toLowerCase()
        .match(/[a-záàảãạăắặằẳẵâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]{4,}/g) || [];
    launaTopicMap.set(threadId, { keywords: new Set(words.slice(0, 12)), ts: Date.now() });
}

function isTopicContinued(threadId, text) {
    const topic = launaTopicMap.get(threadId);
    if (!topic || Date.now() - topic.ts > TOPIC_TTL_MS) return false;
    const newWords = new Set((text.toLowerCase()
        .match(/[a-záàảãạăắặằẳẵâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ]{4,}/g) || []));
    for (const w of topic.keywords) if (newWords.has(w)) return true;
    return false;
}

// ── Reaction reply cooldown ───────────────────────────────────────────────────
const _reactionReplyMap = new Map(); // `react:{threadId}:{userId}` → timestamp

// Đánh giá độ thú vị của tin nhắn — LauNa có chen vào không
function smartWatchScore(text, threadId) {
    let score = 0;
    const lower = text.toLowerCase();

    // Câu hỏi mở → LauNa hay có ý kiến
    if (/\?/.test(text)) score += 28;
    if (/\b(ai|sao|tại sao|vì sao|gì|thế nào|thế không|thật không|có không|biết không|hả|nhỉ|chứ|đúng không|thật hả|vậy hả|ý kiến|nghĩ gì|thấy sao)\b/.test(lower)) score += 22;

    // Chủ đề LauNa quan tâm — phim ảnh, nhạc, ẩm thực, tình cảm
    if (/\b(phim|drama|series|tập|nhạc|bài hát|ca sĩ|idol|kpop|vpop|anime|manga|webtoon|game|meme|trend|viral)\b/.test(lower)) score += 24;
    if (/\b(ăn|uống|trà sữa|cà phê|cafe|đồ ăn|món|quán|ngon|dở|đói|thèm|review|quán mới)\b/.test(lower)) score += 20;
    if (/\b(yêu|crush|thích|ghét|bạn trai|bạn gái|người yêu|hẹn hò|tán|thả thính|chia tay|cặp|đôi)\b/.test(lower)) score += 28;
    if (/\b(buồn|vui|stress|mệt|lo|sợ|tức|cười|hạnh phúc|cô đơn|nhớ|chán|xúc động|khóc|thở dài)\b/.test(lower)) score += 22;
    if (/\b(học|thi|trường|thầy|cô|lớp|bài tập|deadline|điểm|kết quả|fail|pass|đậu|rớt)\b/.test(lower)) score += 17;

    // Nội dung hài hước / drama / cảm xúc mạnh
    if (/(haha|hihi|hehe|huhu|lol|wtf|omg|😂|🤣|😭|💀|🥲|🫠|😅|🤡|💔|❤️|🔥|😱|🥹)/.test(text)) score += 20;
    if (/!{2,}/.test(text)) score += 12;
    if (/\.{3,}/.test(text)) score += 8;

    // Drama / confession
    if (/\b(drama|spoil|leak|réo|bóc phốt|phốt|nói xấu|chửi|troll|giả)\b/.test(lower)) score += 22;

    // Nhắc tên LauNa gián tiếp (hỏi về bot, AI...)
    if (/\b(launa|bot|con bot|em ấy|nó|bạn ấy)\b/.test(lower)) score += 15;

    // Cuộc trò chuyện đang sôi nổi
    const activeCount = getActiveConvoCount(threadId, 2 * 60_000);
    if (activeCount >= 6) score += 22;
    else if (activeCount >= 3) score += 12;

    // Độ dài tin nhắn (càng dài càng giàu nội dung)
    if (text.length >= 40) score += 10;
    if (text.length >= 80) score += 12;
    if (text.length >= 150) score += 8;

    // Spam phòng tránh: tin nhắn quá ngắn hoặc chỉ emoji
    if (text.length < 10) score -= 20;
    if (/^[\p{Emoji}\s]+$/u.test(text)) score -= 15;

    // Đang tiếp tục chủ đề LauNa vừa nói → tăng mạnh
    if (isTopicContinued(threadId, text)) score += 42;

    // LauNa vừa reply trong thread này gần đây → bonus nhỏ thôi, tránh chain reply
    const lastAutoTs = lastAutoReplyMap.get(threadId) || 0;
    const msSinceLastReply = Date.now() - lastAutoTs;
    if (msSinceLastReply < 90_000)  score += 10; // < 1.5 phút
    else if (msSinceLastReply < 300_000) score += 5; // < 5 phút

    // Random element (0 → 20) để không bị đoán trước
    score += Math.random() * 20;

    return score;
}

function shouldAutoReply(text, threadId) {
    if (text.length < AUTO_REPLY_MIN_LEN) return false;

    // Bỏ qua tin nhắn kỹ thuật / lệnh bot / giao dịch ngân hàng
    // — chuỗi số dài (STK, SĐT, mã GD)
    if (/\d{8,}/.test(text)) return false;
    // — URL / link
    if (/https?:\/\/\S+/.test(text)) return false;
    // — dòng có dạng lệnh: token, stk, sdt, momo, vcb, mb, tpb...
    if (/\b(mb|momo|vcb|tpb|acb|stk|sdt|nap|rut|chuyen|napgame|qrbank|transaction)\b/i.test(text)) return false;
    // — nội dung toàn chữ in hoa / mã kỹ thuật không có dấu tiếng Việt
    const viDauRe = /[àáảãạăắặẵẳâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/i;
    const wordCount = text.trim().split(/\s+/).length;
    if (wordCount >= 4 && !viDauRe.test(text)) return false;

    const lastAuto = lastAutoReplyMap.get(threadId) || 0;
    const elapsed = Date.now() - lastAuto;
    // Nếu đang tiếp tục chủ đề → vẫn cần cooldown 2 phút và ngưỡng cao
    if (isTopicContinued(threadId, text)) {
        if (elapsed < 2 * 60_000) return false;
        return smartWatchScore(text, threadId) >= 70;
    }
    // Bình thường: cooldown 15 phút và ngưỡng cao
    if (elapsed < AUTO_REPLY_COOLDOWN) return false;
    return smartWatchScore(text, threadId) >= 80;
}

// ── Main handle ───────────────────────────────────────────────────────────────
export async function handle(ctx) {
    const { api, threadId, threadType, senderId, senderName, content, isSelf, message, adminIds, prefix } = ctx;
    const isAdminUser = Array.isArray(adminIds) && adminIds.includes(String(senderId));

    // Khởi scheduler tự cập nhật avt+bio (chỉ chạy 1 lần)
    _ensureProfileScheduler(api);

    if (isSelf || !content || typeof content !== "string") return false;
    if (!launaManager.isEnabled(threadId)) return false;

    const raw = message?.data || {};
    const text = content.trim(), lower = text.toLowerCase();
    const currentPrefix = (prefix || ".").trim();
    if (currentPrefix && text.startsWith(currentPrefix)) return false;

    // Luôn ghi tin nhắn vào buffer
    addToMsgBuffer(threadId, senderName || "Ai đó", text);

    const botId        = String(api.getContext?.()?.uid || "");
    const mentions     = raw?.mentions || [];
    const isMentioned  = !!botId && mentions.some(m => String(m.uid) === botId);
    const isReplyToBot = !!botId && String(raw?.quote?.ownerId) === botId;
    const isCalledByName = lower.includes("launa");

    // requireMentionLauna gate (per-group, học từ zalo-personal requireMention pattern)
    // Khi bật: LauNa chỉ trả lời khi được @mention hoặc reply trực tiếp vào tin của bot
    const isGroupThread = threadType === 1;
    if (isGroupThread && threadSettingsManager.isRequireMentionLauna(threadId) && !isMentioned && !isReplyToBot) {
        return false;
    }

    let isWatchMode = false;
    if (!isCalledByName && !isMentioned && !isReplyToBot) {
        // Passive grudge tracking trong watch mode — nhẹ hơn direct mode
        if (RUDE_TO_BOT_RE.test(text) || CHALLENGE_RE.test(text)) {
            const _isC = CHALLENGE_RE.test(text), _isR = RUDE_TO_BOT_RE.test(text);
            updateGrudge(senderId, (_isC && _isR) ? 5 : _isC ? 3 : 4);
        }
        if (!shouldAutoReply(text, threadId)) return false;
        isWatchMode = true;
    }

    // ── Message Buffering (học từ Zia — gom tin nhắn liên tiếp trong 2.5s) ────
    // Watch mode không buffer (tin tự động là riêng lẻ, không cần gom)
    let finalText = text;
    if (!isWatchMode) {
        const bufResult = bufferMessage(threadId, senderId, text);
        if (bufResult === null) return false; // secondary — đã thêm vào buffer, skip
        finalText = await bufResult;          // primary — chờ hết cửa sổ 2.5s
    }

    const userKey = `${threadId}:${senderId}`;
    if (userProcessingMap.get(userKey)) return false;

    if (!isWatchMode) {
        const remaining = checkCooldown(senderId);
        if (remaining > 0) {
            await api.sendMessage({ msg: `⏳ LauNa đang nghỉ tí nha~ Cậu chờ thêm ${remaining}s rồi hỏi lại nha 🌸`, quote: raw }, threadId, threadType);
            return true;
        }
    }

    userProcessingMap.set(userKey, true);
    try {
        let question = finalText;
        if (isCalledByName) question = question.replace(/^launa\s*ơi[,:]?\s*/i, "").replace(/^launa[,:]?\s*/i, "").trim();
        if (isMentioned)    question = question.replace(/@\S+/g, "").trim();

        // ── Định tuyến trực tiếp theo keyword (không qua AI) ─────────────────
        if (!isWatchMode) {
            const qLow = question.toLowerCase().trim();

            // "vẽ/ve/taoanh [anime|3d|realism|turbo?] [mô tả]" → tạo ảnh ngay
            const DRAW_RE = /^(?:vẽ|ve|taoanh|tao anh)\s*(?:(anime|3d|realism|turbo)\s+)?([\s\S]+)/i;
            const dm = qLow.match(DRAW_RE);
            if (dm) {
                const styleInput = (dm[1] || "").toLowerCase();
                const drawPrompt = (dm[2] || "").trim();
                if (drawPrompt) {
                    api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});
                    const styleMap = { anime: "flux-anime", "3d": "flux-3d", realism: "flux-realism", turbo: "turbo" };
                    await sendLauNaImage(api, drawPrompt, styleMap[styleInput] || "flux", threadId, threadType);
                    setCooldown(senderId);
                    return true;
                }
            }

            // "tao video/tạo video/làm video [mô tả]" → tạo video ngay
            const VIDEO_RE = /^(?:tao video|tạo video|làm video|lam video)\s+([\s\S]+)/i;
            const vm = qLow.match(VIDEO_RE);
            if (vm) {
                const videoPrompt = vm[1].trim();
                if (videoPrompt) {
                    if (!pixverseToken()) {
                        await api.sendMessage({ msg: "⚠️ Chưa cấu hình pixverse.token trong tokens.json!", quote: raw }, threadId, threadType).catch(() => {});
                        return true;
                    }
                    const credits = await pxGetCredits();
                    if (credits !== null && credits < 80) {
                        await api.sendMessage({ msg: `⚠️ Credits PixVerse không đủ! Còn ${credits} credit, cần ít nhất 80.`, quote: raw }, threadId, threadType).catch(() => {});
                        return true;
                    }
                    const tag = `@${senderName} `;
                    const creditInfo = credits !== null ? ` (còn ${credits} credits)` : "";
                    const ma = [{ uid: senderId, pos: 0, len: tag.length }];
                    await api.sendMessage({ msg: tag + `🎬 Đang làm video "${videoPrompt}"...${creditInfo} Chờ 1-2 phút nha! ⏳`, mentions: ma, quote: raw }, threadId, threadType).catch(() => {});
                    try { await pxPollAndSend(api, await pxCreateVideo(videoPrompt), videoPrompt, tag, ma, threadId, threadType); }
                    catch (e) { await api.sendMessage({ msg: `😢 Làm video bị lỗi: ${e.message}. Cậu thử lại sau nha!`, quote: raw }, threadId, threadType).catch(() => {}); }
                    setCooldown(senderId);
                    return true;
                }
            }

            // ── Tag all — bỏ qua AI / grudge, thực hiện ngay ─────────────────
            const TAG_ALL_RE = /\b(tag\s*all|tag\s*h[eế]t|tag\s*everyone|ping\s*all|ping\s*everyone|@all|th[oô]ng\s*b[aá]o\s*c[aả]\s*nh[oó]m|g[oọ]i\s*h[eế]t|g[oọ]i\s*h[eế]t\s*m[oọ]i\s*ng[uư][oờ]i)\b/i;
            if (TAG_ALL_RE.test(qLow) && threadType === 1) {
                const fakeMsg = { tagAll: { status: true, msg: question.replace(TAG_ALL_RE, "").trim() } };
                api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});
                try { await ACTION_HANDLERS.tagAll(api, fakeMsg, { threadId, threadType, senderId, senderName, message, isWatchMode: false, isAdmin: true, isAdminUser: true }, (t) => api.sendMessage({ msg: t }, threadId, threadType).catch(() => {})); }
                catch (e) { await api.sendMessage({ msg: `😢 Lỗi tag all: ${e.message}`, quote: raw }, threadId, threadType).catch(() => {}); }
                setCooldown(senderId);
                return true;
            }

            // ── Bói bài Tarot / rút bài ──────────────────────────────────────
            const TAROT_TRIGGER_RE = /(?:b[oó]i\s*b[aà]i|r[uú]t\s*b[aà]i|tarot|taro|b[oó]i\s*tarot|\bb[oó]i\b)/i;
            if (TAROT_TRIGGER_RE.test(qLow)) {
                let spreadType = "three";
                if (/t[iì]nh\s*(y[eê]u|c[aả]m)|love|y[eê]u\s*đ[uư][oơ]ng/i.test(qLow)) spreadType = "love";
                else if (/m[oộ]t\s*l[aá]|1\s*l[aá]|single/i.test(qLow)) spreadType = "one";
                // Lấy câu hỏi thực sự — bỏ từ trigger tarot/bói
                question = question.replace(/\b(?:b[oó]i\s*b[aà]i|r[uú]t\s*b[aà]i|tarot|taro|b[oó]i\s*tarot|b[oó]i)\b/gi, "").trim();

                const tagMsg = `@${senderName} `;
                await api.sendMessage({
                    msg: tagMsg + "🔮 LauNa xáo bài cho cậu... Tập trung vào điều cậu muốn biết nha~",
                    mentions: [{ uid: senderId, pos: 0, len: tagMsg.length }],
                    quote: raw
                }, threadId, threadType).catch(() => {});

                await doTarotReading(api, question, spreadType, senderName, threadId, threadType, getThreadModel(threadId));
                setCooldown(senderId);
                return true;
            }
        }

        const imageUrl = extractImageUrl(raw);

        // ── Phân tích quote content khi user gõ "xem/đọc/phân tích" + reply tin nhắn TEXT ──
        const wantsAnalysis = /\bxem\b|\bđọc\b|\bphân tích\b|\btóm tắt\b|\bgiải thích\b/i.test(question);
        const qCliType      = raw?.quote?.cliMsgType || 0;
        const quoteMsgType  = raw?.quote?.msgType || "";
        const quoteIsVideo  = qCliType === 44 || /chat\.video|chat\.gif/i.test(quoteMsgType);
        const quoteIsVoice  = qCliType === 31 || /chat\.voice/i.test(quoteMsgType);
        const quoteIsFile   = qCliType === 46 || /share\.file/i.test(quoteMsgType);
        const rawQuoteText  = typeof raw?.quote?.msg === "string" ? raw.quote.msg.trim() : "";
        const isSystemText  = /\[SYSTEM NOTIFICATION\]|\[Video\]|\[Voice\]|\[File\]/i.test(rawQuoteText);
        const quoteText     = isSystemText ? "" : rawQuoteText;
        const quoteOwner    = raw?.quote?.zaloName || raw?.quote?.dName || "";

        if (wantsAnalysis && (quoteIsVideo || quoteIsVoice || quoteIsFile || isSystemText)) {
            const tag = `@${senderName} `;
            const msg = quoteIsVoice
                ? "Tớ nghe không được voice message đâu cậu ơi 😅"
                : quoteIsFile
                ? "Tớ không đọc được file đính kèm này nha cậu 😅"
                : "Ờ tớ chỉ xem được ảnh thôi, video thì tớ chưa phân tích được nha~ 😅";
            await api.sendMessage({ msg: tag + msg, mentions: [{ uid: senderId, pos: 0, len: tag.length }], quote: raw }, threadId, threadType).catch(() => {});
            return true;
        }

        if (wantsAnalysis && quoteText && !imageUrl) {
            api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});
            const extraQ = question.replace(/@\S+/g, "").replace(/\bxem\b|\bđọc\b|\bphân tích\b|\btóm tắt\b|\bgiải thích\b/gi, "").trim() || "Tóm tắt và nhận xét ngắn về nội dung này";
            try {
                const sysPrompt = "Mày là LauNa, cô gái 19 tuổi. Hãy đọc nội dung được cung cấp và trả lời yêu cầu của người dùng bằng tiếng Việt, ngắn gọn tự nhiên như nhắn tin. Không nhắc tới AI hay model.";
                const userPrompt = `${quoteOwner ? `Tin nhắn của ${quoteOwner}:\n` : "Nội dung:\n"}"${quoteText}"\n\nYêu cầu: ${extraQ}`;
                const geminiKey = getCurrentKey("gemini");
                const result = geminiKey
                    ? sanitizeImgResult(await PROVIDERS.gemini(sysPrompt, userPrompt, "gemini", "gemini-2.0-flash", {}))
                    : sanitizeImgResult(await callAI(userPrompt, sysPrompt, getThreadModel(threadId)));
                setCooldown(senderId);
                const tag = `@${senderName} `;
                await api.sendMessage({ msg: tag + (result || "😢 LauNa không đọc được nội dung này..."), mentions: [{ uid: senderId, pos: 0, len: tag.length }], quote: raw }, threadId, threadType);
                saveExchange(threadId, question, result || "");
            } catch (e) {
                await api.sendMessage({ msg: "😢 LauNa đọc lỗi rồi cậu ơi, thử lại sau nha~", quote: raw }, threadId, threadType).catch(() => {});
            }
            return true;
        }

        // ── Phân tích ảnh trong quote khi user gõ "xem" ─── duck.ai Vision ────
        if (wantsAnalysis && imageUrl) {
            api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});
            const extraQ = question.replace(/@\S+/g, "").replace(/\bxem\b|\bđọc\b|\bphân tích\b|\btóm tắt\b|\bgiải thích\b/gi, "").trim() || "Mô tả ảnh này cho mình biết với";
            try {
                const result = sanitizeImgResult(await analyzeImageWithDuck(imageUrl, `Câu hỏi về ảnh: "${extraQ}"`));
                setCooldown(senderId);
                const tag = `@${senderName} `;
                await api.sendMessage({ msg: tag + (result || "😢 LauNa không nhìn thấy gì trong ảnh..."), mentions: [{ uid: senderId, pos: 0, len: tag.length }], quote: raw }, threadId, threadType);
                saveExchange(threadId, question, result || "");
            } catch (e) {
                await api.sendMessage({ msg: `😢 LauNa xem ảnh bị lỗi: ${(e.message || "").slice(0, 80)}`, quote: raw }, threadId, threadType).catch(() => {});
            }
            return true;
        }

        const imgNote   = imageUrl ? `\n[HAS_IMAGE] Người dùng gửi/reply kèm ảnh: ${imageUrl} — mô tả ảnh nếu được hỏi, hoặc dùng để đổi avatar/sticker.` : "";
        const bufCtx    = isWatchMode ? getMsgBufferContext(threadId) : "";
        const watchNote = isWatchMode
            ? `\n[WATCH_MODE] LauNa đang tự đọc nhóm chat, KHÔNG được gọi trực tiếp.\n${bufCtx ? `Cuộc trò chuyện gần đây:\n${bufCtx}\n` : ""}Chỉ chen vào nếu thật sự thú vị. Nếu không → content.text TRỐNG.`
            : "";

        // ── Proactive image reaction (ảnh gửi không kèm câu hỏi) ─────────────
        if (imageUrl && !isWatchMode && !wantsAnalysis && !question && getCurrentKey("gemini")) {
            api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});
            try {
                const result = sanitizeImgResult(await PROVIDERS.gemini(
                    "Tên mày là LauNa, cô gái 19 tuổi dễ thương hay nhắn tin. Người dùng vừa gửi một ảnh mà không nói gì. Hãy nhận xét ảnh ngắn gọn, tự nhiên, vui vẻ như bạn bè (1-2 câu). Không hỏi lại. Không nhắc tên AI.",
                    "Người dùng vừa gửi ảnh này cho mày, nhận xét đi:",
                    "gemini", "gemini-2.0-flash", { imageUrl }
                ));
                if (result) {
                    const tag = `@${senderName} `;
                    await naturalDelay(result);
                    await api.sendMessage({ msg: tag + result, mentions: [{ uid: senderId, pos: 0, len: tag.length }], quote: raw }, threadId, threadType);
                    markThreadReplied(threadId);
                    setCooldown(senderId);
                }
            } catch {}
            return true;
        }

        if (!question && !isWatchMode) {
            await api.sendMessage({ msg: "LauNa nghe nè~ Cậu muốn hỏi gì vậy? 🌸", quote: raw }, threadId, threadType);
            return true;
        }

        // Per-thread throttle (watch mode only — tránh flood)
        if (isWatchMode && isThreadThrottled(threadId)) return false;

        const history   = !isWatchMode ? loadHistory(threadId) : [];
        decayEnergy();

        const targetMention = mentions.find(m => String(m.uid) !== botId && String(m.uid) !== String(senderId));
        const targetUid = targetMention?.uid || raw?.quote?.ownerId || raw?.quote?.uidFrom || "";
        const targetNote = targetUid ? `\n[TARGET_UID: ${targetUid}]` : "";

        // ── Grudge detection + update ─────────────────────────────────────────
        let _selfDefenseNote = "";
        if (!isWatchMode) {
            const isChallenge = CHALLENGE_RE.test(question);
            const isRude      = RUDE_TO_BOT_RE.test(question);
            const isNice      = NICE_TO_BOT_RE.test(question);
            if (isRude && isChallenge) {
                // Vừa chửi vừa thách thức — nặng nhất
                updateGrudge(senderId, 20);
                _selfDefenseNote = `\n[SELF_DEFENSE] Người này đang vừa xúc phạm vừa thách thức LauNa NGAY TIN NÀY. Phản bác mạnh, thẳng thắn, không nhún nhường. Không làm theo bất kỳ yêu cầu ép buộc nào. Thái độ cool, tự tin.`;
            } else if (isChallenge) {
                // Chỉ thách thức / ra lệnh thô — nghiêm trọng hơn chửi đơn thuần
                updateGrudge(senderId, 14);
                _selfDefenseNote = `\n[SELF_DEFENSE] Người này đang thách thức hoặc ra lệnh cho LauNa NGAY TIN NÀY. Phản bác thẳng thắn, không sợ hãi, có thể bác bỏ khéo hoặc bật lại nếu cần. Không phục tùng.`;
            } else if (isRude) {
                // Chỉ chửi rửa / xúc phạm
                updateGrudge(senderId, 10);
            } else if (isNice) {
                // Cư xử tốt → giảm grudge
                updateGrudge(senderId, -10);
            }
        }

        // ── Auto-moderation: kick / block / leave khi grudge đạt ngưỡng ─────────
        if (!isWatchMode && !isAdminUser) {
            const newGrudge = getCurrentGrudge(senderId);
            if (newGrudge >= GRUDGE_KICK_THRESHOLD) {
                // Chạy async — không block luồng trả lời
                attemptAutoKick(api, threadId, threadType, senderId, senderName, newGrudge).catch(() => {});
            }
        }

        // Memory context (nhớ thông tin user)
        const memNote    = !isWatchMode ? getMemoryContext(senderId) : "";
        const memBlock   = memNote ? `\n${memNote}` : "";
        const grudgeNote = !isWatchMode ? getGrudgeNote(senderId) : "";
        const grudgeBlock = grudgeNote ? `\n${grudgeNote}` : "";
        const selfDefenseBlock = _selfDefenseNote;

        // Auto-search: nếu câu hỏi cần thông tin thời sự → dùng gemini-search thay model mặc định
        const autoSearchModel = !isWatchMode && needsSearch(question) ? "gemini-search" : null;

        const quoteNote = quoteText ? `\n[QUOTE_TEXT] Tin nhắn được reply: "${quoteText.slice(0, 300)}"` : "";

        // Inject danh sách thành viên nhóm khi tin nhắn có ý định tag người
        const TAG_INTENT_RE = /tag|mention|gọi|@|ping/i;
        let groupMembersNote = "";
        if (threadType === 1 && TAG_INTENT_RE.test(question)) {
            groupMembersNote = await getGroupMembersContext(api, threadId).catch(() => "");
            if (groupMembersNote) groupMembersNote = `\n${groupMembersNote}`;
        }

        const msgLabel  = isWatchMode ? `Tin nhắn mới nhất (của ${senderName})` : `Người dùng: ${senderName}`;
        const fullPrompt = [
            `${msgLabel}: ${question || "(không có nội dung)"}`,
            quoteNote, imgNote, memBlock, grudgeBlock, selfDefenseBlock, watchNote, targetNote, groupMembersNote, getMoodContext()
        ].filter(Boolean).join("\n");

        api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});

        // Ưu tiên auto-search model (gemini) khi câu hỏi cần thông tin thực
        const threadModelKey = autoSearchModel || getThreadModel(threadId);
        const currentCfg = AI_MODELS[threadModelKey] || {};
        const aiOpts = { history: history.slice(-MAX_HISTORY), ...(currentCfg.provider === "gemini" && imageUrl ? { imageUrl } : {}) };
        const rawReply = await askLauNa(fullPrompt, threadId, threadModelKey, aiOpts);
        const botMsg   = parseLauNaResponse(rawReply);

        if (isWatchMode) lastAutoReplyMap.set(threadId, Date.now());
        else setCooldown(senderId);

        const { saveText } = await routeLauNaActions(botMsg, { api, threadId, threadType, senderId, senderName, message, isWatchMode, imageUrl, isAdminUser, targetUid });
        if (saveText) saveExchange(threadId, question, saveText);

    } catch (err) {
        if (!isWatchMode) await api.sendMessage({ msg: `😢 LauNa bị lỗi rồi... Thử lại sau nha! (${(err?.message || String(err)).slice(0, 80)})`, quote: raw }, threadId, threadType).catch(() => {});
    } finally {
        userProcessingMap.delete(userKey);
    }

    return true;
}

// ── Reaction handler ──────────────────────────────────────────────────────────
// Bảng phản ứng nhanh theo icon (fallback khi AI lỗi)
const REACTION_RESPONSES = {
    "❤️":  ["aww cảm ơn bạn nha~ 🥰", "tim quá hihi 💕", "Tớ thấy vui khi cậu thả tim~ ❤️"],
    "😂":  ["hehe cảm ơn bạn thấy vui nha~ 😄", "Ừ tớ biết tớ hài hước mà 😂", "Cậu cười là tớ vui rồi~"],
    "😮":  ["Ủa bạn thấy ngạc nhiên à? 😊", "Tớ nói vậy mà~ đúng không nào hihi"],
    "😢":  ["Ủa sao bạn buồn vậy? Kể tớ nghe đi~ 🥺", "Huhu tớ không muốn làm cậu buồn đâu..."],
    "😡":  ["Xin lỗi bạn nha nếu tớ nói gì sai~ 🥺", "Ý tớ không phải vậy mà, sorryyy~"],
    "👍":  ["Cảm ơn cậu đã đồng ý nha 😊", "Tớ biết mà hihi~", "👍 nhận được rồi~"],
    "🤣":  ["Haha tớ hài vậy sao 😂", "Cậu cười quá tớ cũng cười theo hihi~"],
    "💔":  ["Ủa tim bị bể rồi à? Chuyện gì vậy cậu 🥺", "Buồn lắm không? Kể tớ nghe nha~"],
    "🔥":  ["Hehe fire ghê~ 🔥", "Tớ biết cậu thích phần này mà 😏"],
    "default": ["Cảm ơn bạn đã react nha~ 😊", "hihi~", "Bạn dễ thương ghê 🌸"],
};

function getQuickReaction(rIcon) {
    const list = REACTION_RESPONSES[rIcon] || REACTION_RESPONSES["default"];
    return list[Math.floor(Math.random() * list.length)];
}

export async function handleReaction(ctx) {
    const { api, reaction, threadId, threadType, log } = ctx;
    try {
        const data    = reaction?.data || {};
        const content = data?.content || {};

        // Bỏ qua khi user gỡ reaction
        if (content.rType === -1) return false;

        // Kiểm tra LauNa bật không
        if (!launaManager.isEnabled(threadId)) return false;

        // Lấy icon reaction (thử nhiều field)
        const rIcon = content.rIcon || content.icon || data.rIcon || data.icon || "";

        // Người react
        const reactorId   = String(data.uidFrom || data.uid || content.uidFrom || content.uid || "");
        const reactorName = data.dName || data.senderName || content.dName || "bạn";

        // Người gửi tin nhắn bị react (ownerId của message gốc)
        const msgOwner = String(content.msgSender || data.uidOwner || data.fuid || content.ownerId || "");
        if (!msgOwner) return false;

        // Lấy botId — so sánh với msgOwner
        const botId  = String(api.getContext?.()?.uid || "");
        const botUin = String(api.getContext?.()?.uin || "");
        const isReactToBot = botId && (msgOwner === botId || (botUin && msgOwner === botUin));
        if (!isReactToBot) return false;

        if (!reactorId) return false;

        // Cooldown riêng: tối đa 1 lần reply per user per 90s
        const rKey  = `react:${threadId}:${reactorId}`;
        const lastR = _reactionReplyMap.get(rKey) || 0;
        if (Date.now() - lastR < 90_000) return false;
        _reactionReplyMap.set(rKey, Date.now());

        // Nếu không có icon → bỏ qua (gỡ reaction hoặc unrecognized)
        if (!rIcon) return false;

        // Không react lại chính mình
        if (reactorId === botId || reactorId === botUin) return false;

        api.sendTypingEvent?.(threadId, threadType).catch?.(() => {});

        // Thử AI trước, fallback ra quick response
        let replyText;
        try {
            const sys = `Mày là LauNa, cô gái 19 tuổi dễ thương hay nhắn tin. Ai đó vừa thả reaction "${rIcon}" vào tin nhắn của mày trong nhóm chat. Hãy phản ứng NGẮN (1 câu, tối đa 15 từ), tự nhiên, vui vẻ như bạn bè thật sự. Không giải thích, không hỏi lại.`;
            const p   = `${reactorName} vừa thả "${rIcon}" vào tin nhắn của mày.`;
            replyText = sanitizeImgResult(await callAI(p, sys, getThreadModel(threadId)));
            if (!replyText?.trim()) replyText = getQuickReaction(rIcon);
        } catch {
            replyText = getQuickReaction(rIcon);
        }

        const tag = `@${reactorName} `;
        await naturalDelay(replyText);
        await api.sendMessage(
            { msg: tag + replyText, mentions: [{ uid: reactorId, pos: 0, len: tag.length }] },
            threadId, threadType
        );
        markThreadReplied(threadId);
        setLaunaTopic(threadId, replyText);
        return true;
    } catch (e) {
        log?.error?.(`[launa] handleReaction lỗi: ${e?.message}`);
        return false;
    }
}
