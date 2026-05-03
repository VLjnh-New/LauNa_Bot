import { log } from "../../logger.js";
import os from "node:os";

const MAX_HEAP_MB   = 512;
const WARN_PCT      = 0.55;
const CRIT_PCT      = 0.75;
const CHECK_INTERVAL_MS  = 20_000;
const REPORT_INTERVAL_MS = 300_000;
const GC_INTERVAL_MS     = 120_000;

const C = {
    r:      "\x1b[0m",
    b:      "\x1b[1m",
    gray:   "\x1b[90m",
    yellow: "\x1b[93m",
    red:    "\x1b[91m",
    green:  "\x1b[92m",
    cyan:   "\x1b[96m",
};

function mb(bytes) {
    return (bytes / 1024 / 1024).toFixed(1);
}

function bar(pct, width = 20) {
    const filled = Math.round(pct * width);
    const empty  = width - filled;
    const color  = pct >= CRIT_PCT ? C.red : pct >= WARN_PCT ? C.yellow : C.green;
    return `${color}${"█".repeat(filled)}${C.gray}${"░".repeat(empty)}${C.r}`;
}

function snapshot() {
    const m    = process.memoryUsage();
    const heapUsedMB  = parseFloat(mb(m.heapUsed));
    const heapTotalMB = parseFloat(mb(m.heapTotal));
    const rssMB       = parseFloat(mb(m.rss));
    const extMB       = parseFloat(mb(m.external));
    const pct         = heapUsedMB / MAX_HEAP_MB;
    return { heapUsedMB, heapTotalMB, rssMB, extMB, pct };
}

function tryGC(label) {
    if (typeof global.gc === "function") {
        global.gc();
        log.warn(`${C.yellow}[MEM] GC triggered${C.r} (${label})`);
    }
}

let _restartBot = null;

// ── Stats tracking ────────────────────────────────────────────────────────────
const _startTime = Date.now();
const _stats = {
    messagesProcessed: 0,
    commandsExecuted:  0,
    eventsHandled:     0,
    errorsOccurred:    0,
};

export const healthMonitor = {
    logMessage:       () => _stats.messagesProcessed++,
    logCommand:       () => _stats.commandsExecuted++,
    logEvent:         () => _stats.eventsHandled++,
    logErrorOccurred: () => _stats.errorsOccurred++,

    getUptime() {
        const ms = Date.now() - _startTime;
        const h  = Math.floor(ms / 3_600_000);
        const m  = Math.floor((ms % 3_600_000) / 60_000);
        return `${h}h ${m}m`;
    },

    getSystemInfo() {
        return {
            cpuCount:    os.cpus().length,
            freeMemory:  Math.round(os.freemem()  / 1024 / 1024),
            totalMemory: Math.round(os.totalmem() / 1024 / 1024),
            uptime:      Math.round(os.uptime()   / 3_600),
        };
    },

    getHealthReport() {
        const { heapUsedMB, heapTotalMB, rssMB, extMB, pct } = snapshot();
        const mem = { heapUsed: heapUsedMB, heapTotal: heapTotalMB, rss: rssMB, external: extMB };
        const sys = this.getSystemInfo();
        const warnings = [];

        if (pct >= CRIT_PCT)           warnings.push("⚠️ Heap usage > 75%");
        if (sys.freeMemory < 300)      warnings.push("⚠️ System free memory < 300MB");
        if (_stats.errorsOccurred > 100) warnings.push("⚠️ Error count > 100");

        return { uptime: this.getUptime(), stats: { ..._stats }, memory: mem, system: sys, warnings };
    },
};

// ── Memory monitor ────────────────────────────────────────────────────────────
export function startMemMonitor(restartFn) {
    _restartBot = restartFn;

    let lastReportAt = 0;
    let critPending  = false;
    let critTimer    = null;

    // GC định kỳ mỗi 2 phút để giải phóng bộ nhớ nhỏ liên tục
    setInterval(() => tryGC("periodic"), GC_INTERVAL_MS);

    function check() {
        const { heapUsedMB, heapTotalMB, rssMB, extMB, pct } = snapshot();
        const now = Date.now();

        if (pct >= CRIT_PCT) {
            log.warn(
                `${C.red}${C.b}[MEM] ⚠ NGƯỠNG NGUY HIỂM${C.r} — heap ${C.b}${heapUsedMB}${C.r}/${MAX_HEAP_MB} MB` +
                ` (${(pct * 100).toFixed(1)}%) | RSS ${rssMB} MB`
            );
            tryGC("critical");

            if (!critPending) {
                critPending = true;
                critTimer = setTimeout(() => {
                    const after = snapshot();
                    if (after.pct >= CRIT_PCT) {
                        log.warn(
                            `${C.red}${C.b}[MEM] 🔴 Heap vẫn cao sau GC (${(after.pct * 100).toFixed(1)}%)` +
                            ` — khởi động lại bot để tránh crash OOM${C.r}`
                        );
                        _restartBot?.("[MEM] OOM prevention restart");
                    } else {
                        log.warn(`${C.yellow}[MEM] GC giải phóng đủ bộ nhớ (${(after.pct * 100).toFixed(1)}%) — OK${C.r}`);
                        critPending = false;
                    }
                }, 10_000);
            }
            return;
        }

        if (critPending) {
            clearTimeout(critTimer);
            critPending = false;
        }

        if (pct >= WARN_PCT) {
            log.warn(
                `${C.yellow}[MEM] Heap cao${C.r} ${heapUsedMB}/${MAX_HEAP_MB} MB` +
                ` (${(pct * 100).toFixed(1)}%) ${bar(pct)} — gọi GC`
            );
            tryGC("warn");
            return;
        }

        if (now - lastReportAt >= REPORT_INTERVAL_MS) {
            lastReportAt = now;
            log.mem(
                `Heap ${C.b}${heapUsedMB}${C.r}/${heapTotalMB} MB` +
                ` ${bar(pct, 16)} | RSS ${rssMB} MB | ext ${extMB} MB`
            );
        }
    }

    setInterval(check, CHECK_INTERVAL_MS);
    check();

    log.mem(`Giám sát RAM — giới hạn heap ${MAX_HEAP_MB} MB, ${CHECK_INTERVAL_MS / 1000}s`);
}
