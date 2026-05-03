import { fs, path, axios } from "../globals.js";
// uploadFromFile và isCloudinaryConfigured được set vào global bởi utils/core/globals.js
import FormData from 'form-data';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export const name = "ghepmat";
export const description = "Ghép mặt từ ảnh này sang ảnh khác";

export const pendingGhepMat = new Map();

// ── Tải ảnh từ URL hoặc file cục bộ ──────────────────────────────────────────
async function downloadToBuffer(input) {
    if (input.startsWith('http://') || input.startsWith('https://')) {
        const res = await axios.get(input, {
            responseType: 'arraybuffer',
            timeout: 30000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
                'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
                'Referer': 'https://chat.zalo.me/',
            },
        });
        const buf = Buffer.from(res.data);
        const fmt = detectImageFormat(buf);
        // Nếu không phải ảnh hợp lệ → có thể bị redirect sang login page
        if (buf.length < 1000) throw new Error(`Ảnh tải về quá nhỏ (${buf.length}B), có thể URL hết hạn`);
        if (fmt.ext === 'jpg' && buf[0] !== 0xFF) throw new Error(`Header ảnh không hợp lệ (${buf.slice(0,4).toString('hex')}), URL có thể hết hạn`);
        return buf;
    }
    return fs.promises.readFile(input);
}

// ── Phát hiện định dạng ảnh từ buffer ─────────────────────────────────────────
function detectImageFormat(buf) {
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
        return { mime: 'image/jpeg', ext: 'jpg' };
    }
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
        return { mime: 'image/png', ext: 'png' };
    }
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) {
        // RIFF header — likely WebP
        return { mime: 'image/webp', ext: 'webp' };
    }
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
        return { mime: 'image/gif', ext: 'gif' };
    }
    return { mime: 'image/jpeg', ext: 'jpg' }; // fallback
}

// ── Upload ảnh lên Litterbox (litter.catbox.moe) — URL công khai tạm thời 1h ──
async function uploadToLitterbox(buf) {
    const fmt = detectImageFormat(buf);
    const form = new FormData();
    form.append('reqtype', 'fileupload');
    form.append('time', '1h');
    form.append('fileToUpload', buf, { filename: `face.${fmt.ext}`, contentType: fmt.mime });
    const res = await axios.post('https://litterbox.catbox.moe/resources/internals/api.php', form, {
        headers: form.getHeaders(),
        timeout: 20000,
    });
    const url = res.data?.trim();
    if (!url || !url.startsWith('http')) throw new Error('Litterbox trả về URL không hợp lệ');
    return url;
}

// ── Tải ảnh lên host công khai, trả về URL ────────────────────────────────────
// Ưu tiên Litterbox (truy cập được từ HuggingFace), fallback sang Cloudinary
async function uploadToPublicHost(buf) {
    // 1. Thử Litterbox — URL công khai, accessible từ HuggingFace
    try {
        const url = await uploadToLitterbox(buf);
        return url;
    } catch {}
    // 2. Fallback: Cloudinary
    const cacheDir = path.join(process.cwd(), 'src/modules/cache');
    if (!fs.existsSync(cacheDir)) await fs.promises.mkdir(cacheDir, { recursive: true });
    const tmpPath = path.join(cacheDir, `ghepmat_up_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
    await fs.promises.writeFile(tmpPath, buf);
    try {
        if (global.uploadFromFile) {
            const url = await global.uploadFromFile(tmpPath);
            if (url && typeof url === 'string') {
                fs.promises.unlink(tmpPath).catch(() => {});
                return url;
            }
        }
    } catch {}
    fs.promises.unlink(tmpPath).catch(() => {});
    throw new Error('Không thể tải ảnh lên host công khai (đã thử Litterbox và Cloudinary)');
}

// ── SSE stream reader — nhận URL ảnh kết quả ─────────────────────────────────
// callPrefix: '/call/' (Gradio 3) hoặc '/gradio_api/call/' (Gradio 4)
// filePrefix: '/file=' (Gradio 3) hoặc '/gradio_api/file=' (Gradio 4)
async function readSseResult(spaceUrl, endpoint, eventId, timeout = 120000, callPrefix = '/call/', filePrefix = '/file=') {
    return new Promise((resolve, reject) => {
        let done = false;
        const timer = setTimeout(() => {
            if (!done) { done = true; reject(new Error(`${spaceUrl} quá thời gian (${timeout / 1000}s)`)); }
        }, timeout);

        axios.get(`${spaceUrl}${callPrefix}${endpoint}/${eventId}`, {
            responseType: 'stream',
            timeout,
            headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache' },
        }).then(res => {
            let buf = '';
            let currentEvent = null;

            // Trích xuất URL từ FileData — ưu tiên dùng `path` với filePrefix đúng
            // Tránh dùng `url` từ Gradio 3 vì có thể bị lỗi format /call/ru/file=
            const extractResultUrl = (out) => {
                if (!out) return null;
                if (typeof out === 'string') return out.startsWith('http') ? out : `${spaceUrl}${filePrefix}${out}`;
                if (out.path) return `${spaceUrl}${filePrefix}${out.path}`;
                if (out.url && out.url.startsWith('http')) return out.url;
                return null;
            };

            res.data.on('data', chunk => {
                buf += chunk.toString();
                const lines = buf.split('\n');
                buf = lines.pop(); // giữ dòng chưa hoàn chỉnh

                for (const line of lines) {
                    const trimmed = line.trim();

                    if (trimmed.startsWith('event:')) {
                        currentEvent = trimmed.slice(6).trim();
                        continue;
                    }

                    if (!trimmed.startsWith('data:')) continue;
                    const jsonStr = trimmed.slice(5).trim();

                    // Xử lý lỗi
                    if (currentEvent === 'error') {
                        if (!done) {
                            done = true;
                            clearTimeout(timer);
                            res.data.destroy();
                            reject(new Error(`${spaceUrl} không thể ghép (có thể ảnh không có mặt người rõ ràng)`));
                        }
                        continue;
                    }

                    if (!jsonStr || jsonStr === 'null') continue;

                    try {
                        const parsed = JSON.parse(jsonStr);

                        // Format mới: { msg: 'process_completed', output: { data: [...] } }
                        if (parsed?.msg === 'process_completed') {
                            const errMsg = parsed?.output?.error;
                            if (errMsg) {
                                if (!done) {
                                    done = true;
                                    clearTimeout(timer);
                                    res.data.destroy();
                                    reject(new Error(`${spaceUrl} lỗi xử lý: ${errMsg}`));
                                }
                                continue;
                            }
                            const arr = parsed?.output?.data;
                            if (Array.isArray(arr) && arr[0]) {
                                const imgUrl = extractResultUrl(arr[0]);
                                if (imgUrl && !done) {
                                    done = true;
                                    clearTimeout(timer);
                                    res.data.destroy();
                                    resolve(imgUrl);
                                }
                            }
                            continue;
                        }

                        // Format cũ / event: complete — mảng trực tiếp [fileData, ...]
                        const arr = Array.isArray(parsed) ? parsed : (parsed?.data ?? null);
                        if (!Array.isArray(arr)) continue;
                        const imgUrl = extractResultUrl(arr[0]);
                        if (imgUrl && !done) {
                            done = true;
                            clearTimeout(timer);
                            res.data.destroy();
                            resolve(imgUrl);
                        }
                    } catch {}
                }
            });

            res.data.on('end', () => {
                clearTimeout(timer);
                if (!done) { done = true; reject(new Error(`${spaceUrl} stream kết thúc không có kết quả`)); }
            });
            res.data.on('error', err => {
                clearTimeout(timer);
                if (!done) { done = true; reject(new Error(`${spaceUrl} stream lỗi: ${err.message}`)); }
            });
        }).catch(err => {
            clearTimeout(timer);
            if (!done) { done = true; reject(err); }
        });
    });
}

// ── Gọi Gradio Space với URL ảnh công khai ────────────────────────────────────
// callPrefix: '/call/' (Gradio 3) hoặc '/gradio_api/call/' (Gradio 4)
// filePrefix: '/file=' (Gradio 3) hoặc '/gradio_api/file=' (Gradio 4)
async function callGradioWithUrl(spaceUrl, endpoint, imgUrls, extraData = [], timeout = 120000, callPrefix = '/call/', filePrefix = '/file=') {
    const makeFileData = (url) => ({
        path: url,
        url: url,
        orig_name: 'img.jpg',
        mime_type: 'image/jpeg',
        meta: { _type: 'gradio.FileData' },
    });

    const queueRes = await axios.post(`${spaceUrl}${callPrefix}${endpoint}`, {
        data: [...imgUrls.map(makeFileData), ...extraData],
    }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
    });

    const eventId = queueRes.data?.event_id;
    if (!eventId) throw new Error(`${spaceUrl} không trả về event_id`);

    return readSseResult(spaceUrl, endpoint, eventId, timeout, callPrefix, filePrefix);
}

// ── Gọi Gradio Space với upload trực tiếp (fallback) ─────────────────────────
async function callGradioWithUpload(spaceUrl, endpoint, imgBuffers, extraData = [], timeout = 120000, callPrefix = '/call/', filePrefix = '/file=') {
    // Gradio 4 dùng /gradio_api/upload, Gradio 3 dùng /upload
    const uploadPath = callPrefix.includes('/gradio_api/') ? '/gradio_api/upload' : '/upload';
    async function uploadImg(buf) {
        const form = new FormData();
        form.append('files', buf, { filename: 'img.jpg', contentType: 'image/jpeg' });
        const res = await axios.post(`${spaceUrl}${uploadPath}`, form, {
            headers: form.getHeaders(),
            timeout: 30000,
        });
        if (!Array.isArray(res.data) || !res.data[0]) throw new Error(`${spaceUrl} upload thất bại`);
        return res.data[0];
    }

    const uploadedPaths = await Promise.all(imgBuffers.map(uploadImg));

    const makeFileData = (p) => ({
        path: p,
        url: `${spaceUrl}${filePrefix}${p}`,
        orig_name: 'img.jpg',
        mime_type: 'image/jpeg',
        meta: { _type: 'gradio.FileData' },
    });

    const queueRes = await axios.post(`${spaceUrl}${callPrefix}${endpoint}`, {
        data: [...uploadedPaths.map(makeFileData), ...extraData],
    }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
    });

    const eventId = queueRes.data?.event_id;
    if (!eventId) throw new Error(`${spaceUrl} không trả về event_id`);

    return readSseResult(spaceUrl, endpoint, eventId, timeout, callPrefix, filePrefix);
}

// ── Cấu hình các Space ────────────────────────────────────────────────────────
// order:       thứ tự ảnh — 'target-source' hoặc 'source-target'
// extra:       tham số bổ sung sau ảnh
// callPrefix:  '/call/' (Gradio 3) | '/gradio_api/call/' (Gradio 4)
// filePrefix:  '/file=' (Gradio 3) | '/gradio_api/file=' (Gradio 4)
const SPACES = [
    {
        url: 'https://rphrp1985-Faceswaper.hf.space',
        endpoint: 'predict',
        order: 'source-target',
        extra: [false],
        callPrefix: '/gradio_api/call/',
        filePrefix: '/gradio_api/file=',
    },
    {
        url: 'https://LucanDerLurch-face-swap.hf.space',
        endpoint: 'swap_face',
        order: 'source-target',
        extra: [false],
        callPrefix: '/gradio_api/call/',
        filePrefix: '/gradio_api/file=',
    },
];

// ── Hàm ghép mặt chính ───────────────────────────────────────────────────────
async function ghepMat(sourceInput, targetInput) {
    // Tải cả 2 ảnh song song
    const [srcBuf, tgtBuf] = await Promise.all([
        downloadToBuffer(sourceInput),
        downloadToBuffer(targetInput),
    ]);

    // Xác nhận ảnh decode được qua canvas
    let srcValid = false, tgtValid = false;
    try { await loadImage(srcBuf); srcValid = true; } catch {}
    try { await loadImage(tgtBuf); tgtValid = true; } catch {}

    // Nếu ảnh không decode được → convert qua canvas trước khi gửi HF space
    let finalSrcBuf = srcBuf, finalTgtBuf = tgtBuf;
    if (!srcValid) throw new Error('Ảnh mặt không hợp lệ hoặc URL hết hạn. Vui lòng gửi lại ảnh mới từ Zalo!');
    if (!tgtValid) throw new Error('Ảnh khung/thân không hợp lệ hoặc URL hết hạn. Vui lòng gửi lại ảnh mới từ Zalo!');
    // Luôn re-encode qua canvas → JPEG chuẩn (ffd8ff) để HF space xử lý được
    // (Zalo dùng format lạ ff0afa4f mà canvas đọc được nhưng HF space không nhận)
    const reEncode = async (buf) => {
        const img = await loadImage(buf);
        const cv = createCanvas(img.width, img.height);
        cv.getContext('2d').drawImage(img, 0, 0);
        return cv.toBuffer('image/jpeg', { quality: 95 });
    };
    finalSrcBuf = await reEncode(finalSrcBuf);
    finalTgtBuf = await reEncode(finalTgtBuf);

    // Upload lên host công khai để lấy URL (dùng cho strategy URL)
    let srcPublicUrl = null, tgtPublicUrl = null;
    try {
        [srcPublicUrl, tgtPublicUrl] = await Promise.all([
            uploadToPublicHost(finalSrcBuf),
            uploadToPublicHost(finalTgtBuf),
        ]);
    } catch {}

    for (const space of SPACES) {
        const callPrefix = space.callPrefix ?? '/call/';
        const filePrefix = space.filePrefix ?? '/file=';
        const urls = space.order === 'target-source'
            ? [tgtPublicUrl, srcPublicUrl]
            : [srcPublicUrl, tgtPublicUrl];
        const bufs = space.order === 'target-source'
            ? [finalTgtBuf, finalSrcBuf]
            : [finalSrcBuf, finalTgtBuf];

        // Strategy 1: URL method (nếu có URL công khai)
        if (srcPublicUrl && tgtPublicUrl) {
            try {
                return await callGradioWithUrl(space.url, space.endpoint, urls, space.extra, 120000, callPrefix, filePrefix);
            } catch (e) {
                await new Promise(r => setTimeout(r, 1500));
            }
        }

        // Strategy 2: Direct upload (fallback)
        try {
            return await callGradioWithUpload(space.url, space.endpoint, bufs, space.extra, 120000, callPrefix, filePrefix);
        } catch {}
    }

    throw new Error("Ghép mặt thất bại. Lưu ý: ảnh phải có mặt người RÕ RÀNG, nhìn thẳng, đủ sáng. Vui lòng thử lại với ảnh khác!");
}

// ── Trích xuất URL ảnh từ dữ liệu attachment ─────────────────────────────────
const extractImageUrl = (attachStr) => {
    if (!attachStr) return null;
    try {
        let attachObj = typeof attachStr === "string" ? JSON.parse(attachStr) : attachStr;
        if (Array.isArray(attachObj) && attachObj.length > 0) attachObj = attachObj[0];

        let url = null;
        if (attachObj.params) {
            let paramsObj = typeof attachObj.params === "string" ? JSON.parse(attachObj.params) : attachObj.params;
            if (paramsObj.hd) url = paramsObj.hd;
            else if (paramsObj.url) url = paramsObj.url;
        }
        if (!url && attachObj.href) url = attachObj.href;

        if (url && typeof url === 'string') {
            url = url.trim().replace(/^"|"$/g, '');
            if (url.startsWith("http")) return url;
        }
    } catch {}
    return null;
};

// ── Xử lý và gửi kết quả ghép mặt ───────────────────────────────────────────
async function processGhepMat(ctx, sourceUrl, targetUrl, pendingNotiMsg = null) {
    const { api, threadId, threadType, log } = ctx;
    let waitRes = null;
    try {
        waitRes = await api.sendMessage({ msg: "⏳ Đang ghép mặt, vui lòng chờ trong giây lát..." }, threadId, threadType);

        const resultUrl = await ghepMat(sourceUrl, targetUrl);

        if (!resultUrl) {
            return api.sendMessage({ msg: "❌ Lỗi: Không nhận được ảnh từ API." }, threadId, threadType);
        }

        // Tải ảnh kết quả về
        let rawBuf;
        let finalUrl = resultUrl;
        if (finalUrl.startsWith('data:image')) {
            const base64Data = finalUrl.replace(/^data:image\/\w+;base64,/, '');
            rawBuf = Buffer.from(base64Data, 'base64');
        } else {
            if (!finalUrl.startsWith('http')) {
                finalUrl = finalUrl.startsWith('/') ? 'https://taoanhdep.com' + finalUrl : 'https://taoanhdep.com/' + finalUrl;
            }
            const resImg = await axios.get(finalUrl, { responseType: 'arraybuffer', timeout: 60000 });
            rawBuf = Buffer.from(resImg.data);
        }

        // Chuyển đổi sang JPG nếu cần (webp/png → jpg)
        const fmt = detectImageFormat(rawBuf);
        let jpgBuf;
        if (fmt.ext !== 'jpg') {
            try {
                const img = await loadImage(rawBuf);
                const canvas = createCanvas(img.width, img.height);
                const canvasCtx = canvas.getContext('2d');
                canvasCtx.drawImage(img, 0, 0);
                jpgBuf = canvas.toBuffer('image/jpeg', { quality: 92 });
            } catch (convErr) {
                jpgBuf = rawBuf;
            }
        } else {
            jpgBuf = rawBuf;
        }

        // Lấy kích thước ảnh để gửi qua sendImageEnhanced
        let imgW = 720, imgH = 960;
        try {
            const imgObj = await loadImage(jpgBuf);
            imgW = imgObj.width;
            imgH = imgObj.height;
        } catch {}

        // Upload lên Catbox rồi gửi ảnh trực tiếp vào Zalo
        const catboxUrl = await uploadToLitterbox(jpgBuf);

        if (api.sendImageEnhanced) {
            await api.sendImageEnhanced({ imageUrl: catboxUrl, threadId, threadType, width: imgW, height: imgH, msg: '✨ Ảnh ghép của bạn đây!' });
        } else {
            await api.sendMessage({ msg: `✨ Ảnh ghép của bạn đây!\n${catboxUrl}` }, threadId, threadType);
        }

        // Thu hồi thông báo chờ
        try {
            if (waitRes?.message) api.undo(waitRes.message, threadId, threadType).catch(() => {});
            if (pendingNotiMsg?.message) api.undo(pendingNotiMsg.message, threadId, threadType).catch(() => {});
        } catch {}

    } catch (error) {
        await api.sendMessage({ msg: `❌ Lỗi ghép mặt: ${error.message}` }, threadId, threadType);
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────
export const commands = {
    ghepmat: async (ctx) => {
        const { api, args, threadId, threadType, senderId, message } = ctx;

        let sourceUrl, targetUrl;
        const quoteImageUrl = extractImageUrl(message.data?.quote?.attach);
        const currentImageUrl = extractImageUrl(message.data?.attach);

        if (args.length >= 2 && args[0].startsWith("http") && args[1].startsWith("http")) {
            sourceUrl = args[0];
            targetUrl = args[1];
        } else if (currentImageUrl && quoteImageUrl) {
            sourceUrl = currentImageUrl;
            targetUrl = quoteImageUrl;
        } else if (args.length >= 1 && args[0].startsWith("http")) {
            if (quoteImageUrl) {
                sourceUrl = args[0];
                targetUrl = quoteImageUrl;
            } else if (currentImageUrl) {
                sourceUrl = currentImageUrl;
                targetUrl = args[0];
            }
        }

        if (sourceUrl && targetUrl) {
            return processGhepMat(ctx, sourceUrl, targetUrl);
        }

        let singleImage = currentImageUrl || quoteImageUrl || (args.length === 1 && args[0].startsWith("http") ? args[0] : null);

        if (singleImage) {
            if (pendingGhepMat.has(senderId)) {
                const pendingData = pendingGhepMat.get(senderId);
                if (pendingData.threadId === threadId) {
                    pendingGhepMat.delete(senderId);
                    return processGhepMat(ctx, singleImage, pendingData.targetUrl, pendingData.notiMsg);
                }
            }
            const notiRes = await api.sendMessage({
                msg: "✅ Đã nhận ảnh KHUNG (ảnh thân/poster).\n\n▶ Bây giờ bạn hãy TÌM MỘT BỨC ẢNH MẶT, sau đó REPLY LẠI BỨC ẢNH ĐÓ và gõ lệnh '!ghepmat' lần nữa để ghép nhé!"
            }, threadId, threadType);
            pendingGhepMat.set(senderId, { targetUrl: singleImage, threadId, notiMsg: notiRes?.message });
            return;
        }

        return api.sendMessage({
            msg: "⚠️ Hướng dẫn !ghepmat:\n1. Reply 1 ảnh khung và gõ !ghepmat, sau đó reply tiếp 1 ảnh mặt và gõ !ghepmat lần 2.\n2. Reply 1 ảnh khung & đính kèm 1 ảnh mặt.\n3. Dùng 2 link: !ghepmat <link_mặt> <link_thân>"
        }, threadId, threadType);
    }
};

// ── Handle sự kiện ảnh (không kèm lệnh) ──────────────────────────────────────
export async function handle(ctx) {
    const { message, threadId, senderId } = ctx;

    if (!pendingGhepMat.has(senderId)) return false;
    const pendingData = pendingGhepMat.get(senderId);
    if (pendingData.threadId !== threadId) return false;

    const imageUrl = extractImageUrl(message.data?.attach);
    if (!imageUrl) return false;

    pendingGhepMat.delete(senderId);
    return processGhepMat(ctx, imageUrl, pendingData.targetUrl, pendingData.notiMsg);
}
