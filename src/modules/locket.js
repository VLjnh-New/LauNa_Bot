import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { FFMPEG_BIN, FFPROBE_BIN } from "../utils/core/ffmpegHelper.js";
import { createHash } from "node:crypto";
import axios from "axios";
import { log } from "../globals.js";
import { tempDir, readJSON, writeJSON } from "../utils/core/io-json.js";

export const name = "locket";
export const description = "Upload ảnh/video lên Locket, xem moments, chat, quản lý bạn bè";

// ── Zalo cookie helper (dùng khi download media từ CDN Zalo) ──────────────────
const COOKIE_PATH = path.resolve(process.cwd(), "cookie.json");
let _zaloCookieStr = null;
function getZaloCookieHeader() {
    if (_zaloCookieStr) return _zaloCookieStr;
    try {
        const cookies = JSON.parse(fs.readFileSync(COOKIE_PATH, "utf8"));
        _zaloCookieStr = Array.isArray(cookies)
            ? cookies.map(c => `${c.key}=${c.value}`).join("; ")
            : "";
    } catch { _zaloCookieStr = ""; }
    return _zaloCookieStr;
}
function isZaloCdnUrl(url) {
    return typeof url === "string" && (
        url.includes("dlmd.me") || url.includes("zdn.vn") ||
        url.includes("zalo.me") || url.includes("zadn.vn") ||
        url.includes("zaloapp.com") || url.includes("chat.zalo.me")
    );
}

// ── Firebase / Locket constants ────────────────────────────────────────────────
const FIREBASE_API_KEY  = "AIzaSyCQngaaXQIfJaH0aS2l7REgIjD7nL431So";
const FIREBASE_AUTH_URL = `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPassword?key=${FIREBASE_API_KEY}`;
const LOCKET_API        = "https://api.locketcamera.com";

const IMG_BUCKET   = "locket-img";
const VIDEO_BUCKET = "locket-video";

// ── Device profiles ────────────────────────────────────────────────────────────
// GMPID đúng theo luckit + Aedotris: cc8eb46290d69b234fa606
const FIREBASE_GMPID_IOS     = "1:641029076083:ios:cc8eb46290d69b234fa606";
const FIREBASE_GMPID_ANDROID = "1:641029076083:android:a3c9b8e0f1234567";

const DEVICE_PROFILES = {
    ios: {
        locketUA:    "com.locket.Locket/1.82.0 iPhone/18.0 hw/iPhone15_3 (GTMSUF/1)",
        gmpid:       FIREBASE_GMPID_IOS,
        clientType:  "CLIENT_TYPE_IOS",
        authHeaders: {
            "Accept":                  "*/*",
            "Accept-Language":         "en-GB,en;q=0.9",
            "Connection":              "keep-alive",
            "Content-Type":            "application/json",
            "X-Client-Version":        "iOS/FirebaseSDK/10.23.1/FirebaseCore-iOS",
            "X-Firebase-GMPID":        FIREBASE_GMPID_IOS,
            "X-Ios-Bundle-Identifier": "com.locket.Locket",
            "User-Agent":              "FirebaseAuth.iOS/10.23.1 com.locket.Locket/1.82.0 iPhone/18.0 hw/iPhone12_1",
        },
        // appCheckToken: optional — truyền vào để bạn bè thấy video
        apiHeaders: (idToken, appCheckToken = null) => ({
            "Content-Type":            "application/json",
            "Authorization":           `Bearer ${idToken}`,
            "User-Agent":              "com.locket.Locket/1.82.0 iPhone/18.0 hw/iPhone15_3 (GTMSUF/1)",
            "X-Client-Version":        "iOS/FirebaseSDK/10.23.1/FirebaseCore-iOS",
            "X-Firebase-GMPID":        FIREBASE_GMPID_IOS,
            "X-Ios-Bundle-Identifier": "com.locket.Locket",
            ...(appCheckToken ? { "X-Firebase-AppCheck": appCheckToken } : {}),
        }),
    },
    android: {
        locketUA:    "Locket/1.82.0 (Android 14; SM-S918B Build/UP1A.231005.007) okhttp/4.12.0",
        gmpid:       FIREBASE_GMPID_ANDROID,
        clientType:  "CLIENT_TYPE_ANDROID",
        authHeaders: {
            "Accept":                  "*/*",
            "Accept-Language":         "en-US,en;q=0.9",
            "Connection":              "keep-alive",
            "Content-Type":            "application/json",
            "X-Client-Version":        "Android/FirebaseSDK/20.7.0/FirebaseCore-Android",
            "X-Firebase-GMPID":        FIREBASE_GMPID_ANDROID,
            "X-Android-Package":       "com.locket.Locket",
            "X-Android-Cert":          "A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2",
            "User-Agent":              "FirebaseAuth.Android/20.7.0 com.locket.Locket/1.82.0 Android/14 (SM-S918B)",
        },
        apiHeaders: (idToken, appCheckToken = null) => ({
            "Content-Type":            "application/json",
            "Authorization":           `Bearer ${idToken}`,
            "User-Agent":              "Locket/1.82.0 (Android 14; SM-S918B Build/UP1A.231005.007) okhttp/4.12.0",
            "X-Client-Version":        "Android/FirebaseSDK/20.7.0/FirebaseCore-Android",
            "X-Firebase-GMPID":        FIREBASE_GMPID_ANDROID,
            ...(appCheckToken ? { "X-Firebase-AppCheck": appCheckToken } : {}),
        }),
    },
    // Web profile — không có AppCheck, không khai báo iOS/Android → server không enforce AppCheck
    // Dùng khi không có AppCheck token (fallback hoàn toàn tự động)
    web: {
        locketUA:   "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        authHeaders: {
            "Content-Type":  "application/json",
            "User-Agent":    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        },
        apiHeaders: (idToken) => ({
            "Content-Type":  "application/json",
            "Authorization": `Bearer ${idToken}`,
            "User-Agent":    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        }),
    },
};

const LOCKET_UA    = DEVICE_PROFILES.ios.locketUA;
const AUTH_HEADERS = DEVICE_PROFILES.ios.authHeaders;

function getProfile(senderId) {
    const accs = getLocketAccounts();
    const dev  = accs[String(senderId)]?.device || "ios";
    return DEVICE_PROFILES[dev] || DEVICE_PROFILES.ios;
}

// Trả về profile phù hợp: nếu không có AppCheck thì dùng web (không bị enforce AppCheck)
function getEffectiveProfile(senderId) {
    const profile = getProfile(senderId);
    // Nếu đang dùng ios/android mà không có AppCheck → tự động dùng web profile
    if (profile !== DEVICE_PROFILES.web && !appCheckStatus(senderId).ok) {
        return DEVICE_PROFILES.web;
    }
    return profile;
}

// ── Credentials store ──────────────────────────────────────────────────────────
const TOKEN_PATH = path.join(process.cwd(), "src/data/locket_tokens.json");

function readTokens()      { return readJSON(TOKEN_PATH) || {}; }
function writeTokens(data) { writeJSON(TOKEN_PATH, data); }
function getLocketAccounts()             { return readTokens()?.locketAccounts || {}; }
function saveLocketAccount(sid, info)    { const t = readTokens(); if (!t.locketAccounts) t.locketAccounts = {}; t.locketAccounts[String(sid)] = info; writeTokens(t); }
function removeLocketAccount(sid)        { const t = readTokens(); if (t.locketAccounts) delete t.locketAccounts[String(sid)]; writeTokens(t); }

// ── Lưu thread cuối để bot biết gửi nhắc vào đâu ─────────────────────────────
function saveLastThread(sid, threadId, threadType) {
    const t = readTokens();
    if (!t.locketAccounts) t.locketAccounts = {};
    if (!t.locketAccounts[String(sid)]) t.locketAccounts[String(sid)] = {};
    t.locketAccounts[String(sid)].lastThreadId   = String(threadId);
    t.locketAccounts[String(sid)].lastThreadType = threadType;
    writeTokens(t);
}
function getLastThread(sid) {
    const acc = getLocketAccounts()[String(sid)];
    if (!acc?.lastThreadId) return null;
    return { threadId: acc.lastThreadId, threadType: acc.lastThreadType ?? 0 };
}

// ── AppCheck token per-user ────────────────────────────────────────────────────
function saveAppCheckToken(sid, token) {
    const t = readTokens();
    if (!t.locketAccounts) t.locketAccounts = {};
    if (!t.locketAccounts[String(sid)]) t.locketAccounts[String(sid)] = {};
    t.locketAccounts[String(sid)].appCheckToken = token;
    writeTokens(t);
}
function getAppCheckToken(sid) {
    return getLocketAccounts()[String(sid)]?.appCheckToken || null;
}

// Decode JWT exp (không cần verify signature) → timestamp (ms) hoặc null
function decodeJwtExp(token) {
    try {
        const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
        return payload.exp ? payload.exp * 1000 : null;
    } catch { return null; }
}
function appCheckStatus(sid) {
    const token = getAppCheckToken(sid);
    if (!token) return { ok: false, msg: "chưa có AppCheck token" };
    const exp = decodeJwtExp(token);
    if (!exp) return { ok: true, msg: "có token (không đọc được hạn)" };
    if (Date.now() > exp) return { ok: false, msg: `token đã hết hạn (${new Date(exp).toLocaleString("vi-VN")})` };
    const mins = Math.round((exp - Date.now()) / 60000);
    return { ok: true, msg: `còn hiệu lực ${mins < 60 ? mins + " phút" : Math.round(mins/60) + " giờ"}` };
}

// ── Auto AppCheck: thử debug token exchange (Firebase) ────────────────────────
// Sẽ thất bại nếu Locket production không cho phép debug token.
// Nhưng không tốn gì để thử — nếu thành công thì token hoàn toàn tự động.
const LOCKET_PROJ    = "locket-93d2a";
const LOCKET_IOS_APP = "1:641029076083:ios:cc8eb46290d69b234fa606";
const AC_EXCHANGE_URL = `https://firebaseappcheck.googleapis.com/v1/projects/${LOCKET_PROJ}/apps/${LOCKET_IOS_APP}:exchangeDebugToken`;

// debug_token phải là UUID đã đăng ký trong Firebase Console của Locket → ta không có quyền
// → endpoint này sẽ trả 403 với Locket production. Nhưng vẫn thử mỗi restart phòng trường hợp.
async function tryDebugTokenExchange(debugUuid) {
    try {
        const res = await axios.post(AC_EXCHANGE_URL, { debug_token: debugUuid }, {
            headers: { "Content-Type": "application/json" },
            timeout: 8000,
            validateStatus: () => true,
        });
        if (res.status === 200 && res.data?.token) {
            return res.data.token;
        }
    } catch { /* bỏ qua */ }
    return null;
}

// ── Tự động lấy AppCheck token bằng Headless Browser (Chromium) ───────────────
// Không cần điện thoại hay mitmproxy.
// Dùng puppeteer-core + chromium để mở locket.top, đăng nhập,
// bắt X-Firebase-AppCheck từ request đi ra, lưu lại.
// Tìm đường dẫn chromium (sync, dùng execFileSync đã import ở đầu file)
function findChromium() {
    const candidates = ["chromium", "chromium-browser", "google-chrome"];
    for (const bin of candidates) {
        try {
            const p = execFileSync("which", [bin], { encoding: "utf8", timeout: 3000 }).trim();
            if (p) return p;
        } catch {}
    }
    return "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
}

let _puppeteerBusy = false;

async function autoFetchAppCheckToken(email, password) {
    if (_puppeteerBusy) throw new Error("Đang có tiến trình lấy token khác, vui lòng đợi.");
    _puppeteerBusy = true;
    let browser;
    try {
        const puppeteer = await import("puppeteer-core");
        const launch    = puppeteer.launch || puppeteer.default?.launch;
        if (!launch) throw new Error("puppeteer-core không khởi động được");

        const executablePath = findChromium();
        log.info(`[Locket AutoToken] Khởi động Chromium: ${executablePath}`);

        browser = await launch({
            executablePath,
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-software-rasterizer",
                "--disable-extensions",
                "--no-first-run",
                "--no-zygote",
                "--single-process",
            ],
        });

        const page = await browser.newPage();
        await page.setUserAgent(
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) " +
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
        );

        // Patch fetch + XHR để bắt header X-Firebase-AppCheck
        await page.evaluateOnNewDocument(() => {
            window.__locketAC = null;

            const storeAC = (headers) => {
                const token = headers?.["X-Firebase-AppCheck"] || headers?.["x-firebase-appcheck"];
                if (token && token.length > 100) window.__locketAC = token;
            };

            // Patch fetch
            const origFetch = window.fetch;
            window.fetch = function(input, init = {}) {
                const url = typeof input === "string" ? input : input?.url || "";
                if (url.includes("locketcamera.com") || url.includes("firebasestorage") || url.includes("googleapis")) {
                    storeAC(init.headers || {});
                }
                return origFetch.apply(this, arguments);
            };

            // Patch XMLHttpRequest
            const origOpen = XMLHttpRequest.prototype.open;
            const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
                if ((name === "X-Firebase-AppCheck" || name === "x-firebase-appcheck") && value?.length > 100) {
                    window.__locketAC = value;
                }
                return origSetHeader.apply(this, arguments);
            };
        });

        // Mở trang locket.top
        log.info("[Locket AutoToken] Đang mở locket.top...");
        await page.goto("https://locket.top/", { waitUntil: "domcontentloaded", timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        // Điền form đăng nhập
        const emailSel    = 'input[type="email"], input[name="email"], input[placeholder*="mail"], input[placeholder*="Email"]';
        const passwordSel = 'input[type="password"], input[name="password"]';

        await page.waitForSelector(emailSel, { timeout: 10000 });
        await page.click(emailSel);
        await page.type(emailSel, email, { delay: 50 });
        await page.click(passwordSel);
        await page.type(passwordSel, password, { delay: 50 });

        // Click nút đăng nhập
        const btnSel = 'button[type="submit"], button.login-btn, button:is([class*="login"],[class*="Login"],[class*="submit"])';
        try {
            await page.click(btnSel);
        } catch {
            // Fallback: Enter key
            await page.keyboard.press("Enter");
        }

        log.info("[Locket AutoToken] Đã submit form, đang chờ token...");

        // Chờ token xuất hiện (tối đa 30s)
        const token = await new Promise((resolve) => {
            const start   = Date.now();
            const checker = setInterval(async () => {
                try {
                    const val = await page.evaluate(() => window.__locketAC);
                    if (val) { clearInterval(checker); resolve(val); return; }
                } catch {}
                if (Date.now() - start > 30000) { clearInterval(checker); resolve(null); }
            }, 1000);
        });

        if (!token) {
            // Thử trigger bằng cách đợi thêm sau khi trang load xong
            await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {});
            const retry = await page.evaluate(() => window.__locketAC);
            if (retry) return retry;
            throw new Error("Không bắt được AppCheck token — locket.top có thể dùng server-side rendering.");
        }

        log.info(`[Locket AutoToken] Lấy được token (${token.length} ký tự) ✅`);
        return token;
    } finally {
        _puppeteerBusy = false;
        try { await browser?.close(); } catch {}
    }
}

// ── Auto-monitor: kiểm tra token mỗi 10 phút, nhắc user khi sắp hết ──────────
// Gọi startAutoAppCheckMonitor(api) từ bot.js sau khi login xong.
const MONITOR_INTERVAL_MS  = 10 * 60 * 1000;  // kiểm tra mỗi 10 phút
const WARN_BEFORE_EXPIRE_MS = 15 * 60 * 1000;  // cảnh báo khi còn < 15 phút
const _notifiedExpiry = new Set();              // tránh gửi lặp nhiều tin

export function startAutoAppCheckMonitor(api) {
    const _run = async () => {
        const accounts = getLocketAccounts();
        for (const [sid, acc] of Object.entries(accounts)) {
            const token = acc?.appCheckToken;
            if (!token) continue;
            const lastThread = getLastThread(sid);
            if (!lastThread) continue;

            const exp = decodeJwtExp(token);
            if (!exp) continue;

            const msLeft = exp - Date.now();
            const key    = `${sid}:${exp}`;

            if (msLeft <= 0) {
                // Token đã hết hạn
                if (!_notifiedExpiry.has(key)) {
                    _notifiedExpiry.add(key);
                    try {
                        await api.sendMessage({
                            msg: [
                                `⚠️ [Locket AutoCheck] AppCheck token của bạn đã HẾT HẠN!`,
                                `Video sẽ không hiển thị với bạn bè cho đến khi cập nhật token mới.`,
                                ``,
                                `📱 Cách lấy token mới (1-2 phút):`,
                                `1. Mở Locket trên điện thoại (cần mitmproxy đã cài sẵn)`,
                                `2. Xem bất kỳ moment nào → bắt request tới api.locketcamera.com`,
                                `3. Copy header X-Firebase-AppCheck`,
                                `4. Dán vào bot: .uplocket appcheck set <JWT>`,
                            ].join("\n"),
                        }, lastThread.threadId, lastThread.threadType);
                    } catch { /* bỏ qua lỗi gửi tin */ }
                }
            } else if (msLeft <= WARN_BEFORE_EXPIRE_MS) {
                // Sắp hết hạn → thử debug exchange trước
                const mins = Math.round(msLeft / 60000);
                if (!_notifiedExpiry.has(key)) {
                    // Thử lấy token tự động (sẽ thất bại với Locket production nhưng thử vẫn hơn)
                    const autoToken = await tryDebugTokenExchange(
                        `${sid.slice(-8)}-auto-${Date.now().toString(36)}-xxxx-xxxx-xxxx`
                            .replace(/x/g, () => Math.floor(Math.random()*16).toString(16))
                    );
                    if (autoToken) {
                        saveAppCheckToken(sid, autoToken);
                        _notifiedExpiry.add(key);
                        try {
                            await api.sendMessage({
                                msg: `✅ [Locket AutoCheck] Đã tự động làm mới AppCheck token thành công! 🎉`,
                            }, lastThread.threadId, lastThread.threadType);
                        } catch { /* bỏ qua */ }
                        continue;
                    }
                    _notifiedExpiry.add(key);
                    try {
                        await api.sendMessage({
                            msg: [
                                `⏰ [Locket AutoCheck] AppCheck token sắp hết hạn sau ${mins} phút!`,
                                `Video sẽ không hiển thị nếu không cập nhật kịp.`,
                                ``,
                                `Lệnh cập nhật nhanh: .uplocket appcheck set <JWT>`,
                                `Xem hướng dẫn:       .uplocket appcheck help`,
                            ].join("\n"),
                        }, lastThread.threadId, lastThread.threadType);
                    } catch { /* bỏ qua */ }
                }
            } else {
                // Token còn nhiều giờ → reset lại để có thể nhắc lần sau
                _notifiedExpiry.delete(key);
            }
        }
    };

    // Chạy ngay lần đầu sau 30s (để bot hoàn tất login)
    setTimeout(_run, 30_000);
    setInterval(_run, MONITOR_INTERVAL_MS);
    log.info("[Locket] Auto AppCheck monitor đã khởi động (kiểm tra mỗi 10 phút).");
}

// OTP pending store (in-memory, không cần lưu disk)
const otpPending = new Map(); // senderId → { phoneNumber, sessionInfo }

// ── Firebase Auth ──────────────────────────────────────────────────────────────
const tokenCache = new Map();

async function loginToLocket(email, password, profile = DEVICE_PROFILES.ios) {
    const res = await axios.post(FIREBASE_AUTH_URL, {
        email,
        password,
        clientType:        profile.clientType,
        returnSecureToken: true,
    }, { headers: profile.authHeaders, timeout: 15000 });

    return {
        idToken:      res.data.idToken,
        refreshToken: res.data.refreshToken,
        uid:          res.data.localId,
        expiresAt:    Date.now() + Number(res.data.expiresIn) * 1000,
    };
}

async function refreshIdToken(refreshToken) {
    // securetoken.googleapis.com cũng dùng API key bị restrict iOS
    // → phải khai báo X-Ios-Bundle-Identifier để không bị 403 "API key restricted to iOS"
    const res = await axios.post(
        `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
        { grant_type: "refresh_token", refresh_token: refreshToken },
        {
            headers: {
                "Content-Type":            "application/json",
                "X-Ios-Bundle-Identifier": "com.locket.Locket",
                "X-Client-Version":        "iOS/FirebaseSDK/10.23.1/FirebaseCore-iOS",
                "User-Agent":              "FirebaseAuth.iOS/10.23.1 com.locket.Locket/1.82.0 iPhone/18.0 hw/iPhone12_1",
            },
            timeout: 15000,
        }
    );
    return {
        idToken:      res.data.id_token,
        refreshToken: res.data.refresh_token,
        uid:          res.data.user_id,
        expiresAt:    Date.now() + Number(res.data.expires_in) * 1000,
    };
}

async function getIdToken(senderId) {
    const cached  = tokenCache.get(String(senderId));
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached;

    const cred    = getLocketAccounts()[String(senderId)];
    if (!cred) throw new Error("Chưa đăng nhập Locket. Dùng .uplocket login <email> <password>");

    // Firebase Auth API key bị restrict theo iOS bundle ID → PHẢI dùng iOS profile cho auth
    // LUÔN LUÔN dùng iOS cho Firebase Auth, bất kể cred.device là gì.
    // cred.device chỉ ảnh hưởng đến Locket API headers, không ảnh hưởng Firebase Auth.
    // Android profile không có X-Ios-Bundle-Identifier → Firebase trả 403 "iOS client <empty> blocked"
    const authProfile = DEVICE_PROFILES.ios;
    let entry;
    if (cached?.refreshToken) {
        try {
            entry = await refreshIdToken(cached.refreshToken);
        } catch (refreshErr) {
            const refreshUrl = refreshErr?.config?.url || "securetoken";
            const refreshStatus = refreshErr?.response?.status;
            log.warn(`[Locket] refresh failed (${refreshStatus || refreshErr.message}) @ ${refreshUrl} — thử login lại`);
            try {
                entry = await loginToLocket(cred.email, cred.password, authProfile);
            } catch (loginErr) {
                const loginUrl = loginErr?.config?.url || "identitytoolkit";
                const loginStatus = loginErr?.response?.status;
                const loginBody = JSON.stringify(loginErr?.response?.data).slice(0, 200);
                log.error(`[Locket] login failed (${loginStatus}) @ ${loginUrl} — ${loginBody}`);
                throw loginErr;
            }
        }
    } else {
        try {
            entry = await loginToLocket(cred.email, cred.password, authProfile);
        } catch (loginErr) {
            const loginUrl = loginErr?.config?.url || "identitytoolkit";
            const loginStatus = loginErr?.response?.status;
            const loginBody = JSON.stringify(loginErr?.response?.data).slice(0, 200);
            log.error(`[Locket] login failed (${loginStatus}) @ ${loginUrl} — ${loginBody}`);
            throw loginErr;
        }
    }

    tokenCache.set(String(senderId), entry);
    return entry;
}

// ── Phone OTP Auth (luckit style) ─────────────────────────────────────────────
async function sendPhoneOTP(phoneNumber) {
    // Firebase sendVerificationCode — không cần recaptcha nếu dùng "TEST" safety net
    const res = await axios.post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/sendVerificationCode?key=${FIREBASE_API_KEY}`,
        {
            phoneNumber,
            iosReceipt: "",
            iosSecret:  "",
        },
        {
            headers: {
                "Content-Type":            "application/json",
                "X-Ios-Bundle-Identifier": "com.locket.Locket",
                "X-Firebase-GMPID":        FIREBASE_GMPID_IOS,
                "X-Client-Version":        "iOS/FirebaseSDK/10.23.1/FirebaseCore-iOS",
                "User-Agent":              "FirebaseAuth.iOS/10.23.1 com.locket.Locket/1.82.0 iPhone/18.0 hw/iPhone12_1",
            },
            timeout: 15000,
        }
    );
    return res.data.sessionInfo;
}

async function verifyPhoneOTP(sessionInfo, code) {
    const res = await axios.post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/verifyPhoneNumber?key=${FIREBASE_API_KEY}`,
        {
            sessionInfo,
            code,
            returnSecureToken: true,
        },
        {
            headers: {
                "Content-Type":            "application/json",
                "X-Ios-Bundle-Identifier": "com.locket.Locket",
                "X-Firebase-GMPID":        FIREBASE_GMPID_IOS,
                "X-Client-Version":        "iOS/FirebaseSDK/10.23.1/FirebaseCore-iOS",
                "User-Agent":              "FirebaseAuth.iOS/10.23.1 com.locket.Locket/1.82.0 iPhone/18.0 hw/iPhone12_1",
            },
            timeout: 15000,
        }
    );
    return {
        idToken:      res.data.idToken,
        refreshToken: res.data.refreshToken,
        uid:          res.data.localId,
        expiresAt:    Date.now() + Number(res.data.expiresIn) * 1000,
    };
}

// ── Resumable upload helper ────────────────────────────────────────────────────
// appCheckToken: bắt buộc từ mid-2025 — Firebase Storage bật AppCheck enforcement
async function resumableUpload(idToken, uid, buffer, bucket, objPath, contentType, appCheckToken = null) {
    const encoded  = encodeURIComponent(objPath);
    const initUrl  = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encoded}?uploadType=resumable&name=${encoded}`;

    const initHeaders = {
        "Authorization":                 `Bearer ${idToken}`,
        "Content-Type":                  "application/json; charset=UTF-8",
        "Accept":                        "*/*",
        "Accept-Language":               "vi-VN,vi;q=0.9",
        "x-goog-upload-protocol":        "resumable",
        "x-goog-upload-command":         "start",
        "x-goog-upload-content-length":  String(buffer.length),
        "x-goog-upload-content-type":    contentType,
        // Chỉ khai báo iOS headers khi có AppCheck token
        // Nếu không có token mà vẫn khai báo iOS → Firebase Storage enforce AppCheck → 403
        ...(appCheckToken
            ? {
                "x-firebase-storage-version": "ios/10.28.1",
                "x-firebase-gmpid":           FIREBASE_GMPID_IOS,
                "User-Agent":                 LOCKET_UA,
                "X-Firebase-AppCheck":        appCheckToken,
              }
            : {
                "User-Agent": DEVICE_PROFILES.web.locketUA,
              }
        ),
    };

    const initRes = await axios.post(initUrl, {
        name:        objPath,
        contentType: contentType,
        bucket:      "",
        metadata:    { creator: uid, visibility: "private" },
    }, {
        headers: initHeaders,
        timeout: 30000,
    });

    const uploadUrl = initRes.headers["x-goog-upload-url"];
    if (!uploadUrl) throw new Error("Firebase không trả về upload URL");

    await axios.put(uploadUrl, buffer, {
        headers: {
            "Content-Type":                  "application/octet-stream",
            "X-Goog-Upload-Command":         "upload, finalize",
            "X-Goog-Upload-Offset":          "0",
            "Upload-Incomplete":             "?0",
            "Upload-Draft-Interop-Version":  "3",
            "User-Agent":                    LOCKET_UA,
        },
        timeout:          120000,
        maxBodyLength:    50 * 1024 * 1024,
        maxContentLength: 50 * 1024 * 1024,
    });

    const getUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encoded}`;
    const getHeaders = {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type":  "application/json; charset=UTF-8",
    };
    if (appCheckToken) getHeaders["X-Firebase-AppCheck"] = appCheckToken;

    const getRes = await axios.get(getUrl, {
        headers: getHeaders,
        timeout: 15000,
    });

    const token = getRes.data.downloadTokens;
    if (!token) throw new Error("Không lấy được download token từ Firebase");
    return `${getUrl}?alt=media&token=${token}`;
}

// ── Upload ảnh lên Firebase Storage ───────────────────────────────────────────
async function uploadImage(idToken, uid, buffer, isVideoThumb = false, appCheckToken = null) {
    const ext     = isVideoThumb ? "jpg" : "webp";
    const mime    = isVideoThumb ? "image/jpeg" : "image/webp";
    const name    = `${Date.now()}_locket.${ext}`;
    const objPath = `users/${uid}/moments/thumbnails/${name}`;
    return resumableUpload(idToken, uid, buffer, IMG_BUCKET, objPath, mime, appCheckToken);
}

// ── Upload video lên Firebase Storage ─────────────────────────────────────────
async function uploadVideo(idToken, uid, buffer, appCheckToken = null) {
    const name    = `${Date.now()}_locket.mp4`;
    const objPath = `users/${uid}/moments/videos/${name}`;
    return resumableUpload(idToken, uid, buffer, VIDEO_BUCKET, objPath, "video/mp4", appCheckToken);
}

// ── Convert ảnh sang WebP bằng ffmpeg ─────────────────────────────────────────
function convertToWebP(inputPath) {
    const outPath = path.join(tempDir, `locket_webp_${Date.now()}.webp`);
    try {
        execFileSync(FFMPEG_BIN, [
            "-y", "-i", inputPath,
            "-vf", "scale=1020:1020:force_original_aspect_ratio=decrease",
            "-quality", "90",
            outPath,
        ], { timeout: 30000, stdio: "pipe" });
        return fs.existsSync(outPath) ? outPath : null;
    } catch {
        return null;
    }
}

// ── Tạo thumbnail từ video bằng ffmpeg ────────────────────────────────────────
// Luôn trả về một file .jpg hợp lệ (không bao giờ return null nếu ffmpeg hoạt động)
function extractVideoThumbnail(videoPath) {
    const thumbPath = path.join(tempDir, `locket_thumb_${Date.now()}.jpg`);

    // Thử lấy frame tại các mốc khác nhau
    for (const ss of ["00:00:00.5", "00:00:01", "00:00:00"]) {
        try {
            execFileSync(FFMPEG_BIN, [
                "-y", "-i", videoPath,
                "-ss", ss,
                "-frames:v", "1",
                "-vf", "scale=720:720:force_original_aspect_ratio=increase,crop=720:720",
                "-q:v", "3",
                thumbPath,
            ], { timeout: 30000, stdio: "pipe" });
            if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500) return thumbPath;
        } catch { /* thử tiếp */ }
    }

    // Thử lấy frame đầu tiên không dùng -ss (an toàn nhất)
    try {
        execFileSync(FFMPEG_BIN, [
            "-y", "-i", videoPath,
            "-frames:v", "1",
            "-vf", "scale=720:720:force_original_aspect_ratio=increase,crop=720:720",
            "-q:v", "3",
            thumbPath,
        ], { timeout: 30000, stdio: "pipe" });
        if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 500) return thumbPath;
    } catch { /* thử tiếp */ }

    // Fallback cuối: tạo ảnh đen 720x720 — KHÔNG ĐƯỢC dùng videoUrl thay thế
    try {
        execFileSync(FFMPEG_BIN, [
            "-y", "-f", "lavfi", "-i", "color=c=black:s=720x720:r=1",
            "-frames:v", "1", "-q:v", "3",
            thumbPath,
        ], { timeout: 15000, stdio: "pipe" });
        return fs.existsSync(thumbPath) ? thumbPath : null;
    } catch {
        return null;
    }
}

// ── Convert sticker (animated WebP/GIF) sang video MP4 ────────────────────────
function stickerToVideo(inputPath) {
    const outPath = path.join(tempDir, `locket_stk_${Date.now()}.mp4`);
    try {
        execFileSync(FFMPEG_BIN, [
            "-y",
            "-stream_loop", "2",
            "-i", inputPath,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-an",
            "-movflags", "+faststart",
            "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=15",
            outPath,
        ], { timeout: 60000, stdio: "pipe" });
        return fs.existsSync(outPath) ? outPath : null;
    } catch (e) {
        log.warn(`[Locket] stickerToVideo lỗi: ${e.message?.slice(0, 200)}`);
        return null;
    }
}

// ── Giới hạn thời lượng video Locket (giây) ───────────────────────────────────
const LOCKET_MAX_DURATION = 5;

function getVideoDuration(filePath) {
    try {
        const out = execFileSync(FFPROBE_BIN, [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            filePath,
        ], { timeout: 10000, stdio: "pipe" }).toString().trim();
        const sec = parseFloat(out);
        return isNaN(sec) ? null : sec;
    } catch {
        return null;
    }
}

// ── Re-encode video sang chuẩn Locket (H.264 yuv420p, cắt ≤5s, max ~15MB) ────
function processVideo(inputPath) {
    const outPath = path.join(tempDir, `locket_vid_${Date.now()}.mp4`);
    const duration = getVideoDuration(inputPath);
    const trimArgs = (duration !== null && duration > LOCKET_MAX_DURATION)
        ? ["-t", String(LOCKET_MAX_DURATION)]
        : [];

    // Scale video về tối đa 720x720 (Locket không cần full HD)
    // yuv420p bắt buộc để tương thích iOS/Android player
    // faststart để stream được ngay
    const videoFilter = "scale=720:720:force_original_aspect_ratio=decrease,pad=720:720:(ow-iw)/2:(oh-ih)/2,format=yuv420p";

    try {
        // Pass 1: encode với audio
        try {
            execFileSync(FFMPEG_BIN, [
                "-y", "-i", inputPath,
                ...trimArgs,
                "-map", "0:v:0",
                "-map", "0:a:0?",
                "-c:v", "libx264", "-preset", "fast", "-crf", "26",
                "-profile:v", "baseline", "-level", "3.1",
                "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
                "-movflags", "+faststart",
                "-vf", videoFilter,
                outPath,
            ], { timeout: 180000, stdio: "pipe" });
            if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return outPath;
        } catch { /* thử không audio */ }

        // Pass 2: encode không audio (fallback)
        execFileSync(FFMPEG_BIN, [
            "-y", "-i", inputPath,
            ...trimArgs,
            "-map", "0:v:0",
            "-c:v", "libx264", "-preset", "fast", "-crf", "26",
            "-profile:v", "baseline", "-level", "3.1",
            "-pix_fmt", "yuv420p",
            "-an",
            "-movflags", "+faststart",
            "-vf", videoFilter,
            outPath,
        ], { timeout: 180000, stdio: "pipe" });
        return (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) ? outPath : null;
    } catch {
        return null;
    }
}

// ── Post ảnh lên Locket ────────────────────────────────────────────────────────
async function postImage(idToken, thumbnailUrl, caption = "", apiHeaders) {
    const res = await axios.post(`${LOCKET_API}/postMomentV2`, {
        data: {
            thumbnail_url: thumbnailUrl,
            caption:       caption || "",
            sent_to_all:   true,
            overlays:      [],
        },
    }, { headers: apiHeaders, timeout: 30000 });
    return res.data;
}

// ── Tạo UUID v4 đơn giản ──────────────────────────────────────────────────────
function uuidv4() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

// ── Post video lên Locket ──────────────────────────────────────────────────────
async function postVideo(idToken, videoUrl, thumbnailUrl, caption = "", apiHeaders) {
    if (!thumbnailUrl || thumbnailUrl === videoUrl) {
        throw new Error("thumbnail_url phải khác video_url và không được rỗng — bạn bè sẽ không thấy video nếu thiếu thumbnail hợp lệ");
    }
    const momentUid = uuidv4();
    const payload = {
        data: {
            thumbnail_url: thumbnailUrl,
            video_url:     videoUrl,
            is_video:      true,
            caption:       caption || "",
            sent_to_all:   true,
            overlays:      [],
            moment_uid:    momentUid,
            analytics: {
                platform: "ios",
                google_analytics: {
                    app_instance_id: uuidv4().replace(/-/g, "").toUpperCase().slice(0, 32),
                },
            },
        },
    };
    const res = await axios.post(`${LOCKET_API}/postMomentV2`, payload, {
        headers: apiHeaders,
        timeout: 30000,
    });
    return res.data;
}

// ── Lấy thông tin tài khoản Firebase ─────────────────────────────────────────
async function getAccountInfo(idToken) {
    const res = await axios.post(
        `https://www.googleapis.com/identitytoolkit/v3/relyingparty/getAccountInfo?key=${FIREBASE_API_KEY}`,
        { idToken },
        { headers: AUTH_HEADERS, timeout: 10000 }
    );
    return res.data?.users?.[0];
}

// ── Lấy moments mới nhất từ bạn bè ───────────────────────────────────────────
async function getLatestMoments(idToken, apiHeaders, syncToken = null) {
    const payload = {
        data: {
            excluded_users:             [],
            fetch_streak:               false,
            should_count_missed_moments: true,
        },
    };
    if (syncToken) payload.data.sync_token = syncToken;

    const res = await axios.post(`${LOCKET_API}/getLatestMomentV2`, payload, {
        headers: apiHeaders,
        timeout: 15000,
    });
    return res.data?.result || res.data;
}

// ── Lấy danh sách bạn bè ─────────────────────────────────────────────────────
async function getFriends(idToken, apiHeaders) {
    const res = await axios.post(`${LOCKET_API}/getFriendsV2`, {
        data: {},
    }, {
        headers: apiHeaders,
        timeout: 15000,
    });
    return res.data?.result || res.data;
}

// ── Tìm user theo username ────────────────────────────────────────────────────
async function getUserByUsername(username, apiHeaders) {
    const res = await axios.post(`${LOCKET_API}/getUserByUsername`, {
        data: { username },
    }, {
        headers: apiHeaders,
        timeout: 15000,
    });
    return res.data?.result || res.data;
}

// ── Gửi tin nhắn Locket chat ─────────────────────────────────────────────────
async function sendChatMessage(receiverUid, message, momentUid = null, apiHeaders) {
    const res = await axios.post(`${LOCKET_API}/sendChatMessageV2`, {
        data: {
            receiver_uid:  receiverUid,
            client_token:  uuidv4().toUpperCase(),
            msg:           message,
            moment_uid:    momentUid || null,
            from_memory:   false,
        },
    }, {
        headers: apiHeaders,
        timeout: 15000,
    });
    return res.data?.result || res.data;
}

// ── Đổi thông tin profile ─────────────────────────────────────────────────────
async function changeProfileInfo(data, apiHeaders) {
    const res = await axios.post(`${LOCKET_API}/changeProfileInfo`, {
        data,
    }, {
        headers: apiHeaders,
        timeout: 15000,
    });
    return res.data?.result || res.data;
}

// ── Format thời gian relative ─────────────────────────────────────────────────
function timeAgo(seconds) {
    const diff = Math.floor(Date.now() / 1000) - seconds;
    if (diff < 60)          return `${diff}s trước`;
    if (diff < 3600)        return `${Math.floor(diff / 60)}m trước`;
    if (diff < 86400)       return `${Math.floor(diff / 3600)}h trước`;
    return `${Math.floor(diff / 86400)}d trước`;
}

// ── Trích xuất media từ tin nhắn Zalo ─────────────────────────────────────────
const VIDEO_MSG_TYPES   = new Set([4, 44]);
const IMAGE_MSG_TYPES   = new Set([2, 31, 32]);
const STICKER_MSG_TYPES = new Set([6, 36]);

function parseZaloAttach(attachStr) {
    try {
        let outer = typeof attachStr === "string" ? JSON.parse(attachStr) : attachStr;
        if (!outer || typeof outer !== "object") return null;
        if (Array.isArray(outer)) {
            if (outer.length === 0) return null;
            outer = outer[0];
            if (!outer || typeof outer !== "object") return null;
        }
        const params = outer.params
            ? (typeof outer.params === "string" ? JSON.parse(outer.params) : outer.params)
            : null;
        return { outer, params };
    } catch { return null; }
}

function pickImageUrl(...candidates) {
    for (const u of candidates) {
        if (typeof u === "string" && u.startsWith("http")) return u;
    }
    return null;
}

function extractMedia(raw) {
    const quote = raw?.quote;
    if (quote) {
        const cliType = quote.cliMsgType ?? 0;
        const parsed  = parseZaloAttach(quote.attach);
        if (parsed) {
            const { outer, params } = parsed;

            if (VIDEO_MSG_TYPES.has(cliType) || params?.videoUrl) {
                const url = pickImageUrl(params?.videoUrl, outer?.href);
                if (url) return { url, isVideo: true, thumbUrl: outer?.thumb || params?.thumbUrl };
            }

            const stickerId = outer?.stickerId || outer?.sticker_id || outer?.id
                || params?.stickerId || params?.id;
            const cateId    = outer?.cateId    || outer?.cate_id    || outer?.catId
                || params?.cateId   || params?.catId;
            if (STICKER_MSG_TYPES.has(cliType) || stickerId) {
                const rawStickerUrl = pickImageUrl(
                    params?.hdUrl, params?.hd, params?.oriUrl,
                    params?.url, params?.staticUrl, params?.thumbUrl,
                    outer?.hdUrl, outer?.oriUrl, outer?.thumbUrl, outer?.href,
                );
                if (rawStickerUrl) {
                    const url = rawStickerUrl.replace(/&amp;/g, "&");
                    return { url, isVideo: false, isSticker: true };
                }
                if (stickerId) return { stickerId: String(stickerId), cateId: String(cateId || ""), isVideo: false, isSticker: true };
            }

            const imgUrl = pickImageUrl(
                params?.hd, params?.hdUrl, params?.url, params?.normalUrl,
                params?.oriUrl, params?.thumbUrl,
                outer?.hdUrl, outer?.href,
            );
            if (imgUrl) return { url: imgUrl, isVideo: false };
            if (outer?.href?.startsWith("http")) return { url: outer.href, isVideo: false };
        }
        if (quote.href?.startsWith("http")) return { url: quote.href, isVideo: false };
    }

    if (Array.isArray(raw?.attachments)) {
        for (const a of raw.attachments) {
            if (a?.type === "video" || a?.msgType === "video") {
                const url = pickImageUrl(a?.url, a?.fileUrl, a?.href);
                if (url) return { url, isVideo: true };
            }
        }
        for (const a of raw.attachments) {
            if (a?.type === "sticker" || a?.msgType === "sticker") {
                const url = pickImageUrl(a?.hdUrl, a?.url, a?.staticUrl, a?.href);
                if (url) return { url, isVideo: false, isSticker: true };
                const sid = a?.stickerId || a?.sticker_id;
                if (sid) return { stickerId: String(sid), cateId: String(a?.cateId || ""), isVideo: false, isSticker: true };
            }
        }
        for (const a of raw.attachments) {
            const url = pickImageUrl(a?.hd, a?.hdUrl, a?.url, a?.fileUrl, a?.href);
            if (url) return { url, isVideo: false };
        }
    }

    if (raw?.attach) {
        const parsed = parseZaloAttach(raw.attach);
        if (parsed) {
            const { outer, params } = parsed;
            if (params?.videoUrl) return { url: params.videoUrl, isVideo: true };
            const url = pickImageUrl(
                params?.hd, params?.hdUrl, params?.url, params?.normalUrl,
                params?.oriUrl, outer?.hdUrl, outer?.href,
            );
            if (url) return { url, isVideo: false };
        }
    }

    return null;
}

function isHttpUrl(str) {
    return typeof str === "string" && /^https?:\/\/.+/i.test(str);
}

// ── Xử lý upload media chính (dùng chung cho post) ────────────────────────────
async function handleUploadMedia(mediaInfo, auth, profile, senderId, caption, api, threadId, threadType, rawData) {
    const mediaEmoji = mediaInfo.isVideo ? "🎬" : mediaInfo.isSticker ? "🎭" : "📸";
    const mediaLabel = mediaInfo.isVideo ? "video" : mediaInfo.isSticker ? "sticker" : "ảnh";

    const loading = await api.sendMessage({
        msg: [
            `${mediaEmoji} Đang upload ${mediaLabel} lên Locket...`,
            caption ? `📝 ${caption}` : null,
        ].filter(Boolean).join("\n"),
    }, threadId, threadType);

    let tmpPath = null, thumbPath = null;
    try {
        const dlHeaders = { "User-Agent": "Mozilla/5.0" };
        if (isZaloCdnUrl(mediaInfo.url)) {
            const cookie = getZaloCookieHeader();
            if (cookie) dlHeaders["Cookie"] = cookie;
            dlHeaders["Referer"] = "https://chat.zalo.me/";
        }
        const dlRes = await axios.get(mediaInfo.url, {
            responseType: "arraybuffer",
            timeout:      60000,
            headers:      dlHeaders,
        });

        let mimeType = dlRes.headers["content-type"]?.split(";")[0].trim() || "image/jpeg";
        if (mediaInfo.isVideo && !mimeType.startsWith("video/")) mimeType = "video/mp4";

        const isVideo = mimeType.startsWith("video/") || mediaInfo.isVideo === true;

        let ext;
        if (isVideo) ext = "mp4";
        else if (mimeType === "image/webp") ext = "webp";
        else if (mimeType === "image/gif")  ext = "gif";
        else ext = "jpg";

        tmpPath = path.join(tempDir, `locket_${Date.now()}.${ext}`);
        fs.writeFileSync(tmpPath, Buffer.from(dlRes.data));

        const appCheckTok = getAppCheckToken(senderId);
        const effectiveProfile = getEffectiveProfile(senderId);
        const apiHdrs          = effectiveProfile.apiHeaders(auth.idToken, appCheckTok);
        let result, momentId;
        let origDuration = null, wasTrimmed = false;

        if (isVideo) {
            // Không chặn cứng nếu thiếu AppCheck — resumableUpload tự fallback
            // sang web headers (không có iOS identifiers) → Firebase Storage không enforce AppCheck
            origDuration = getVideoDuration(tmpPath);
            wasTrimmed   = origDuration !== null && origDuration > LOCKET_MAX_DURATION;

            const processedPath = processVideo(tmpPath);
            const videoPath = (processedPath && fs.existsSync(processedPath)) ? processedPath : tmpPath;

            const thumbExtracted = extractVideoThumbnail(videoPath);
            const videoBuffer    = fs.readFileSync(videoPath);
            const videoUrl       = await uploadVideo(auth.idToken, auth.uid, videoBuffer, appCheckTok);

            if (processedPath && processedPath !== tmpPath && fs.existsSync(processedPath)) {
                try { fs.unlinkSync(processedPath); } catch {}
            }

            // Thumbnail BẮT BUỘC phải là ảnh riêng biệt — KHÔNG ĐƯỢC dùng videoUrl
            // Nếu thumbnailUrl === videoUrl thì bạn bè KHÔNG thấy video (bug phổ biến)
            if (!thumbExtracted || !fs.existsSync(thumbExtracted)) {
                throw new Error("Không tạo được thumbnail cho video. Kiểm tra ffmpeg có hoạt động không.");
            }
            thumbPath = thumbExtracted;
            const thumbBuf     = fs.readFileSync(thumbPath);
            const thumbnailUrl = await uploadImage(auth.idToken, auth.uid, thumbBuf, true, appCheckTok);
            if (!thumbnailUrl) {
                throw new Error("Upload thumbnail thất bại — không thể post video (bạn bè sẽ không thấy nếu thiếu thumbnail).");
            }

            result   = await postVideo(auth.idToken, videoUrl, thumbnailUrl, caption, apiHdrs);
            momentId = result?.result?.data?.canonical_uid
                || result?.result?.moment_id || result?.result?.id
                || result?.data?.moment_id   || result?.data?.id || "?";
        } else {
            let webpPath = convertToWebP(tmpPath);
            let imgBuf;
            if (webpPath && fs.existsSync(webpPath)) {
                imgBuf    = fs.readFileSync(webpPath);
                thumbPath = webpPath;
            } else {
                imgBuf = fs.readFileSync(tmpPath);
            }
            const imageUrl = await uploadImage(auth.idToken, auth.uid, imgBuf, false, appCheckTok);
            result   = await postImage(auth.idToken, imageUrl, caption, apiHdrs);
            momentId = result?.result?.data?.canonical_uid
                || result?.result?.moment_id || result?.result?.id
                || result?.data?.moment_id   || result?.data?.id || "?";
        }

        await api.sendMessage({
            msg: [
                `✅ Upload Locket thành công!`,
                `${mediaEmoji} Loại: ${isVideo ? "Video" : "Ảnh"}`,
                isVideo && wasTrimmed
                    ? `✂️ Đã cắt: ${origDuration.toFixed(1)}s → ${LOCKET_MAX_DURATION}s (giới hạn Locket)`
                    : isVideo && origDuration !== null
                    ? `⏱️ Thời lượng: ${origDuration.toFixed(1)}s`
                    : null,
                caption ? `📝 Caption: ${caption}` : null,
                `🆔 Moment ID: ${momentId}`,
                isVideo ? `🖼️ Thumbnail: đã upload riêng ✓ (bạn bè có thể thấy)` : null,
            ].filter(Boolean).join("\n"),
            quote: rawData,
        }, threadId, threadType);

        //log.info(`[Locket] Posted ${isVideo ? "video" : "image"} by ${auth.uid}, momentId=${momentId}`);
    } catch (e) {
        const respData  = e?.response?.data;
        const httpStatus = e?.response?.status;
        const rawErrMsg = respData?.error?.message
            || respData?.message
            || (typeof respData === "string" ? respData.slice(0, 200) : null)
            || (httpStatus ? `HTTP ${httpStatus} ${e.response?.statusText}` : null)
            || e.message;

        // Phân loại lỗi
        const errStr = String(rawErrMsg).toLowerCase();
        const isStorageErr  = httpStatus === 403 && e?.config?.url?.includes("firebasestorage");
        const isAppCheckErr = errStr.includes("appcheck") || errStr.includes("app check");
        const isAuthErr     = httpStatus === 401 || errStr.includes("unauthenticated");
        const isPermErr     = httpStatus === 403 && !isStorageErr;

        let errMsg = rawErrMsg;
        if (isAppCheckErr || isPermErr) {
            errMsg = [
                rawErrMsg,
                ``,
                `🔐 Lỗi AppCheck — thử set token: .uplocket appcheck set <JWT>`,
                `Hướng dẫn lấy token: .uplocket appcheck help`,
            ].join("\n");
        } else if (isAuthErr) {
            errMsg = [rawErrMsg, ``, `🔑 Phiên đăng nhập hết hạn. Thử: .uplocket login <email> <pass>`].join("\n");
        } else if (isStorageErr) {
            errMsg = [rawErrMsg, ``, `📦 Lỗi Firebase Storage — thử lại sau ít phút.`].join("\n");
        }

        const failUrl = e?.config?.url || e?.request?._currentUrl || "unknown";
        log.error(`[Locket] ${httpStatus || "ERR"} @ ${failUrl} — ${rawErrMsg}`);
        await api.sendMessage(
            { msg: `❌ Upload Locket thất bại: ${errMsg}` },
            threadId, threadType
        );
    } finally {
        try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
        for (const p of [tmpPath, thumbPath]) {
            if (p && fs.existsSync(p)) try { fs.unlinkSync(p); } catch {}
        }
    }
}

// ── Commands ───────────────────────────────────────────────────────────────────
export const commands = {

    uplocket: async (ctx) => {
        const { api, args, threadId, threadType, senderId, raw, prefix, message } = ctx;
        const rawData = raw || message?.data || {};
        const sub     = args[0]?.toLowerCase();

        // Lưu thread để monitor biết chỗ gửi nhắc nhở
        saveLastThread(senderId, threadId, threadType);

        // ── Help ──────────────────────────────────────────────────────────────
        if (!sub) {
            const loggedIn = getLocketAccounts()[String(senderId)];
            const curDev   = loggedIn?.device || "ios";
            return api.sendMessage({
                msg: [
                    `📸 UPLOCKET — Locket Bot (luckit API)`,
                    `───────────────────────────────────────────`,
                    `🔑 Đăng nhập:`,
                    `  ${prefix}uplocket login <email> <pass>`,
                    `  ${prefix}uplocket loginphone <+84xxx>   — gửi OTP`,
                    `  ${prefix}uplocket otp <code>            — xác nhận OTP`,
                    `  ${prefix}uplocket logout`,
                    ``,
                    `📤 Upload (reply ảnh/video hoặc dán URL):`,
                    `  ${prefix}uplocket post [caption]`,
                    `  ${prefix}uplocket post <url> [caption]`,
                    ``,
                    `📰 Xem nội dung:`,
                    `  ${prefix}uplocket moments [n]  — moment mới nhất (mặc định 5)`,
                    `  ${prefix}uplocket friends      — danh sách bạn bè`,
                    `  ${prefix}uplocket find <username>`,
                    ``,
                    `💬 Chat:`,
                    `  ${prefix}uplocket chat <uid> <tin nhắn>`,
                    ``,
                    `🛠️ Cài đặt:`,
                    `  ${prefix}uplocket device ios|android`,
                    `  ${prefix}uplocket profile <first> <last>  — đổi tên`,
                    `  ${prefix}uplocket status`,
                    ``,
                    `🔐 AppCheck (bắt buộc từ mid-2025 cho video upload):`,
                    `  ${prefix}uplocket appcheck auto           — tự động lấy token (không cần phone!)`,
                    `  ${prefix}uplocket appcheck help           — hướng dẫn chi tiết`,
                    `  ${prefix}uplocket appcheck set <JWT>      — lưu token thủ công`,
                    `  ${prefix}uplocket appcheck status         — kiểm tra hạn`,
                    `  ${prefix}uplocket appcheck clear          — xoá token`,
                    `───────────────────────────────────────────`,
                    `Tài khoản: ${loggedIn ? `✅ ${loggedIn.email || loggedIn.phone || "đã đăng nhập"}` : "❌ Chưa đăng nhập"}`,
                    `Thiết bị: ${curDev === "android" ? "🤖 Android (Samsung Galaxy S23)" : "🍎 iOS (iPhone 15 Pro)"}`,
                    `AppCheck: ${(() => { const s = appCheckStatus(senderId); return s.ok ? `✅ ${s.msg}` : `❌ ${s.msg}`; })()}`,
                ].join("\n"),
            }, threadId, threadType);
        }

        // ── Login email/password ──────────────────────────────────────────────
        if (sub === "login") {
            const email    = args[1];
            const password = args[2];
            if (!email || !password) {
                return api.sendMessage({
                    msg: `❌ Cú pháp: ${prefix}uplocket login <email> <mật khẩu>`,
                }, threadId, threadType);
            }
            const loading = await api.sendMessage({ msg: `🔐 Đang đăng nhập Locket...` }, threadId, threadType);
            try {
                const entry = await loginToLocket(email, password);
                saveLocketAccount(senderId, { email, password, uid: entry.uid });
                tokenCache.set(String(senderId), entry);
                await api.sendMessage({
                    msg: [
                        `✅ Đăng nhập Locket thành công!`,
                        `📧 ${email}`,
                        `🆔 UID: ${entry.uid}`,
                    ].join("\n"),
                }, threadId, threadType);
            } catch (e) {
                const errMsg = e?.response?.data?.error?.message || e.message;
                await api.sendMessage({ msg: `❌ Đăng nhập thất bại: ${errMsg}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── Login phone (OTP) ─────────────────────────────────────────────────
        if (sub === "loginphone") {
            const phone = args[1];
            if (!phone || !phone.startsWith("+")) {
                return api.sendMessage({
                    msg: `❌ Cú pháp: ${prefix}uplocket loginphone <+84xxxxxxxxx>\nVí dụ: ${prefix}uplocket loginphone +84912345678`,
                }, threadId, threadType);
            }
            const loading = await api.sendMessage({ msg: `📱 Đang gửi OTP tới ${phone}...` }, threadId, threadType);
            try {
                const sessionInfo = await sendPhoneOTP(phone);
                otpPending.set(String(senderId), { phoneNumber: phone, sessionInfo });
                await api.sendMessage({
                    msg: [
                        `✅ Đã gửi OTP tới ${phone}!`,
                        `Nhập mã OTP bằng lệnh:`,
                        `  ${prefix}uplocket otp <mã 6 số>`,
                        `⏰ OTP hết hạn sau 5 phút`,
                    ].join("\n"),
                }, threadId, threadType);
            } catch (e) {
                const errMsg = e?.response?.data?.error?.message || e.message;
                await api.sendMessage({ msg: `❌ Gửi OTP thất bại: ${errMsg}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── Verify OTP ────────────────────────────────────────────────────────
        if (sub === "otp") {
            const code = args[1];
            if (!code) {
                return api.sendMessage({ msg: `❌ Cú pháp: ${prefix}uplocket otp <mã OTP>` }, threadId, threadType);
            }
            const pending = otpPending.get(String(senderId));
            if (!pending) {
                return api.sendMessage({
                    msg: `❌ Không có phiên OTP nào đang chờ.\nDùng ${prefix}uplocket loginphone <số điện thoại> trước.`,
                }, threadId, threadType);
            }
            const loading = await api.sendMessage({ msg: `🔐 Đang xác minh OTP...` }, threadId, threadType);
            try {
                const entry = await verifyPhoneOTP(pending.sessionInfo, code);
                saveLocketAccount(senderId, { phone: pending.phoneNumber, uid: entry.uid });
                tokenCache.set(String(senderId), entry);
                otpPending.delete(String(senderId));
                await api.sendMessage({
                    msg: [
                        `✅ Đăng nhập bằng số điện thoại thành công!`,
                        `📱 SĐT: ${pending.phoneNumber}`,
                        `🆔 UID: ${entry.uid}`,
                    ].join("\n"),
                }, threadId, threadType);
            } catch (e) {
                const errMsg = e?.response?.data?.error?.message || e.message;
                await api.sendMessage({ msg: `❌ Xác minh OTP thất bại: ${errMsg}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── Logout ────────────────────────────────────────────────────────────
        if (sub === "logout") {
            removeLocketAccount(senderId);
            tokenCache.delete(String(senderId));
            otpPending.delete(String(senderId));
            return api.sendMessage({ msg: `✅ Đã đăng xuất khỏi Locket.` }, threadId, threadType);
        }

        // ── Device ────────────────────────────────────────────────────────────
        if (sub === "device") {
            const choice = args[1]?.toLowerCase();
            if (!choice || !["ios", "android"].includes(choice)) {
                const cur = getLocketAccounts()[String(senderId)]?.device || "ios";
                return api.sendMessage({
                    msg: [
                        `📱 Thiết bị giả mạo hiện tại: ${cur === "android" ? "🤖 Android" : "🍎 iOS"}`,
                        ``,
                        `Chuyển đổi:`,
                        `  ${prefix}uplocket device ios`,
                        `  ${prefix}uplocket device android`,
                    ].join("\n"),
                }, threadId, threadType);
            }
            const t = readTokens();
            if (!t.locketAccounts?.[String(senderId)]) {
                return api.sendMessage({ msg: `❌ Chưa đăng nhập Locket.` }, threadId, threadType);
            }
            t.locketAccounts[String(senderId)].device = choice;
            writeTokens(t);
            tokenCache.delete(String(senderId));
            const icon    = choice === "android" ? "🤖" : "🍎";
            const devName = choice === "android" ? "Android (Samsung Galaxy S23)" : "iOS (iPhone 15 Pro)";
            return api.sendMessage({
                msg: `${icon} Đã chuyển thiết bị giả mạo sang: ${devName}\nLần post tiếp theo sẽ dùng profile này.`,
            }, threadId, threadType);
        }

        // ── Status ────────────────────────────────────────────────────────────
        if (sub === "status") {
            let auth;
            try { auth = await getIdToken(senderId); } catch (e) {
                return api.sendMessage({ msg: `❌ ${e.message}` }, threadId, threadType);
            }
            const loading = await api.sendMessage({ msg: `📊 Đang kiểm tra tài khoản Locket...` }, threadId, threadType);
            try {
                const info   = await getAccountInfo(auth.idToken);
                const acc    = getLocketAccounts()[String(senderId)] || {};
                const ident  = acc.email || acc.phone || "?";
                const devKey = acc.device || "ios";
                const devLabel = devKey === "android"
                    ? "🤖 Android (Samsung Galaxy S23)"
                    : "🍎 iOS (iPhone 15 Pro)";
                await api.sendMessage({
                    msg: [
                        `📸 Locket Status`,
                        `─────────────────────`,
                        `✅ Đã đăng nhập`,
                        acc.email ? `📧 Email: ${acc.email}` : acc.phone ? `📱 SĐT: ${acc.phone}` : null,
                        `🆔 UID: ${auth.uid}`,
                        info?.displayName ? `👤 Tên: ${info.displayName}` : null,
                        `📱 Thiết bị: ${devLabel}`,
                    ].filter(Boolean).join("\n"),
                }, threadId, threadType);
            } catch (e) {
                await api.sendMessage({ msg: `❌ Lỗi: ${e.message}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── Moments — xem moment mới nhất từ bạn bè ──────────────────────────
        if (sub === "moments") {
            let auth;
            try { auth = await getIdToken(senderId); } catch (e) {
                return api.sendMessage({ msg: `❌ ${e.message}` }, threadId, threadType);
            }
            const limit  = Math.min(parseInt(args[1]) || 5, 15);
            const profile = getEffectiveProfile(senderId);
            const loading = await api.sendMessage({ msg: `⏳ Đang tải moments từ bạn bè...` }, threadId, threadType);
            try {
                const data   = await getLatestMoments(auth.idToken, profile.apiHeaders(auth.idToken, getAppCheckToken(senderId)));
                const list   = data?.data || [];
                if (!list.length) {
                    await api.sendMessage({ msg: `📭 Không có moment nào từ bạn bè.` }, threadId, threadType);
                    return;
                }
                const shown = list.slice(0, limit);
                const lines = [
                    `📸 Moments từ bạn bè (${shown.length}/${list.length}):`,
                    `─────────────────────────`,
                ];
                for (let i = 0; i < shown.length; i++) {
                    const m   = shown[i];
                    const uid = typeof m.user === "string" ? m.user : m.user?.uid || "?";
                    const ts  = m.date?._seconds ? timeAgo(m.date._seconds) : "?";
                    lines.push(
                        `${i + 1}. 👤 ${uid.slice(0, 10)}...`,
                        `   ⏰ ${ts}`,
                        m.caption ? `   💬 ${m.caption}` : null,
                        `   🖼️ ${m.thumbnail_url ? m.thumbnail_url.slice(0, 60) + "..." : "no thumb"}`,
                    );
                }
                await api.sendMessage({ msg: lines.filter(Boolean).join("\n") }, threadId, threadType);
            } catch (e) {
                await api.sendMessage({ msg: `❌ Lỗi: ${e.message}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── Friends — danh sách bạn bè ────────────────────────────────────────
        if (sub === "friends") {
            let auth;
            try { auth = await getIdToken(senderId); } catch (e) {
                return api.sendMessage({ msg: `❌ ${e.message}` }, threadId, threadType);
            }
            const profile = getEffectiveProfile(senderId);
            const loading = await api.sendMessage({ msg: `⏳ Đang tải danh sách bạn bè...` }, threadId, threadType);
            try {
                const data    = await getFriends(auth.idToken, profile.apiHeaders(auth.idToken, getAppCheckToken(senderId)));
                const friends = data?.friends || data?.data || [];
                if (!friends.length) {
                    await api.sendMessage({ msg: `👥 Chưa có bạn bè nào trên Locket.` }, threadId, threadType);
                    return;
                }
                const lines = [`👥 Bạn bè Locket (${friends.length}):`, `─────────────────────────`];
                for (let i = 0; i < Math.min(friends.length, 20); i++) {
                    const f = friends[i];
                    const name    = [f.first_name, f.last_name].filter(Boolean).join(" ") || f.username || "?";
                    const uid     = f.uid || f.user_id || "?";
                    const uname   = f.username ? `@${f.username}` : "";
                    lines.push(`${i + 1}. ${name} ${uname}`.trim());
                    lines.push(`   🆔 ${uid}`);
                }
                if (friends.length > 20) lines.push(`... và ${friends.length - 20} người nữa`);
                await api.sendMessage({ msg: lines.join("\n") }, threadId, threadType);
            } catch (e) {
                await api.sendMessage({ msg: `❌ Lỗi: ${e.message}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── Find — tìm user theo username ─────────────────────────────────────
        if (sub === "find") {
            const username = args[1];
            if (!username) {
                return api.sendMessage({ msg: `❌ Cú pháp: ${prefix}uplocket find <username>` }, threadId, threadType);
            }
            let auth;
            try { auth = await getIdToken(senderId); } catch (e) {
                return api.sendMessage({ msg: `❌ ${e.message}` }, threadId, threadType);
            }
            const profile = getEffectiveProfile(senderId);
            const loading = await api.sendMessage({ msg: `🔍 Đang tìm @${username}...` }, threadId, threadType);
            try {
                const data  = await getUserByUsername(username, profile.apiHeaders(auth.idToken, getAppCheckToken(senderId)));
                const user  = data?.user || data;
                if (!user?.uid) {
                    await api.sendMessage({ msg: `❌ Không tìm thấy user "@${username}"` }, threadId, threadType);
                    return;
                }
                const name = [user.first_name, user.last_name].filter(Boolean).join(" ") || username;
                await api.sendMessage({
                    msg: [
                        `👤 Tìm thấy user Locket:`,
                        `─────────────────────────`,
                        `📛 Tên: ${name}`,
                        `🔖 Username: @${user.username || username}`,
                        `🆔 UID: ${user.uid}`,
                        user.profile_picture_url ? `🖼️ Avatar: có` : null,
                    ].filter(Boolean).join("\n"),
                }, threadId, threadType);
            } catch (e) {
                await api.sendMessage({ msg: `❌ Lỗi: ${e.message}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── Chat — gửi tin nhắn Locket ────────────────────────────────────────
        if (sub === "chat") {
            const uid = args[1];
            const msg = args.slice(2).join(" ").trim();
            if (!uid || !msg) {
                return api.sendMessage({
                    msg: [
                        `❌ Cú pháp: ${prefix}uplocket chat <uid> <tin nhắn>`,
                        `Tip: dùng ${prefix}uplocket find <username> để lấy UID`,
                    ].join("\n"),
                }, threadId, threadType);
            }
            let auth;
            try { auth = await getIdToken(senderId); } catch (e) {
                return api.sendMessage({ msg: `❌ ${e.message}` }, threadId, threadType);
            }
            const profile = getEffectiveProfile(senderId);
            const loading = await api.sendMessage({ msg: `💬 Đang gửi tin nhắn Locket...` }, threadId, threadType);
            try {
                await sendChatMessage(uid, msg, null, profile.apiHeaders(auth.idToken, getAppCheckToken(senderId)));
                await api.sendMessage({
                    msg: [
                        `✅ Đã gửi tin nhắn Locket!`,
                        `🆔 Tới UID: ${uid}`,
                        `💬 Nội dung: ${msg}`,
                    ].join("\n"),
                }, threadId, threadType);
            } catch (e) {
                await api.sendMessage({ msg: `❌ Gửi tin nhắn thất bại: ${e.message}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── Profile — đổi tên ─────────────────────────────────────────────────
        if (sub === "profile") {
            const firstName = args[1];
            const lastName  = args[2];
            if (!firstName) {
                return api.sendMessage({
                    msg: `❌ Cú pháp: ${prefix}uplocket profile <tên> [họ]\nVí dụ: ${prefix}uplocket profile Minh Nguyen`,
                }, threadId, threadType);
            }
            let auth;
            try { auth = await getIdToken(senderId); } catch (e) {
                return api.sendMessage({ msg: `❌ ${e.message}` }, threadId, threadType);
            }
            const profile = getEffectiveProfile(senderId);
            const loading = await api.sendMessage({ msg: `✏️ Đang cập nhật tên...` }, threadId, threadType);
            try {
                await changeProfileInfo({
                    first_name: firstName,
                    last_name:  lastName || "",
                }, profile.apiHeaders(auth.idToken, getAppCheckToken(senderId)));
                await api.sendMessage({
                    msg: [
                        `✅ Đã đổi tên Locket!`,
                        `👤 Tên mới: ${firstName}${lastName ? " " + lastName : ""}`,
                    ].join("\n"),
                }, threadId, threadType);
            } catch (e) {
                await api.sendMessage({ msg: `❌ Đổi tên thất bại: ${e.message}` }, threadId, threadType);
            } finally {
                try { await api.undo({msgId: loading.message?.msgId}, threadId, threadType); } catch {}
            }
            return;
        }

        // ── AppCheck token management ─────────────────────────────────────────
        if (sub === "appcheck") {
            const arg2 = args[1]?.toLowerCase();

            // Help
            if (!arg2 || arg2 === "help") {
                return api.sendMessage({
                    msg: [
                        `🔐 AppCheck Token — Hướng dẫn`,
                        ``,
                        `Tại sao cần? Video bạn post lên Locket sẽ KHÔNG hiển thị với bạn bè nếu thiếu token này (Firebase AppCheck bắt buộc từ mid-2025).`,
                        ``,
                        `🤖 Cách 1 — Tự động (không cần điện thoại):`,
                        `${prefix}uplocket appcheck auto`,
                        `Bot tự mở trình duyệt ẩn, đăng nhập locket.top bằng tài khoản đã lưu, bắt token về.`,
                        `Token web có thể dùng được ~1-7 giờ.`,
                        ``,
                        `📱 Cách 2 — Thủ công (intercept HTTPS):`,
                        `1. Cài mitmproxy hoặc Charles Proxy trên máy tính.`,
                        `2. Cài cert của proxy lên điện thoại thật (iOS/Android).`,
                        `3. Mở app Locket, đăng nhập / xem moments.`,
                        `4. Lọc request tới api.locketcamera.com, tìm header:`,
                        `   X-Firebase-AppCheck: <JWT dài ~600-800 ký tự>`,
                        `5. Copy toàn bộ JWT đó.`,
                        ``,
                        `Lưu token: ${prefix}uplocket appcheck set <JWT>`,
                        `Kiểm tra:  ${prefix}uplocket appcheck status`,
                        `Xoá:       ${prefix}uplocket appcheck clear`,
                        ``,
                        `⏱ Token hết hạn sau ~1-7 giờ → chạy lại 'auto' khi hết hạn.`,
                    ].join("\n"),
                }, threadId, threadType);
            }

            // Status
            if (arg2 === "status") {
                const { ok, msg: statusMsg } = appCheckStatus(senderId);
                return api.sendMessage({
                    msg: [
                        `🔐 AppCheck Token Status`,
                        `${ok ? "✅" : "❌"} ${statusMsg}`,
                    ].join("\n"),
                }, threadId, threadType);
            }

            // Clear
            if (arg2 === "clear") {
                saveAppCheckToken(senderId, null);
                return api.sendMessage({ msg: `🗑️ Đã xoá AppCheck token.` }, threadId, threadType);
            }

            // Auto: tự động lấy token qua headless browser
            if (arg2 === "auto" || arg2 === "autotoken") {
                const acc = getLocketAccounts()[senderId];
                if (!acc?.email || !acc?.password) {
                    return api.sendMessage({
                        msg: [
                            `❌ Chưa đăng nhập Locket.`,
                            `Dùng: ${prefix}uplocket login <email> <password>  trước.`,
                        ].join("\n"),
                    }, threadId, threadType);
                }
                await api.sendMessage({
                    msg: `🤖 Đang tự động lấy AppCheck token bằng trình duyệt ẩn...\n⏳ Có thể mất 20-40 giây, vui lòng đợi.`,
                }, threadId, threadType);
                try {
                    const fetchedToken = await autoFetchAppCheckToken(acc.email, acc.password);
                    saveAppCheckToken(senderId, fetchedToken);
                    const { msg: statusMsg } = appCheckStatus(senderId);
                    return api.sendMessage({
                        msg: [
                            `✅ Tự động lấy AppCheck token thành công!`,
                            `⏱ ${statusMsg}`,
                            ``,
                            `Giờ bạn có thể upload video lên Locket bình thường 🎬`,
                            `Token sẽ hết hạn sau ~1-7 giờ. Chạy lệnh này lại khi cần.`,
                        ].join("\n"),
                    }, threadId, threadType);
                } catch (err) {
                    return api.sendMessage({
                        msg: [
                            `❌ Tự động lấy token thất bại:`,
                            err.message,
                            ``,
                            `Thử lại sau hoặc dùng cách thủ công:`,
                            `${prefix}uplocket appcheck help`,
                        ].join("\n"),
                    }, threadId, threadType);
                }
            }

            // Set: uplocket appcheck set <token>   OR   uplocket appcheck <token>
            let rawToken = null;
            if (arg2 === "set") {
                rawToken = args.slice(2).join(" ").trim();
            } else if (arg2 && arg2 !== "help" && arg2 !== "auto" && arg2 !== "autotoken") {
                // user typed the JWT directly after "appcheck"
                rawToken = args.slice(1).join(" ").trim();
            }

            if (!rawToken) {
                return api.sendMessage({
                    msg: `❌ Thiếu token. Dùng: ${prefix}uplocket appcheck set <JWT>`,
                }, threadId, threadType);
            }

            // Basic JWT validation: 3 parts, starts with eyJ
            const parts = rawToken.split(".");
            if (parts.length !== 3 || !rawToken.startsWith("eyJ")) {
                return api.sendMessage({
                    msg: `❌ Token không hợp lệ (phải là JWT gồm 3 phần bắt đầu bằng eyJ...).`,
                }, threadId, threadType);
            }

            saveAppCheckToken(senderId, rawToken);
            const { ok, msg: statusMsg } = appCheckStatus(senderId);
            return api.sendMessage({
                msg: [
                    `✅ Đã lưu AppCheck token!`,
                    `⏱ Trạng thái: ${statusMsg}`,
                    `Giờ video của bạn sẽ hiển thị với bạn bè trên Locket 🎬`,
                ].join("\n"),
            }, threadId, threadType);
        }

        // ── Post ──────────────────────────────────────────────────────────────
        if (sub === "post") {
            let auth;
            try { auth = await getIdToken(senderId); } catch (e) {
                return api.sendMessage({ msg: `❌ ${e.message}` }, threadId, threadType);
            }
            const profile  = getEffectiveProfile(senderId);

            let directUrl = null;
            let captionStartIdx = 1;
            if (isHttpUrl(args[1])) {
                directUrl = args[1];
                captionStartIdx = 2;
            }

            let mediaInfo = directUrl
                ? { url: directUrl, isVideo: /\.(mp4|mov|avi|mkv|webm)/i.test(directUrl) }
                : extractMedia(rawData);

            // Sticker kho Zalo: chỉ có stickerId, cần gọi API lấy URL
            if (mediaInfo?.stickerId && !mediaInfo?.url) {
                let resolvedUrl = null;

                try {
                    if (typeof api.getStickersDetail === "function") {
                        const details = await api.getStickersDetail([mediaInfo.stickerId]);
                        const arr = Array.isArray(details) ? details : (details?.data || []);
                        const s   = arr[0] || null;
                        const rawUrl = s?.stickerWebpUrl || s?.stickerUrl
                            || s?.image_url || s?.webp_url
                            || s?.static_image_url || s?.staticImgUrl || s?.animationImgUrl
                            || s?.thumbUrl || s?.url || s?.href || null;
                        resolvedUrl = rawUrl ? rawUrl.replace(/&amp;/g, "&") : null;
                    }
                } catch { /* bỏ qua */ }

                if (!resolvedUrl && mediaInfo.stickerId) {
                    const sid = mediaInfo.stickerId;
                    const cid = mediaInfo.cateId;
                    const candidates = [
                        cid ? `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${sid}&size=240` : null,
                        `https://zpsticke.zadn.vn/api/emoticon/sprite?eid=${sid}&size=240`,
                        `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${sid}&size=130`,
                        cid ? `https://zpsticke.zadn.vn/api/emoticon/package/${cid}/icon_${sid}_big.png` : null,
                    ].filter(Boolean);

                    for (const candUrl of candidates) {
                        try {
                            const check = await axios.head(candUrl, {
                                timeout: 5000,
                                headers: { "User-Agent": "Mozilla/5.0" },
                                validateStatus: s => s < 400,
                            });
                            if (check.status < 400) { resolvedUrl = candUrl; break; }
                        } catch { /* thử tiếp */ }
                    }

                    if (!resolvedUrl) {
                        resolvedUrl = `https://zalo-api.zadn.vn/api/emoticon/sticker/webpc?eid=${sid}&size=240`;
                    }
                }

                mediaInfo = resolvedUrl ? { url: resolvedUrl, isVideo: false, isSticker: true } : null;
            }

            if (!mediaInfo) {
                return api.sendMessage({
                    msg: [
                        `❌ Không tìm thấy ảnh/video!`,
                        `Cách dùng:`,
                        `  • Reply ảnh/video kèm lệnh`,
                        `  • ${prefix}uplocket post <url> [caption]`,
                    ].join("\n"),
                }, threadId, threadType);
            }

            const caption = args.slice(captionStartIdx).join(" ").trim();
            // Cảnh báo nếu đăng VIDEO mà thiếu AppCheck token hợp lệ
            if (mediaInfo.isVideo) {
                const acStatus = appCheckStatus(senderId);
                if (!acStatus.ok) {
                    await api.sendMessage({
                        msg: [
                            `⚠️ Thiếu AppCheck token hợp lệ!`,
                            `Video sẽ upload được nhưng BẠN BÈ SẼ KHÔNG THẤY.`,
                            `Dùng: ${prefix}uplocket appcheck set <JWT> để set token.`,
                            `Xem hướng dẫn: ${prefix}uplocket appcheck help`,
                        ].join("\n"),
                    }, threadId, threadType);
                }
            }
            await handleUploadMedia(mediaInfo, auth, profile, senderId, caption, api, threadId, threadType, rawData);
            return;
        }

        await api.sendMessage(
            { msg: `❓ Lệnh không hợp lệ. Gõ ${prefix}uplocket để xem hướng dẫn.` },
            threadId, threadType
        );
    },
};
