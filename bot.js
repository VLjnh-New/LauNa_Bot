import "./src/utils/core/globals.js";
import { startCapture } from "./src/utils/core/consoleCapture.js";
startCapture();
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import qrTerminal from "qrcode-terminal";
import { Zalo } from "zca-api";
import sizeOf from "image-size";
import { execSync, spawn } from "node:child_process";
import { loadModules } from "./src/modules/index.js";
import { loadEvents } from "./src/events/index.js";
import { log } from "./src/logger.js";
import { rentalManager } from "./src/utils/managers/rentalManager.js";
import { statsManager } from "./src/utils/managers/statsManager.js";
import { autoReactManager } from "./src/utils/managers/autoReactManager.js";
import { cleanTempFiles, cleanupOldFiles, initDataStore, readJSON, writeJSON } from "./src/utils/core/io-json.js";
import { handleListen } from "./src/utils/core/listen.js";
import { registerCustomApi } from "./src/utils/api/customApi.js";
import { protectionManager } from "./src/utils/managers/protectionManager.js";
import { startAutosendTicker } from "./src/modules/autosend.js";
import { startMemMonitor } from "./src/utils/core/memMonitor.js";
import { startMoodProfileScheduler } from "./src/events/launa.js";
import { checkAndExecuteSchedules } from "./src/modules/scheduler.js";
import { proxyPool } from "./src/utils/managers/proxyPool.js";
import { initAutoUACheck } from "./src/utils/core/userAgents.js";

if (process.platform === "win32") {
    try { process.stdout.setDefaultEncoding("utf8"); } catch {}
    try { process.stderr.setDefaultEncoding("utf8"); } catch {}
    try { execSync("chcp 65001", { stdio: "pipe", timeout: 3000 }); } catch {}
}

function _resolvebin(name) {
    try {
        const cmd = process.platform === "win32" ? `where ${name}` : `which ${name}`;
        return execSync(cmd, { encoding: "utf8", timeout: 4000, stdio: ["pipe","pipe","pipe"] }).trim().split(/\r?\n/)[0].trim() || name;
    } catch { return name; }
}

const CONFIG_PATH = process.cwd() + "/config.json";
const loadConfig = () => readJSON(CONFIG_PATH) || JSON.parse(readFileSync("config.json", "utf-8"));
const COOKIE_PATH = "cookie.json";
const loadCookie = () => {
    try {
        if (!existsSync(COOKIE_PATH)) return null;
        return JSON.parse(readFileSync(COOKIE_PATH, "utf-8"));
    } catch { return null; }
};
const saveCookie = (data) => writeFileSync(COOKIE_PATH, JSON.stringify(data, null, 2));

const isValidCookies = (c) => {
    if (!c) return false;
    if (typeof c === "string") return c.length > 50;
    return (Array.isArray(c.cookies) && c.cookies.length > 0) || (Array.isArray(c) && c.length > 0) || Object.keys(c).length > 0;
};

const C = {
    r: "\x1b[0m",
    b: "\x1b[1m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
    magenta: "\x1b[35m",
    gray: "\x1b[90m",
    blue: "\x1b[34m",
    white: "\x1b[37m",
    bgCyan: "\x1b[46m",
    bgGreen: "\x1b[42m",
    bgRed: "\x1b[41m",
    bgBlue: "\x1b[44m",
};

async function loginWithQR(zalo) {
    return new Promise((resolve, reject) => {
        zalo.loginQR({}, async (event) => {
            if (event.type === 0) {
                await event.actions.saveToFile("qr.png");
                qrTerminal.generate(event.data.token, { small: true }, (qr) => {
                    console.log(qr);
                });
            } else if (event.type === 1) {
                log.warn(`${C.yellow}QR expired${C.r} — retrying...`);
                event.actions.retry();
            } else if (event.type === 2) {
                log.info(`${C.green}QR scanned${C.r} — confirm on phone`);
            } else if (event.type === 3) {
                log.error(`QR declined`);
                event.actions.retry();
            }
        }).then(resolve).catch(reject);
    });
}

async function main() {
    const config = loadConfig();
    const { bot: { prefix = "!", selfListen = false } = {}, admin: { ids: adminIds = [] } = {}, credentials: creds = {} } = config;
    const cookies = loadCookie();

    let _ver = "?";
    try { _ver = JSON.parse(readFileSync("package.json", "utf-8")).version; } catch {}

    console.log(`${C.cyan}${C.b}┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓${C.r}`);
    console.log(`${C.cyan}${C.b}┃  ${C.yellow}✦  LAUNA  ${C.gray}(zca-api)${C.cyan}          ┃${C.r}`);
    console.log(`${C.cyan}${C.b}┃  ${C.green}✦  PROJERT BY DGK ${C.cyan}           ┃${C.r}`);
    console.log(`${C.cyan}${C.b}┃  ✦  UPDATE BY VLJNH${C.cyan}           ┃${C.r}`);
    console.log(`${C.cyan}${C.b}┃  ${C.magenta}✦  VERSION: ${_ver}${C.cyan}           ┃${C.r}`);
    console.log(`${C.cyan}${C.b}┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛${C.r}`);

    // Khởi tạo diver (file system) trước, sau đó load modules/events
    await initDataStore();

    // Khởi động song song: load data + load modules/events cùng lúc
    const [, , { allCommands, moduleInfo, extraHandlers }, { handlers: baseEventHandlers, eventCommands }] = await Promise.all([
        rentalManager.load(),
        statsManager.load(),
        loadModules(),
        loadEvents(),
    ]);
    autoReactManager.load();
    protectionManager.load();
    const eventHandlers = [...baseEventHandlers, ...extraHandlers];
    Object.assign(allCommands, eventCommands);
    global.allCommands = allCommands;

    log.info(`${C.yellow}${C.b}${moduleInfo.length}${C.r} modules  ${C.cyan}${C.b}${eventHandlers.length}${C.r} events`);

    const zalo = new Zalo({
        selfListen,
        imageMetadataGetter: async (p) => {
            try {
                const b = readFileSync(p);
                const d = sizeOf(b);
                return { width: d.width, height: d.height, size: b.length };
            } catch (e) { return { width: 100, height: 100, size: 0 }; }
        }
    });

    let api;
    if (isValidCookies(cookies) && creds.imei) {
        try {
            log.info(`${C.blue}🔑 Logging in${C.r} with cookies...`);
            api = await zalo.login({ cookie: cookies, imei: creds.imei, userAgent: creds.userAgent });
            log.success(`${C.green}Login OK${C.r} — cookies`);
        } catch (e) {
            log.warn(`Cookie session expired or invalid: ${e.message}`);
            try { writeFileSync(COOKIE_PATH, JSON.stringify([], null, 2)); } catch {}
            api = null;
        }
    }

    if (!api) {
        try {
            log.warn(`No valid cookies — ${C.yellow}switching to QR${C.r}`);
            api = await loginWithQR(zalo);
            log.success(`${C.green}Login OK${C.r} — QR`);
        } catch (e) { log.error(`Login failed`, e.message); process.exit(1); }
    }

    const zaloCtx = api.getContext();
    // Lưu cookie vào cookie.json riêng
    if (zaloCtx.cookie && typeof zaloCtx.cookie.toJSON === "function") {
        saveCookie(zaloCtx.cookie.toJSON().cookies || []);
    } else if (typeof zaloCtx.cookie === "string") {
        saveCookie(zaloCtx.cookie);
    }
    // Lưu imei + userAgent vào config.json
    const cfg = loadConfig();
    cfg.credentials = cfg.credentials || {};
    cfg.credentials.imei = zaloCtx.imei;
    cfg.credentials.userAgent = zaloCtx.userAgent;
    writeJSON(CONFIG_PATH, cfg);
    writeFileSync("config.json", JSON.stringify(cfg, null, 2));
    log.info(`${C.gray}Credentials saved.${C.r}`);

    registerCustomApi(api, log);


    global.zca_api = api;
    global.prefix = prefix;
    global.restartBot = (reason, delay = 2000) => {
        log.warn(`[RESTART] ${reason || "Restarting..."}`);
        setTimeout(() => {
            // Nếu chạy dưới PM2 → để PM2 tự restart (exit code 0)
            // Ngược lại → tự spawn process mới (VPS không có process manager)
            const underPM2 = !!process.env.PM2_HOME || process.env.pm_id !== undefined;
            if (underPM2) {
                process.exit(0);
            } else {
                const child = spawn(process.execPath, process.argv.slice(1), {
                    detached: true,
                    stdio:    "inherit",
                    env:      process.env,
                    cwd:      process.cwd(),
                });
                child.unref();
                process.exit(0);
            }
        }, delay);
    };

    cleanTempFiles(); cleanupOldFiles();
    setInterval(() => { cleanTempFiles(); cleanupOldFiles(); }, 3600000);

    startAutosendTicker(api);
    startMemMonitor(global.restartBot);
    startMoodProfileScheduler(api);

    // Tick scheduler mỗi 30s — duyệt datlich.json và phát thông báo khi tới giờ
    setInterval(() => {
        checkAndExecuteSchedules(api, log).catch(e => log.warn(`[Scheduler] Tick lỗi: ${e.message}`));
    }, 30000);
    // startAutoAppCheckMonitor(api);

    // Khởi động proxy pool (background, không block bot)
    proxyPool.init().catch(e => log.warn(`[ProxyPool] Init lỗi: ${e.message}`));

    // Auto kiểm tra & lọc UA pool mỗi 24h (chạy lần đầu sau 10s)
    initAutoUACheck({ concurrency: 5, intervalMs: 24 * 60 * 60 * 1000, silent: true });

    // Auto xác thực Google Drive nếu chưa có token (gửi link vào DM admin)
    // autoInitDrive(api, adminIds).catch(e => log.warn(`[DriveAutoInit] ${e.message}`));

    const ctx = { prefix, selfListen, adminIds, allCommands, moduleInfo, eventHandlers, log };

    // ─── Auto-reconnect WebSocket ───────────────────────────────────────────
    let retryCount    = 0;
    let isReconnecting = false;
    const MAX_RETRY_DELAY = 60000;

    async function startListener() {
        // Xóa TOÀN BỘ listener cũ trước khi đăng ký mới — tránh listener leak khi reconnect
        try { api.listener.removeAllListeners?.(); } catch {}

        try {
            await handleListen(api, ctx);
            retryCount     = 0;
            isReconnecting = false;

            // Dùng once() để chỉ xử lý 1 lần mỗi sự kiện
            api.listener.once?.("error", (err) => {
                log.warn(`${C.yellow}[WS] Lỗi kết nối: ${err?.message || err}${C.r}`);
                scheduleReconnect();
            });
            api.listener.once?.("close", () => {
                log.warn(`${C.yellow}[WS] Kết nối đóng — sẽ reconnect...${C.r}`);
                scheduleReconnect();
            });
        } catch (e) {
            log.error(`[WS] handleListen lỗi: ${e.message}`);
            scheduleReconnect();
        }
    }

    function scheduleReconnect() {
        // Chặn nhiều reconnect đồng thời
        if (isReconnecting) return;
        isReconnecting = true;
        retryCount++;
        const delay = Math.min(5000 * retryCount, MAX_RETRY_DELAY);
        log.warn(`${C.yellow}[WS] Bị ngắt! Reconnect sau ${delay / 1000}s (lần ${retryCount})...${C.r}`);
        setTimeout(async () => {
            try { api.listener.stop?.(); } catch {}
            // Chờ thêm 2s sau khi stop để Zalo giải phóng session cũ
            await new Promise(r => setTimeout(r, 2000));
            await startListener();
        }, delay);
    }

    await startListener();

    // Không để crash khi có lỗi không xử lý
    process.on("uncaughtException", (err) => {
        log.error(`[UNCAUGHT] ${err.message}`);
    });
    process.on("unhandledRejection", (reason) => {
        log.error(`[UNHANDLED] ${reason?.message || reason}`);
    });

    const stop = () => { log.info(`${C.red}Shutting down...${C.r}`); api.listener.stop?.(); process.exit(0); };
    process.on("SIGINT", stop);
    if (process.platform !== "win32") process.on("SIGTERM", stop);
}

main();
