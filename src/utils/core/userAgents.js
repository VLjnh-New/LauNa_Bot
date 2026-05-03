/**
 * userAgents.js
 * Danh sách User-Agent thực tế dùng cho crawl/request.
 * Dùng getUA() để lấy ngẫu nhiên, hoặc dùng UA_MOBILE/UA_DESKTOP.
 * Chỉ giữ UA của trình duyệt thật — không dùng bot/crawler UA (dễ bị chặn).
 *
 * Tiện ích:
 *   checkUA(ua, testUrl)        — kiểm tra 1 UA có hoạt động không
 *   checkAllUAs(testUrl, opts)  — kiểm tra toàn bộ danh sách UA
 *   crawlWithUA(url, opts)      — crawl URL, tự đổi UA nếu bị chặn
 */
import axios from "axios";

// ── Mobile ────────────────────────────────────────────────────────────────────
export const UA_MOBILE = [
    // Android — Chrome
    "Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 12; CPH2219) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; Redmi Note 12) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; Redmi Note 13 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; M2101K9AG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 14; 23127PN0CG) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; CPH2557) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36",
    // iOS — Safari
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.82 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    // Android — Firefox
    "Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0",
    "Mozilla/5.0 (Android 13; Mobile; rv:124.0) Gecko/124.0 Firefox/124.0",
    // Android — Samsung Browser
    "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
];

// ── Desktop ───────────────────────────────────────────────────────────────────
export const UA_DESKTOP = [
    // Windows — Chrome
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.112 Safari/537.36",
    // Windows — Edge
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0",
    // Windows — Firefox
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
    // macOS — Chrome
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    // macOS — Safari
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    // macOS — Firefox
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0",
    // Linux — Chrome / Firefox
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
];

// ── Tất cả ───────────────────────────────────────────────────────────────────
export const UA_ALL = [...UA_MOBILE, ...UA_DESKTOP];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Lấy ngẫu nhiên 1 UA từ danh sách chỉ định.
 * Tự động dùng danh sách đã lọc (sau initAutoUACheck) nếu có.
 * @param {"mobile"|"desktop"|"all"} type
 * @returns {string}
 */
export function getUA(type = "all") {
    const list = _getActiveList(type);
    return list[Math.floor(Math.random() * list.length)];
}

/**
 * Lấy ngẫu nhiên 1 UA mobile.
 * @returns {string}
 */
export function getMobileUA() { return getUA("mobile"); }

/**
 * Lấy ngẫu nhiên 1 UA desktop.
 * @returns {string}
 */
export function getDesktopUA() { return getUA("desktop"); }

/**
 * UA mặc định dùng chung (Android Chrome — ổn định nhất cho API crawl).
 */
export const DEFAULT_UA = "Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

// ── Active UA Pool (được cập nhật tự động sau mỗi lần check) ─────────────────
let _activeMobile  = null;   // null = chưa check, [] = đã check
let _activeDesktop = null;

/**
 * Lấy danh sách UA đang hoạt động.
 * Nếu chưa check hoặc active < 3 thì fallback về danh sách gốc.
 */
function _getActiveList(type) {
    if (type === "mobile")  return (_activeMobile  && _activeMobile.length  >= 3) ? _activeMobile  : UA_MOBILE;
    if (type === "desktop") return (_activeDesktop && _activeDesktop.length >= 3) ? _activeDesktop : UA_DESKTOP;
    const m = (_activeMobile  && _activeMobile.length  >= 3) ? _activeMobile  : UA_MOBILE;
    const d = (_activeDesktop && _activeDesktop.length >= 3) ? _activeDesktop : UA_DESKTOP;
    return [...m, ...d];
}

// ── Check & Crawl ─────────────────────────────────────────────────────────────

const CHECK_BLOCKED_CODES  = new Set([403, 429, 503, 530]);
const CHECK_TIMEOUT_MS     = 8000;
const CHECK_TEST_URL       = "https://httpbin.org/headers";

/**
 * Kiểm tra 1 UA có hoạt động không bằng cách gửi GET request thử.
 *
 * @param {string} ua          - Chuỗi User-Agent cần kiểm tra
 * @param {string} [testUrl]   - URL test (mặc định httpbin.org/headers)
 * @returns {Promise<{ ua: string, ok: boolean, status: number|null, ms: number, reason: string }>}
 */
export async function checkUA(ua, testUrl = CHECK_TEST_URL) {
    const t0 = Date.now();
    try {
        const res = await axios.get(testUrl, {
            headers: {
                "User-Agent":      ua,
                "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Connection":      "keep-alive",
            },
            timeout:        CHECK_TIMEOUT_MS,
            maxRedirects:   5,
            validateStatus: () => true,
        });
        const ms     = Date.now() - t0;
        const status = res.status;
        const ok     = status >= 200 && status < 300 && !CHECK_BLOCKED_CODES.has(status);
        const reason = ok ? "OK" : `HTTP ${status}`;
        return { ua, ok, status, ms, reason };
    } catch (e) {
        const ms = Date.now() - t0;
        const reason = e.code === "ECONNABORTED" ? "timeout" : (e.message || "error");
        return { ua, ok: false, status: null, ms, reason };
    }
}

/**
 * Kiểm tra toàn bộ danh sách UA (hoặc danh sách tự chọn).
 * Chạy song song theo batch để không quá tải.
 *
 * @param {string}   [testUrl]         - URL test
 * @param {object}   [opts]
 * @param {string[]} [opts.list]       - Danh sách UA tùy chỉnh (mặc định UA_ALL)
 * @param {number}   [opts.batchSize]  - Số UA chạy song song mỗi đợt (mặc định 5)
 * @param {(r: object) => void} [opts.onResult] - Callback nhận kết quả từng UA
 * @returns {Promise<{ passed: string[], failed: string[], results: object[] }>}
 */
export async function checkAllUAs(testUrl = CHECK_TEST_URL, { list = UA_ALL, batchSize = 5, onResult } = {}) {
    const results = [];
    for (let i = 0; i < list.length; i += batchSize) {
        const batch   = list.slice(i, i + batchSize);
        const checked = await Promise.all(batch.map(ua => checkUA(ua, testUrl)));
        for (const r of checked) {
            results.push(r);
            if (onResult) onResult(r);
        }
    }
    const passed = results.filter(r => r.ok).map(r => r.ua);
    const failed = results.filter(r => !r.ok).map(r => r.ua);
    return { passed, failed, results };
}

/**
 * Crawl một URL với UA ngẫu nhiên.
 * Tự động thử lại với UA khác nếu bị chặn (403/429/503).
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {"mobile"|"desktop"|"all"} [opts.type]     - Loại UA dùng (mặc định "all")
 * @param {number}  [opts.maxRetries]                - Số lần thử tối đa (mặc định 4)
 * @param {number}  [opts.timeout]                   - Timeout mỗi request ms (mặc định 12000)
 * @param {object}  [opts.extraHeaders]              - Header bổ sung
 * @param {"json"|"text"|"arraybuffer"|"stream"} [opts.responseType] - Kiểu response (mặc định "text")
 * @returns {Promise<{ data: any, ua: string, status: number, attempts: number }>}
 */
export async function crawlWithUA(url, {
    type         = "all",
    maxRetries   = 4,
    timeout      = 12000,
    extraHeaders = {},
    responseType = "text",
} = {}) {
    const usedUAs = new Set();
    let lastErr;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        let ua = getUA(type);
        // Cố lấy UA chưa dùng
        for (let t = 0; t < 10 && usedUAs.has(ua); t++) ua = getUA(type);
        usedUAs.add(ua);

        try {
            const res = await axios.get(url, {
                headers: {
                    "User-Agent":      ua,
                    "Accept":          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                    "Accept-Language": "vi-VN,vi;q=0.9,en-US;q=0.8",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Referer":         new URL(url).origin + "/",
                    "Connection":      "keep-alive",
                    ...extraHeaders,
                },
                timeout,
                maxRedirects: 5,
                responseType,
                validateStatus: () => true,
            });

            if (CHECK_BLOCKED_CODES.has(res.status)) {
                lastErr = new Error(`Bị chặn HTTP ${res.status} (attempt ${attempt})`);
                continue;
            }
            if (res.status < 200 || res.status >= 300) {
                lastErr = new Error(`HTTP ${res.status} (attempt ${attempt})`);
                continue;
            }

            return { data: res.data, ua, status: res.status, attempts: attempt };
        } catch (e) {
            lastErr = e;
        }
    }

    throw lastErr || new Error(`crawlWithUA thất bại sau ${maxRetries} lần thử: ${url}`);
}

// ── Auto UA Health Check ───────────────────────────────────────────────────────

let _autoCheckTimer = null;

/**
 * Khởi động tính năng tự động kiểm tra UA định kỳ.
 * - Chạy ngay khi gọi (background, không block)
 * - Lọc ra các UA bị chặn → cập nhật pool active
 * - Tự lặp lại sau mỗi `intervalMs` (mặc định 24h)
 *
 * @param {object} [opts]
 * @param {number}  [opts.intervalMs]   - Chu kỳ check (ms). Mặc định 86400000 (24h)
 * @param {string}  [opts.testUrl]      - URL dùng để test (mặc định CHECK_TEST_URL)
 * @param {number}  [opts.concurrency]  - Số UA kiểm tra song song. Mặc định 5
 * @param {boolean} [opts.silent]       - Không log kết quả. Mặc định false
 */
export function initAutoUACheck({
    intervalMs  = 24 * 60 * 60 * 1000,   // 24h
    testUrl     = CHECK_TEST_URL,
    concurrency = 5,
    silent      = false,
} = {}) {
    // Hủy timer cũ nếu có
    if (_autoCheckTimer) { clearTimeout(_autoCheckTimer); _autoCheckTimer = null; }

    async function runCheck() {
        if (!silent) console.log("[UserAgent] Đang kiểm tra UA pool...");
        try {
            // Tách mobile / desktop để check riêng
            const checkList = async (list, label) => {
                const passed = [];
                const chunks = [];
                for (let i = 0; i < list.length; i += concurrency)
                    chunks.push(list.slice(i, i + concurrency));
                for (const chunk of chunks) {
                    const results = await Promise.all(chunk.map(ua => checkUA(ua, testUrl)));
                    chunk.forEach((ua, idx) => { if (results[idx].ok) passed.push(ua); });
                }
                if (!silent) console.log(`[UserAgent] ${label}: ${passed.length}/${list.length} UA hoạt động`);
                return passed;
            };

            const [okMobile, okDesktop] = await Promise.all([
                checkList(UA_MOBILE,  "Mobile"),
                checkList(UA_DESKTOP, "Desktop"),
            ]);

            // Cập nhật pool active (fallback về full list nếu quá ít)
            _activeMobile  = okMobile.length  >= 3 ? okMobile  : [...UA_MOBILE];
            _activeDesktop = okDesktop.length >= 3 ? okDesktop : [...UA_DESKTOP];

            if (!silent) console.log(`[UserAgent] Pool cập nhật — Mobile: ${_activeMobile.length}, Desktop: ${_activeDesktop.length}`);
        } catch (e) {
            console.warn(`[UserAgent] Auto check lỗi: ${e.message}`);
            // Giữ nguyên pool cũ nếu check thất bại
        }

        // Lên lịch lần check tiếp theo
        _autoCheckTimer = setTimeout(runCheck, intervalMs);
    }

    // Chạy lần đầu sau 10s (để bot kịp khởi động xong)
    setTimeout(runCheck, 10_000);
}

/**
 * Dừng auto check UA.
 */
export function stopAutoUACheck() {
    if (_autoCheckTimer) { clearTimeout(_autoCheckTimer); _autoCheckTimer = null; }
    console.log("[UserAgent] Auto UA check đã dừng.");
}
