import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

function resolveSystemBin(name) {
    try {
        const which = process.platform === "win32" ? `where ${name}` : `which ${name}`;
        const out = execSync(which, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/)[0].trim();
        if (out) return out;
    } catch {}
    return null;
}

function resolveFFmpegBin() {
    if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
    // Ưu tiên system ffmpeg (NixOS / OS-installed), tránh ffmpeg-static cũ build với gcc8 dễ crash.
    const sys = resolveSystemBin("ffmpeg");
    if (sys) return sys;
    try {
        const bin = require("ffmpeg-static");
        if (bin) return bin;
    } catch {}
    return "ffmpeg";
}

function resolveFFprobeBin() {
    if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
    const sys = resolveSystemBin("ffprobe");
    if (sys) return sys;
    try {
        const { path } = require("@ffprobe-installer/ffprobe");
        if (path) return path;
    } catch {}
    return "ffprobe";
}

export const FFMPEG_BIN = resolveFFmpegBin();
export const FFPROBE_BIN = resolveFFprobeBin();

export function getFFmpegBin()  { return FFMPEG_BIN; }
export function getFFprobeBin() { return FFPROBE_BIN; }

// Lọc bỏ banner/config của ffmpeg, chỉ giữ dòng lỗi thực sự.
function cleanFFmpegStderr(raw) {
    if (!raw) return "";
    const lines = raw.split(/\r?\n/);
    const noisePrefix = /^(ffmpeg version|built with|configuration:|\s*lib(av|sw|post)\w+\s+\d|Input #|Output #|Stream #|Metadata:|Duration:|encoder\s*:|\s+(major_brand|minor_version|compatible_brands|handler_name|vendor_id|encoder)\b|\s*--(enable|disable|with|without|prefix|cc|cxx|extra)[\w-]*)/i;
    const noiseSubstr = /(--enable-|--disable-|--with-|--without-|libavutil|libavcodec|libavformat|libavdevice|libavfilter|libswscale|libswresample|libpostproc|configuration:)/i;
    const errorHints = /(error|fail|invalid|denied|not\s+found|unable|forbidden|no\s+such|unsupported|exit|moov atom|protocol|404|403|connection|timeout|broken)/i;
    const meaningful = lines.filter(l => l.trim() && !noisePrefix.test(l) && !noiseSubstr.test(l));
    const errors = meaningful.filter(l => errorHints.test(l));
    const picked = (errors.length ? errors : meaningful).slice(-3).join(" | ").trim();
    return picked.length > 240 ? picked.slice(-240) : picked;
}

export function ffprobeAsync(filePath) {
    return new Promise((resolve, reject) => {
        const args = ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", filePath];
        const proc = spawn(FFPROBE_BIN, args);
        let out = "";
        let err = "";
        proc.stdout.on("data", d => out += d);
        proc.stderr.on("data", d => err += d);
        proc.on("close", code => {
            if (code !== 0) return reject(new Error(`ffprobe exit ${code}: ${cleanFFmpegStderr(err) || err.slice(-200)}`));
            try { resolve(JSON.parse(out)); } catch { reject(new Error("ffprobe JSON parse error")); }
        });
        proc.on("error", reject);
    });
}

export function ffmpegRun(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(FFMPEG_BIN, args);
        let errOutput = "";
        proc.stderr.on("data", d => errOutput += d);
        const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error("ffmpeg timeout")); }, timeoutMs);
        proc.on("close", code => {
            clearTimeout(timer);
            if (code === 0) resolve();
            else reject(new Error(`ffmpeg exit ${code}: ${cleanFFmpegStderr(errOutput) || errOutput.slice(-200)}`));
        });
        proc.on("error", e => { clearTimeout(timer); reject(e); });
    });
}
