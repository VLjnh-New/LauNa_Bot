import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import axios from 'axios';
import FormData from 'form-data';
import { log } from '../../logger.js';
import { getFFmpegBin } from '../core/ffmpegHelper.js';

const DL_TIMEOUT  = 15000;
const API_TIMEOUT = 20000;

// ─── Đọc credentials Sightengine ─────────────────────────────────────────────
function _getSightengine() {
    try {
        const t = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tokens.json'), 'utf-8'));
        return { user: t.antinude?.sightengine_user || '', secret: t.antinude?.sightengine_secret || '' };
    } catch { return { user: '', secret: '' }; }
}

// ─── Thư mục cache ────────────────────────────────────────────────────────────
function _ensureCache() {
    const dir = path.join(process.cwd(), '.cache');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
}

// ─── Nhận dạng format ảnh từ magic bytes ─────────────────────────────────────
function _detectImageFormat(buf) {
    if (!buf || buf.length < 12) return { ext: 'jpg', contentType: 'image/jpeg' };
    if (buf[0] === 0xFF && buf[1] === 0xD8)
        return { ext: 'jpg', contentType: 'image/jpeg' };
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47)
        return { ext: 'png', contentType: 'image/png' };
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)
        return { ext: 'webp', contentType: 'image/webp' };
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46)
        return { ext: 'gif', contentType: 'image/gif' };
    return { ext: 'jpg', contentType: 'image/jpeg' };
}

// ─── Phát hiện JXL ───────────────────────────────────────────────────────────
function _isJxl(buf) {
    if (!buf || buf.length < 4) return false;
    if (buf.length >= 8 && buf.slice(4, 8).toString('ascii') === 'jXL ') return true;
    if (buf[0] === 0xFF && buf[1] === 0x0A) return true;
    return false;
}

// ─── Convert bất kỳ format → JPEG bằng ffmpeg ────────────────────────────────
async function _toJpeg(buf) {
    const cacheDir = _ensureCache();
    const ts  = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const inp = path.join(cacheDir, `conv_in_${ts}`);
    const out = path.join(cacheDir, `conv_out_${ts}.jpg`);
    try {
        fs.writeFileSync(inp, buf);
        await new Promise((resolve, reject) => {
            const proc = spawn(getFFmpegBin(), ['-y', '-i', inp, '-q:v', '2', '-f', 'image2', out], { stdio: 'ignore' });
            const timer = setTimeout(() => { try { proc.kill(); } catch {} reject(new Error('ffmpeg conv timeout')); }, 12000);
            proc.on('close', code => {
                clearTimeout(timer);
                code === 0 && fs.existsSync(out) ? resolve() : reject(new Error(`ffmpeg exit ${code}`));
            });
            proc.on('error', e => { clearTimeout(timer); reject(e); });
        });
        return fs.readFileSync(out);
    } catch {
        return buf;
    } finally {
        try { fs.unlinkSync(inp); } catch {}
        try { if (fs.existsSync(out)) fs.unlinkSync(out); } catch {}
    }
}

// ─── Nhận biết URL audio/media không phải ảnh/video ──────────────────────────
const AUDIO_EXT_REGEX = /\.(aac|mp3|m4a|ogg|wav|flac|opus|wma|amr|3gp)(\?.*)?$/i;
function _isAudioUrl(url) {
    try {
        const u = new URL(url);
        return AUDIO_EXT_REGEX.test(u.pathname);
    } catch { return AUDIO_EXT_REGEX.test(url); }
}

// ─── Nhận biết URL Zalo CDN ───────────────────────────────────────────────────
function _isZaloCdn(url) {
    try {
        const h = new URL(url).hostname.toLowerCase();
        return h.endsWith('.zdn.vn') || h.endsWith('.zadn.vn') || h.endsWith('.zalo.me')
            || h.includes('zfcloud') || h.includes('dlmd.me');
    } catch { return false; }
}

// ─── Tải ảnh + convert JXL → JPEG nếu cần ───────────────────────────────────
async function _downloadAndPrepare(url) {
    const isZalo = _isZaloCdn(url);
    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        ...(isZalo ? {
            'Referer':         'https://chat.zalo.me/',
            'Accept':          'image/jpeg,image/png,image/webp,image/*,*/*;q=0.8',
            'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
        } : {}),
    };
    const resp = await axios.get(url, {
        responseType: 'arraybuffer', timeout: DL_TIMEOUT,
        headers, maxRedirects: 5, validateStatus: s => s < 500,
    });
    if (resp.status >= 400) throw new Error(`HTTP ${resp.status}`);
    let buf = Buffer.from(resp.data);
    if (buf.length < 100) throw new Error(`Response quá nhỏ (${buf.length} bytes)`);

    // Luôn convert sang JPEG qua ffmpeg — đảm bảo Sightengine đọc được mọi format
    buf = await _toJpeg(buf);
    return buf;
}

// ─── Sightengine: upload file ─────────────────────────────────────────────────
async function _checkWithSightengine(filePath) {
    const { user, secret } = _getSightengine();
    if (!user || !secret) { log.warn('[NSFW] Chưa cấu hình sightengine trong tokens.json'); return null; }
    if (!fs.existsSync(filePath)) return null;
    const size = fs.statSync(filePath).size;
    if (size < 100) { log.warn(`[NSFW] File quá nhỏ (${size}B)`); return null; }

    const buf = fs.readFileSync(filePath);
    const fmt = _detectImageFormat(buf);

    try {
        const form = new FormData();
        form.append('media',      fs.createReadStream(filePath), { filename: `media.${fmt.ext}`, contentType: fmt.contentType });
        form.append('models',     'nudity-2.0');
        form.append('api_user',   user);
        form.append('api_secret', secret);
        const resp = await axios.post('https://api.sightengine.com/1.0/check.json', form, {
            headers: { ...form.getHeaders() },
            timeout: API_TIMEOUT,
            validateStatus: () => true,
        });
        if (resp.status !== 200) {
            const body = typeof resp.data === 'object' ? JSON.stringify(resp.data).slice(0, 200) : String(resp.data).slice(0, 200);
            log.warn(`[NSFW] Sightengine HTTP ${resp.status}: ${body}`);
            return null;
        }
        return _parseSightengine(resp.data);
    } catch (e) {
        log.warn(`[NSFW] Sightengine lỗi: ${e.message}`);
        return null;
    }
}

function _parseSightengine(data) {
    if (!data || data.status !== 'success') return null;
    const nudity = data.nudity;
    if (!nudity) return null;
    const explicit   = (nudity.sexual_activity || 0) + (nudity.sexual_display || 0);
    const suggestive = nudity.suggestive || 0;
    const score      = Math.max(explicit, suggestive * 0.7);
    const isNSFW     = explicit >= 0.45 || score >= 0.55;
    return {
        isNSFW,
        score:          parseFloat(score.toFixed(4)),
        confidence:     Math.round(score * 100),
        classification: isNSFW ? 'NỘI DUNG NHẠY CẢM' : 'SẠCH',
        source:         'sightengine',
    };
}

// ─── Chuẩn hoá → ghi file tạm → check ───────────────────────────────────────
async function _checkBuffer(buf) {
    if (!buf?.length) return null;
    // Luôn convert sang JPEG — tránh mọi lỗi format Sightengine không đọc được
    const workBuf = await _toJpeg(buf);
    const fmt      = _detectImageFormat(workBuf);
    const cacheDir = _ensureCache();
    const tmp      = path.join(cacheDir, `nsfw_${Date.now()}_${Math.random().toString(36).slice(2)}.${fmt.ext}`);
    try {
        fs.writeFileSync(tmp, workBuf);
        return await _checkWithSightengine(tmp);
    } finally {
        try { fs.unlinkSync(tmp); } catch {}
    }
}

// ─── Check URL: tải + chuẩn hoá → Sightengine ────────────────────────────────
async function _checkUrl(url) {
    if (_isAudioUrl(url)) return null;
    try {
        const buf = await _downloadAndPrepare(url);
        return await _checkBuffer(buf);
    } catch (e) {
        log.warn(`[NSFW] _checkUrl lỗi: ${e.message}`);
        return null;
    }
}

// ─── FFmpeg: trích frame video tại timestamp ──────────────────────────────────
function _extractFrameAt(videoPath, timestamp) {
    return new Promise((resolve, reject) => {
        const proc = spawn(getFFmpegBin(), [
            '-ss', String(timestamp), '-i', videoPath,
            '-frames:v', '1', '-vf', 'scale=480:-2',
            '-f', 'image2', '-vcodec', 'mjpeg', '-q:v', '5', 'pipe:1'
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
        const chunks = [];
        proc.stdout.on('data', d => chunks.push(d));
        proc.on('close', () => {
            const buf = Buffer.concat(chunks);
            buf.length > 500 ? resolve(buf) : reject(new Error(`Frame trống tại ${timestamp}s`));
        });
        proc.on('error', reject);
    });
}

function _getVideoDuration(videoPath) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffprobe', [
            '-v', 'error', '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1', videoPath
        ]);
        let out = '';
        proc.stdout.on('data', d => { out += d.toString(); });
        proc.on('close', () => {
            const dur = parseFloat(out.trim());
            !isNaN(dur) && dur > 0 ? resolve(dur) : reject(new Error('ffprobe không lấy được duration'));
        });
        proc.on('error', reject);
    });
}

// ─── Cloudinary: trích frame từ video URL (không tải video) ──────────────────
async function _extractFrameCloudinary(videoUrl, sec = 1) {
    try {
        const tokensRaw = fs.readFileSync(path.resolve(process.cwd(), 'tokens.json'), 'utf-8');
        const cloud = JSON.parse(tokensRaw)?.cloudinary?.cloud;
        if (!cloud) return null;
        const encoded = encodeURIComponent(videoUrl);
        const url = `https://res.cloudinary.com/${cloud}/video/fetch/so_${sec},f_jpg,w_480/${encoded}`;
        const res = await axios.get(url, {
            responseType: 'arraybuffer', timeout: DL_TIMEOUT,
            headers: { 'User-Agent': 'Mozilla/5.0' },
            maxRedirects: 5, validateStatus: s => s < 500,
        });
        if (res.status !== 200) return null;
        const buf = Buffer.from(res.data);
        if (buf.length < 500) return null;
        const ct = (res.headers?.['content-type'] || '').toLowerCase();
        return (ct.startsWith('image/') || (buf[0] === 0xFF && buf[1] === 0xD8)) ? buf : null;
    } catch { return null; }
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

export const nsfwDetector = {

    async checkUrl(url, _api) {
        if (!url) return null;
        return await _checkUrl(url);
    },

    async checkBuffer(buf, _api) {
        if (!buf?.length) return null;
        return await _checkBuffer(buf);
    },

    async checkUrlWithZaloAI(url, api) { return this.checkUrl(url, api); },
    async checkBufferWithZaloAI(buf, api) { return this.checkBuffer(buf, api); },
    async checkFrame(buf, api) { return this.checkBuffer(buf, api); },
    async checkVideoFrame(buf, api) { return this.checkBuffer(buf, api); },

    async extractFrameFromUrl(videoUrl, offsets = [1, 3, 5]) {
        for (const sec of offsets) {
            try { const buf = await _extractFrameCloudinary(videoUrl, sec); if (buf) return buf; } catch {}
        }
        return null;
    },

    async checkVideo(videoPath, options = {}, _api) {
        const { interval = 3, maxFrames = 5 } = options;
        if (!videoPath || !fs.existsSync(videoPath)) return null;
        try {
            const duration = await _getVideoDuration(videoPath);
            const timestamps = new Set([1]);
            for (let ts = interval; ts < duration; ts += interval) {
                timestamps.add(parseFloat(Math.min(ts, duration - 0.5).toFixed(2)));
                if (timestamps.size >= maxFrames) break;
            }
            for (const ts of [...timestamps]) {
                try {
                    const frameBuf = await _extractFrameAt(videoPath, ts);
                    const result   = await _checkBuffer(frameBuf);
                    if (!result) continue;
                    if (result.isNSFW) return result;
                } catch {}
            }
            return { isNSFW: false, score: 0, confidence: 0, classification: 'SẠCH', source: 'sightengine' };
        } catch { return null; }
    },

    async extractFrame(videoPath, timestamp = 0) {
        return _extractFrameAt(videoPath, timestamp);
    },
};
