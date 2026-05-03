import axios from "axios";
import { getLiveProxies } from "../../modules/proxy.js";
import { log } from "../../logger.js";

const POOL_SIZE        = 20;    // số proxy duy trì trong pool
const REFETCH_BELOW    = 8;     // refetch khi pool còn < 8 proxy live
const REFRESH_INTERVAL = 30 * 60 * 1000; // tự refresh mỗi 30 phút
const CHECK_TIMEOUT    = 5000;  // timeout kiểm tra 1 proxy
const CHECK_URLS       = [
    "http://ip-api.com/json",
    "http://checkip.amazonaws.com",
    "http://httpbin.org/ip",
];
const CONCURRENCY      = 10;    // check song song 10 proxy (giảm để tránh spike RAM)

// ── Trạng thái pool ───────────────────────────────────────────────────────────
let pool         = [];          // [{ ip, port, https, code, ms, failCount }]
let isRefreshing = false;
let lastRefresh  = 0;

// ── Kiểm tra 1 proxy — thử lần lượt các CHECK_URLS ──────────────────────────
async function checkOne(ip, port) {
    const start = Date.now();
    const proxyConfig = { host: ip, port: parseInt(port) };
    for (const url of CHECK_URLS) {
        try {
            await axios.get(url, { proxy: proxyConfig, timeout: CHECK_TIMEOUT });
            return { alive: true, ms: Date.now() - start };
        } catch { }
    }
    return { alive: false, ms: Date.now() - start };
}

// ── Kiểm tra batch song song ───────────────────────────────────────────────────
async function checkBatch(proxies) {
    const results = [];
    for (let i = 0; i < proxies.length; i += CONCURRENCY) {
        const batch = proxies.slice(i, i + CONCURRENCY);
        const checked = await Promise.all(
            batch.map(async (p) => {
                const r = await checkOne(p.ip, p.port);
                return { ...p, ...r, failCount: 0 };
            })
        );
        results.push(...checked.filter(p => p.alive));
    }
    return results;
}

// ── Fetch + check → nạp vào pool ─────────────────────────────────────────────
async function refetchPool() {
    if (isRefreshing) return;
    isRefreshing = true;
    try {
        const existing = new Set(pool.map(p => `${p.ip}:${p.port}`));

        // ── Lấy proxy từ nguồn tổng hợp ──────────────────────────────────────
        const need = POOL_SIZE - pool.length;
        if (need > 0) {
            const live = await getLiveProxies(need, null, null, CONCURRENCY);
            if (live.length > 0) {
                for (const p of live) {
                    const key = `${p.ip}:${p.port}`;
                    if (!existing.has(key)) {
                        pool.push({ ...p, failCount: 0 });
                        existing.add(key);
                    }
                }
            }
        }

        if (pool.length > 0) {
            lastRefresh = Date.now();
            // log.info(`[ProxyPool] Refetch xong — pool còn ${pool.length} proxy live.`);
        }
    } catch (e) {
        log.error("[ProxyPool] Lỗi refetch:", e.message);
    } finally {
        isRefreshing = false;
    }
}

// ── Lấy 1 proxy ngẫu nhiên từ pool ──────────────────────────────────────────
function pickProxy() {
    if (!pool.length) return null;
    return pool[Math.floor(Math.random() * pool.length)];
}

// ── Đánh dấu proxy thất bại → loại khỏi pool sau 3 lần ──────────────────────
function markFail(ip, port) {
    const entry = pool.find(p => p.ip === ip && p.port === port);
    if (!entry) return;
    entry.failCount = (entry.failCount || 0) + 1;
    if (entry.failCount >= 3) {
        pool = pool.filter(p => !(p.ip === ip && p.port === port));
        log.warn(`Loại proxy ${ip}:${port} (fail 3 lần). Pool còn ${pool.length}.`);
        if (pool.length < REFETCH_BELOW && !isRefreshing) refetchPool();
    }
}

// ── axios wrapper: tự chọn proxy, retry 1 lần nếu lỗi ───────────────────────
async function axiosWithProxy(config, retries = 1) {
    const proxy = pickProxy();
    if (!proxy) {
        // Không có proxy → gọi thẳng
        return axios(config);
    }
    const proxyConfig = {
        ...config,
        proxy: { host: proxy.ip, port: parseInt(proxy.port) }
    };
    try {
        const res = await axios(proxyConfig);
        return res;
    } catch (e) {
        markFail(proxy.ip, proxy.port);
        if (retries > 0) return axiosWithProxy(config, retries - 1);
        // Sau retry vẫn lỗi → gọi thẳng không qua proxy
        return axios(config);
    }
}

// ── axiosGet / axiosPost shorthand ────────────────────────────────────────────
function axiosGet(url, config = {}) {
    return axiosWithProxy({ ...config, method: "get", url });
}

function axiosPost(url, data, config = {}) {
    return axiosWithProxy({ ...config, method: "post", url, data });
}

// ── Public API ────────────────────────────────────────────────────────────────
export const proxyPool = {
    /** Khởi động pool (gọi 1 lần khi bot start) */
    async init() {
        await refetchPool();
        setInterval(() => {
            if (Date.now() - lastRefresh >= REFRESH_INTERVAL) refetchPool();
        }, 5 * 60 * 1000);
    },

    /** Lấy thông tin pool hiện tại */
    getStats() {
        return {
            total:        pool.length,
            lastRefresh:  lastRefresh ? new Date(lastRefresh).toISOString() : null,
            isRefreshing,
            proxies:      pool.map(p => `${p.ip}:${p.port} (${p.ms}ms, ${p.code})`)
        };
    },

    /** Lấy 1 proxy ngẫu nhiên (dạng object { ip, port, ... }) */
    pick: pickProxy,

    /** Lấy proxy config cho axios: { proxy: { host, port } } */
    getAxiosProxy() {
        const p = pickProxy();
        if (!p) return {};
        return { proxy: { host: p.ip, port: parseInt(p.port) } };
    },

    /** Đánh dấu fail */
    markFail,

    /**
     * Gọi axios qua proxy pool (tự rotate, retry, fallback)
     * @param {import("axios").AxiosRequestConfig} config
     */
    axios: axiosWithProxy,

    /** Shorthand GET qua proxy */
    get: axiosGet,

    /** Shorthand POST qua proxy */
    post: axiosPost,

    /** Force refresh pool ngay lập tức */
    refresh: refetchPool,

    /**
     * Inject danh sách proxy live từ ngoài vào pool (merge, dedup)
     * Dùng sau khi .proxy get lấy xong để doss dùng ngay
     * @param {Array<{ip,port,...}>} proxies
     */
    inject(proxies) {
        if (!proxies?.length) return;
        const existing = new Set(pool.map(p => `${p.ip}:${p.port}`));
        const added = [];
        for (const p of proxies) {
            const key = `${p.ip}:${p.port}`;
            if (!existing.has(key)) {
                pool.push({ ...p, failCount: 0 });
                existing.add(key);
                added.push(key);
            }
        }
        // Giới hạn pool không quá lớn
        if (pool.length > 500) {
            pool = pool.slice(-500);
        }
        lastRefresh = Date.now();
    }
};
