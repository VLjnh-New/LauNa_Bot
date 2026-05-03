import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import axios from "axios";

// Đường dẫn tuyệt đối từ file này (hoạt động đúng trên cả dev lẫn hosting)
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
// Gốc project: src/utils/canvas/ -> ../../.. -> project root
const PROJECT_ROOT = path.resolve(__dirname, "../../..");

// Dynamic import canvas — thử @napi-rs/canvas trước (hỗ trợ Android ARM64), fallback skia-canvas
let createCanvas, loadImage, FontLibrary;
export let canvasAvailable = false;

function _patchCanvasToBuffer(canvas) {
    const orig = canvas.toBuffer.bind(canvas);
    canvas.toBuffer = (fmt, ...args) => {
        const mime = fmt === "png" ? "image/png" : fmt === "jpeg" ? "image/jpeg" : (fmt || "image/png");
        const result = orig(mime, ...args);
        return result instanceof Promise ? result : Promise.resolve(result);
    };
    return canvas;
}

async function tryLoadCanvas() {
    // 1. Thử @napi-rs/canvas (có binary Android ARM64)
    try {
        const m = await import("@napi-rs/canvas");
        const _createCanvas = m.createCanvas || m.default?.createCanvas;
        loadImage     = m.loadImage || m.default?.loadImage;
        const GF      = m.GlobalFonts || m.default?.GlobalFonts;
        createCanvas  = (w, h) => _patchCanvasToBuffer(_createCanvas(w, h));
        FontLibrary   = {
            use: (name, fontPath) => {
                try { GF?.registerFromPath(fontPath, name); } catch {}
            }
        };
        return true;
    } catch {}

    // 2. Fallback skia-canvas (desktop/server)
    try {
        const m = await import("skia-canvas");
        createCanvas  = (w, h) => _patchCanvasToBuffer(new m.Canvas(w, h));
        loadImage     = m.loadImage;
        FontLibrary   = m.FontLibrary;
        return true;
    } catch (err) {
        console.error("[canvas] ❌ Không tải được canvas — các lệnh ảnh sẽ dùng text fallback.", err?.message || err);
        return false;
    }
}

// ── Lazy init: canvas chỉ tải khi lệnh đầu tiên cần dùng ──────────────────
let _canvasInitPromise = null;

async function ensureCanvas() {
    if (_canvasInitPromise === null) {
        _canvasInitPromise = (async () => {
            const ok = await tryLoadCanvas();
            canvasAvailable = ok;
            if (ok) {
                const fontPath  = path.join(PROJECT_ROOT, "src/assets/fonts/BeVietnamPro-Bold.ttf");
                const emojiPath = path.join(PROJECT_ROOT, "src/assets/fonts/NotoEmoji-Bold.ttf");
                try {
                    FontLibrary.use("BeVietnamPro",     fontPath);
                    FontLibrary.use("BeVietnamProBold", fontPath);
                    FontLibrary.use("NotoEmoji",        emojiPath);
                    FontLibrary.use("NotoEmojiBold",    emojiPath);
                } catch (e) {
                    console.warn("[canvas] Không thể đăng ký font:", e?.message || e);
                }
            }
        })();
    }
    return _canvasInitPromise;
}

/**
 * Shared Utils
 */
const msToTime = (ms) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

function drawRoundRect(ctx, x, y, width, height, radius) {
    if (radius === undefined) radius = 0;
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

/**
 * MUSIC CANVAS FUNCTIONS
 */

export async function drawSoundCloudSearch(songs, query) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1280;
    const height = 720;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themeColor = "#ff5500"; // SoundCloud Orange

    // 1. Background Dark Premium
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "rgba(255, 85, 0, 0.2)");
    bgGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Header & Hướng dẫn (In thẳng lên Canvas)
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px BeVietnamProBold, Sans";
    ctx.fillText("SOUNDCLOUD", 50, 80);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "bold 24px BeVietnamProBold, Sans";
    ctx.fillText(`KẾT QUẢ: ${query.toUpperCase()}`, 480, 75);

    // 3. Grid Setup (2 Cột x 5 Hàng)
    const paddingX = 50;
    const paddingY = 120;
    const itemW = 570;
    const itemH = 100;
    const gapX = 40;
    const gapY = 15;

    // Tải thumbnail song song
    const sclList = songs.slice(0, 10);
    const sclThumbs = await Promise.allSettled(sclList.map(async s => {
        const url = (s.thumbnail || s.thumb || s.artwork_url || "").replace("t120x120", "t240x240");
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 4000 });
        return loadImage(Buffer.from(res.data));
    }));

    for (let i = 0; i < sclList.length; i++) {
        const s = sclList[i];
        const col = i >= 5 ? 1 : 0;
        const row = i % 5;
        const x = paddingX + (col * (itemW + gapX));
        const y = paddingY + (row * (itemH + gapY));

        // Card Box
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        drawRoundRect(ctx, x, y, itemW, itemH, 20);
        ctx.fill();

        // Thumb
        const sclImg = sclThumbs[i]?.status === 'fulfilled' ? sclThumbs[i].value : null;
        if (sclImg) {
            ctx.save();
            drawRoundRect(ctx, x + 10, y + 10, 80, 80, 15);
            ctx.clip();
            ctx.drawImage(sclImg, x + 10, y + 10, 80, 80);
            ctx.restore();
        }

        // Index Badge (STT)
        ctx.fillStyle = themeColor;
        ctx.beginPath();
        ctx.arc(x + 10, y + 10, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 18px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        ctx.fillText(i + 1, x + 10, y + 17);

        // Name & Artist
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 22px BeVietnamProBold, NotoEmojiBold, Sans";
        let title = s.title || "No Title";
        if (ctx.measureText(title).width > 420) title = title.substring(0, 25) + "...";
        ctx.fillText(title, x + 105, y + 40);

        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = "18px BeVietnamPro, Sans";
        let artist = s.artistsNames || s.user?.username || "Artist";
        if (ctx.measureText(artist).width > 300) artist = artist.substring(0, 20) + "...";
        const durRaw = s.duration;
        const durStr = typeof durRaw === 'number'
            ? (durRaw > 3600 ? msToTime(durRaw) : msToTime(durRaw * 1000))
            : (durRaw || "00:00");
        ctx.fillText(`${artist}  •  ${durStr}`, x + 105, y + 80);
    }

    // Branding chân trang
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.font = "bold 16px BeVietnamPro, Sans";
    ctx.fillText("POWERED BY LAUNA NA • DGK SYSTEM", width / 2, height - 20);

    return await canvas.toBuffer("png");
}

export async function drawZingSearch(songs, query, sourceName = "ZING MP3") {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const sourceUpper = sourceName.toUpperCase();
    const isScl = sourceUpper === "SOUNDCLOUD";
    const isNct = sourceUpper === "NHACCUATUI";
    const isYt = sourceUpper.includes("YOUTUBE");
    const isSpt = sourceUpper === "SPOTIFY";

    // Theme Colors
    let themeColor = "#8a3ab9"; // Default Zing Purple
    if (isScl) themeColor = "#ff5500"; 
    else if (isNct) themeColor = "#00afea"; 
    else if (isYt) themeColor = "#ff0000"; 
    else if (isSpt) themeColor = "#1DB954"; 

    const width = 1280;
    const height = 720;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Background Phẳng (Dark)
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, width, height);

    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, `${themeColor}33`); // 20% opacity
    bgGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Header & Hướng dẫn
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px BeVietnamProBold, Sans";
    ctx.fillText(sourceUpper.replace(" MUSIC", ""), 50, 80);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "bold 24px BeVietnamProBold, Sans";
    ctx.fillText(`KẾT QUẢ: ${query.toUpperCase()}`, 480, 75);

    // Dòng hướng dẫn quan trọng (In vào Badge Box)
    const instrText = "➜ PHẢN HỒI STT (1-10) ĐỂ TẢI NHẠC";
    ctx.font = "bold 26px BeVietnamProBold, Sans";
    const textWidth = ctx.measureText(instrText).width;
    const badgeW = textWidth + 60;
    const badgeH = 55;
    const badgeX = width - badgeW - 50;
    const badgeY = 45;

    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 15;
    ctx.fillStyle = themeColor;
    drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 20);
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText(instrText, badgeX + (badgeW / 2), badgeY + 36);

    // 3. Grid Setup (2 Cột x 5 Hàng)
    const paddingX = 50;
    const paddingY = 120;
    const itemW = 570;
    const itemH = 100;
    const gapX = 40;
    const gapY = 15;

    // Tải thumbnail song song
    const zingList = songs.slice(0, 10);
    const zingThumbs = await Promise.allSettled(zingList.map(async s => {
        const url = (s.thumbnail || s.thumb || s.artwork_url || "").replace("w94", "w240");
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 4000 });
        return loadImage(Buffer.from(res.data));
    }));

    for (let i = 0; i < zingList.length; i++) {
        const s = zingList[i];
        const col = i >= 5 ? 1 : 0;
        const row = i % 5;
        const x = paddingX + (col * (itemW + gapX));
        const y = paddingY + (row * (itemH + gapY));

        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        drawRoundRect(ctx, x, y, itemW, itemH, 20);
        ctx.fill();

        const zingImg = zingThumbs[i]?.status === 'fulfilled' ? zingThumbs[i].value : null;
        if (zingImg) {
            ctx.save();
            drawRoundRect(ctx, x + 10, y + 10, 80, 80, 15);
            ctx.clip();
            ctx.drawImage(zingImg, x + 10, y + 10, 80, 80);
            ctx.restore();
        }

        ctx.fillStyle = themeColor;
        ctx.beginPath();
        ctx.arc(x + 10, y + 10, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 18px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        ctx.fillText(i + 1, x + 10, y + 17);

        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 22px BeVietnamProBold, NotoEmojiBold, Sans";
        let title = s.title || "No Title";
        if (ctx.measureText(title).width > 420) title = title.substring(0, 25) + "...";
        ctx.fillText(title, x + 105, y + 40);

        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = "18px BeVietnamPro, Sans";
        let artist = s.artistsNames || (s.user ? s.user.username : "Artist");
        if (ctx.measureText(artist).width > 300) artist = artist.substring(0, 20) + "...";

        let duration = "00:00";
        if (s.duration) {
            if (typeof s.duration === 'string' && s.duration.includes(':')) duration = s.duration;
            else duration = msToTime(s.duration * (s.duration > 10000 ? 1 : 1000));
        }
        ctx.fillText(`${artist}  •  ${duration}`, x + 105, y + 80);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.font = "bold 16px BeVietnamPro, Sans";
    ctx.fillText(`POWERED BY HIN NA • ${sourceUpper} SYSTEM`, width / 2, height - 20);

    return await canvas.toBuffer("png");
}


export async function drawZingPlayer(song) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1100;
    const height = 500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const sourceUpper = (song.sourceName || "Zing MP3").toUpperCase();
    const isScl = sourceUpper === "SOUNDCLOUD";
    const isNct = sourceUpper === "NHACCUATUI";
    const isYt = sourceUpper.includes("YOUTUBE");

    let themeColor = "#8a3ab9"; // Default Zing Purple
    let themeColorSecondary = "#5e1a8a";
    if (isScl) {
        themeColor = "#ff5500";
        themeColorSecondary = "#cc4400";
    } else if (isNct) {
        themeColor = "#00afea";
        themeColorSecondary = "#0086b3";
    } else if (isYt) {
        themeColor = "#ff0000";
        themeColorSecondary = "#800000";
    }

    let img = null;
    try {
        const thumbUrl = (song.thumbnail || song.thumb || "").replace("w94", "w500");
        if (thumbUrl && thumbUrl.startsWith("http")) {
            const response = await axios.get(thumbUrl, { responseType: 'arraybuffer', timeout: 5000 });
            img = await loadImage(Buffer.from(response.data));
        }
    } catch (e) { }

    // 1. Vibrant Background Gradient (Platform Specific)
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, themeColorSecondary);
    bgGrad.addColorStop(1, themeColor);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Blur
    if (img) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        ctx.filter = 'blur(60px)';
        ctx.drawImage(img, -100, -100, width + 200, height + 200);
        ctx.restore();
    }

    // 2. Main Card (Dark Glass)
    const cardW = 900;
    const cardH = 360;
    const cardX = (width - cardW) / 2;
    const cardY = (height - cardH) / 2;

    // Card Shadow
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 40;
    ctx.fillStyle = "rgba(15, 15, 20, 0.85)";
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, 35);
    ctx.fill();
    ctx.shadowBlur = 0;

    // 3. Album Art (Rectangular/Square on the left)
    const artSize = cardH; // Flush with top/bottom
    if (img) {
        ctx.save();
        drawRoundRect(ctx, cardX, cardY, artSize, artSize, 35);
        ctx.clip();
        ctx.drawImage(img, cardX, cardY, artSize, artSize);
        ctx.restore();
    } else {
        ctx.fillStyle = "#222";
        drawRoundRect(ctx, cardX, cardY, artSize, artSize, 35);
        ctx.fill();
    }

    // Light border for art to separate from text area
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + artSize, cardY);
    ctx.lineTo(cardX + artSize, cardY + cardH);
    ctx.stroke();

    // 4. Content Area (Right Side)
    const textZoneX = cardX + artSize + 40;
    const textZoneW = cardW - artSize - 80;

    // Platform Name
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "bold 20px BeVietnamProBold, Sans";
    ctx.fillText(sourceUpper, textZoneX, cardY + 60);

    // Divider Line
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(textZoneX, cardY + 75);
    ctx.lineTo(cardX + cardW - 40, cardY + 75);
    ctx.stroke();

    // Song Title (Large, Bold, Uppercase)
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px BeVietnamProBold, NotoEmojiBold, Sans";
    let title = (song.title || "Unknown").toUpperCase();
    if (ctx.measureText(title).width > textZoneW) {
        let truncated = title;
        while (ctx.measureText(truncated + "...").width > textZoneW && truncated.length > 0) truncated = truncated.slice(0, -1);
        title = truncated + "...";
    }
    ctx.fillText(title, textZoneX, cardY + 160);

    // Artist Names
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = "bold 34px BeVietnamProBold, NotoEmojiBold, Sans";
    let artists = (song.artistsNames || "Unknown Artist").toUpperCase();
    if (ctx.measureText(artists).width > textZoneW) {
        let truncated = artists;
        while (ctx.measureText(truncated + "...").width > textZoneW && truncated.length > 0) truncated = truncated.slice(0, -1);
        artists = truncated + "...";
    }
    ctx.fillText(artists, textZoneX, cardY + 220);

    // Metadata / Status
    ctx.fillStyle = themeColor;
    ctx.font = "bold 20px BeVietnamProBold, Sans";
    if (song.processTime) {
        ctx.fillText(`⚡ PROCESSING: ${song.processTime}S`, textZoneX, cardY + 265);
    }

    // Duration (Bottom Right)
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "bold 28px BeVietnamProBold, Sans";
    const durationStr = song.duration ? (typeof song.duration === 'string' ? song.duration : msToTime(song.duration * 1000)) : "00:00";
    ctx.fillText(durationStr, cardX + cardW - 40, cardY + cardH - 40);

    return await canvas.toBuffer("png");
}

export async function drawZingPlaylist(playlistInfo, songs) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const CARD_W = 700;
    const CARD_H = 100;
    const PADDING = 50;
    const HEADER_HEIGHT = 450;
    const FOOTER_HEIGHT = 60;
    const CARD_GAP = 15;

    const width = 800;
    const displaySongs = songs.slice(0, 10);
    const height = HEADER_HEIGHT + (displaySongs.length * (CARD_H + CARD_GAP)) + FOOTER_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#0f172a");
    bgGrad.addColorStop(0.5, "#1e293b");
    bgGrad.addColorStop(1, "#0f172a");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Blur
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath(); ctx.arc(0, 0, 400, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8b5cf6";
    ctx.beginPath(); ctx.arc(width, 500, 400, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // 2. Playlist Header
    let playlistImg = null;
    try {
        const thumbUrl = (playlistInfo.thumbnailM || playlistInfo.thumbnail || "").replace("w165", "w600");
        if (thumbUrl && thumbUrl.startsWith("http")) {
            const response = await axios.get(thumbUrl, { responseType: 'arraybuffer', timeout: 5000 });
            playlistImg = await loadImage(Buffer.from(response.data));

            // Draw blurred background under header
            ctx.save();
            ctx.filter = 'blur(50px)';
            ctx.globalAlpha = 0.4;
            ctx.drawImage(playlistImg, -100, -100, width + 200, HEADER_HEIGHT + 100);
            ctx.restore();
        }
    } catch (e) { }

    // Playlist Thumbnail
    const thumbSize = 240;
    const thumbX = (width - thumbSize) / 2;
    const thumbY = 40;
    if (playlistImg) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.5)";
        ctx.shadowBlur = 30;
        drawRoundRect(ctx, thumbX, thumbY, thumbSize, thumbSize, 25);
        ctx.clip();
        ctx.drawImage(playlistImg, thumbX, thumbY, thumbSize, thumbSize);
        ctx.restore();
    }

    // Playlist Title
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px BeVietnamProBold, NotoEmojiBold, Sans";
    ctx.fillText(playlistInfo.title || "Zing MP3 Playlist", width / 2, thumbY + thumbSize + 55);

    // Playlist Artists/Description
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = "bold 20px BeVietnamPro, Sans";
    const subTitle = playlistInfo.artistsNames || "Zing MP3 Official";
    ctx.fillText(subTitle, width / 2, thumbY + thumbSize + 85);

    // "TOP RANKING" Label
    ctx.fillStyle = "#3b82f6";
    drawRoundRect(ctx, width / 2 - 80, thumbY + thumbSize + 110, 160, 35, 17.5);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 18px BeVietnamProBold, Sans";
    ctx.fillText("BẢNG XẾP HẠNG", width / 2, thumbY + thumbSize + 134);

    // 3. Songs List - tải thumbnail song song
    ctx.textAlign = "left";
    const playlistThumbs = await Promise.allSettled(displaySongs.map(async s => {
        const url = (s.thumbnail || s.thumb || "").replace("w94", "w240");
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 4000 });
        return loadImage(Buffer.from(res.data));
    }));

    for (let i = 0; i < displaySongs.length; i++) {
        const s = displaySongs[i];
        const y = HEADER_HEIGHT + (i * (CARD_H + CARD_GAP));
        const x = (width - CARD_W) / 2;

        // Card
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        drawRoundRect(ctx, x, y, CARD_W, CARD_H, 15);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.stroke();

        // Rank Number & Status
        const rank = i + 1;
        ctx.textAlign = "center";

        // Vẽ số thứ hạng
        ctx.fillStyle = (i < 3) ? (i === 0 ? "#fbbf24" : (i === 1 ? "#94a3b8" : "#92400e")) : "#ffffff";
        ctx.font = "bold 34px BeVietnamProBold, Sans";
        ctx.fillText(rank, x + 40, y + CARD_H / 2 + 5);

        // Vẽ trạng thái tăng/giảm hạng (Vét thông tin từ API)
        const status = s.rakingStatus || 0; // 1: up, -1: down, 0: stable, 2: new
        ctx.font = "bold 14px BeVietnamProBold, Sans";
        if (status === 1) {
            ctx.fillStyle = "#10b981"; // Green
            ctx.fillText("▲ " + (s.lastRank - rank || 1), x + 40, y + CARD_H / 2 + 25);
        } else if (status === -1) {
            ctx.fillStyle = "#ef4444"; // Red
            ctx.fillText("▼ " + (rank - s.lastRank || 1), x + 40, y + CARD_H / 2 + 25);
        } else if (status === 2) {
            ctx.fillStyle = "#3b82f6"; // Blue
            ctx.fillText("NEW", x + 40, y + CARD_H / 2 + 25);
        } else {
            ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
            ctx.fillText("-", x + 40, y + CARD_H / 2 + 25);
        }

        // Song Thumb
        const playlistImg = playlistThumbs[i]?.status === 'fulfilled' ? playlistThumbs[i].value : null;
        if (playlistImg) {
            ctx.save();
            drawRoundRect(ctx, x + 85, y + 10, 80, 80, 12);
            ctx.clip();
            ctx.drawImage(playlistImg, x + 85, y + 10, 80, 80);
            ctx.restore();
        }

        // Info
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 22px BeVietnamProBold, NotoEmojiBold, Sans";
        let title = s.title;
        if (ctx.measureText(title).width > 420) title = title.substring(0, 25) + "...";
        ctx.fillText(title, x + 185, y + 40);

        ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
        ctx.font = "18px BeVietnamPro, Sans";
        let artist = s.artistsNames || "Unknown";
        if (ctx.measureText(artist).width > 420) artist = artist.substring(0, 30) + "...";
        ctx.fillText(artist, x + 185, y + 68);

        // Vét sạch thông tin: Lượt nghe | Điểm (nếu có)
        ctx.fillStyle = "#9deadd";
        ctx.font = "bold 16px BeVietnamPro, Sans";
        let extraInfo = [];
        if (s.listen) extraInfo.push(`🎧 ${s.listen.toLocaleString("vi-VN")}`);
        if (s.score) extraInfo.push(`🔥 ${s.score.toLocaleString("vi-VN")} điểm`);

        ctx.fillText(extraInfo.join("  |  "), x + 185, y + 92);

        // VIP Label
        if (s.streamingStatus === 3 || s.isVIP) {
            ctx.fillStyle = "#fbbf24";
            ctx.font = "bold 14px BeVietnamProBold, Sans";
            ctx.fillText("VIP", x + CARD_W - 50, y + 35);
        }
    }

    return await canvas.toBuffer("png");
}

/**
 * WEATHER CANVAS FUNCTIONS
 */

export async function drawWeatherCard(data) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 800, height = 1250;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#334155");
    bg.addColorStop(1, "#0f172a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const margin = 30;
    const boxBg = "rgba(45, 45, 45, 0.8)";
    const textColor = "#ffffff";

    /** 1. TOP BOX: CURRENT WEATHER **/
    ctx.save();
    drawRoundRect(ctx, margin, margin, width - margin * 2, 280, 40);
    ctx.fillStyle = boxBg;
    ctx.fill();

    ctx.textAlign = "left";
    ctx.fillStyle = textColor;
    ctx.font = "bold 44px BeVietnamProBold, Sans";
    ctx.fillText(data.location.split(",")[0], margin + 30, margin + 70);

    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "bold 26px BeVietnamPro, Sans";
    ctx.fillText("Thời tiết hiện tại", margin + 30, margin + 115);

    ctx.textAlign = "right";
    ctx.fillStyle = textColor;
    ctx.font = "bold 34px BeVietnamPro, Sans";
    ctx.fillText(data.time, width - margin - 30, margin + 70);

    try {
        const icon = await loadImage(data.current.icon);
        ctx.drawImage(icon, margin + 30, margin + 150, 100, 100);
    } catch (e) { }

    ctx.textAlign = "left";
    ctx.font = "bold 90px BeVietnamProBold, Sans";
    ctx.fillText(`${Math.round(data.current.temp)}°`, margin + 150, margin + 225);
    ctx.font = "bold 28px BeVietnamPro, Sans";
    ctx.fillText("C", margin + 255, margin + 195);

    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = "24px BeVietnamPro, Sans";
    ctx.fillText(`RealFeel® ${Math.round(data.current.feelsLike)}°`, margin + 150, margin + 260);
    ctx.fillText(data.current.condition, margin + 30, margin + 270);

    const rightLabelX = width - 280;
    const rightValX = width - margin - 30;
    const rows = [
        { l: "RealFeel Shade™", v: `${Math.round(data.current.temp - 1)}°` },
        { l: "Gió", v: `BTB ${Math.round(data.current.wind)} km/h` },
        { l: "Gió giật mạnh", v: `${Math.round(data.current.windGust)} km/h` },
        { l: "Chất lượng không khí", v: data.current.aqiLevel, c: data.current.aqiLevel === "Tốt" ? "#4ade80" : "#facc15" }
    ];

    rows.forEach((r, i) => {
        const y = margin + 130 + i * 42;
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "22px BeVietnamPro, Sans";
        ctx.fillText(r.l, rightLabelX, y);
        ctx.textAlign = "right";
        ctx.fillStyle = r.c || "#fff";
        ctx.fillText(r.v, rightValX, y);
    });
    ctx.restore();

    /** 2. HOURLY BOX **/
    ctx.save();
    const hourlyY = 340;
    drawRoundRect(ctx, margin, hourlyY, width - margin * 2, 220, 30);
    ctx.fillStyle = boxBg;
    ctx.fill();

    const hourW = (width - margin * 2) / 7;
    for (let i = 0; i < 7; i++) {
        const h = data.hourly[i];
        if (!h) break;
        const x = margin + i * hourW + hourW / 2;

        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "bold 24px BeVietnamPro, Sans";
        ctx.fillText(h.time, x, hourlyY + 45);

        try {
            const icon = await loadImage(h.icon);
            ctx.drawImage(icon, x - 35, hourlyY + 60, 70, 70);
        } catch (e) { }

        ctx.fillStyle = "#fff";
        ctx.font = "bold 26px BeVietnamPro, Sans";
        ctx.fillText(`${Math.round(h.temp)}°`, x, hourlyY + 160);

        ctx.fillStyle = "#93c5fd";
        ctx.font = "18px BeVietnamPro, Sans";
        ctx.fillText(`💧${h.pop}%`, x, hourlyY + 195);
    }
    ctx.restore();

    /** 3. ASTRONOMY & AQI **/
    ctx.save();
    const astroY = 590;
    const colW = (width - margin * 2 - 20) / 4;

    const drawSubBox = (x, y, w, h, icon, title, val1, val2) => {
        drawRoundRect(ctx, x, y, w, h, 20);
        ctx.fillStyle = boxBg;
        ctx.fill();
        ctx.textAlign = "center";
        ctx.fillStyle = "#fbbf24";
        ctx.font = "30px NotoEmoji";
        ctx.fillText(icon, x + w / 2, y + 45);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 22px BeVietnamPro, Sans";
        ctx.fillText(title, x + w / 2, y + 85);
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "18px BeVietnamPro, Sans";
        ctx.fillText(val1, x + w / 2, y + 115);
        ctx.fillText(val2, x + w / 2, y + 145);
    };

    drawSubBox(margin, astroY, colW * 1.5, 220, "☀️", data.astronomy.sunDuration, `Mọc: ${data.astronomy.sunrise}`, `Lặn: ${data.astronomy.sunset}`);
    drawSubBox(margin + colW * 1.5 + 10, astroY, colW * 1.5, 220, "🌕", "Mặt Trăng", `Mọc: ${data.astronomy.moonrise}`, `Lặn: ${data.astronomy.moonset}`);

    const aqiX = margin + colW * 3 + 20;
    const aqiW = (width - margin) - aqiX;
    drawRoundRect(ctx, aqiX, astroY, aqiW, 220, 20);
    ctx.fillStyle = boxBg;
    ctx.fill();
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px BeVietnamPro, Sans";
    ctx.fillText("Chất lượng không khí", aqiX + 20, astroY + 40);
    ctx.fillStyle = data.current.aqiLevel === "Tốt" ? "#4ade80" : "#facc15";
    ctx.fillText(data.current.aqiLevel, aqiX + 20, astroY + 75);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "16px BeVietnamPro, Sans";
    wrapText(ctx, data.current.aqiText, aqiX + 20, astroY + 110, aqiW - 40, 22);
    ctx.restore();

    /** 4. DAILY LIST **/
    ctx.save();
    const dailyY = 840;
    drawRoundRect(ctx, margin, dailyY, width - margin * 2, 320, 30);
    ctx.fillStyle = "rgba(20, 20, 20, 0.4)";
    ctx.fill();

    for (let i = 0; i < data.daily.length; i++) {
        const d = data.daily[i];
        const y = dailyY + 30 + i * 90;
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 24px BeVietnamPro, Sans";
        ctx.fillText(d.date, margin + 20, y + 15);
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "18px BeVietnamPro, Sans";
        ctx.fillText(d.dayName, margin + 20, y + 45);

        try {
            const icon = await loadImage(d.icon);
            ctx.drawImage(icon, margin + 100, y - 5, 70, 70);
        } catch (e) { }

        ctx.fillStyle = "#fff";
        ctx.font = "bold 32px BeVietnamPro, Sans";
        ctx.fillText(`${Math.round(d.high)}°`, margin + 180, y + 25);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "24px BeVietnamPro, Sans";
        ctx.fillText(`${Math.round(d.low)}°`, margin + 250, y + 25);

        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "20px BeVietnamPro, Sans";
        const summary = d.condition;
        ctx.fillText(summary, margin + 330, y + 15);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillText(summary, margin + 330, y + 45);

        ctx.textAlign = "right";
        ctx.fillStyle = "#93c5fd";
        ctx.font = "bold 24px BeVietnamPro, Sans";
        ctx.fillText(`${d.pop}% 💧`, width - margin - 30, y + 25);

        if (i < data.daily.length - 1) {
            ctx.strokeStyle = "rgba(255,255,255,0.05)";
            ctx.beginPath(); ctx.moveTo(margin + 20, y + 75); ctx.lineTo(width - margin - 20, y + 75); ctx.stroke();
        }
    }
    ctx.restore();

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "italic 18px BeVietnamPro, Sans";
    ctx.fillText("Hệ thống Hin Na - Dự báo thời tiết thông minh v4.5", width / 2, height - 35);

    return await canvas.toBuffer("png");
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(" ");
    let line = "";
    for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + " ";
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;
        if (testWidth > maxWidth && n > 0) {
            ctx.fillText(line, x, y);
            line = words[n] + " ";
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    ctx.fillText(line, x, y);
}

/**
 * USER INFO CANVAS
 */
export async function drawUserInfo({ displayName, username, avatar, bio, onlineStatus, fields = [] }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 800, height = 420;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#0f172a");
    bgGrad.addColorStop(1, "#1e293b");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath(); ctx.arc(0, 0, 350, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8b5cf6";
    ctx.beginPath(); ctx.arc(width, height, 300, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // Avatar
    const avX = 80, avY = 80, avR = 80;
    let avImg = null;
    try {
        if (avatar && avatar.startsWith("http")) {
            const res = await axios.get(avatar, { responseType: 'arraybuffer', timeout: 5000 });
            avImg = await loadImage(Buffer.from(res.data));
        }
    } catch (e) { }

    // Glow ring
    const statusColor = onlineStatus === "online" ? "#10b981" : "#94a3b8";
    ctx.shadowColor = statusColor; ctx.shadowBlur = 20;
    ctx.strokeStyle = statusColor; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(avX, avY, avR + 5, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;

    if (avImg) {
        ctx.save();
        ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(avImg, avX - avR, avY - avR, avR * 2, avR * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = "#334155";
        ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.fill();
    }

    // Online dot
    ctx.fillStyle = statusColor;
    ctx.beginPath(); ctx.arc(avX + avR * 0.7, avY + avR * 0.7, 14, 0, Math.PI * 2); ctx.fill();

    // Name & Username
    const textX = avX + avR + 40;
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 36px BeVietnamProBold, NotoEmojiBold, Sans";
    ctx.fillText(displayName || "Zalo User", textX, 65);

    if (username) {
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "20px BeVietnamPro, Sans";
        ctx.fillText(`@${username}`, textX, 95);
    }

    if (bio) {
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "italic 18px BeVietnamPro, Sans";
        ctx.fillText(bio.substring(0, 60), textX, 125);
    }

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(40, 180); ctx.lineTo(width - 40, 180); ctx.stroke();

    // Fields Grid (2 columns)
    const colW = (width - 80) / 2;
    fields.forEach((f, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const fx = 40 + col * colW;
        const fy = 210 + row * 65;

        ctx.fillStyle = "rgba(255,255,255,0.05)";
        drawRoundRect(ctx, fx, fy, colW - 15, 50, 12);
        ctx.fill();

        ctx.fillStyle = "#60a5fa";
        ctx.font = "bold 20px NotoEmojiBold, BeVietnamPro, Sans";
        ctx.textAlign = "left";
        ctx.fillText(f.icon || "▸", fx + 12, fy + 32);

        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "bold 15px BeVietnamPro, Sans";
        ctx.fillText(f.label, fx + 40, fy + 18);

        ctx.fillStyle = "#fff";
        ctx.font = "bold 18px BeVietnamProBold, Sans";
        ctx.fillText(String(f.value || "—").substring(0, 28), fx + 40, fy + 36);
    });

    return await canvas.toBuffer("png");
}

/**
 * MIXCLOUD CANVAS FUNCTIONS
 */
export async function drawMcSearch(results, query) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const CARD_H = 130, CARD_GAP = 18, PADDING = 40;
    const width = 800, height = 150 + (results.length * (CARD_H + CARD_GAP)) + 90;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#0a0a1a"); bg.addColorStop(1, "#1a1a2e");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#ff6b35";
    ctx.beginPath(); ctx.arc(width, 0, 280, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6b35";
    ctx.font = "bold 42px BeVietnamProBold, Sans";
    ctx.shadowColor = "#ff6b35"; ctx.shadowBlur = 15;
    ctx.fillText("MIXCLOUD", width / 2, 75);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "20px BeVietnamPro, Sans";
    ctx.fillText(`"${query}"`, width / 2, 112);

    // Tải thumbnail song song
    const mcThumbs = await Promise.allSettled(results.map(async r => {
        const url = r.picture_url || r.thumbnail || "";
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 4000 });
        return loadImage(Buffer.from(res.data));
    }));

    ctx.textAlign = "left";
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const y = 140 + i * (CARD_H + CARD_GAP);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        drawRoundRect(ctx, PADDING, y, width - PADDING * 2, CARD_H, 18);
        ctx.fill();
        ctx.strokeStyle = "rgba(255,107,53,0.2)"; ctx.stroke();

        const mcImg = mcThumbs[i]?.status === 'fulfilled' ? mcThumbs[i].value : null;
        if (mcImg) {
            ctx.save();
            drawRoundRect(ctx, PADDING + 12, y + 12, 106, 106, 12); ctx.clip();
            ctx.drawImage(mcImg, PADDING + 12, y + 12, 106, 106);
            ctx.restore();
        } else {
            ctx.fillStyle = "#333"; drawRoundRect(ctx, PADDING + 12, y + 12, 106, 106, 12); ctx.fill();
        }

        const tx = PADDING + 135;
        ctx.fillStyle = "#fff"; ctx.font = "bold 24px BeVietnamProBold, NotoEmojiBold, Sans";
        let name = (r.name || "Unknown").substring(0, 30);
        ctx.fillText(name, tx, y + 42);

        ctx.fillStyle = "#ff6b35"; ctx.font = "bold 18px BeVietnamPro, Sans";
        ctx.fillText(r.user?.name || r.artist || "Unknown", tx, y + 72);

        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "16px BeVietnamPro, Sans";
        const dur = r.duration ? `⏱️ ${Math.floor(r.duration / 60)}:${String(Math.floor(r.duration % 60)).padStart(2, '0')}` : "";
        ctx.fillText(dur, tx, y + 100);

        ctx.fillStyle = "#ff6b35";
        ctx.beginPath(); ctx.arc(width - PADDING - 30, y + CARD_H / 2, 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 18px BeVietnamPro, Sans"; ctx.textAlign = "center";
        ctx.fillText(i + 1, width - PADDING - 30, y + CARD_H / 2 + 7);
        ctx.textAlign = "left";
    }

    ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "italic 18px BeVietnamPro, Sans";
    ctx.fillText(`➜ Trả lời 1-${results.length} để tải nhạc`, width / 2, height - 35);
    return await canvas.toBuffer("png");
}

export async function drawMcPlayer(track) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 800, height = 260;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    let img = null;
    try {
        const thumbUrl = track.picture_url || track.thumbnail || "";
        if (thumbUrl.startsWith("http")) {
            const res = await axios.get(thumbUrl, { responseType: 'arraybuffer', timeout: 5000 });
            img = await loadImage(Buffer.from(res.data));
        }
    } catch (e) { }

    if (img) {
        ctx.save(); ctx.filter = 'blur(40px) brightness(0.5)';
        const sc = Math.max(width / img.width, height / img.height);
        ctx.drawImage(img, (width - img.width * sc) / 2, (height - img.height * sc) / 2, img.width * sc, img.height * sc);
        ctx.restore();
        ctx.fillStyle = "rgba(10,10,20,0.78)"; ctx.fillRect(0, 0, width, height);
    } else {
        const bg = ctx.createLinearGradient(0, 0, width, height);
        bg.addColorStop(0, "#0a0a1a"); bg.addColorStop(1, "#1a1a2e");
        ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);
    }

    ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fillRect(0, 0, width, 40);
    ctx.fillStyle = "#ff6b35"; ctx.font = "bold 18px BeVietnamProBold, Sans"; ctx.textAlign = "center";
    ctx.fillText("MIXCLOUD", width / 2, 27);

    const cx = 150, cy = 147, r = 88;
    ctx.shadowColor = "#ff6b35"; ctx.shadowBlur = 20;
    ctx.strokeStyle = "rgba(255,107,53,0.5)"; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;

    if (img) {
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2); ctx.restore();
    } else {
        ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    }

    ctx.fillStyle = "#ff6b35"; ctx.beginPath(); ctx.arc(cx, cy, 28, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.beginPath();
    ctx.moveTo(cx - 5, cy - 9); ctx.lineTo(cx + 9, cy); ctx.lineTo(cx - 5, cy + 9);
    ctx.closePath(); ctx.fill();

    const tx = cx + r + 40; let cY = cy - 60;
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff"; ctx.font = "bold 28px BeVietnamProBold, NotoEmojiBold, Sans";
    let title = (track.name || "Unknown").substring(0, 28);
    ctx.fillText(title, tx, cY); cY += 42;
    ctx.fillStyle = "#ff6b35"; ctx.font = "bold 22px BeVietnamProBold, Sans";
    ctx.fillText(track.user?.name || track.artist || "Unknown", tx, cY); cY += 38;
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "20px BeVietnamPro, Sans";
    const durStr = track.duration ? `⏱️ ${Math.floor(track.duration / 60)}:${String(Math.floor(track.duration % 60)).padStart(2, '0')}` : "⏱️ --:--";
    ctx.fillText(durStr, tx, cY);

    const barY = height - 38, barW = 340, barH = 6;
    ctx.fillStyle = "rgba(255,255,255,0.1)"; drawRoundRect(ctx, tx, barY, barW, barH, 3); ctx.fill();
    ctx.fillStyle = "#ff6b35"; drawRoundRect(ctx, tx, barY, barW * 0.4, barH, 3); ctx.fill();

    return await canvas.toBuffer("png");
}

/**
 * TIKTOK CANVAS FUNCTION
 */
export async function drawTikTokSearch(videos, title = "TIKTOK") {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const CARD_H = 130, CARD_GAP = 16, PADDING = 40;
    const width = 800, height = 150 + (videos.length * (CARD_H + CARD_GAP)) + 90;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#0d0d0d"); bg.addColorStop(1, "#1a0a1a");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#69c9d0";
    ctx.beginPath(); ctx.arc(0, 0, 250, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ee1d52";
    ctx.beginPath(); ctx.arc(width, height, 250, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    ctx.textAlign = "center";
    ctx.shadowColor = "#ee1d52"; ctx.shadowBlur = 20;
    ctx.fillStyle = "#fff"; ctx.font = "bold 40px BeVietnamProBold, Sans";
    ctx.fillText(title.toUpperCase().substring(0, 40), width / 2, 75);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "18px BeVietnamPro, Sans";
    ctx.fillText(`${videos.length} kết quả`, width / 2, 110);

    // Tải thumbnail song song
    const ttThumbs = await Promise.allSettled(videos.map(async v => {
        const url = v.origin_cover || v.cover || "";
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 4000 });
        return loadImage(Buffer.from(res.data));
    }));

    ctx.textAlign = "left";
    for (let i = 0; i < videos.length; i++) {
        const v = videos[i];
        const y = 140 + i * (CARD_H + CARD_GAP);
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        drawRoundRect(ctx, PADDING, y, width - PADDING * 2, CARD_H, 18);
        ctx.fill();
        ctx.strokeStyle = "rgba(238,29,82,0.2)"; ctx.stroke();

        const ttImg = ttThumbs[i]?.status === 'fulfilled' ? ttThumbs[i].value : null;
        if (ttImg) {
            ctx.save();
            drawRoundRect(ctx, PADDING + 10, y + 10, 110, 110, 12); ctx.clip();
            ctx.drawImage(ttImg, PADDING + 10, y + 10, 110, 110);
            ctx.restore();
        } else {
            ctx.fillStyle = "#222"; drawRoundRect(ctx, PADDING + 10, y + 10, 110, 110, 12); ctx.fill();
        }

        const tx = PADDING + 135;
        ctx.fillStyle = "#fff"; ctx.font = "bold 22px BeVietnamProBold, NotoEmojiBold, Sans";
        let vTitle = (v.title || "Không tiêu đề").substring(0, 32);
        ctx.fillText(vTitle, tx, y + 38);

        ctx.fillStyle = "#69c9d0"; ctx.font = "bold 17px BeVietnamPro, Sans";
        ctx.fillText(`@${v.author?.unique_id || v.author?.uniqueId || "unknown"}`, tx, y + 62);

        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "15px BeVietnamPro, NotoEmojiBold, Sans";
        const likes = v.digg_count ? `❤️ ${(+v.digg_count).toLocaleString("vi-VN")}` : "";
        const dur = v.duration ? `⏱️ ${v.duration}s` : "";
        ctx.fillText([likes, dur].filter(Boolean).join("  |  "), tx, y + 90);

        const badgeColors = ["#ee1d52", "#ff6b35", "#fbbf24", "#10b981", "#3b82f6", "#8b5cf6"];
        ctx.fillStyle = badgeColors[i % badgeColors.length];
        ctx.beginPath(); ctx.arc(width - PADDING - 28, y + CARD_H / 2, 20, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = "bold 18px BeVietnamPro, Sans"; ctx.textAlign = "center";
        ctx.fillText(i + 1, width - PADDING - 28, y + CARD_H / 2 + 7);
        ctx.textAlign = "left";
    }

    ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "italic 17px BeVietnamPro, Sans";
    ctx.fillText(`➜ Phản hồi số 1-${videos.length} để tải video`, width / 2, height - 35);
    return await canvas.toBuffer("png");
}

/**
 * PREMIUM WELCOME / GOODBYE CANVAS FUNCTIONS
 */

export async function drawWelcome(userInfo, groupName = "nhóm", approverName = "", joinTime = "") {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1100, height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // LUXURY DESIGN SYSTEM
    const themeColor = "#00f2ea"; // Cyan/Neon Blue
    const themeColorSecondary = "#ff0050"; // Pink/Red

    // 1. Vibrant Animated-style Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#0a0a0f");
    bgGrad.addColorStop(0.5, "#1a1a2e");
    bgGrad.addColorStop(1, "#0a0a0f");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Blur / Glows
    let avatarImg = null;
    try {
        const avUrl = (userInfo.avatar_251 || userInfo.avatar || userInfo.avatar_25 || "").replace("w94", "w500");
        if (avUrl.startsWith("http")) {
            const res = await axios.get(avUrl, { responseType: 'arraybuffer', timeout: 5000 });
            avatarImg = await loadImage(Buffer.from(res.data));

            ctx.save();
            ctx.globalAlpha = 0.3;
            ctx.filter = "blur(50px)";
            ctx.drawImage(avatarImg, -100, -100, width + 200, height + 200);
            ctx.restore();
        }
    } catch (e) { }

    // Modern Neon Blobs
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = themeColor;
    ctx.beginPath(); ctx.arc(0, 0, 400, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = themeColorSecondary;
    ctx.beginPath(); ctx.arc(width, height, 400, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // 2. Main Glassmorphism Card
    const cardMargin = 40;
    const cardW = width - (cardMargin * 2);
    const cardH = height - (cardMargin * 2);
    const cardX = cardMargin;
    const cardY = cardMargin;

    // Card Shadow
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 30;
    ctx.fillStyle = "rgba(15, 15, 25, 0.8)";
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, 40);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Card Glass Border
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 3. Avatar on the left
    const avR = 100;
    const avX = cardX + 40 + avR;
    const avY = cardY + cardH / 2;

    // Outer Neon Ring
    ctx.shadowColor = themeColor;
    ctx.shadowBlur = 20;
    ctx.strokeStyle = themeColor;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(avX, avY, avR + 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (avatarImg) {
        ctx.save();
        ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(avatarImg, avX - avR, avY - avR, avR * 2, avR * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = "#334155";
        ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.fill();
    }

    // Inner White Border
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.stroke();

    // 4. Content Area
    const textX = avX + avR + 50;
    const centerT = cardY + cardH / 2;

    // User Name (Multicolor / Large)
    ctx.textAlign = "left";
    ctx.font = "bold 52px BeVietnamProBold, NotoEmojiBold, Sans";
    const displayName = (userInfo.displayName || userInfo.zaloName || "THÀNH VIÊN MỚI").toUpperCase();

    // Gradient text for name
    const nGrad = ctx.createLinearGradient(textX, 0, textX + ctx.measureText(displayName).width, 0);
    nGrad.addColorStop(0, themeColorSecondary);
    nGrad.addColorStop(1, themeColor);
    ctx.fillStyle = nGrad;
    ctx.fillText(displayName, textX, centerT - 50);

    // Divider
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(textX, centerT - 35);
    ctx.lineTo(cardX + cardW - 60, centerT - 35);
    ctx.stroke();

    // Join Message
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px BeVietnamProBold, Sans";
    const statusText = `✓ Đã tham gia vào `;
    ctx.fillText(statusText, textX, centerT + 20);

    const groupText = groupName.toUpperCase();
    ctx.fillStyle = themeColor;
    ctx.fillText(groupText, textX + ctx.measureText(statusText).width, centerT + 20);

    // Approver / Approval Info
    if (approverName) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        ctx.font = "bold 24px BeVietnamPro, Sans";
        ctx.fillText(`Duyệt bởi: ${approverName}`, textX, centerT + 65);
    }

    // Footer Slogan
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    ctx.font = "italic 22px BeVietnamPro, Sans";
    ctx.fillText("✨ Gặp nhau là duyên, đồng hành là nghĩa ✨", cardX + cardW / 2 + avR, cardY + cardH - 30);

    // Extra Tag (e.g. Join Date)
    if (joinTime) {
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "bold 16px BeVietnamPro, Sans";
        ctx.fillText(`📅 ${joinTime}`, cardX + 30, height - 15);
    }

    return await canvas.toBuffer("png");
}

export async function drawGoodbye(userInfo, groupName = "nhóm") {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1100, height = 400;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themeColor = "#fbbf24"; // Amber/Gold
    const themeColorSecondary = "#ef4444"; // Red/Danger

    // Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#0c0a09");
    bgGrad.addColorStop(0.5, "#1c1917");
    bgGrad.addColorStop(1, "#0c0a09");
    ctx.fillStyle = bgGrad; ctx.fillRect(0, 0, width, height);

    // Glows
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = themeColorSecondary;
    ctx.beginPath(); ctx.arc(width, 0, 400, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    const cardMargin = 40;
    const cardW = width - (cardMargin * 2), cardH = height - (cardMargin * 2);
    const cardX = cardMargin, cardY = cardMargin;

    ctx.fillStyle = "rgba(24, 24, 27, 0.9)";
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, 40);
    ctx.fill();

    // Avatar on the left (Grayscale-ish)
    const avR = 100, avX = cardX + 40 + avR, avY = cardY + cardH / 2;
    try {
        const avUrl = (userInfo.avatar_251 || userInfo.avatar || userInfo.avatar_25 || "").replace("w94", "w500");
        if (avUrl.startsWith("http")) {
            const res = await axios.get(avUrl, { responseType: 'arraybuffer', timeout: 5000 });
            const img = await loadImage(Buffer.from(res.data));
            ctx.save();
            ctx.filter = "grayscale(80%) brightness(0.7)";
            ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(img, avX - avR, avY - avR, avR * 2, avR * 2);
            ctx.restore();
        }
    } catch (e) {
        ctx.fillStyle = "#27272a";
        ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.fill();
    }

    ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(avX, avY, avR + 5, 0, Math.PI * 2); ctx.stroke();

    // Content
    const textX = avX + avR + 50;
    const centerT = cardY + cardH / 2;

    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px BeVietnamProBold, NotoEmojiBold, Sans";
    const name = (userInfo.displayName || userInfo.zaloName || "THÀNH VIÊN").toUpperCase();
    ctx.fillText(name, textX, centerT - 40);

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "bold 34px BeVietnamProBold, Sans";
    ctx.fillText("HẸN GẶP LẠI BẠN VÀO MỘT NGÀY KHÁC 🕊️", textX, centerT + 20);

    ctx.fillStyle = themeColorSecondary;
    ctx.font = "bold 24px BeVietnamPro, Sans";
    ctx.fillText(`Vừa rời khỏi ${groupName.toUpperCase()}`, textX, centerT + 70);

    return await canvas.toBuffer("png");
}

/**
 * TAI XIU CANVAS FUNCTION
 */
export async function drawTaiXiu(dices, total, result, betInfoText) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 600, height = 500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Luxury Dark Background
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#0a0a1a");
    bgGrad.addColorStop(1, "#1a1a2e");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Blur
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = result === "tai" ? "#fbbf24" : "#10b981";
    ctx.beginPath(); ctx.arc(width / 2, height / 2, 200, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // Header
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 32px BeVietnamProBold, Sans";
    ctx.fillText("🎲 TÀI XỈU LUXURY 🎲", width / 2, 60);

    // Dices Section
    const diceIcons = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
    const gap = 120;
    const startX = width / 2 - gap;

    ctx.font = "bold 100px Sans";
    dices.forEach((d, i) => {
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        drawRoundRect(ctx, startX + i * gap - 50, 120, 100, 100, 20);
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(diceIcons[d], startX + i * gap, 200);
    });

    // Total & Result
    ctx.font = "bold 40px BeVietnamProBold, Sans";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(`${dices.join(" + ")} = ${total}`, width / 2, 260);

    // Big Result Text
    ctx.font = "bold 80px BeVietnamProBold, Sans";
    ctx.fillStyle = result === "tai" ? "#fbbf24" : "#10b981";
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 20;
    ctx.fillText(result.toUpperCase(), width / 2, 350);
    ctx.shadowBlur = 0;

    // Bet Info Text Box
    ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
    drawRoundRect(ctx, 40, 380, width - 80, 80, 15);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.stroke();

    ctx.font = "20px BeVietnamPro, Sans";
    ctx.fillStyle = "#ffffff";
    wrapText(ctx, betInfoText, width / 2, 420, width - 120, 25);

    return await canvas.toBuffer("png");
}

/**
 * CAPCUT SEARCH CANVAS FUNCTION
 */
export async function drawCapCutSearch(templates, query) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const CARD_W = 540;
    const CARD_H = 140;
    const PADDING = 130;
    const HEADER_HEIGHT = 150;
    const FOOTER_HEIGHT = 100;
    const CARD_GAP = 20;

    const width = 800;
    const height = HEADER_HEIGHT + (templates.length * (CARD_H + CARD_GAP)) + FOOTER_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Luxury Dark Background 
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#000000");
    bgGrad.addColorStop(0.5, "#0f172a");
    bgGrad.addColorStop(1, "#000000");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Glows
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#ff0050"; // CapCut Pink
    ctx.beginPath(); ctx.arc(0, 0, 300, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#00f2ea"; // CapCut Cyan
    ctx.beginPath(); ctx.arc(width, height, 300, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // Title
    ctx.textAlign = "center";
    ctx.shadowColor = "#ff0050";
    ctx.shadowBlur = 15;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px BeVietnamProBold, Sans";
    ctx.fillText("CAPCUT SEARCH", width / 2, 75);
    ctx.shadowBlur = 0;

    ctx.font = "22px BeVietnamPro, Sans";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(`“${query}”`, width / 2, 115);

    // Tải thumbnail song song
    const ccThumbs = await Promise.allSettled(templates.map(async t => {
        const url = t.cover_url || t.cover || (t.video_template?.cover_url) || "";
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 4000 });
        return loadImage(Buffer.from(res.data));
    }));

    ctx.textAlign = "left";
    for (let i = 0; i < templates.length; i++) {
        const t = templates[i];
        const y = HEADER_HEIGHT + (i * (CARD_H + CARD_GAP));
        const x = PADDING;

        // Card
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        drawRoundRect(ctx, x, y, CARD_W, CARD_H, 20);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.stroke();

        // Thumbnail
        const ccImg = ccThumbs[i]?.status === 'fulfilled' ? ccThumbs[i].value : null;
        if (ccImg) {
            ctx.save();
            drawRoundRect(ctx, x + 15, y + 15, 110, 110, 15);
            ctx.clip();
            ctx.drawImage(ccImg, x + 15, y + 15, 110, 110);
            ctx.restore();
        } else {
            ctx.fillStyle = "#222";
            drawRoundRect(ctx, x + 15, y + 15, 110, 110, 15);
            ctx.fill();
        }

        const titleX = x + 145;
        // Title
        ctx.fillStyle = "#fff";
        ctx.font = "bold 24px BeVietnamProBold, Sans";
        let title = t.title || "No Title";
        if (ctx.measureText(title).width > CARD_W - 180) title = title.substring(0, 25) + "...";
        ctx.fillText(title, titleX, y + 50);

        // Author
        ctx.fillStyle = "#00f2ea";
        ctx.font = "bold 18px BeVietnamPro, Sans";
        const author = t.author?.name || "Unknown Author";
        ctx.fillText(`👤 ${author}`, titleX, y + 85);

        // Stats
        ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
        ctx.font = "16px BeVietnamPro, Sans";
        const usage = t.usage_amount ? (t.usage_amount / 1000).toFixed(1) + "k dùng" : "Hot";
        const duration = t.duration ? (t.duration / 1000).toFixed(1) + "s" : "";
        ctx.fillText(`🔥 ${usage}  |  ⏱️ ${duration}`, titleX, y + 115);

        // Badge Number
        ctx.fillStyle = "#ff0050";
        ctx.beginPath();
        ctx.arc(x + CARD_W - 40, y + CARD_H / 2, 22, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 20px BeVietnamPro, Sans";
        ctx.textAlign = "center";
        ctx.fillText(i + 1, x + CARD_W - 40, y + CARD_H / 2 + 7);
        ctx.textAlign = "left";
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "italic 20px BeVietnamPro, Sans";
    ctx.fillText(`➜ Phản hồi số 1-${templates.length} để tải video`, width / 2, height - 40);

    return await canvas.toBuffer("png");
}


/**
 * GROUP CARD INFO CANVAS (with member avatars & group bg)
 */
export async function drawGroupCard({ groupName, groupId, avatar, memberCount, creatorName, createdTime, description, settings = [], memberAvatarUrls = [] }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 800, height = 750;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Background: Dark base
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "#0b0e1a");
    bgGrad.addColorStop(0.4, "#131835");
    bgGrad.addColorStop(1, "#0b0e1a");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // 2. Group Avatar as BLURRED BACKGROUND (top area)
    let groupAvImg = null;
    try {
        if (avatar && avatar.startsWith("http")) {
            const res = await axios.get(avatar, { responseType: 'arraybuffer', timeout: 5000 });
            groupAvImg = await loadImage(Buffer.from(res.data));
        }
    } catch (e) { }

    if (groupAvImg) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.filter = 'blur(40px)';
        ctx.drawImage(groupAvImg, -50, -50, width + 100, 320);
        ctx.restore();
    }

    // Decorative Glow
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#6366f1";
    ctx.beginPath(); ctx.arc(0, 0, 350, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ec4899";
    ctx.beginPath(); ctx.arc(width, height, 300, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // 3. Top Card
    const headerGrad = ctx.createLinearGradient(0, 0, width, 0);
    headerGrad.addColorStop(0, "rgba(99, 102, 241, 0.25)");
    headerGrad.addColorStop(0.5, "rgba(236, 72, 153, 0.15)");
    headerGrad.addColorStop(1, "rgba(6, 182, 212, 0.25)");
    ctx.fillStyle = headerGrad;
    drawRoundRect(ctx, 30, 25, width - 60, 200, 25);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();

    // Group Avatar (sharp, circular)
    const avX = 130, avY = 125, avR = 60;
    ctx.shadowColor = "#6366f1";
    ctx.shadowBlur = 25;
    ctx.strokeStyle = "#6366f1";
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(avX, avY, avR + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;

    if (groupAvImg) {
        ctx.save();
        ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(groupAvImg, avX - avR, avY - avR, avR * 2, avR * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = "#1e1b4b";
        ctx.beginPath(); ctx.arc(avX, avY, avR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#6366f1";
        ctx.font = "bold 40px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        ctx.fillText("G", avX, avY + 14);
    }

    // 4. Group Name & ID
    const textX = avX + avR + 35;
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px BeVietnamProBold, NotoEmojiBold, Sans";
    let displayName = groupName || "Nhóm không tên";
    const maxNameW = width - textX - 60;
    if (ctx.measureText(displayName).width > maxNameW) {
        while (ctx.measureText(displayName + "...").width > maxNameW && displayName.length > 0) displayName = displayName.slice(0, -1);
        displayName += "...";
    }
    ctx.fillText(displayName, textX, avY - 15);

    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "16px BeVietnamPro, Sans";
    ctx.fillText("ID: " + (groupId || "N/A"), textX, avY + 15);

    // Member Badge
    ctx.fillStyle = "#6366f1";
    drawRoundRect(ctx, textX, avY + 28, 150, 32, 16);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px BeVietnamProBold, Sans";
    ctx.fillText("  " + (memberCount || "?") + " thành viên", textX + 14, avY + 50);

    // 5. MEMBER AVATARS ROW
    const memRowY = 250;
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    drawRoundRect(ctx, 30, memRowY, width - 60, 100, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.stroke();

    ctx.fillStyle = "#a5b4fc";
    ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.textAlign = "left";
    ctx.fillText("THÀNH VIÊN", 55, memRowY + 22);

    const memAvSize = 42;
    const memOverlap = 14;
    const memStartX = 55;
    const memY = memRowY + 40;
    const maxDisplay = Math.min(memberAvatarUrls.length, 14);

    // Tải avatar thành viên song song
    const memAvatars = await Promise.allSettled(memberAvatarUrls.slice(0, maxDisplay).map(async url => {
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 3000 });
        return loadImage(Buffer.from(res.data));
    }));

    for (let i = 0; i < maxDisplay; i++) {
        const mx = memStartX + i * (memAvSize - memOverlap);
        const mImg = memAvatars[i]?.status === 'fulfilled' ? memAvatars[i].value : null;

        // Dark border ring
        ctx.fillStyle = "#131835";
        ctx.beginPath(); ctx.arc(mx + memAvSize / 2, memY + memAvSize / 2, memAvSize / 2 + 2, 0, Math.PI * 2); ctx.fill();

        if (mImg) {
            ctx.save();
            ctx.beginPath(); ctx.arc(mx + memAvSize / 2, memY + memAvSize / 2, memAvSize / 2, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(mImg, mx, memY, memAvSize, memAvSize);
            ctx.restore();
        } else {
            const colors = ["#6366f1", "#ec4899", "#06b6d4", "#10b981", "#f59e0b", "#ef4444"];
            ctx.fillStyle = colors[i % colors.length];
            ctx.beginPath(); ctx.arc(mx + memAvSize / 2, memY + memAvSize / 2, memAvSize / 2, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.font = "bold 16px BeVietnamProBold, Sans";
            ctx.textAlign = "center";
            ctx.fillText(String(i + 1), mx + memAvSize / 2, memY + memAvSize / 2 + 6);
            ctx.textAlign = "left";
        }
    }

    // "+N more" badge
    if (memberCount > maxDisplay) {
        const moreX = memStartX + maxDisplay * (memAvSize - memOverlap);
        ctx.fillStyle = "rgba(99, 102, 241, 0.6)";
        ctx.beginPath(); ctx.arc(moreX + memAvSize / 2, memY + memAvSize / 2, memAvSize / 2, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        ctx.fillText("+" + (memberCount - maxDisplay), moreX + memAvSize / 2, memY + memAvSize / 2 + 5);
        ctx.textAlign = "left";
    }

    // 6. Info Section
    const infoY = 370;
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    drawRoundRect(ctx, 30, infoY, width - 60, 140, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.stroke();

    const infoFields = [
        { icon: "👑", label: "Người tạo", value: creatorName || "Không rõ" },
        { icon: "📅", label: "Ngày tạo", value: createdTime || "Không rõ" },
        { icon: "📝", label: "Mô tả", value: (description || "Không có mô tả").substring(0, 40) },
    ];

    const colW = (width - 80) / 2;
    infoFields.forEach((f, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const fx = 50 + col * colW;
        const fy = infoY + 20 + row * 60;

        ctx.fillStyle = "rgba(99, 102, 241, 0.15)";
        drawRoundRect(ctx, fx, fy, colW - 20, 48, 12);
        ctx.fill();

        ctx.textAlign = "left";
        ctx.fillStyle = "#a5b4fc";
        ctx.font = "bold 18px NotoEmojiBold, BeVietnamPro, Sans";
        ctx.fillText(f.icon, fx + 12, fy + 32);

        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "13px BeVietnamPro, Sans";
        ctx.fillText(f.label, fx + 40, fy + 18);

        ctx.fillStyle = "#fff";
        ctx.font = "bold 16px BeVietnamProBold, Sans";
        const maxValW = colW - 80;
        let val = String(f.value);
        if (ctx.measureText(val).width > maxValW) val = val.substring(0, 25) + "...";
        ctx.fillText(val, fx + 40, fy + 38);
    });

    // 7. Settings Section
    const settingsY = 530;
    ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
    drawRoundRect(ctx, 30, settingsY, width - 60, 170, 20);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.stroke();

    ctx.fillStyle = "#a5b4fc";
    ctx.font = "bold 18px BeVietnamProBold, Sans";
    ctx.textAlign = "left";
    ctx.fillText("CÀI ĐẶT NHÓM", 55, settingsY + 30);

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath(); ctx.moveTo(50, settingsY + 42); ctx.lineTo(width - 50, settingsY + 42); ctx.stroke();

    const defaultSettings = [
        { label: "Anti-Link", value: "OFF", color: "#94a3b8" },
        { label: "Anti-Spam", value: "OFF", color: "#94a3b8" },
        { label: "Auto Reply", value: "ON", color: "#10b981" },
        { label: "Auto React", value: "OFF", color: "#94a3b8" },
    ];

    const displaySettings = settings.length > 0 ? settings : defaultSettings;
    const sColW = (width - 100) / displaySettings.length;

    displaySettings.forEach((s, i) => {
        const sx = 50 + i * sColW;
        const sy = settingsY + 55;

        ctx.fillStyle = s.value === "ON" ? "rgba(16, 185, 129, 0.15)" : "rgba(148, 163, 184, 0.1)";
        drawRoundRect(ctx, sx, sy, sColW - 15, 90, 15);
        ctx.fill();

        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "13px BeVietnamPro, Sans";
        ctx.fillText(s.label, sx + (sColW - 15) / 2, sy + 32);

        ctx.fillStyle = s.color || (s.value === "ON" ? "#10b981" : "#94a3b8");
        ctx.font = "bold 24px BeVietnamProBold, Sans";
        ctx.fillText(s.value, sx + (sColW - 15) / 2, sy + 68);
    });

    // 8. Footer
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.font = "italic 14px BeVietnamPro, Sans";
    ctx.fillText("✦ Hin Na System ✦", width / 2, height - 15);

    return await canvas.toBuffer("png");
}


export async function drawNoitu({ word, description, points, timeLeft, historyCount, skipsLeft, nextLetter, botAvatar, userName }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 800, height = 500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Background Gradient
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#1e3a8a"); // Blue-900
    bg.addColorStop(1, "#1e40af"); // Blue-800
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Subtle Grid Pattern
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let i = 0; i < width; i += 40) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke();
    }
    for (let i = 0; i < height; i += 40) {
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(width, i); ctx.stroke();
    }

    // 2. Header
    ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
    ctx.fillRect(0, 0, width, 80);
    
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 34px BeVietnamProBold, Sans";
    ctx.textAlign = "left";
    ctx.fillText("NỐI TỪ VTV 🎮", 30, 52);

    // Stats on Header
    ctx.textAlign = "right";
    ctx.font = "bold 22px BeVietnamPro, Sans";
    ctx.fillStyle = "#fbbf24"; // Gold
    ctx.fillText(`Điểm: ${points}  |  Lượt: ${historyCount}  |  Bỏ qua: ${skipsLeft}/3`, width - 30, 50);

    // 3. Main Content Card
    const cardX = 30, cardY = 100, cardW = 740, cardH = 300;
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    drawRoundRect(ctx, cardX, cardY, cardW, cardH, 25);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.stroke();

    // 4. Timer Bar
    const timerW = (timeLeft / 30) * (cardW - 40);
    ctx.fillStyle = timeLeft > 10 ? "#10b981" : "#ef4444";
    drawRoundRect(ctx, cardX + 20, cardY + 20, Math.max(0, timerW), 10, 5);
    ctx.fill();

    // 5. Central Word
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 60px BeVietnamProBold, Sans";
    ctx.fillText(word.toUpperCase(), width / 2, cardY + 120);

    // Description text wrapping
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = "italic 20px BeVietnamPro, Sans";
    wrapText(ctx, description || "Đang cập nhật định nghĩa...", width / 2, cardY + 170, cardW - 100, 28);

    // 6. Next Character Instruction
    ctx.fillStyle = "#facc15";
    ctx.font = "bold 30px BeVietnamProBold, Sans";
    ctx.fillText(`HÃY Nối: ${nextLetter.toUpperCase()} ...`, width / 2, cardY + 260);

    // 7. Footer
    ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    ctx.fillRect(0, height - 60, width, 60);
    
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "16px BeVietnamPro, Sans";
    ctx.fillText("HD: Nhắn từ 2 chữ cái để nối. Nhắn '!noitu skip' để bỏ qua.", 30, height - 25);

    return await canvas.toBuffer("png");
}

export async function drawVtv({ jumbled, points, timeLeft, round, userName, avatar }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 800, height = 500;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Luxury Dark/Yellow Theme (VTV colors)
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#1a1a1a");
    bg.addColorStop(1, "#333333");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Yellow border
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 15;
    ctx.strokeRect(0, 0, width, height);

    // Header
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(15, 15, width - 30, 80);
    
    ctx.fillStyle = "#000";
    ctx.font = "bold 40px BeVietnamProBold, Sans";
    ctx.textAlign = "center";
    ctx.fillText("VUA TIẾNG VIỆT 🇻🇳", width / 2, 70);

    // Main Content
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px BeVietnamPro, Sans";
    ctx.fillText(`VÒNG ${round}: NHẬN DIỆN`, width / 2, 160);

    // Jumbled Word Box
    const boxW = 600, boxH = 120;
    const boxX = (width - boxW) / 2, boxY = 190;
    ctx.fillStyle = "rgba(251, 191, 36, 0.1)";
    drawRoundRect(ctx, boxX, boxY, boxW, boxH, 20);
    ctx.fill();
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 60px BeVietnamProBold, Sans";
    ctx.fillText(jumbled.toUpperCase(), width / 2, boxY + 80);

    // Timer and Info
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.font = "bold 28px BeVietnamProBold, Sans";
    ctx.textAlign = "left";
    ctx.fillText(`⏳ ${timeLeft}s`, boxX + 20, boxY + boxH + 60);
    ctx.textAlign = "right";
    ctx.fillText(`🏆 Điểm: ${points}`, width - boxX - 20, boxY + boxH + 60);

    // Footer
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "italic 18px BeVietnamPro, Sans";
    ctx.fillText("Hãy sắp xếp các chữ cái trên thành một từ có nghĩa!", width / 2, height - 50);

    return await canvas.toBuffer("png");
}

/**
 * MOVIE CANVAS FUNCTIONS
 */

export async function drawMovieSearch(movies, query) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1280, height = 720;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themeColor = "#e50914";
    const goldColor = "#f5c518";

    ctx.fillStyle = "#0d0d0d";
    ctx.fillRect(0, 0, width, height);

    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, "rgba(229,9,20,0.18)");
    bgGrad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = themeColor;
    ctx.fillRect(0, 0, 6, height);

    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 54px BeVietnamProBold, Sans";
    ctx.fillText("🎬 PHIM", 30, 70);

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "bold 22px BeVietnamProBold, Sans";
    ctx.fillText(`KẾT QUẢ: ${query.toUpperCase()}`, 220, 65);

    const instrText = "➜ PHẢN HỒI STT (1-5) ĐỂ XEM CHI TIẾT";
    ctx.font = "bold 22px BeVietnamProBold, Sans";
    const instrW = ctx.measureText(instrText).width + 50;
    ctx.fillStyle = themeColor;
    drawRoundRect(ctx, width - instrW - 30, 35, instrW, 48, 24);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(instrText, width - instrW / 2 - 30, 66);

    const POSTER_W = 90, POSTER_H = 110;
    const CARD_W = 1200, CARD_H = 110;
    const startX = 40, startY = 100, GAP = 16;

    // Tải poster phim song song
    const movieList = movies.slice(0, 5);
    const moviePosters = await Promise.allSettled(movieList.map(async m => {
        const url = m.thumb_url || m.poster_url || "";
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 4000 });
        return loadImage(Buffer.from(res.data));
    }));

    for (let i = 0; i < movieList.length; i++) {
        const m = movieList[i];
        const y = startY + i * (CARD_H + GAP);

        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)";
        drawRoundRect(ctx, startX, y, CARD_W, CARD_H, 18);
        ctx.fill();

        const movieImg = moviePosters[i]?.status === 'fulfilled' ? moviePosters[i].value : null;
        if (movieImg) {
            ctx.save();
            drawRoundRect(ctx, startX + 10, y + (CARD_H - POSTER_H) / 2, POSTER_W, POSTER_H, 12);
            ctx.clip();
            ctx.drawImage(movieImg, startX + 10, y + (CARD_H - POSTER_H) / 2, POSTER_W, POSTER_H);
            ctx.restore();
        } else {
            ctx.fillStyle = "#1a1a1a";
            drawRoundRect(ctx, startX + 10, y + (CARD_H - POSTER_H) / 2, POSTER_W, POSTER_H, 12);
            ctx.fill();
        }

        ctx.fillStyle = themeColor;
        ctx.beginPath();
        ctx.arc(startX + 10, y + (CARD_H - POSTER_H) / 2 + 18, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 16px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        ctx.fillText(i + 1, startX + 10, y + (CARD_H - POSTER_H) / 2 + 24);

        const tx = startX + POSTER_W + 25;
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 26px BeVietnamProBold, NotoEmojiBold, Sans";
        let title = m.name || m.origin_name || "Không có tên";
        if (ctx.measureText(title).width > 700) title = title.substring(0, 35) + "...";
        ctx.fillText(title, tx, y + 38);

        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "18px BeVietnamPro, Sans";
        let originName = m.origin_name || "";
        if (ctx.measureText(originName).width > 500) originName = originName.substring(0, 40) + "...";
        ctx.fillText(originName, tx, y + 65);

        ctx.fillStyle = goldColor;
        ctx.font = "bold 16px BeVietnamProBold, Sans";
        const tags = [];
        if (m.year) tags.push(`📅 ${m.year}`);
        if (m.quality) tags.push(`🎞️ ${m.quality}`);
        if (m.lang) tags.push(`🌐 ${m.lang}`);
        if (m.episode_current) tags.push(`📺 ${m.episode_current}`);
        ctx.fillText(tags.join("   "), tx, y + 93);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "bold 15px BeVietnamPro, Sans";
    ctx.fillText("POWERED BY HIN NA • DGK SYSTEM • OPHIM API", width / 2, height - 12);

    return await canvas.toBuffer("png");
}

/**
 * UPTIME CARD
 */
export async function drawUptimeCard(data) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1100, height = 560;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themeColor = "#00c6ff";
    const themeSecondary = "#0072ff";
    const greenColor = "#00e676";
    const warnColor = "#ff9800";

    // Background gradient
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#0a0f1e");
    bg.addColorStop(1, "#0d1b35");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Decorative glow top-left
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 400);
    glow.addColorStop(0, "rgba(0,198,255,0.15)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Left accent bar
    const barGrad = ctx.createLinearGradient(0, 0, 0, height);
    barGrad.addColorStop(0, themeColor);
    barGrad.addColorStop(1, themeSecondary);
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, 0, 6, height);

    // Header
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px BeVietnamProBold, Sans";
    ctx.fillText("SYSTEM UPTIME", 30, 72);

    ctx.fillStyle = "rgba(0,198,255,0.7)";
    ctx.font = "bold 20px BeVietnamProBold, Sans";
    ctx.fillText("MiZai v2.0.0  •  BOT LAUNA", 30, 100);

    // Divider
    ctx.strokeStyle = "rgba(0,198,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 115);
    ctx.lineTo(width - 30, 115);
    ctx.stroke();

    // Left column - System info
    const leftX = 30;
    let ly = 155;
    const lineH = 46;
    const labelColor = "rgba(255,255,255,0.5)";
    const valueColor = "#ffffff";

    function drawInfoRow(label, value, x, y, highlight = false) {
        ctx.textAlign = "left";
        ctx.font = "18px BeVietnamPro, Sans";
        ctx.fillStyle = labelColor;
        ctx.fillText(label, x, y);
        ctx.font = "bold 22px BeVietnamProBold, Sans";
        ctx.fillStyle = highlight ? themeColor : valueColor;
        ctx.fillText(value, x, y + 24);
    }

    drawInfoRow("THOI GIAN HIEN TAI", data.vnTime, leftX, ly);
    ly += lineH + 10;
    drawInfoRow("KHOI DONG LUC", data.startTime, leftX, ly);
    ly += lineH + 10;
    drawInfoRow("THOI GIAN HOAT DONG", data.uptimeStr, leftX, ly, true);
    ly += lineH + 10;
    drawInfoRow("SO LAN RESTART", `${data.restartCount} lan`, leftX, ly);
    ly += lineH + 10;
    drawInfoRow("PHIEN BAN NODE.JS", data.nodeVer, leftX, ly);

    // Right column
    const rightX = 580;
    let ry = 155;

    drawInfoRow("PING API", `${data.pingMs}ms`, rightX, ry, true);
    ry += lineH + 10;
    drawInfoRow("SO LENH HOAT DONG", `${data.cmdCount} lenh`, rightX, ry);
    ry += lineH + 10;
    drawInfoRow("PREFIX BOT", data.prefix, rightX, ry);
    ry += lineH + 10;
    drawInfoRow("HE DIEU HANH", data.platform, rightX, ry);
    ry += lineH + 10;
    drawInfoRow("IP NOI BO", data.localIP, rightX, ry);

    // CPU Bar
    const barY = 440;
    const barW = 460;
    const barH = 28;
    const barRadius = 14;

    // CPU Label
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "bold 18px BeVietnamProBold, Sans";
    ctx.fillText(`CPU  ${data.cpuModel}`, leftX, barY - 8);

    // CPU bar BG
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    drawRoundRect(ctx, leftX, barY, barW, barH, barRadius);
    ctx.fill();

    // CPU bar fill
    const cpuFill = Math.max(4, (data.cpuPct / 100) * barW);
    const cpuGrad = ctx.createLinearGradient(leftX, 0, leftX + barW, 0);
    cpuGrad.addColorStop(0, themeColor);
    cpuGrad.addColorStop(1, themeSecondary);
    ctx.fillStyle = cpuGrad;
    drawRoundRect(ctx, leftX, barY, cpuFill, barH, barRadius);
    ctx.fill();

    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 16px BeVietnamProBold, Sans";
    ctx.fillText(`${data.cpuPct}%`, leftX + barW, barY - 8);

    // RAM Bar
    const ramY = barY + 55;
    const ramFillColor = data.ramWarning ? warnColor : greenColor;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "bold 18px BeVietnamProBold, Sans";
    ctx.fillText(`RAM  ${data.usedMem}MB / ${data.totalMem}MB`, leftX, ramY - 8);

    ctx.fillStyle = "rgba(255,255,255,0.1)";
    drawRoundRect(ctx, leftX, ramY, barW, barH, barRadius);
    ctx.fill();

    const ramFill = Math.max(4, (data.ramPct / 100) * barW);
    const ramGrad = ctx.createLinearGradient(leftX, 0, leftX + barW, 0);
    ramGrad.addColorStop(0, ramFillColor);
    ramGrad.addColorStop(1, data.ramWarning ? "#ff5252" : "#00bfa5");
    ctx.fillStyle = ramGrad;
    drawRoundRect(ctx, leftX, ramY, ramFill, barH, barRadius);
    ctx.fill();

    ctx.textAlign = "right";
    ctx.fillStyle = data.ramWarning ? warnColor : "#fff";
    ctx.font = "bold 16px BeVietnamProBold, Sans";
    ctx.fillText(`${data.ramPct}%${data.ramWarning ? " ⚠" : ""}`, leftX + barW, ramY - 8);

    // Footer
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "bold 15px BeVietnamPro, Sans";
    ctx.fillText("POWERED BY HIN NA  •  DGK SYSTEM  •  MIZAI v2.0.0", width / 2, height - 14);

    return await canvas.toBuffer("png");
}

/**
 * WON CARD — Tỷ giá KRW → VND, cùng style uptime card
 * @param {{
 *   krwAmount?: number,
 *   rate: number,
 *   changeData: {pct:number}|null,
 *   chartRates: number[],
 *   predicted: number|null,
 *   updatedAt: string
 * }} opts
 */
export async function drawWonCard({ krwAmount, rate, changeData, chartRates, predicted, updatedAt }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1100, height = 520;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themeColor     = "#00c6ff";
    const themeSecondary = "#0072ff";
    const greenColor     = "#00e676";
    const redColor       = "#ff5252";
    const labelColor     = "rgba(255,255,255,0.5)";
    const isConvert      = krwAmount != null;

    // ── Helpers ──────────────────────────────────────────────────────────
    const fV = n => Math.round(n).toLocaleString("vi-VN");

    // ── Background gradient ──────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#0a0f1e");
    bg.addColorStop(1, "#0d1b35");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Decorative glow top-left
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 400);
    glow.addColorStop(0, "rgba(0,198,255,0.15)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // ── Left accent bar ───────────────────────────────────────────────────
    const accentBar = ctx.createLinearGradient(0, 0, 0, height);
    accentBar.addColorStop(0, themeColor);
    accentBar.addColorStop(1, themeSecondary);
    ctx.fillStyle = accentBar;
    ctx.fillRect(0, 0, 6, height);

    // ── Header ────────────────────────────────────────────────────────────
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 52px BeVietnamProBold, Sans";
    ctx.fillText("TY GIA WON", 30, 72);

    ctx.fillStyle = "rgba(0,198,255,0.7)";
    ctx.font = "bold 20px BeVietnamProBold, Sans";
    const subtitle = isConvert
        ? `${Math.round(krwAmount).toLocaleString("vi-VN")} KRW  →  VND  •  AI Prediction`
        : "Won (KRW)  →  VND  •  Realtime + AI Prediction";
    ctx.fillText(subtitle, 30, 100);

    // Divider
    ctx.strokeStyle = "rgba(0,198,255,0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 115);
    ctx.lineTo(width - 30, 115);
    ctx.stroke();

    // ── drawInfoRow ────────────────────────────────────────────────────────
    const LINE_H = 46;
    function drawInfoRow(label, value, x, y, highlight = false, customColor = null) {
        ctx.textAlign = "left";
        ctx.font = "18px BeVietnamPro, Sans";
        ctx.fillStyle = labelColor;
        ctx.fillText(label, x, y);
        ctx.font = "bold 22px BeVietnamProBold, Sans";
        ctx.fillStyle = customColor || (highlight ? themeColor : "#ffffff");
        ctx.fillText(value, x, y + 24);
    }

    // ── Left column ────────────────────────────────────────────────────────
    const leftX = 30;
    let ly = 155;

    drawInfoRow("TY GIA HIEN TAI", `${rate.toFixed(2)} VND / KRW`, leftX, ly, true);
    ly += LINE_H + 10;

    // Change row (custom color)
    const chgStr   = changeData
        ? (changeData.pct >= 0 ? `+${changeData.pct.toFixed(2)}%  ▲` : `${changeData.pct.toFixed(2)}%  ▼`)
        : "Chua du lieu";
    const chgColor = changeData ? (changeData.pct >= 0 ? greenColor : redColor) : labelColor;
    drawInfoRow("THAY DOI 24 GIO", chgStr, leftX, ly, false, chgColor);
    ly += LINE_H + 10;

    drawInfoRow("1.000 KRW",    `${fV(rate * 1_000)} VND`,     leftX, ly);
    ly += LINE_H + 10;
    drawInfoRow("10.000 KRW",   `${fV(rate * 10_000)} VND`,    leftX, ly);
    ly += LINE_H + 10;
    drawInfoRow("100.000 KRW",  `${fV(rate * 100_000)} VND`,   leftX, ly);

    // ── Right column ──────────────────────────────────────────────────────
    const rightX = 580;
    let ry = 155;

    if (isConvert) {
        const vnd = rate * krwAmount;

        drawInfoRow("SO TIEN NHAP", `${fV(krwAmount)} KRW`, rightX, ry);
        ry += LINE_H + 10;

        // Big result
        ctx.textAlign = "left";
        ctx.font = "18px BeVietnamPro, Sans";
        ctx.fillStyle = labelColor;
        ctx.fillText("KET QUA QUY DOI", rightX, ry);
        ctx.font = "bold 30px BeVietnamProBold, Sans";
        ctx.fillStyle = themeColor;
        ctx.fillText(`${fV(vnd)} VND`, rightX, ry + 32);
        ry += LINE_H + 22;

        // AI prediction
        if (predicted !== null) {
            const diff     = predicted - rate;
            const aiColor  = diff >= 0 ? greenColor : redColor;
            const aiSym    = diff >= 0 ? "▲ tang" : "▼ giam";
            drawInfoRow("AI DU DOAN GIO TOI", `${aiSym}  →  ${predicted.toFixed(2)} VND/KRW`, rightX, ry, false, aiColor);
            ry += LINE_H + 10;
        } else {
            ry += LINE_H + 10;
        }

        drawInfoRow("1 TRIEU KRW", `${fV(rate * 1_000_000)} VND`, rightX, ry);
        ry += LINE_H + 10;
        drawInfoRow("CAP NHAT", updatedAt, rightX, ry);
    } else {
        drawInfoRow("50.000 KRW",    `${fV(rate * 50_000)} VND`,    rightX, ry);
        ry += LINE_H + 10;
        drawInfoRow("500.000 KRW",   `${fV(rate * 500_000)} VND`,   rightX, ry);
        ry += LINE_H + 10;
        drawInfoRow("1 TRIEU KRW",   `${fV(rate * 1_000_000)} VND`, rightX, ry);
        ry += LINE_H + 10;

        if (predicted !== null) {
            const diff    = predicted - rate;
            const aiColor = diff >= 0 ? greenColor : redColor;
            const aiSym   = diff >= 0 ? "▲ tang" : "▼ giam";
            drawInfoRow("AI DU DOAN GIO TOI", `${aiSym}  →  ${predicted.toFixed(2)} VND/KRW`, rightX, ry, false, aiColor);
        }
        ry += LINE_H + 10;
        drawInfoRow("CAP NHAT", updatedAt, rightX, ry);
    }

    // ── Line chart (bottom, full-width, same bar area as uptime) ──────────
    const chartY = 405;
    const chartH = 68;
    const chartX = 30;
    const chartW = width - 60;

    if (chartRates && chartRates.length >= 2) {
        const vals   = chartRates;
        const rawMin = Math.min(...vals);
        const rawMax = Math.max(...vals);
        const pad    = (rawMax - rawMin) * 0.2 || 0.01;
        const yMin   = rawMin - pad;
        const yMax   = rawMax + pad;

        const toX = i => chartX + (i / (vals.length - 1)) * chartW;
        const toY = r => chartY + chartH - ((r - yMin) / (yMax - yMin)) * chartH;

        // Label
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "bold 14px BeVietnamProBold, Sans";
        ctx.fillText(`BIEU DO TY GIA  ${vals.length}H GAN NHAT`, chartX, chartY - 10);

        // Chart bg
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        drawRoundRect(ctx, chartX, chartY, chartW, chartH, 4);
        ctx.fill();

        // Grid lines
        for (let i = 0; i <= 2; i++) {
            const gy = chartY + (chartH / 2) * i;
            ctx.strokeStyle = "rgba(255,255,255,0.05)";
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(chartX, gy);
            ctx.lineTo(chartX + chartW, gy);
            ctx.stroke();
        }

        // Fill gradient
        const grad = ctx.createLinearGradient(0, chartY, 0, chartY + chartH);
        grad.addColorStop(0, "rgba(0,198,255,0.3)");
        grad.addColorStop(1, "rgba(0,198,255,0.0)");
        ctx.beginPath();
        ctx.moveTo(toX(0), chartY + chartH);
        vals.forEach((r, i) => ctx.lineTo(toX(i), toY(r)));
        ctx.lineTo(toX(vals.length - 1), chartY + chartH);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();

        // Line
        ctx.beginPath();
        ctx.strokeStyle = themeColor;
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        vals.forEach((r, i) => i === 0 ? ctx.moveTo(toX(i), toY(r)) : ctx.lineTo(toX(i), toY(r)));
        ctx.stroke();

        // Predicted dashed extension
        if (predicted !== null) {
            const predColor = predicted > rate ? greenColor : redColor;
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = predColor;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(toX(vals.length - 1), toY(vals[vals.length - 1]));
            ctx.lineTo(toX(vals.length - 1) + (chartW / vals.length), toY(predicted));
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Last point dot
        ctx.beginPath();
        ctx.arc(toX(vals.length - 1), toY(vals[vals.length - 1]), 4, 0, Math.PI * 2);
        ctx.fillStyle = themeColor;
        ctx.fill();

        // Axis labels
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.font = "11px BeVietnamPro, Sans";
        ctx.textAlign = "right";
        ctx.fillText(yMax.toFixed(2), chartX - 5, chartY + 12);
        ctx.fillText(yMin.toFixed(2), chartX - 5, chartY + chartH);
        ctx.textAlign = "left";
        ctx.fillText(`${vals.length}h truoc`, chartX, chartY + chartH + 14);
        ctx.textAlign = "right";
        ctx.fillText("Hien tai", chartX + chartW, chartY + chartH + 14);
        ctx.textAlign = "left";

    } else {
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        drawRoundRect(ctx, chartX, chartY, chartW, chartH, 4);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.font = "16px BeVietnamPro, Sans";
        ctx.textAlign = "center";
        ctx.fillText("Chua co du lieu bieu do — se hien thi sau khi tich luy them gio", chartX + chartW / 2, chartY + chartH / 2 + 6);
        ctx.textAlign = "left";
    }

    // ── Footer ────────────────────────────────────────────────────────────
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "bold 15px BeVietnamPro, Sans";
    ctx.fillText("POWERED BY HIN NA  •  DGK SYSTEM  •  WON AI v4.4", width / 2, height - 14);

    return await canvas.toBuffer("png");
}

/**
 * MAIL CARD
 */
export async function drawMailCard({ email, action, content = "" }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1000, height = 380;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themeColor = "#1a73e8";
    const themeSecondary = "#0d47a1";
    const accentColor = "#4fc3f7";

    // Background
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#050c1a");
    bg.addColorStop(1, "#0a1628");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Glow
    const glow = ctx.createRadialGradient(width, 0, 0, width, 0, 500);
    glow.addColorStop(0, "rgba(26,115,232,0.15)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    // Left accent bar
    const barGrad = ctx.createLinearGradient(0, 0, 0, height);
    barGrad.addColorStop(0, themeColor);
    barGrad.addColorStop(1, accentColor);
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, 0, 6, height);

    // Header icon area
    ctx.fillStyle = "rgba(26,115,232,0.2)";
    drawRoundRect(ctx, 25, 25, 80, 80, 20);
    ctx.fill();
    ctx.fillStyle = themeColor;
    ctx.font = "bold 48px BeVietnamProBold, NotoEmojiBold, Sans";
    ctx.textAlign = "center";
    ctx.fillText("@", 65, 79);

    // Title
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 46px BeVietnamProBold, Sans";
    ctx.fillText("TEMP MAIL", 120, 68);

    ctx.fillStyle = accentColor;
    ctx.font = "bold 18px BeVietnamProBold, Sans";
    const actionLabel = action === "new" ? "EMAIL MOI DA TAO" : action === "check" ? "HOP THU DEN" : action === "del" ? "DA XOA EMAIL" : "THONG TIN EMAIL";
    ctx.fillText(actionLabel, 120, 95);

    // Divider
    ctx.strokeStyle = "rgba(26,115,232,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(25, 115);
    ctx.lineTo(width - 25, 115);
    ctx.stroke();

    // Email address box
    const boxY = 135;
    ctx.fillStyle = "rgba(26,115,232,0.15)";
    drawRoundRect(ctx, 25, boxY, width - 50, 80, 18);
    ctx.fill();

    ctx.strokeStyle = "rgba(26,115,232,0.4)";
    ctx.lineWidth = 1.5;
    drawRoundRect(ctx, 25, boxY, width - 50, 80, 18);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 32px BeVietnamProBold, Sans";
    let emailDisplay = email || "";
    if (ctx.measureText(emailDisplay).width > width - 100) {
        emailDisplay = emailDisplay.substring(0, 35) + "...";
    }
    ctx.fillText(emailDisplay, width / 2, boxY + 50);

    // Content area
    if (content) {
        const lines = content.split("\n").filter(Boolean).slice(0, 3);
        let cy = 250;
        ctx.textAlign = "left";
        for (const line of lines) {
            ctx.fillStyle = line.startsWith("•") || line.startsWith("✓") ? accentColor : "rgba(255,255,255,0.7)";
            ctx.font = "18px BeVietnamPro, Sans";
            let l = line;
            if (ctx.measureText(l).width > width - 60) l = l.substring(0, 58) + "...";
            ctx.fillText(l, 30, cy);
            cy += 30;
        }
    } else {
        // Default commands hint
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "18px BeVietnamPro, Sans";
        ctx.fillText(".tempmail check  —  kiem tra hop thu", 30, 255);
        ctx.fillText(".tempmail read <so>  —  doc thu", 30, 283);
        ctx.fillText(".tempmail del  —  xoa email", 30, 311);
    }

    // Footer
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "bold 14px BeVietnamPro, Sans";
    ctx.fillText("POWERED BY HIN NA  •  TEMP-MAIL.IO  •  DGK SYSTEM", width / 2, height - 14);

    return await canvas.toBuffer("png");
}

export async function drawMovieDetail(movie, episodes) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1100, height = 600;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themeColor = "#e50914";
    const goldColor = "#f5c518";

    let posterImg = null;
    try {
        const posterUrl = movie.poster_url || movie.thumb_url || "";
        if (posterUrl.startsWith("http")) {
            const res = await axios.get(posterUrl, { responseType: 'arraybuffer', timeout: 6000 });
            posterImg = await loadImage(Buffer.from(res.data));
        }
    } catch (e) { }

    if (posterImg) {
        ctx.save();
        ctx.filter = "blur(55px) brightness(0.35)";
        const sc = Math.max(width / posterImg.width, height / posterImg.height);
        ctx.drawImage(posterImg, (width - posterImg.width * sc) / 2, (height - posterImg.height * sc) / 2, posterImg.width * sc, posterImg.height * sc);
        ctx.restore();
    } else {
        const bg = ctx.createLinearGradient(0, 0, width, height);
        bg.addColorStop(0, "#1a0000");
        bg.addColorStop(1, "#0d0d0d");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
    }

    ctx.fillStyle = "rgba(10,10,10,0.65)";
    ctx.fillRect(0, 0, width, height);

    const POSTER_W = 220, POSTER_H = 320;
    const posterX = 40, posterY = (height - POSTER_H) / 2;

    if (posterImg) {
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.8)";
        ctx.shadowBlur = 30;
        drawRoundRect(ctx, posterX, posterY, POSTER_W, POSTER_H, 18);
        ctx.clip();
        ctx.drawImage(posterImg, posterX, posterY, POSTER_W, POSTER_H);
        ctx.restore();
    } else {
        ctx.fillStyle = "#222";
        drawRoundRect(ctx, posterX, posterY, POSTER_W, POSTER_H, 18);
        ctx.fill();
    }

    const tx = posterX + POSTER_W + 40;
    const contentW = width - tx - 30;
    let cY = 60;

    ctx.textAlign = "left";
    ctx.fillStyle = goldColor;
    ctx.font = "bold 16px BeVietnamProBold, Sans";
    const tags2 = [movie.year, movie.quality, movie.lang].filter(Boolean).join("  •  ");
    ctx.fillText(tags2, tx, cY); cY += 32;

    ctx.fillStyle = "#fff";
    ctx.font = "bold 42px BeVietnamProBold, NotoEmojiBold, Sans";
    let mtitle = movie.name || "Không có tên";
    while (ctx.measureText(mtitle).width > contentW && mtitle.length > 5) mtitle = mtitle.slice(0, -1);
    if ((movie.name || "").length > mtitle.length) mtitle += "...";
    ctx.fillText(mtitle, tx, cY); cY += 46;

    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "20px BeVietnamPro, Sans";
    let origin = movie.origin_name || "";
    if (ctx.measureText(origin).width > contentW) origin = origin.substring(0, 45) + "...";
    ctx.fillText(origin, tx, cY); cY += 36;

    ctx.strokeStyle = "rgba(229,9,20,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tx, cY); ctx.lineTo(tx + contentW, cY); ctx.stroke();
    cY += 20;

    if (movie.content) {
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = "17px BeVietnamPro, NotoEmojiBold, Sans";
        const maxChars = 200;
        const desc = movie.content.replace(/<[^>]+>/g, "");
        const trimmed = desc.length > maxChars ? desc.substring(0, maxChars) + "..." : desc;
        const words = trimmed.split(" ");
        let line = "", lineY = cY;
        for (const w of words) {
            const test = line + w + " ";
            if (ctx.measureText(test).width > contentW && line !== "") {
                ctx.fillText(line, tx, lineY);
                line = w + " ";
                lineY += 24;
                if (lineY > cY + 96) { ctx.fillText(line + "...", tx, lineY); break; }
            } else { line = test; }
        }
        if (line && lineY <= cY + 96) ctx.fillText(line, tx, lineY);
        cY = lineY + 32;
    }

    ctx.fillStyle = themeColor;
    ctx.font = "bold 18px BeVietnamProBold, Sans";
    const epHint = episodes.length > 1 ? `📺 ${episodes.length} tập — phản hồi số tập để tải` : `📺 Phim lẻ — phản hồi "1" để tải`;
    ctx.fillText(epHint, tx, cY); cY += 30;

    const COLS = 10, EPW = 58, EPH = 34, EGAP = 8;
    let epX = tx, epY2 = cY;
    for (let i = 0; i < Math.min(episodes.length, 50); i++) {
        if (i > 0 && i % COLS === 0) { epX = tx; epY2 += EPH + EGAP; }
        ctx.fillStyle = "rgba(229,9,20,0.75)";
        drawRoundRect(ctx, epX, epY2, EPW, EPH, 8);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 15px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        const epName = episodes[i].name || `${i + 1}`;
        ctx.fillText(epName.length > 4 ? (i + 1) : epName, epX + EPW / 2, epY2 + EPH / 2 + 5);
        ctx.textAlign = "left";
        epX += EPW + EGAP;
    }

    if (episodes.length > 50) {
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "15px BeVietnamPro, Sans";
        ctx.fillText(`... và ${episodes.length - 50} tập khác`, tx, epY2 + EPH + EGAP + 18);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "bold 14px BeVietnamPro, Sans";
    ctx.fillText("POWERED BY HIN NA • DGK SYSTEM • OPHIM API", width / 2, height - 12);

    return await canvas.toBuffer("png");
}

/**
 * SHARE FILE BROWSER CANVAS
 */
export async function drawShareBrowser(dirPath, items, totalCount, page = 1, totalPages = 1) {
    await ensureCanvas();
    if (!canvasAvailable) return null;

    function fmtSize(bytes) {
        if (bytes == null) return "";
        if (bytes >= 1073741824) return (bytes / 1073741824).toFixed(2) + " GB";
        if (bytes >= 1048576)    return (bytes / 1048576).toFixed(2) + " MB";
        if (bytes >= 1024)       return (bytes / 1024).toFixed(1) + " KB";
        return bytes + " B";
    }

    const PADDING   = 40;
    const HEADER_H  = 140;
    const ITEM_H    = 54;
    const ITEM_GAP  = 8;
    const FOOTER_H  = 64;
    const displayItems = items.slice(0, 20);
    const width  = 920;
    const height = HEADER_H + (displayItems.length * (ITEM_H + ITEM_GAP)) + FOOTER_H + PADDING;

    const canvas = createCanvas(width, height);
    const ctx    = canvas.getContext("2d");

    // Background
    const bg = ctx.createLinearGradient(0, 0, 0, height);
    bg.addColorStop(0, "#0f172a");
    bg.addColorStop(1, "#1e293b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Decorative blobs
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath(); ctx.arc(0, 0, 300, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8b5cf6";
    ctx.beginPath(); ctx.arc(width, height, 280, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // Header bar
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    drawRoundRect(ctx, PADDING, 18, width - PADDING * 2, HEADER_H - 18, 18);
    ctx.fill();

    ctx.textAlign = "left";
    ctx.fillStyle = "#60a5fa";
    ctx.font = "bold 32px BeVietnamProBold, Sans";
    ctx.fillText("📂 FILE BROWSER", PADDING + 20, 62);

    // Page badge (top-right)
    if (totalPages > 1) {
        const badge = `Trang ${page} / ${totalPages}`;
        ctx.textAlign = "right";
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 16px BeVietnamProBold, Sans";
        ctx.fillText(badge, width - PADDING - 16, 62);
        ctx.textAlign = "left";
    }

    const folderName = dirPath.length > 65 ? "..." + dirPath.slice(-62) : dirPath;
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "15px BeVietnamPro, Sans";
    ctx.fillText(folderName, PADDING + 20, 92);

    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.font = "bold 14px BeVietnamPro, Sans";
    ctx.fillText(`${totalCount} mục  •  Hiển thị ${displayItems.length}  •  Trang ${page}/${totalPages}`, PADDING + 20, 118);

    // Items list
    for (let i = 0; i < displayItems.length; i++) {
        const item   = displayItems[i];
        const y      = HEADER_H + PADDING / 2 + i * (ITEM_H + ITEM_GAP);
        const isDir  = item.isDir;
        const idxNum = item.index ?? (i + 1);

        // Card background
        ctx.fillStyle = isDir ? "rgba(59,130,246,0.13)" : "rgba(255,255,255,0.05)";
        drawRoundRect(ctx, PADDING, y, width - PADDING * 2, ITEM_H, 12);
        ctx.fill();
        if (isDir) {
            ctx.strokeStyle = "rgba(59,130,246,0.35)";
            ctx.lineWidth   = 1;
            ctx.stroke();
        }

        // Index badge
        ctx.fillStyle = isDir ? "#3b82f6" : "#64748b";
        ctx.beginPath(); ctx.arc(PADDING + 24, y + ITEM_H / 2, 17, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font      = "bold 13px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        ctx.fillText(String(idxNum), PADDING + 24, y + ITEM_H / 2 + 5);

        // Icon + Name
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font      = "bold 19px BeVietnamProBold, NotoEmojiBold, Sans";
        const icon = isDir ? "📁" : "📄";
        let name = item.name;
        const maxNameW = 500;
        if (ctx.measureText(icon + "  " + name).width > maxNameW) {
            while (ctx.measureText(icon + "  " + name + "…").width > maxNameW && name.length > 5) {
                name = name.slice(0, -1);
            }
            name += "…";
        }
        ctx.fillText(`${icon}  ${name}`, PADDING + 54, y + ITEM_H / 2 + 7);

        // File size (right side, files only)
        if (!isDir && item.size != null) {
            const sizeStr = fmtSize(item.size);
            ctx.textAlign   = "right";
            ctx.fillStyle   = item.size >= 50 * 1048576 ? "#f87171" : "rgba(255,255,255,0.4)";
            ctx.font        = "bold 14px BeVietnamPro, Sans";
            ctx.fillText(sizeStr, width - PADDING - 16, y + ITEM_H / 2 + 6);
        } else if (isDir) {
            ctx.textAlign = "right";
            ctx.fillStyle = "rgba(96,165,250,0.5)";
            ctx.font      = "13px BeVietnamPro, Sans";
            ctx.fillText("thư mục", width - PADDING - 16, y + ITEM_H / 2 + 6);
        }
    }

    // Footer
    const footerY = height - FOOTER_H;
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(0, footerY, width, FOOTER_H);
    ctx.textAlign = "center";
    ctx.fillStyle = "#60a5fa";
    ctx.font      = "bold 17px BeVietnamProBold, Sans";

    let footerTip = `➜ STT để mở/gửi  |  "up" quay lại`;
    if (totalPages > 1) footerTip += `  |  "tiếp" / "t${page < totalPages ? page + 1 : page}" đổi trang`;
    ctx.fillText(footerTip, width / 2, footerY + 38);

    return await canvas.toBuffer("png");
}

export async function drawTokenStatus({ items, okCount, failCount, skipCount, timestamp }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 920;
    const rowH = 58;
    const headerH = 110;
    const footerH = 72;
    const height = headerH + items.length * rowH + footerH;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#0d1117");
    bg.addColorStop(1, "#161b22");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const barGrad = ctx.createLinearGradient(0, 0, 0, height);
    barGrad.addColorStop(0, "#f0c040");
    barGrad.addColorStop(1, "#e88020");
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, 0, 5, height);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 46px BeVietnamProBold, Sans";
    ctx.textAlign = "left";
    ctx.fillText("TOKEN STATUS", 28, 62);

    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.font = "18px BeVietnamPro, Sans";
    ctx.fillText(timestamp, 28, 92);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, headerH); ctx.lineTo(width - 20, headerH); ctx.stroke();

    for (let i = 0; i < items.length; i++) {
        const { label, status, detail } = items[i];
        const y = headerH + i * rowH;

        if (i % 2 === 0) {
            ctx.fillStyle = "rgba(255,255,255,0.02)";
            ctx.fillRect(0, y, width, rowH);
        }

        const dotColor = status === "✅" ? "#00e676" : status === "❌" ? "#ff5252" : "#ffab40";
        ctx.shadowColor = dotColor;
        ctx.shadowBlur = 10;
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(32, y + rowH / 2, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 21px BeVietnamProBold, Sans";
        ctx.textAlign = "left";
        ctx.fillText(label, 58, y + rowH / 2 - 6);

        ctx.fillStyle = "rgba(255,255,255,0.48)";
        ctx.font = "16px BeVietnamPro, Sans";
        ctx.fillText(String(detail || "").substring(0, 68), 58, y + rowH / 2 + 16);
    }

    const footerY = headerH + items.length * rowH;
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, footerY); ctx.lineTo(width - 20, footerY); ctx.stroke();

    const summaryY = footerY + 46;
    ctx.font = "bold 24px BeVietnamProBold, Sans";
    ctx.textAlign = "left";

    ctx.fillStyle = "#00e676";
    ctx.fillText(`✅  ${okCount} OK`, 28, summaryY);
    ctx.fillStyle = "#ff5252";
    ctx.fillText(`❌  ${failCount} LỖI`, 200, summaryY);
    ctx.fillStyle = "#ffab40";
    ctx.fillText(`⚠  ${skipCount} BỎ QUA`, 390, summaryY);

    return await canvas.toBuffer("png");
}


// ── NEW GAME & DATA CANVAS FUNCTIONS ────────────────────────────────────────

export async function drawGoldPrice(goldList, updateTime) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const CARD_H = 75, CARD_GAP = 12, PADDING = 40;
    const HEADER_HEIGHT = 160;
    const FOOTER_HEIGHT = 120;
    const width = 800;
    const height = HEADER_HEIGHT + (goldList.length * (CARD_H + CARD_GAP)) + FOOTER_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Luxury Dark & Gold Background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#0c0a09");
    bgGrad.addColorStop(0.5, "#1c1917");
    bgGrad.addColorStop(1, "#0c0a09");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Blur
    ctx.globalAlpha = 0.15;
    ctx.fillStyle = "#fbbf24"; // Gold
    ctx.beginPath(); ctx.arc(0, 0, 450, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#92400e";
    ctx.beginPath(); ctx.arc(width, height, 400, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // 2. Header
    ctx.textAlign = "center";
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 44px BeVietnamProBold, Sans";
    ctx.shadowColor = "#fbbf24"; ctx.shadowBlur = 15;
    ctx.fillText("BẢNG GIÁ VÀNG PHÚ QUÝ", width / 2, 75);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
    ctx.font = "bold 20px BeVietnamPro, Sans";
    ctx.fillText(updateTime || "Cập nhật hôm nay", width / 2, 115);

    // Table Header
    ctx.textAlign = "left";
    ctx.font = "bold 18px BeVietnamProBold, Sans";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.fillText("LOẠI VÀNG", PADDING + 30, 145);
    ctx.textAlign = "right";
    ctx.fillText("MUA VÀO", width - PADDING - 180, 145);
    ctx.fillText("BÁN RA", width - PADDING - 40, 145);

    // 3. Rows
    for (let i = 0; i < goldList.length; i++) {
        const item = goldList[i];
        const y = HEADER_HEIGHT + i * (CARD_H + CARD_GAP);
        
        ctx.fillStyle = "rgba(251, 191, 36, 0.04)";
        drawRoundRect(ctx, PADDING, y, width - PADDING * 2, CARD_H, 15);
        ctx.fill();
        ctx.strokeStyle = "rgba(251, 191, 36, 0.1)";
        ctx.stroke();

        // Type
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 20px BeVietnamProBold, NotoEmojiBold, Sans";
        let type = item.type;
        if (ctx.measureText(type).width > 420) type = type.substring(0, 32) + "...";
        ctx.fillText(type, PADDING + 30, y + 45);

        // Buy/Sell
        ctx.textAlign = "right";
        ctx.font = "bold 22px BeVietnamProBold, Sans";
        ctx.fillStyle = "#fbbf24";
        ctx.fillText(item.buy || "—", width - PADDING - 180, y + 45);
        ctx.fillStyle = "#ef4444";
        ctx.fillText(item.sell || "—", width - PADDING - 40, y + 45);
    }

    // 4. Footer
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.2)";
    ctx.font = "italic 18px BeVietnamPro, Sans";
    ctx.fillText("Dữ liệu được cập nhật từ Phú Quý Group • DGK System", width / 2, height - 60);

    return await canvas.toBuffer('png');
}

export async function drawFuelPrice(fuelList, updateTime) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const CARD_H = 80, CARD_GAP = 12, PADDING = 40;
    const HEADER_HEIGHT = 180;
    const FOOTER_HEIGHT = 120;
    const width = 800;
    const height = HEADER_HEIGHT + (fuelList.length * (CARD_H + CARD_GAP)) + FOOTER_HEIGHT;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. PVOIL Theme Background (Deep Blue Gradient)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#075985"); // Blue 800
    bgGrad.addColorStop(1, "#1e1b4b"); // Navy
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Blur
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#ef4444"; 
    ctx.beginPath(); ctx.arc(width, 0, 400, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath(); ctx.arc(0, height, 350, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // 2. Header
    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px BeVietnamProBold, Sans";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10;
    ctx.fillText("BẢNG GIÁ XĂNG DẦU PVOIL", width / 2, 75);
    ctx.shadowBlur = 0;

    // Red Decorative Line
    ctx.fillStyle = "#ef4444";
    ctx.fillRect(width / 2 - 150, 90, 300, 4);

    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.font = "bold 22px BeVietnamPro, Sans";
    ctx.fillText(`🕒 Cập nhật: ${updateTime || "Mới nhất"}`, width / 2, 130);

    // Table Header
    ctx.textAlign = "left";
    ctx.font = "bold 18px BeVietnamProBold, Sans";
    ctx.fillStyle = "#bae6fd";
    ctx.fillText("SẢN PHẨM", PADDING + 30, 165);
    ctx.textAlign = "right";
    ctx.fillText("GIÁ (VNĐ/LÍT)", width - PADDING - 180, 165);
    ctx.fillText("THAY ĐỔI", width - PADDING - 30, 165);

    // 3. Rows
    for (let i = 0; i < fuelList.length; i++) {
        const item = fuelList[i];
        const y = HEADER_HEIGHT + i * (CARD_H + CARD_GAP);
        
        ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
        drawRoundRect(ctx, PADDING, y, width - PADDING * 2, CARD_H, 20);
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        ctx.stroke();

        // Product Name
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 22px BeVietnamProBold, NotoEmojiBold, Sans";
        ctx.fillText(item.name, PADDING + 30, y + 48);

        // Price
        ctx.textAlign = "right";
        ctx.font = "bold 26px BeVietnamProBold, Sans";
        ctx.fillStyle = "#facc15"; 
        ctx.fillText(item.price, width - PADDING - 180, y + 48);

        // Change
        ctx.font = "bold 18px BeVietnamProBold, Sans";
        const chg = item.change || "";
        if (chg.includes("+")) ctx.fillStyle = "#f87171"; 
        else if (chg.includes("-")) ctx.fillStyle = "#4ade80"; 
        else ctx.fillStyle = "#94a3b8";
        ctx.fillText(chg === "0" ? "—" : chg, width - PADDING - 30, y + 48);
    }

    // 4. Footer
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.3)";
    ctx.font = "italic 18px BeVietnamPro, Sans";
    ctx.fillText("Dữ liệu được trích xuất từ PVOIL.com.vn • System by DGK", width / 2, height - 60);

    return await canvas.toBuffer('png');
}

export async function drawXSMB(results, dateStr) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 800;
    const headerH = 150;
    const footerH = 80;
    const rowH = 65;
    const padding = 40;
    const height = headerH + (9 * rowH) + footerH;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Background (Red/Gradient)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#c00");
    bgGrad.addColorStop(1, "#800");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Pattern
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = "#fff";
    for(let i=0; i<10; i++) {
        ctx.beginPath(); ctx.arc(Math.random()*width, Math.random()*height, 100, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    // 2. Header
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff0"; // Yellow
    ctx.font = "bold 50px BeVietnamProBold, Sans";
    ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 10;
    ctx.fillText("XỔ SỐ MIỀN BẮC", width / 2, 70);
    ctx.shadowBlur = 0;

    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px BeVietnamPro, Sans";
    ctx.fillText(`📅 Ngày mở thưởng: ${dateStr}`, width / 2, 115);

    // 3. Results Table
    const tableY = headerH;
    const labels = ["Mã ĐB", "Giải ĐB", "Giải Nhất", "Giải Nhì", "Giải Ba", "Giải Tư", "Giải Năm", "Giải Sáu", "Giải Bảy"];
    const prizeKeys = ["code", "db", "g1", "g2", "g3", "g4", "g5", "g6", "g7"];

    for (let i = 0; i < labels.length; i++) {
        const y = tableY + i * rowH;
        
        // Row BG
        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.05)";
        ctx.fillRect(padding, y, width - padding * 2, rowH);

        // Label
        ctx.textAlign = "left";
        ctx.fillStyle = "#ff0";
        ctx.font = "bold 22px BeVietnamProBold, Sans";
        ctx.fillText(labels[i], padding + 20, y + 42);

        // Value
        ctx.textAlign = "center";
        let val = results[prizeKeys[i]] || "—";
        if (Array.isArray(val)) val = val.join("   ");
        
        if (i === 1) { // G.DB
            ctx.fillStyle = "#fff";
            ctx.font = "bold 34px BeVietnamProBold, Sans";
            ctx.shadowColor = "rgba(255, 255, 0, 0.5)"; ctx.shadowBlur = 15;
            ctx.fillText(val, width / 2 + 50, y + 45);
            ctx.shadowBlur = 0;
        } else {
            ctx.fillStyle = "#fff";
            ctx.font = "bold 24px BeVietnamProBold, Sans";
            ctx.fillText(val, width / 2 + 50, y + 42);
        }
    }

    // 4. Footer
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    ctx.font = "italic 18px BeVietnamPro, Sans";
    ctx.fillText("KQXS được cập nhật tự động từ xosodaiphat.com • By DGK", width / 2, height - 35);

    return await canvas.toBuffer('png');
}

export async function drawAltp({ question, options, level, reward, timeLeft, lifelines, removedOptions = [] }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1000;
    const height = 600;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Background: Deep Blue Gradient (ALTP Style)
    const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
    bgGrad.addColorStop(0, "#000033");
    bgGrad.addColorStop(0.5, "#000066");
    bgGrad.addColorStop(1, "#000033");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Decorative Glows
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#3b82f6";
    ctx.beginPath(); ctx.arc(width/2, height/2, 400, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // 2. Header: Level & Reward
    ctx.textAlign = "left";
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 35px BeVietnamProBold, Sans";
    ctx.fillText(`CÂU HỎI SỐ ${level}`, 50, 60);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px BeVietnamProBold, Sans";
    ctx.fillText(`MỨC THƯỞNG: ${reward.toLocaleString("vi-VN")} Đ`, width - 50, 60);

    // 3. Question Box
    const qBoxW = 900;
    const qBoxH = 120;
    const qBoxX = (width - qBoxW) / 2;
    const qBoxY = 120;

    // Hexagon-like shape for ALTP
    ctx.beginPath();
    ctx.moveTo(qBoxX + 40, qBoxY);
    ctx.lineTo(qBoxX + qBoxW - 40, qBoxY);
    ctx.lineTo(qBoxX + qBoxW, qBoxY + qBoxH / 2);
    ctx.lineTo(qBoxX + qBoxW - 40, qBoxY + qBoxH);
    ctx.lineTo(qBoxX + 40, qBoxY + qBoxH);
    ctx.lineTo(qBoxX, qBoxY + qBoxH / 2);
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 0, 100, 0.8)";
    ctx.fill();
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 26px BeVietnamProBold, NotoEmojiBold, Sans";
    wrapText(ctx, question, width / 2, qBoxY + 50, qBoxW - 100, 35);

    // 4. Options
    const optW = 430;
    const optH = 70;
    const optGapX = 40;
    const optGapY = 20;
    const optStartY = qBoxY + qBoxH + 60;

    const opKeys = ["A", "B", "C", "D"];
    opKeys.forEach((key, i) => {
        if (removedOptions.includes(key)) return; // Skip drawing removed options

        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = (width - (optW * 2 + optGapX)) / 2 + col * (optW + optGapX);
        const y = optStartY + row * (optH + optGapY);

        ctx.beginPath();
        ctx.moveTo(x + 30, y);
        ctx.lineTo(x + optW - 30, y);
        ctx.lineTo(x + optW, y + optH / 2);
        ctx.lineTo(x + optW - 30, y + optH);
        ctx.lineTo(x + 30, y + optH);
        ctx.lineTo(x, y + optH / 2);
        ctx.closePath();
        ctx.fillStyle = "rgba(0, 0, 50, 0.9)";
        ctx.fill();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.textAlign = "left";
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 24px BeVietnamProBold, Sans";
        ctx.fillText(`${key}:`, x + 40, y + optH / 2 + 8);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 22px BeVietnamProBold, NotoEmojiBold, Sans";
        let optText = options[key];
        if (ctx.measureText(optText).width > optW - 100) optText = optText.substring(0, 25) + "...";
        ctx.fillText(optText, x + 80, y + optH / 2 + 8);
    });

    // 5. Lifelines & Timer
    const footerY = height - 100;
    
    // Lifelines (circles)
    const lifeR = 30;
    const lifeGap = 20;
    const lifeStartX = 80;
    
    const availableLifelines = ["50:50", "Gọi người thân", "Khán giả"];
    availableLifelines.forEach((l, i) => {
        const lx = lifeStartX + i * (lifeR * 2 + lifeGap);
        const ly = footerY + lifeR;
        
        ctx.beginPath(); ctx.arc(lx, ly, lifeR, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(0, 0, 100, 0.8)";
        ctx.fill();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        ctx.textAlign = "center";
        const isUsed = !lifelines.includes(l);
        if (isUsed) {
            ctx.fillStyle = "rgba(0, 0, 0, 0.6)"; // Dim the used one
            ctx.beginPath(); ctx.arc(lx, ly, lifeR, 0, Math.PI * 2);
            ctx.fill();
        }
        
        ctx.textAlign = "center";
        ctx.fillStyle = isUsed ? "rgba(255,255,255,0.2)" : "#fbbf24";
        ctx.font = "bold 16px BeVietnamPro, Sans";
        let icon = i === 0 ? "50:50" : (i === 1 ? "☎️" : "📊");
        ctx.fillText(icon, lx, ly + 6);
    });

    // Timer Circle
    const timerX = width - 100;
    const timerY = footerY + lifeR;
    ctx.beginPath(); ctx.arc(timerX, timerY, 40, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.beginPath(); ctx.arc(timerX, timerY, 40, -Math.PI/2, (timeLeft/60) * Math.PI * 2 - Math.PI/2);
    ctx.strokeStyle = timeLeft > 15 ? "#10b981" : "#ef4444";
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 30px BeVietnamProBold, Sans";
    ctx.fillText(timeLeft, timerX, timerY + 10);

    return await canvas.toBuffer('png');
}



export async function drawCotuong({ board, lastMove, possibleMoves }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 530;
    const height = 567;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const cachePath = path.join(process.cwd(), "src/modules/cache/cotuong");

    // Load static assets
    const bg = await loadImage(path.join(cachePath, "bg.png"));
    
    ctx.drawImage(bg, 0, 0);

    const spaceX = 57;
    const spaceY = 57;
    const startX = -2;
    const startY = 0;

    // Draw pieces
    for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 9; x++) {
            const key = board[y][x];
            if (key) {
                const type = key.charAt(0).toLowerCase();
                const color = key.charAt(0) === key.charAt(0).toLowerCase() ? "r" : "b";
                const piecePath = path.join(cachePath, `${color}_${type}.png`);
                if (fs.existsSync(piecePath)) {
                    const pieceImg = await loadImage(piecePath);
                    ctx.drawImage(pieceImg, x * spaceX + startX, y * spaceY + startY);
                }
            }
        }
    }

    // Draw last move highlights
    if (lastMove) {
        const box = await loadImage(path.join(cachePath, "r_box.png"));
        const { from, to } = lastMove;
        ctx.drawImage(box, from.x * spaceX + startX, from.y * spaceY + startY);
        ctx.drawImage(box, to.x * spaceX + startX, to.y * spaceY + startY);
    }

    // Draw possible moves
    if (possibleMoves && Array.isArray(possibleMoves)) {
        const dot = await loadImage(path.join(cachePath, "dot.png"));
        for (const m of possibleMoves) {
            ctx.drawImage(dot, m[0] * spaceX + startX, m[1] * spaceY + startY);
        }
    }

    return await canvas.toBuffer('png');
}

export async function drawBatchuImage(imageUrl) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const size = 800;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext("2d");

    // Nền trắng và viền vàng đơn giản
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = "#f1c40f";
    ctx.lineWidth = 15;
    ctx.strokeRect(10, 10, size - 20, size - 20);

    try {
        const img = await loadImage(imageUrl);
        const imgSize = 640;
        ctx.drawImage(img, (size - imgSize) / 2, (size - imgSize) / 2, imgSize, imgSize);
    } catch (e) {
        console.error("Lỗi vẽ ảnh Bắt chữ:", e.message);
    }

    return await canvas.toBuffer('png');
}

export async function drawCaro({ board, lastMove = null }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const size = 16;
    const cellS = 60; // Increased for better clarity
    const width = size * cellS + 10;
    const height = size * cellS + 80; // Extra room for header

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // 2. Header
    ctx.fillStyle = "#f3f4f6";
    ctx.fillRect(5, 5, width - 10, 60);
    
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#111827";
    ctx.font = "bold 32px BeVietnamProBold, Sans";
    ctx.fillText("▤ CỜ CARO ▤", width / 2, 35);

    // 3. Grid & Numbers
    ctx.strokeStyle = "#4b5563"; // Darker grid
    ctx.lineWidth = 1.5; // Thicker lines for sharpness
    ctx.font = "bold 18px BeVietnamPro, Sans";

    const startX = 5;
    const startY = 75;

    for (let r = 0; r < size; r++) {
        for (let c = 0; c < size; c++) {
            const x = startX + c * cellS;
            const y = startY + r * cellS;
            const cellVal = board[r][c];
            const num = r * size + c + 1;

            ctx.strokeRect(x, y, cellS, cellS);

            if (cellVal === 0) {
                // Number
                ctx.fillStyle = "#9ca3af";
                ctx.fillText(num, x + cellS / 2, y + cellS / 2);
            } else {
                // Pieces
                ctx.font = "bold 42px BeVietnamProBold, Sans";
                if (cellVal === 1) { // X
                    ctx.fillStyle = "#dc2626"; // Darker Red
                    ctx.fillText("X", x + cellS / 2, y + cellS / 2);
                } else if (cellVal === 2) { // O
                    ctx.fillStyle = "#2563eb"; // Darker Blue
                    ctx.fillText("O", x + cellS / 2, y + cellS / 2);
                }
                ctx.font = "bold 18px BeVietnamPro, Sans";
            }

            // Highlight last move
            if (lastMove && lastMove.x === c && lastMove.y === r) {
                ctx.strokeStyle = "#ea580c"; // Orange-red
                ctx.lineWidth = 4;
                ctx.strokeRect(x + 3, y + 3, cellS - 6, cellS - 6);
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = "#4b5563";
            }
        }
    }

    // 4. Footer hint
    ctx.textAlign = "center";
    ctx.fillStyle = "#111827";
    ctx.font = "bold 16px BeVietnamPro, Sans";
    if (lastMove) {
        ctx.fillText(`Ô gần nhất: ${lastMove.y * size + lastMove.x + 1}`, width / 2, height - 15);
    }

    return await canvas.toBuffer('png');
}
export async function drawCaroLeaderboard(stats = []) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 600;
    const height = 400 + (stats.length * 50);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // 1. Sleek Background
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#1f2937");
    gradient.addColorStop(1, "#111827");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // 2. Header
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 36px BeVietnamProBold, Sans";
    ctx.textAlign = "center";
    ctx.fillText("🏆 BẢNG XẾP HẠNG CARO", width / 2, 60);

    // 3. Columns labels
    ctx.font = "bold 18px BeVietnamPro, Sans";
    ctx.fillStyle = "#9ca3af";
    ctx.textAlign = "left";
    ctx.fillText("HẠNG", 40, 110);
    ctx.fillText("NGƯỜI CHƠI", 120, 110);
    ctx.textAlign = "right";
    ctx.fillText("WINS", 450, 110);
    ctx.fillText("RATE %", 550, 110);

    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(30, 120);
    ctx.lineTo(570, 120);
    ctx.stroke();

    // 4. Rows
    stats.forEach((p, i) => {
        const y = 160 + i * 50;
        
        // Row background on hover (fake)
        ctx.fillStyle = i % 2 === 1 ? "rgba(255,255,255,0.03)" : "transparent";
        ctx.fillRect(30, y - 35, 540, 50);

        // Rank badge
        const rankColors = ["#fcd34d", "#d1d5db", "#b45309"];
        if (i < 3) {
            ctx.fillStyle = rankColors[i];
            ctx.beginPath();
            ctx.arc(55, y - 10, 15, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "#000";
            ctx.font = "bold 16px Arial";
            ctx.textAlign = "center";
            ctx.fillText(i + 1, 55, y - 4);
        } else {
            ctx.fillStyle = "#9ca3af";
            ctx.font = "16px BeVietnamPro, Sans";
            ctx.textAlign = "center";
            ctx.fillText(i + 1, 55, y - 4);
        }

        // Name
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 18px BeVietnamPro, Sans";
        const name = p.name ? (p.name.length > 20 ? p.name.substring(0, 18) + "..." : p.name) : "Người Chơi";
        ctx.fillText(name, 120, y - 4);

        // Stats
        ctx.textAlign = "right";
        ctx.fillStyle = "#fbbf24";
        ctx.fillText(p.wins || 0, 450, y - 4);

        const rate = p.matches > 0 ? ((p.wins / p.matches) * 100).toFixed(1) : "0.0";
        ctx.fillStyle = "#34d399";
        ctx.fillText(`${rate}%`, 550, y - 4);
    });

    return await canvas.toBuffer('png');
}

export async function drawYanh3dSearch(items = [], query = "YANH3D") {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1000;
    const height = 720;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#120f1f");
    bg.addColorStop(0.52, "#201423");
    bg.addColorStop(1, "#09090f");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(249,115,22,0.18)";
    ctx.beginPath();
    ctx.arc(860, 96, 180, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(45,212,191,0.12)";
    ctx.beginPath();
    ctx.arc(130, 640, 210, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.06)";
    drawRoundRect(ctx, 24, 24, 952, 672, 28);
    ctx.fill();

    ctx.fillStyle = "#fb923c";
    ctx.font = "bold 42px BeVietnamProBold, Sans";
    ctx.textAlign = "left";
    ctx.fillText("YANH3D SEARCH", 46, 66);

    ctx.fillStyle = "rgba(255,255,255,0.78)";
    ctx.font = "20px BeVietnamPro, Sans";
    const subtitle = `Ket qua cho: ${query}`.slice(0, 52);
    ctx.fillText(subtitle, 46, 98);

    ctx.fillStyle = "rgba(255,255,255,0.16)";
    drawRoundRect(ctx, 760, 42, 176, 34, 16);
    ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 16px BeVietnamProBold, Sans";
    ctx.textAlign = "center";
    ctx.fillText(`${Math.min(items.length, 5)} ITEMS`, 848, 64);

    const startY = 128;
    const cardH = 104;
    const gap = 16;

    for (let i = 0; i < Math.min(items.length, 5); i++) {
        const item = items[i] || {};
        const y = startY + i * (cardH + gap);

        ctx.fillStyle = "rgba(255,255,255,0.055)";
        drawRoundRect(ctx, 38, y, 924, cardH, 22);
        ctx.fill();

        const accent = ctx.createLinearGradient(38, y, 38, y + cardH);
        accent.addColorStop(0, "#fb923c");
        accent.addColorStop(1, "#f43f5e");
        ctx.fillStyle = accent;
        drawRoundRect(ctx, 38, y, 8, cardH, 8);
        ctx.fill();

        const thumbX = 64;
        const thumbY = y + 10;
        const thumbW = 136;
        const thumbH = 84;

        try {
            const thumbUrl = item.thumb || item.image || item.poster_url || item.thumb_url;
            if (thumbUrl?.startsWith("http")) {
                const res = await axios.get(thumbUrl, { responseType: "arraybuffer", timeout: 5000 });
                const img = await loadImage(Buffer.from(res.data));
                ctx.save();
                drawRoundRect(ctx, thumbX, thumbY, thumbW, thumbH, 14);
                ctx.clip();
                ctx.drawImage(img, thumbX, thumbY, thumbW, thumbH);
                ctx.restore();
            }
        } catch {}

        ctx.fillStyle = "#fb923c";
        drawRoundRect(ctx, 54, y + 10, 34, 28, 14);
        ctx.fill();
        ctx.fillStyle = "#111827";
        ctx.font = "bold 17px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        ctx.fillText(String(i + 1), 71, y + 30);

        const quality = item.quality || "";
        if (quality) {
            ctx.fillStyle = "rgba(45,212,191,0.18)";
            drawRoundRect(ctx, 838, y + 16, 92, 28, 14);
            ctx.fill();
            ctx.fillStyle = "#99f6e4";
            ctx.font = "bold 15px BeVietnamProBold, Sans";
            ctx.fillText(quality.slice(0, 10), 884, y + 35);
        }

        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 24px BeVietnamProBold, NotoEmojiBold, Sans";
        let title = item.title || item.name || "Unknown";
        while (title.length > 0 && ctx.measureText(title).width > 580) {
            title = title.slice(0, -1);
        }
        if ((item.title || item.name || "").length > title.length) title += "...";
        ctx.fillText(title, 224, y + 38);

        ctx.fillStyle = "rgba(255,255,255,0.7)";
        ctx.font = "18px BeVietnamPro, Sans";
        const statusLine = item.episode_current || item.meta || "Dang cap nhat";
        ctx.fillText(statusLine.slice(0, 54), 224, y + 68);

        ctx.fillStyle = "rgba(255,255,255,0.18)";
        drawRoundRect(ctx, 224, y + 78, 108, 18, 9);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.font = "bold 12px BeVietnamProBold, Sans";
        ctx.fillText("Nguon: YanHH3D", 236, y + 91);
    }

    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.textAlign = "center";
    ctx.font = "16px BeVietnamPro, Sans";
    ctx.fillText("Reply so thu tu de mo danh sach tap", width / 2, height - 26);

    return await canvas.toBuffer('png');
}

// ── Bảng màu accent theo vị trí card ──────────────────────────────────────────
const CARD_ACCENTS = [
    ["#7c3aed", "#a855f7"], // violet
    ["#0ea5e9", "#38bdf8"], // sky
    ["#10b981", "#34d399"], // emerald
    ["#f59e0b", "#fbbf24"], // amber
    ["#ef4444", "#f87171"], // red
    ["#ec4899", "#f472b6"], // pink
    ["#6366f1", "#818cf8"], // indigo
    ["#14b8a6", "#2dd4bf"], // teal
];

function fitText(ctx, text, maxW) {
    if (!text) return "";
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (ctx.measureText(text.slice(0, mid) + "…").width <= maxW) lo = mid;
        else hi = mid;
    }
    return text.slice(0, lo) + "…";
}

/**
 * MENU CANVAS — Ảnh canvas cho lệnh .help / .menu / .help all / .help <category>
 * @param {{ name, count, cmds, icon }[]} groups
 * @param {{ totalCmds, prefix, uptime, page, totalPages, allMode, title }} meta
 */
export async function drawMenuCanvas(groups, { totalCmds, prefix, uptime, page = 1, totalPages = 1, allMode = false, title = "" } = {}) {
    await ensureCanvas();
    if (!canvasAvailable) return null;

    const COLS     = 2;
    const CARD_W   = 410;
    const CARD_GAP = 16;
    const PAD_X    = 36;
    const PAD_TOP  = 14;

    // Card height: taller khi normal, compact khi allMode
    const CARD_H   = allMode ? 64 : 88;
    const HEADER_H = 128;
    const FOOTER_H = 52;
    const ROWS     = Math.ceil(groups.length / COLS);

    const FS_TITLE  = 34;
    const FS_SUB    = 15;
    const FS_NAME   = allMode ? 16 : 20;
    const FS_BADGE  = allMode ? 11 : 13;
    const FS_CMDS   = allMode ? 11 : 13;

    const width  = PAD_X * 2 + CARD_W * COLS + CARD_GAP;
    const height = PAD_TOP + HEADER_H + ROWS * (CARD_H + CARD_GAP) - CARD_GAP + FOOTER_H + PAD_TOP;

    const canvas = createCanvas(width, height);
    const ctx    = canvas.getContext("2d");

    // ── 1. Nền ────────────────────────────────────────────────────────────────
    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0,   "#07071a");
    bg.addColorStop(0.5, "#0f0f2e");
    bg.addColorStop(1,   "#07071a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    // Subtle dot grid
    ctx.fillStyle = "rgba(255,255,255,0.025)";
    for (let gx = 20; gx < width; gx += 28) {
        for (let gy = 20; gy < height; gy += 28) {
            ctx.beginPath(); ctx.arc(gx, gy, 1, 0, Math.PI * 2); ctx.fill();
        }
    }

    // Glow blobs
    const blobs = [
        { x: 0,     y: 0,      r: 260, c: "rgba(124,58,237,0.14)"  },
        { x: width, y: height, r: 220, c: "rgba(6,182,212,0.12)"   },
        { x: width, y: 0,      r: 160, c: "rgba(236,72,153,0.10)"  },
    ];
    for (const b of blobs) {
        const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        rg.addColorStop(0,   b.c);
        rg.addColorStop(1,   "transparent");
        ctx.fillStyle = rg;
        ctx.fillRect(0, 0, width, height);
    }

    // ── 2. Header card ────────────────────────────────────────────────────────
    const hx = PAD_X, hy = PAD_TOP, hw = width - PAD_X * 2, hh = HEADER_H - 10;

    // Header shadow glow
    ctx.shadowColor = "rgba(124,58,237,0.5)";
    ctx.shadowBlur  = 28;
    ctx.fillStyle   = "rgba(15,15,40,0.92)";
    drawRoundRect(ctx, hx, hy, hw, hh, 20);
    ctx.fill();
    ctx.shadowBlur  = 0;

    // Header gradient border
    const hbGrad = ctx.createLinearGradient(hx, hy, hx + hw, hy);
    hbGrad.addColorStop(0,   "#7c3aed");
    hbGrad.addColorStop(0.4, "#06b6d4");
    hbGrad.addColorStop(0.7, "#ec4899");
    hbGrad.addColorStop(1,   "#7c3aed");
    ctx.strokeStyle = hbGrad;
    ctx.lineWidth   = 2;
    drawRoundRect(ctx, hx, hy, hw, hh, 20);
    ctx.stroke();

    // Left accent stripe inside header
    const hAccent = ctx.createLinearGradient(hx, hy, hx, hy + hh);
    hAccent.addColorStop(0, "#7c3aed");
    hAccent.addColorStop(1, "#06b6d4");
    ctx.fillStyle = hAccent;
    drawRoundRect(ctx, hx, hy, 5, hh, 4);
    ctx.fill();

    // Title: "✦ LAUNA BOT"
    const titleGrad = ctx.createLinearGradient(hx + 24, 0, hx + 260, 0);
    titleGrad.addColorStop(0, "#c4b5fd");
    titleGrad.addColorStop(0.5, "#38bdf8");
    titleGrad.addColorStop(1, "#f9a8d4");
    ctx.fillStyle  = titleGrad;
    ctx.font       = `bold ${FS_TITLE}px BeVietnamProBold, Sans`;
    ctx.textAlign  = "left";
    const displayTitle = title || "✦  LAUNA BOT";
    ctx.fillText(displayTitle, hx + 24, hy + 46);

    // Right top: mode label
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font      = `bold ${FS_SUB - 1}px BeVietnamPro, Sans`;
    ctx.textAlign = "right";
    const modeLabel = allMode ? "📋 TẤT CẢ LỆNH" : (totalPages > 1 ? `TRANG ${page}/${totalPages}` : "🌸 MENU");
    ctx.fillText(`${modeLabel}  ·  ${prefix}help <lệnh>`, hx + hw - 14, hy + 28);

    // Stats row
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font      = `${FS_SUB}px BeVietnamPro, Sans`;
    ctx.textAlign = "left";
    ctx.fillText(`📦 ${totalCmds} lệnh   🗂️ ${groups.length} nhóm   ⏱️ ${uptime}`, hx + 24, hy + 76);

    // Divider inside header
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(hx + 24, hy + 90);
    ctx.lineTo(hx + hw - 24, hy + 90);
    ctx.stroke();

    // Hint row
    ctx.fillStyle = "rgba(167,139,250,0.7)";
    ctx.font      = `${FS_SUB - 2}px BeVietnamPro, Sans`;
    ctx.fillText(`💡 ${prefix}help game · ${prefix}help ai · ${prefix}help media · ${prefix}help all`, hx + 24, hy + 108);

    // ── 3. Cards grid ─────────────────────────────────────────────────────────
    const gridTop = PAD_TOP + HEADER_H;

    for (let i = 0; i < groups.length; i++) {
        const g      = groups[i];
        const col    = i % COLS;
        const row    = Math.floor(i / COLS);
        const cx     = PAD_X + col * (CARD_W + CARD_GAP);
        const cy     = gridTop + row * (CARD_H + CARD_GAP);
        const accent = CARD_ACCENTS[i % CARD_ACCENTS.length];

        // Card glass bg
        ctx.fillStyle = "rgba(255,255,255,0.04)";
        drawRoundRect(ctx, cx, cy, CARD_W, CARD_H, 14);
        ctx.fill();

        // Card border (subtle)
        ctx.strokeStyle = "rgba(255,255,255,0.07)";
        ctx.lineWidth   = 1;
        drawRoundRect(ctx, cx, cy, CARD_W, CARD_H, 14);
        ctx.stroke();

        // Left accent bar (category color)
        const aGrad = ctx.createLinearGradient(cx, cy, cx, cy + CARD_H);
        aGrad.addColorStop(0, accent[0]);
        aGrad.addColorStop(1, accent[1]);
        ctx.fillStyle = aGrad;
        drawRoundRect(ctx, cx, cy, 5, CARD_H, 4);
        ctx.fill();

        // Top-right glow chip bg
        const chipGrad = ctx.createLinearGradient(cx + CARD_W - 70, cy, cx + CARD_W, cy);
        chipGrad.addColorStop(0, "transparent");
        chipGrad.addColorStop(1, accent[0] + "33");
        ctx.fillStyle = chipGrad;
        drawRoundRect(ctx, cx + CARD_W - 80, cy, 80, CARD_H, 14);
        ctx.fill();

        // Icon + Name
        ctx.textAlign = "left";
        ctx.fillStyle = "#ffffff";
        ctx.font      = `bold ${FS_NAME}px BeVietnamProBold, NotoEmojiBold, Sans`;
        const nameY   = allMode ? cy + CARD_H * 0.42 : cy + CARD_H * 0.40;
        ctx.fillText(`${g.icon || "◈"}  ${g.name}`, cx + 18, nameY);

        // Count badge pill
        ctx.font = `bold ${FS_BADGE}px BeVietnamProBold, Sans`;
        const badgeText = `${g.count} lệnh`;
        const bw  = ctx.measureText(badgeText).width + 16;
        const bh  = allMode ? 18 : 22;
        const bx  = cx + CARD_W - bw - 10;
        const by  = cy + 7;
        ctx.fillStyle = accent[0];
        drawRoundRect(ctx, bx, by, bw, bh, bh / 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.textAlign = "center";
        ctx.fillText(badgeText, bx + bw / 2, by + bh - 5);

        // Commands preview
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.38)";
        ctx.font      = `${FS_CMDS}px BeVietnamPro, Sans`;
        const maxW    = CARD_W - 26;
        const cmdsY   = allMode ? cy + CARD_H - 11 : cy + CARD_H - 16;
        ctx.fillText(fitText(ctx, g.cmds || "", maxW), cx + 18, cmdsY);
    }

    // ── 4. Footer ─────────────────────────────────────────────────────────────
    const footerY = PAD_TOP + HEADER_H + ROWS * (CARD_H + CARD_GAP) - CARD_GAP + 12;

    // Divider
    const divG = ctx.createLinearGradient(PAD_X, footerY, width - PAD_X, footerY);
    divG.addColorStop(0, "transparent");
    divG.addColorStop(0.5, "rgba(255,255,255,0.12)");
    divG.addColorStop(1, "transparent");
    ctx.strokeStyle = divG;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(PAD_X, footerY); ctx.lineTo(width - PAD_X, footerY); ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.font      = "bold 13px BeVietnamPro, Sans";
    ctx.fillText("✦  POWERED BY LAUNA BOT  •  DGK SYSTEM  ✦", width / 2, footerY + 30);

    return await canvas.toBuffer("png");
}

/**
 * CMD DETAIL CANVAS — Ảnh canvas cho lệnh .help <tên lệnh cụ thể>
 * @param {{ cmdName, moduleName, description, relatedCmds, prefix }} info
 */
export async function drawCmdDetailCanvas({ cmdName, moduleName, description, relatedCmds = [], prefix = "." }) {
    await ensureCanvas();
    if (!canvasAvailable) return null;

    const W = 680, H = 280;
    const PAD = 36;
    const canvas = createCanvas(W, H);
    const ctx    = canvas.getContext("2d");

    // Nền
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#07071a"); bg.addColorStop(1, "#0f0f2e");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // Glow
    const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 300);
    rg.addColorStop(0, "rgba(124,58,237,0.18)"); rg.addColorStop(1, "transparent");
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H);

    // Card
    ctx.shadowColor = "rgba(124,58,237,0.4)"; ctx.shadowBlur = 24;
    ctx.fillStyle   = "rgba(15,15,40,0.95)";
    drawRoundRect(ctx, PAD / 2, PAD / 2, W - PAD, H - PAD, 20); ctx.fill();
    ctx.shadowBlur  = 0;

    // Border
    const bGrad = ctx.createLinearGradient(PAD / 2, 0, W - PAD / 2, 0);
    bGrad.addColorStop(0, "#7c3aed"); bGrad.addColorStop(0.5, "#06b6d4"); bGrad.addColorStop(1, "#ec4899");
    ctx.strokeStyle = bGrad; ctx.lineWidth = 2;
    drawRoundRect(ctx, PAD / 2, PAD / 2, W - PAD, H - PAD, 20); ctx.stroke();

    // Accent bar
    const aGrad = ctx.createLinearGradient(PAD / 2, PAD / 2, PAD / 2, H - PAD / 2);
    aGrad.addColorStop(0, "#7c3aed"); aGrad.addColorStop(1, "#06b6d4");
    ctx.fillStyle = aGrad;
    drawRoundRect(ctx, PAD / 2, PAD / 2, 5, H - PAD, 4); ctx.fill();

    // Command name (big)
    const titleGrad = ctx.createLinearGradient(PAD + 10, 0, PAD + 200, 0);
    titleGrad.addColorStop(0, "#c4b5fd"); titleGrad.addColorStop(1, "#38bdf8");
    ctx.fillStyle = titleGrad;
    ctx.font      = "bold 32px BeVietnamProBold, Sans";
    ctx.textAlign = "left";
    ctx.fillText(`${prefix}${cmdName}`, PAD + 16, 76);

    // Module badge
    ctx.font = "bold 12px BeVietnamProBold, Sans";
    const modText = `📦 ${moduleName}`;
    const mw = ctx.measureText(modText).width + 16;
    ctx.fillStyle = "#7c3aed";
    drawRoundRect(ctx, PAD + 16, 88, mw, 22, 11); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textAlign = "center";
    ctx.fillText(modText, PAD + 16 + mw / 2, 103);

    // Description
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font      = "15px BeVietnamPro, Sans";
    ctx.textAlign = "left";
    const descLines = splitLines(ctx, description || "Không có mô tả.", W - PAD * 3);
    descLines.slice(0, 3).forEach((line, i) => ctx.fillText(line, PAD + 16, 132 + i * 22));

    // Related cmds label
    if (relatedCmds.length > 1) {
        ctx.fillStyle = "rgba(167,139,250,0.8)";
        ctx.font      = "bold 13px BeVietnamProBold, Sans";
        ctx.fillText("Lệnh liên quan:", PAD + 16, H - 54);

        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font      = "12px BeVietnamPro, Sans";
        const relText = relatedCmds.map(c => `${prefix}${c}`).join("  ·  ");
        ctx.fillText(fitText(ctx, relText, W - PAD * 3), PAD + 16, H - 36);
    }

    return await canvas.toBuffer("png");
}

function splitLines(ctx, text, maxW) {
    const words = text.split(" ");
    const lines = [];
    let line    = "";
    for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) {
            lines.push(line);
            line = w;
        } else {
            line = test;
        }
    }
    if (line) lines.push(line);
    return lines;
}

// ── CONSOLE LOG CANVAS ────────────────────────────────────────────────────────
/**
 * Vẽ ảnh log console kiểu terminal tối.
 * @param {string[]} lines   Mảng dòng text log
 * @param {{ title?: string, version?: string, total?: number, time?: string }} opts
 */
export async function drawConsoleLog(lines, { title = "CONSOLE LOG", version = "", total = 0, time = "" } = {}) {
    await ensureCanvas();
    if (!canvasAvailable) return null;

    const W         = 940;
    const TITLE_H   = 52;
    const LINE_H    = 20;
    const FONT_SIZE = 13;
    const PAD_X     = 20;
    const PAD_TOP   = 14;
    const FOOTER_H  = 34;
    const MAX_CHARS = 108;

    // Tính chiều cao dựa trên số dòng
    const contentH = PAD_TOP + lines.length * LINE_H + PAD_TOP;
    const H        = TITLE_H + contentH + FOOTER_H;

    const canvas = createCanvas(W, Math.max(H, 160));
    const ctx    = canvas.getContext("2d");

    // ── Nền ──────────────────────────────────────────────────────────────────
    ctx.fillStyle = "#0D1117";
    ctx.fillRect(0, 0, W, canvas.height);

    // ── Thanh tiêu đề ────────────────────────────────────────────────────────
    const titleGrad = ctx.createLinearGradient(0, 0, W, TITLE_H);
    titleGrad.addColorStop(0, "#161B22");
    titleGrad.addColorStop(1, "#1C2128");
    ctx.fillStyle = titleGrad;
    ctx.fillRect(0, 0, W, TITLE_H);

    // Dấu chấm macOS
    [["#FF5F57", 18], ["#FEBC2E", 42], ["#28C840", 66]].forEach(([c, x]) => {
        ctx.beginPath();
        ctx.arc(x, 26, 7, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
    });

    // Tiêu đề giữa
    ctx.textAlign = "center";
    ctx.fillStyle = "#8B949E";
    ctx.font = "bold 15px BeVietnamProBold, Sans";
    const verTag = version ? `  •  ${version}` : "";
    ctx.fillText(`📟 ${title}${verTag}`, W / 2, 33);

    // Thời gian góc phải
    if (time) {
        ctx.textAlign = "right";
        ctx.fillStyle = "#484F58";
        ctx.font = "12px BeVietnamPro, Sans";
        ctx.fillText(time, W - PAD_X, 33);
    }

    // Đường kẻ ngang dưới title
    ctx.strokeStyle = "#21262D";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, TITLE_H);
    ctx.lineTo(W, TITLE_H);
    ctx.stroke();

    // ── Các dòng log ─────────────────────────────────────────────────────────
    ctx.textAlign = "left";
    ctx.font = `${FONT_SIZE}px BeVietnamPro, Sans`;
    let y = TITLE_H + PAD_TOP + FONT_SIZE;

    for (let i = 0; i < lines.length; i++) {
        const raw  = lines[i];
        const text = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) + "…" : raw;

        // Màu theo loại log
        let color = "#C9D1D9";
        if (raw.includes("❌") || /\b(error|ERROR|ERR)\b/.test(raw))      color = "#FF7B72";
        else if (raw.includes("⚠️") || /\b(warn|WARN|ALT)\b/.test(raw))   color = "#E3B341";
        else if (raw.includes("ℹ️") || /\b(info|INFO|INF)\b/.test(raw))   color = "#58A6FF";
        else if (raw.includes("✓") || /\b(ACK|OK)\b/.test(raw))           color = "#3FB950";
        else if (/\b(SYS|SYS )\b/.test(raw) || raw.includes("▸"))        color = "#BC8CFF";

        // Sọc ngang nhẹ cho các dòng chẵn
        if (i % 2 === 0) {
            ctx.fillStyle = "rgba(255,255,255,0.018)";
            ctx.fillRect(0, y - FONT_SIZE, W, LINE_H);
        }

        // Số dòng (dim)
        ctx.fillStyle = "#30363D";
        ctx.font = `${FONT_SIZE - 1}px BeVietnamPro, Sans`;
        ctx.fillText(String(i + 1).padStart(3), PAD_X, y);

        // Nội dung
        ctx.fillStyle = color;
        ctx.font = `${FONT_SIZE}px BeVietnamPro, Sans`;
        ctx.fillText(text, PAD_X + 34, y);

        y += LINE_H;
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const footerY = canvas.height - FOOTER_H;
    ctx.fillStyle = "#161B22";
    ctx.fillRect(0, footerY, W, FOOTER_H);

    ctx.strokeStyle = "#21262D";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, footerY);
    ctx.lineTo(W, footerY);
    ctx.stroke();

    ctx.textAlign = "left";
    ctx.fillStyle = "#484F58";
    ctx.font = `bold 12px BeVietnamPro, Sans`;
    ctx.fillText(`${lines.length} dòng hiển thị  •  ${total} dòng trong buffer`, PAD_X, footerY + 22);

    ctx.textAlign = "right";
    ctx.fillStyle = "#3FB950";
    ctx.font = `bold 12px BeVietnamPro, Sans`;
    ctx.fillText("✦  LAUNA CONSOLE  ✦", W - PAD_X, footerY + 22);

    return await canvas.toBuffer("png");
}

// ─────────────────────────────────────────────────────────────────────────────
//  POKEMON CANVAS FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

const PK_TYPE_COLOR = {
    Fire: "#ff6b35", Flying: "#89aae6", Water: "#4fc3f7", Grass: "#66bb6a",
    Electric: "#ffca28", Psychic: "#f06292", Ice: "#80deea", Dragon: "#7c4dff",
    Dark: "#37474f", Steel: "#90a4ae", Normal: "#bdbdbd", Fighting: "#c62828",
    Poison: "#9c27b0", Ground: "#bc8c5b", Rock: "#a1887f", Bug: "#8bc34a",
    Ghost: "#5c6bc0", Fairy: "#f48fb1",
    // tiếng Việt (từ portal)
    "hệ Cỏ": "#66bb6a", "hệ Độc": "#9c27b0", "hệ Nước": "#4fc3f7",
    "hệ Lửa": "#ff6b35", "hệ Điện": "#ffca28", "hệ Tâm Linh": "#f06292",
    "hệ Băng": "#80deea", "hệ Rồng": "#7c4dff", "hệ Bóng Tối": "#37474f",
    "hệ Thép": "#90a4ae", "hệ Bình Thường": "#bdbdbd", "hệ Đấu": "#c62828",
    "hệ Bay": "#89aae6", "hệ Đất": "#bc8c5b", "hệ Đá": "#a1887f",
    "hệ Sâu Bọ": "#8bc34a", "hệ Bóng Ma": "#5c6bc0", "hệ Tiên": "#f48fb1",
};

async function _pkLoadImg(url) {
    try {
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 6000 });
        return await loadImage(Buffer.from(res.data));
    } catch { return null; }
}

function _pkTypeColor(type) {
    return PK_TYPE_COLOR[type] || "#888888";
}

function _pkDrawTypeBadge(ctx, type, x, y, fontSize = 13) {
    const color = _pkTypeColor(type);
    const label = type.startsWith("hệ ") ? type : type;
    ctx.font = `bold ${fontSize}px BeVietnamPro, Sans`;
    const tw = ctx.measureText(label).width;
    const pw = 14; const ph = fontSize + 8;
    drawRoundRect(ctx, x, y - ph + 4, tw + pw * 2, ph, ph / 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = ["#ffca28","#80deea","#bdbdbd","hệ Bình Thường","Electric"].includes(type) ? "#111" : "#fff";
    ctx.textAlign = "left";
    ctx.fillText(label, x + pw, y);
    return tw + pw * 2 + 8;
}

/**
 * Vẽ card Pokédex chi tiết
 * @param {object} mon - Đối tượng từ pokedex.json (đã được enrich)
 * @returns {Buffer|null}
 */
export async function drawPokeDexCard(mon) {
    await ensureCanvas();
    if (!canvasAvailable || !mon) return null;

    const W = 900; const H = 860;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const mainType  = mon.types?.[0] || "Normal";
    const typeColor = _pkTypeColor(mainType);

    // ── Background ────────────────────────────────────────────────────────────
    ctx.fillStyle = "#10162a";
    ctx.fillRect(0, 0, W, H);
    const bgGrad = ctx.createRadialGradient(W * 0.7, 0, 0, W * 0.7, 0, W * 0.9);
    bgGrad.addColorStop(0, typeColor + "33");
    bgGrad.addColorStop(1, "transparent");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // ── Header strip ──────────────────────────────────────────────────────────
    const hGrad = ctx.createLinearGradient(0, 0, W, 0);
    hGrad.addColorStop(0, typeColor + "cc");
    hGrad.addColorStop(1, typeColor + "44");
    ctx.fillStyle = hGrad;
    drawRoundRect(ctx, 0, 0, W, 220, 0);
    ctx.fill();

    // decorative circle
    ctx.globalAlpha = 0.08;
    ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(W - 80, -40, 140, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 20, 160, 80, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // ── Artwork ───────────────────────────────────────────────────────────────
    const artUrl = mon.ogImage || mon.sprite ||
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${mon.dexId}.png`;
    const artImg = await _pkLoadImg(artUrl);
    if (artImg) {
        const aSize = 190;
        ctx.save();
        ctx.shadowColor = typeColor;
        ctx.shadowBlur  = 30;
        ctx.drawImage(artImg, W - aSize - 24, 10, aSize, aSize);
        ctx.restore();
    }

    // ── ID + Name ─────────────────────────────────────────────────────────────
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "bold 14px BeVietnamPro, Sans";
    ctx.fillText(`#${String(mon.dexId).padStart(4, "0")}`, 28, 44);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 42px BeVietnamProBold, Sans";
    ctx.fillText(mon.name, 28, 90);

    // Category
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "bold 15px BeVietnamPro, Sans";
    ctx.fillText(mon.category || "", 28, 115);

    // ── Types ─────────────────────────────────────────────────────────────────
    let tx = 28;
    const typesToShow = mon.types_vi?.length ? mon.types_vi : (mon.types || []);
    for (const t of typesToShow) {
        tx += _pkDrawTypeBadge(ctx, t, tx, 148, 12);
    }

    // ── Measures (height/weight) ───────────────────────────────────────────────
    const measures = [
        { label: "Chiều cao", value: mon.height || "—" },
        { label: "Cân nặng",  value: mon.weight || "—" },
    ];
    let mx = 28;
    for (const m of measures) {
        const mW = 160;
        drawRoundRect(ctx, mx, 170, mW, 42, 8);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "bold 10px BeVietnamPro, Sans";
        ctx.fillText(m.label.toUpperCase(), mx + 12, 186);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 14px BeVietnamProBold, Sans";
        ctx.fillText(m.value, mx + 12, 204);
        mx += mW + 12;
    }

    // ── Description ───────────────────────────────────────────────────────────
    const desc = mon.description || "";
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.font = "14px BeVietnamPro, Sans";
    const maxW = W - 56; let dy = 248;
    const words = desc.split(" ");
    let line = "";
    for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, 28, dy); dy += 22; line = word;
        } else { line = test; }
    }
    if (line) { ctx.fillText(line, 28, dy); dy += 22; }
    dy += 10;

    // ── Divider ───────────────────────────────────────────────────────────────
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(28, dy); ctx.lineTo(W - 28, dy); ctx.stroke();
    dy += 20;

    // ── Stats ─────────────────────────────────────────────────────────────────
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("NĂNG LỰC CƠ BẢN", 28, dy); dy += 18;

    const bs = mon.baseStats || {};
    const stats = [
        { label: "HP",  value: bs.hp  || 0, color: "#ff6b6b", max: 255 },
        { label: "ATK", value: bs.atk || 0, color: "#ffa94d", max: 190 },
        { label: "DEF", value: bs.def || 0, color: "#ffd43b", max: 230 },
        { label: "SpA", value: bs.spa || 0, color: "#69db7c", max: 194 },
        { label: "SpD", value: bs.spd || 0, color: "#4dabf7", max: 230 },
        { label: "SPD", value: bs.spe || 0, color: "#cc5de8", max: 200 },
    ];
    const barW = W - 200; const barH = 7;
    let total = 0;
    for (const s of stats) {
        total += s.value;
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.font = "bold 11px BeVietnamPro, Sans";
        ctx.textAlign = "left";
        ctx.fillText(s.label, 28, dy + 12);

        ctx.textAlign = "right";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px BeVietnamProBold, Sans";
        ctx.fillText(String(s.value), 100, dy + 12);

        ctx.textAlign = "left";
        drawRoundRect(ctx, 110, dy, barW, barH, 4);
        ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.fill();
        const fill = Math.min((s.value / s.max), 1) * barW;
        drawRoundRect(ctx, 110, dy, fill, barH, 4);
        ctx.fillStyle = s.color;
        ctx.fill();

        dy += 22;
    }
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(`Tổng: ${total}`, W - 28, dy);
    dy += 24;

    // ── Evolution chain ───────────────────────────────────────────────────────
    if (mon.evolutions?.length) {
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.font = "bold 11px BeVietnamPro, Sans";
        ctx.textAlign = "left";
        ctx.fillText("TIẾN HÓA", 28, dy); dy += 14;

        const evoIds = [mon.dexId, ...mon.evolutions.map(e => e.to)];
        const evoImgs = await Promise.allSettled(evoIds.map(id =>
            _pkLoadImg(`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`)
        ));

        let ex = 28;
        for (let i = 0; i < evoIds.length; i++) {
            const img = evoImgs[i].status === "fulfilled" ? evoImgs[i].value : null;
            const evoMon = i === 0 ? mon : null;
            const evoLv = i > 0 ? mon.evolutions[i - 1]?.level : null;

            if (img) {
                ctx.save();
                if (evoIds[i] === mon.dexId) {
                    ctx.shadowColor = typeColor; ctx.shadowBlur = 12;
                }
                ctx.drawImage(img, ex, dy, 60, 60);
                ctx.restore();
            }
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.font = "bold 10px BeVietnamPro, Sans";
            ctx.textAlign = "center";
            ctx.fillText(`#${evoIds[i]}`, ex + 30, dy + 74);
            if (evoLv) {
                ctx.fillStyle = typeColor;
                ctx.font = "bold 9px BeVietnamPro, Sans";
                ctx.fillText(`Lv.${evoLv}`, ex + 30, dy + 84);
            }
            ex += 70;
            if (i < evoIds.length - 1) {
                ctx.fillStyle = "rgba(255,255,255,0.3)";
                ctx.font = "22px Sans";
                ctx.textAlign = "left";
                ctx.fillText("→", ex, dy + 38);
                ex += 28;
            }
        }
    }

    // ── Footer branding ───────────────────────────────────────────────────────
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · vn.portal-pokemon.com ✦", W - 28, H - 16);

    return await canvas.toBuffer("png");
}

/**
 * Vẽ card thông báo Pokemon xuất hiện
 * @param {object} species - Đối tượng từ pokedex.json
 * @param {string} prefix  - Bot prefix
 * @returns {Buffer|null}
 */
export async function drawPkSpawnCard(species, prefix = ".") {
    await ensureCanvas();
    if (!canvasAvailable || !species) return null;

    const W = 900; const H = 480;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const mainType  = species.types?.[0] || "Normal";
    const typeColor = _pkTypeColor(mainType);

    // ── Background ────────────────────────────────────────────────────────────
    ctx.fillStyle = "#0d1117";
    ctx.fillRect(0, 0, W, H);
    const bgGrad = ctx.createRadialGradient(220, H / 2, 0, 220, H / 2, 340);
    bgGrad.addColorStop(0, typeColor + "2a");
    bgGrad.addColorStop(1, "transparent");
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // border glow
    ctx.strokeStyle = typeColor + "66";
    ctx.lineWidth = 2;
    drawRoundRect(ctx, 1, 1, W - 2, H - 2, 16);
    ctx.stroke();

    // ── Top bar ───────────────────────────────────────────────────────────────
    const barGrad = ctx.createLinearGradient(0, 0, W, 0);
    barGrad.addColorStop(0, typeColor + "2a");
    barGrad.addColorStop(1, "transparent");
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, 0, W, 46);

    // blink dot
    ctx.fillStyle = "#ff4444";
    ctx.beginPath(); ctx.arc(22, 23, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowColor = "#ff4444"; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(22, 23, 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.textAlign = "left";
    ctx.fillText("⚡ POKÉMON XUẤT HIỆN!", 36, 28);

    ctx.fillStyle = typeColor;
    ctx.textAlign = "right";
    ctx.font = "bold 13px BeVietnamPro, Sans";
    ctx.fillText("⏰ Biến mất sau 3 phút", W - 22, 28);

    // ── Artwork ───────────────────────────────────────────────────────────────
    const artUrl = species.ogImage || species.sprite ||
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${species.dexId}.png`;
    const artImg = await _pkLoadImg(artUrl);
    if (artImg) {
        ctx.save();
        ctx.shadowColor = typeColor;
        ctx.shadowBlur  = 40;
        ctx.drawImage(artImg, 20, 54, 280, 280);
        ctx.restore();
    }

    // ── Info (right side) ─────────────────────────────────────────────────────
    const rx = 330;
    ctx.textAlign = "left";

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 13px BeVietnamPro, Sans";
    ctx.fillText(`#${String(species.dexId).padStart(4, "0")}`, rx, 80);

    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 44px BeVietnamProBold, Sans";
    ctx.fillText(species.name, rx, 132);

    // types
    let tx = rx; const ty = 155;
    const typesToShow = species.types_vi?.length ? species.types_vi : (species.types || []);
    for (const t of typesToShow) { tx += _pkDrawTypeBadge(ctx, t, tx, ty, 13); }

    // divider
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rx, 175); ctx.lineTo(W - 28, 175); ctx.stroke();

    // catch command highlight box
    drawRoundRect(ctx, rx, 188, W - rx - 28, 70, 10);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fill();
    ctx.strokeStyle = typeColor + "55";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 10px BeVietnamPro, Sans";
    ctx.fillText("LỆNH BẮT", rx + 16, 204);

    ctx.fillStyle = typeColor;
    ctx.font = "bold 24px BeVietnamProBold, Sans";
    ctx.fillText(`${prefix}catch ${species.name}`, rx + 16, 240);

    // ball rates
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 10px BeVietnamPro, Sans";
    ctx.fillText("TỈ LỆ BẮT", rx, 280);

    const balls = [
        { label: "Pokéball",  rate: "55%", color: "#e53935" },
        { label: "Greatball", rate: "60%", color: "#1e88e5" },
        { label: "Ultraball", rate: "70%", color: "#f9a825" },
    ];
    let by = 298;
    for (const b of balls) {
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "13px BeVietnamPro, Sans";
        ctx.textAlign = "left";
        ctx.fillText(b.label, rx, by);
        ctx.fillStyle = b.color;
        ctx.font = "bold 13px BeVietnamProBold, Sans";
        ctx.textAlign = "right";
        ctx.fillText(b.rate, W - 28, by);
        by += 22;
    }

    // ── Description snippet ───────────────────────────────────────────────────
    if (species.description) {
        ctx.textAlign = "left";
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.font = "13px BeVietnamPro, Sans";
        const maxDescW = W - rx - 22;
        const words = species.description.split(" ");
        let descLine = ""; let descY = 380;
        for (const word of words) {
            const test = descLine ? `${descLine} ${word}` : word;
            if (ctx.measureText(test).width > maxDescW && descLine) {
                if (descY >= 418) { ctx.fillText(descLine + "…", rx, descY); break; }
                ctx.fillText(descLine, rx, descY); descY += 20; descLine = word;
            } else { descLine = test; }
        }
        if (descLine && descY <= 418) ctx.fillText(descLine, rx, descY);
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · Pokemon System ✦", W - 20, H - 14);

    return await canvas.toBuffer("png");
}

/**
 * Vẽ card hồ sơ người chơi Pokemon
 * @param {object} profile     - Dữ liệu profile người dùng
 * @param {string} senderName  - Tên hiển thị
 * @param {Function} getPokemonById - Hàm lấy thông tin Pokemon
 * @returns {Buffer|null}
 */
export async function drawPkProfileCard(profile, senderName, getPokemonById) {
    await ensureCanvas();
    if (!canvasAvailable || !profile) return null;

    const W = 900;
    const pListLen = Math.min((profile.pokemons || []).length, 8);
    const H = Math.max(860, 210 + pListLen * 74 + 160);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // ── Background ────────────────────────────────────────────────────────────
    ctx.fillStyle = "#10162a";
    ctx.fillRect(0, 0, W, H);
    const bg2 = ctx.createLinearGradient(0, 0, W, H);
    bg2.addColorStop(0, "#1a237e22");
    bg2.addColorStop(1, "#0f346022");
    ctx.fillStyle = bg2;
    ctx.fillRect(0, 0, W, H);

    // ── Header ────────────────────────────────────────────────────────────────
    const hGrad = ctx.createLinearGradient(0, 0, W, 0);
    hGrad.addColorStop(0, "#1a237e");
    hGrad.addColorStop(1, "#283593");
    ctx.fillStyle = hGrad;
    drawRoundRect(ctx, 0, 0, W, 110, 0);
    ctx.fill();

    // circles
    ctx.globalAlpha = 0.06; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(W - 60, -20, 110, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 10, 90, 70, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // avatar placeholder
    const grad = ctx.createLinearGradient(28, 20, 28, 88);
    grad.addColorStop(0, "#e91e63"); grad.addColorStop(1, "#9c27b0");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(62, 55, 34, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2; ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "bold 28px BeVietnamProBold, Sans";
    ctx.textAlign = "center";
    ctx.fillText("🧢", 62, 68);

    // Name
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px BeVietnamProBold, Sans";
    ctx.fillText(senderName, 108, 48);

    // rank badge
    const wins  = profile.stats?.duelsWon  || 0;
    const total = (profile.stats?.duelsWon || 0) + (profile.stats?.duelsLost || 0);
    const rank  = wins >= 20 ? "Elite Trainer" : wins >= 10 ? "Ace Trainer" : wins >= 5 ? "Trainer" : "Rookie";
    drawRoundRect(ctx, 108, 58, 120, 24, 12);
    ctx.fillStyle = "rgba(255,215,0,0.2)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,215,0,0.4)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 12px BeVietnamPro, Sans";
    ctx.fillText(`🏆 ${rank}`, 116, 74);

    // Credits
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("Credits", W - 28, 42);
    ctx.fillStyle = "#ffd700";
    ctx.font = "bold 26px BeVietnamProBold, Sans";
    ctx.fillText(profile.credits?.toLocaleString?.() || "0", W - 28, 68);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "10px BeVietnamPro, Sans";
    ctx.fillText("💰 xu", W - 28, 84);

    // ── Stats bar ─────────────────────────────────────────────────────────────
    const statItems = [
        { label: "Đã bắt",  value: profile.stats?.caught     || 0, icon: "⚪", color: "#4fc3f7" },
        { label: "Shiny",   value: profile.stats?.shinyCaught || 0, icon: "✨", color: "#ffd700" },
        { label: "Thắng",   value: profile.stats?.duelsWon   || 0, icon: "⚔️", color: "#69db7c" },
        { label: "Thua",    value: profile.stats?.duelsLost  || 0, icon: "💔", color: "#ff6b6b" },
    ];
    const siW = W / statItems.length;

    // stats background vẽ TRƯỚC — text sẽ đè lên sau
    drawRoundRect(ctx, 0, 110, W, 58, 0);
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.fill();

    for (let i = 0; i < statItems.length; i++) {
        const s = statItems[i]; const sx = i * siW;
        if (i > 0) {
            ctx.strokeStyle = "rgba(255,255,255,0.08)";
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(sx, 110); ctx.lineTo(sx, 166); ctx.stroke();
        }
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.font = "18px Sans";
        ctx.fillText(s.icon, sx + siW / 2, 132);
        ctx.fillStyle = s.color;
        ctx.font = "bold 20px BeVietnamProBold, Sans";
        ctx.fillText(s.value, sx + siW / 2, 152);
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "10px BeVietnamPro, Sans";
        ctx.fillText(s.label, sx + siW / 2, 164);
    }

    // ── Pokemon list ──────────────────────────────────────────────────────────
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 11px BeVietnamPro, Sans";
    const boxInfo = `${profile.pokemons?.length || 0}/${profile.maxBoxSize || 30}`;
    ctx.fillText(`POKÉMON (${boxInfo})`, 28, 196);

    const pList = (profile.pokemons || []).slice(0, 8);
    const spriteResults = await Promise.allSettled(pList.map(inst => {
        const sp = getPokemonById(inst.dexId);
        const url = sp?.sprite || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${inst.dexId}.png`;
        return _pkLoadImg(url).then(img => ({ img, sp, inst }));
    }));

    let py = 210;
    for (const result of spriteResults) {
        if (result.status !== "fulfilled") continue;
        const { img, sp, inst } = result.value;
        const rowH = 68;

        // row background
        drawRoundRect(ctx, 18, py, W - 36, rowH, 10);
        ctx.fillStyle = inst.shiny ? "rgba(255,215,0,0.07)" : "rgba(255,255,255,0.04)";
        ctx.fill();
        ctx.strokeStyle = inst.shiny ? "rgba(255,215,0,0.25)" : "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1; ctx.stroke();

        // sprite
        if (img) {
            ctx.save();
            if (inst.shiny) { ctx.shadowColor = "#ffd700"; ctx.shadowBlur = 12; }
            ctx.drawImage(img, 22, py + 6, 56, 56);
            ctx.restore();
        }
        if (inst.shiny) {
            ctx.font = "12px Sans"; ctx.textAlign = "left";
            ctx.fillText("✨", 60, py + 14);
        }

        // name + types
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 16px BeVietnamProBold, Sans";
        ctx.fillText(sp?.name || "???", 86, py + 24);

        // type badges (small)
        const types = sp?.types_vi?.length ? sp.types_vi : (sp?.types || []);
        let ttx = 86;
        for (const t of types.slice(0, 2)) {
            const tColor = _pkTypeColor(t);
            ctx.font = "bold 9px BeVietnamPro, Sans";
            const tw = ctx.measureText(t).width + 14;
            drawRoundRect(ctx, ttx, py + 30, tw, 15, 8);
            ctx.fillStyle = tColor; ctx.fill();
            ctx.fillStyle = "#fff";
            ctx.fillText(t, ttx + 7, py + 41);
            ttx += tw + 4;
        }

        // level
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.font = "12px BeVietnamPro, Sans";
        ctx.fillText("Lv.", W - 100, py + 24);
        const typeColor = _pkTypeColor(types[0] || "Normal");
        ctx.fillStyle = typeColor;
        ctx.font = "bold 18px BeVietnamProBold, Sans";
        ctx.fillText(inst.level, W - 48, py + 24);

        // XP bar
        const xpReq = 10 * inst.level * inst.level;
        const xpPct = Math.min((inst.xp || 0) / xpReq, 1);
        const barX = W - 200; const barW2 = 155;
        drawRoundRect(ctx, barX, py + 36, barW2, 5, 3);
        ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fill();
        if (xpPct > 0) {
            drawRoundRect(ctx, barX, py + 36, barW2 * xpPct, 5, 3);
            ctx.fillStyle = typeColor; ctx.fill();
        }
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.font = "9px BeVietnamPro, Sans";
        ctx.fillText(`${inst.xp || 0}/${xpReq} XP`, W - 28, py + 55);

        // UID
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.font = "9px BeVietnamPro, Sans";
        ctx.textAlign = "left";
        ctx.fillText(`UID: ${inst.uid}`, 86, py + 58);

        py += rowH + 6;
    }

    // ── Inventory ─────────────────────────────────────────────────────────────
    const invY = Math.max(py + 10, H - 120);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(28, invY); ctx.lineTo(W - 28, invY); ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.textAlign = "left";
    ctx.fillText("TÚI ĐỒ", 28, invY + 16);

    const inv = profile.inventory || {};
    const invItems = [
        { key: "pokeball",  label: "Pokéball",  emoji: "🔴", color: "#e53935" },
        { key: "greatball", label: "Greatball",  emoji: "🔵", color: "#1e88e5" },
        { key: "ultraball", label: "Ultraball",  emoji: "🟡", color: "#f9a825" },
    ];
    const iW = (W - 56 - 20) / invItems.length;
    for (let i = 0; i < invItems.length; i++) {
        const item = invItems[i]; const ix = 28 + i * (iW + 10);
        drawRoundRect(ctx, ix, invY + 24, iW, 56, 10);
        ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill();
        ctx.strokeStyle = item.color + "44"; ctx.lineWidth = 1; ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillStyle = "#fff"; ctx.font = "20px Sans";
        ctx.fillText(item.emoji, ix + iW / 2, invY + 52);
        ctx.fillStyle = item.color;
        ctx.font = "bold 16px BeVietnamProBold, Sans";
        ctx.fillText(inv[item.key] || 0, ix + iW / 2, invY + 70);
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.font = "9px BeVietnamPro, Sans";
        ctx.fillText(item.label, ix + iW / 2, invY + 82);
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · Pokemon System ✦", W - 28, H - 10);

    return await canvas.toBuffer("png");
}


// ─────────────────────────────────────────────────────────────────────────────
//  GAME SERVER CANVAS FUNCTIONS  (v2 — ảnh to + thông tin đầy đủ)
// ─────────────────────────────────────────────────────────────────────────────

function _gsHpColor(pct) {
    if (pct > 0.6) return "#69db7c";
    if (pct > 0.3) return "#ffa94d";
    return "#ff6b6b";
}

function _gsDrawHpBar(ctx, x, y, w, h, cur, max, radius = 5) {
    const pct = Math.min(cur / max, 1);
    drawRoundRect(ctx, x, y, w, h, radius);
    ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fill();
    if (pct > 0) {
        const fillW = Math.max(radius * 2, pct * w);
        drawRoundRect(ctx, x, y, fillW, h, radius);
        const grad = ctx.createLinearGradient(x, y, x + fillW, y);
        const c = _gsHpColor(pct);
        grad.addColorStop(0, c + "bb"); grad.addColorStop(1, c);
        ctx.fillStyle = grad; ctx.fill();
    }
    ctx.textAlign = "center"; ctx.fillStyle = "#fff";
    ctx.font = `bold 10px BeVietnamPro, Sans`;
    ctx.fillText(`${cur} / ${max}`, x + w / 2, y + h - 2);
}

function _gsStatMini(ctx, x, y, label, val, color, barW = 110) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.font = "bold 9px BeVietnamPro, Sans";
    ctx.fillText(label, x, y);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    drawRoundRect(ctx, x + 28, y - 9, barW, 7, 3); ctx.fill();
    const fill = Math.min(val / 255, 1) * barW;
    if (fill > 0) {
        drawRoundRect(ctx, x + 28, y - 9, fill, 7, 3);
        ctx.fillStyle = color; ctx.fill();
    }
    ctx.textAlign = "right"; ctx.fillStyle = color;
    ctx.font = "bold 9px BeVietnamProBold, Sans";
    ctx.fillText(val, x + 28 + barW + 18, y);
}

function _gsWrapText(ctx, text, x, y, maxW, lineH, maxLines = 3) {
    const words = (text || "").split(" ");
    let line = ""; let linesDrawn = 0;
    for (const word of words) {
        if (linesDrawn >= maxLines) break;
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > maxW && line) {
            if (linesDrawn === maxLines - 1) {
                while (ctx.measureText(line + "…").width > maxW && line.length > 0)
                    line = line.slice(0, -1);
                ctx.fillText(line + "…", x, y); y += lineH; linesDrawn++; line = ""; break;
            }
            ctx.fillText(line, x, y); y += lineH; linesDrawn++; line = word;
        } else { line = test; }
    }
    if (line && linesDrawn < maxLines) ctx.fillText(line, x, y);
}

/**
 * Wild Rush — ảnh ogImage to + stats + thông tin từng Pokemon
 */
export async function drawGsWildRushCard(spawned, prefix = ".") {
    await ensureCanvas();
    if (!canvasAvailable || !spawned?.length) return null;

    const W = 900; const ROW_H = 130; const HEADER_H = 100;
    const H = HEADER_H + spawned.length * ROW_H + 48;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // Background
    ctx.fillStyle = "#091a09"; ctx.fillRect(0, 0, W, H);
    const bgG = ctx.createLinearGradient(0, 0, 0, H);
    bgG.addColorStop(0, "#1a4a0a22"); bgG.addColorStop(1, "#0a1a0422");
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

    // Header
    const hG = ctx.createLinearGradient(0, 0, W, 0);
    hG.addColorStop(0, "#2e7d32cc"); hG.addColorStop(1, "#1b5e2055");
    ctx.fillStyle = hG; ctx.fillRect(0, 0, W, HEADER_H);

    ctx.strokeStyle = "#66bb6a55"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, HEADER_H); ctx.lineTo(W, HEADER_H); ctx.stroke();

    // Alert dot
    ctx.fillStyle = "#69db7c"; ctx.shadowColor = "#69db7c"; ctx.shadowBlur = 14;
    ctx.beginPath(); ctx.arc(26, 32, 7, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#0a1a04"; ctx.font = "bold 8px Sans";
    ctx.textAlign = "center"; ctx.fillText("!", 26, 36);

    ctx.textAlign = "left";
    ctx.fillStyle = "#69db7c"; ctx.font = "bold 12px BeVietnamPro, Sans";
    ctx.fillText("🌐 GAME SERVER EVENT", 44, 26);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 32px BeVietnamProBold, Sans";
    ctx.fillText("🌿 WILD POKEMON RUSH!", 44, 66);

    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = "bold 13px BeVietnamPro, Sans";
    ctx.fillText(`${spawned.length} Pokémon  ·  Biến mất sau 5 phút`, W - 26, 34);
    ctx.fillStyle = "#69db7c"; ctx.font = "bold 13px BeVietnamProBold, Sans";
    ctx.fillText(`${prefix}catch [tên] để bắt`, W - 26, 56);

    // Pre-load all images
    const imgResults = await Promise.allSettled(spawned.map(s =>
        _pkLoadImg(s.ogImage || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${s.dexId}.png`)
    ));

    let ry = HEADER_H;
    for (let i = 0; i < spawned.length; i++) {
        const s   = spawned[i];
        const img = imgResults[i].status === "fulfilled" ? imgResults[i].value : null;
        const mainType  = s.types?.[0] || "Normal";
        const typeColor = _pkTypeColor(mainType);
        const hpPct     = 1;

        // Row bg
        const rowBg = ctx.createLinearGradient(0, ry, W, ry);
        rowBg.addColorStop(0, typeColor + "22");
        rowBg.addColorStop(0.4, "rgba(255,255,255,0.03)");
        rowBg.addColorStop(1, "transparent");
        ctx.fillStyle = rowBg; ctx.fillRect(0, ry, W, ROW_H);

        // Left: artwork panel (140×130)
        const ART_W = 130;
        if (img) {
            ctx.save();
            ctx.beginPath(); ctx.rect(0, ry, ART_W, ROW_H); ctx.clip();
            // Glow
            ctx.shadowColor = typeColor; ctx.shadowBlur = 30;
            const ratio = Math.min(ART_W / img.width, ROW_H / img.height);
            const aw = img.width * ratio; const ah = img.height * ratio;
            ctx.drawImage(img, (ART_W - aw) / 2, ry + (ROW_H - ah) / 2, aw, ah);
            ctx.restore();
        } else {
            ctx.fillStyle = typeColor + "22";
            ctx.fillRect(0, ry, ART_W, ROW_H);
            ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.15)";
            ctx.font = "bold 40px Sans"; ctx.fillText("?", ART_W / 2, ry + ROW_H / 2 + 14);
        }

        // Type color stripe on left edge
        ctx.fillStyle = typeColor;
        ctx.fillRect(0, ry, 4, ROW_H);

        // Row separator
        ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(W, ry); ctx.stroke();

        // Right: info
        const ix = ART_W + 14;
        // Rank number
        ctx.textAlign = "left"; ctx.fillStyle = typeColor;
        ctx.globalAlpha = 0.25; ctx.font = "bold 72px BeVietnamProBold, Sans";
        ctx.fillText(`${i + 1}`, W - 60, ry + ROW_H - 10);
        ctx.globalAlpha = 1;

        // #ID
        ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "bold 11px BeVietnamPro, Sans";
        ctx.fillText(`#${String(s.dexId).padStart(4, "0")}`, ix, ry + 18);

        // Name
        ctx.fillStyle = "#fff"; ctx.font = "bold 26px BeVietnamProBold, Sans";
        ctx.fillText(s.name, ix, ry + 44);

        // Type badges
        let tx = ix;
        const typesToShow = s.types_vi?.length ? s.types_vi.slice(0,2) : (s.types||[]).slice(0,2);
        for (const t of typesToShow) { tx += _pkDrawTypeBadge(ctx, t, tx, ry + 62, 11); }

        // Category
        if (s.category) {
            ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "11px BeVietnamPro, Sans";
            ctx.fillText(s.category, tx + 8, ry + 62);
        }

        // Base stats mini bars
        if (s.baseStats) {
            const bs = s.baseStats; const sx = ix; const sy = ry + 80;
            _gsStatMini(ctx, sx,       sy, "HP",  bs.hp  || 0, "#ff6b6b");
            _gsStatMini(ctx, sx + 175, sy, "ATK", bs.atk || 0, "#ffa94d");
            _gsStatMini(ctx, sx + 350, sy, "DEF", bs.def || 0, "#ffd43b");
            _gsStatMini(ctx, sx + 525, sy, "SPD", bs.spe || 0, "#cc5de8");
        }

        // Description
        ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.font = "12px BeVietnamPro, Sans";
        ctx.textAlign = "left";
        _gsWrapText(ctx, s.description, ix, ry + 100, W - ix - 120, 16, 1);

        // Catch command
        const cmd = `${prefix}catch ${s.name}`;
        ctx.font = "bold 12px BeVietnamProBold, Sans";
        const cmdW = ctx.measureText(cmd).width + 24;
        drawRoundRect(ctx, W - cmdW - 18, ry + ROW_H / 2 - 18, cmdW, 34, 9);
        ctx.fillStyle = typeColor + "dd"; ctx.fill();
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        ctx.fillText(cmd, W - cmdW / 2 - 18, ry + ROW_H / 2 + 4);

        // ← QUAN TRỌNG: tăng ry cho hàng tiếp theo
        ry += ROW_H;
    }

    // Footer
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · Game Server ✦", W - 20, H - 14);
    return await canvas.toBuffer("png");
}

/**
 * Pokemon Boss Raid — ảnh boss to trái + stats đầy đủ phải
 */
export async function drawGsBossRaidCard(boss, prefix = ".") {
    await ensureCanvas();
    if (!canvasAvailable || !boss) return null;

    const W = 900; const H = 540;
    const ART_W = 360; // left panel width
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const sp        = boss.species;
    const mainType  = sp?.types?.[0] || "Normal";
    const typeColor = _pkTypeColor(mainType);
    const hpPct     = boss.hp / boss.maxHp;
    const bs        = sp?.baseStats || {};

    // Dark background
    ctx.fillStyle = "#0f0505"; ctx.fillRect(0, 0, W, H);

    // Right panel gradient
    const rg = ctx.createLinearGradient(ART_W, 0, W, 0);
    rg.addColorStop(0, typeColor + "18"); rg.addColorStop(1, "#0a0205");
    ctx.fillStyle = rg; ctx.fillRect(ART_W, 0, W - ART_W, H);

    // Load artwork
    const artUrl = sp?.ogImage ||
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${sp?.dexId}.png`;
    const artImg = await _pkLoadImg(artUrl);

    // Left panel — artwork
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, ART_W, H); ctx.clip();
    // BG glow
    const artBg = ctx.createRadialGradient(ART_W / 2, H / 2, 0, ART_W / 2, H / 2, ART_W);
    artBg.addColorStop(0, typeColor + "44"); artBg.addColorStop(1, "#0f0505");
    ctx.fillStyle = artBg; ctx.fillRect(0, 0, ART_W, H);
    if (artImg) {
        const ratio = Math.min((ART_W - 16) / artImg.width, (H - 16) / artImg.height);
        const aw = artImg.width * ratio; const ah = artImg.height * ratio;
        ctx.shadowColor = typeColor; ctx.shadowBlur = 50;
        ctx.drawImage(artImg, (ART_W - aw) / 2, (H - ah) / 2, aw, ah);
        ctx.shadowBlur = 0;
    } else {
        ctx.fillStyle = typeColor + "22"; ctx.fillRect(0, 0, ART_W, H);
        ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.1)";
        ctx.font = "bold 60px Sans"; ctx.fillText("?", ART_W / 2, H / 2 + 20);
    }
    // Gradient overlay (right fade)
    const fadeG = ctx.createLinearGradient(ART_W - 80, 0, ART_W, 0);
    fadeG.addColorStop(0, "transparent"); fadeG.addColorStop(1, "#0f0505");
    ctx.fillStyle = fadeG; ctx.fillRect(ART_W - 80, 0, 80, H);
    // Bottom gradient
    const bG = ctx.createLinearGradient(0, H - 100, 0, H);
    bG.addColorStop(0, "transparent"); bG.addColorStop(1, "#0f050599");
    ctx.fillStyle = bG; ctx.fillRect(0, H - 100, ART_W, 100);
    ctx.restore();

    // Type left stripe
    const stripeG = ctx.createLinearGradient(0, 0, 0, H);
    stripeG.addColorStop(0, typeColor); stripeG.addColorStop(1, typeColor + "55");
    ctx.fillStyle = stripeG; ctx.fillRect(0, 0, 5, H);

    // ID + name overlay on artwork (bottom-left)
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "bold 13px BeVietnamPro, Sans";
    ctx.fillText(`#${String(sp?.dexId || 0).padStart(4, "0")}`, 14, H - 48);
    ctx.fillStyle = typeColor; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("LEGENDARY BOSS", 14, H - 30);

    // Right panel — info
    const rx = ART_W + 22;
    const rW = W - rx - 18;

    // Alert header
    ctx.fillStyle = "rgba(255,255,255,0.08)"; ctx.fillRect(ART_W, 0, W - ART_W, 54);
    ctx.strokeStyle = "rgba(255,68,68,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ART_W, 54); ctx.lineTo(W, 54); ctx.stroke();

    ctx.fillStyle = "#ff6b6b"; ctx.shadowColor = "#ff4444"; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(rx + 8, 27, 5, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.textAlign = "left"; ctx.fillStyle = "#ff9999"; ctx.font = "bold 12px BeVietnamPro, Sans";
    ctx.fillText("⚡ POKEMON BOSS RAID!", rx + 22, 22);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("Boss huyền thoại xuất hiện · Biến mất sau 15 phút", rx + 22, 40);

    // Boss name (large)
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 40px BeVietnamProBold, Sans";
    ctx.fillText(sp?.name || "???", rx, 96);

    // Type badges
    let tx = rx; const tY = 114;
    const typesShow = sp?.types_vi?.length ? sp.types_vi : (sp?.types || []);
    for (const t of typesShow) { tx += _pkDrawTypeBadge(ctx, t, tx, tY, 13); }

    // Category
    if (sp?.category) {
        ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "12px BeVietnamPro, Sans";
        ctx.fillText(`  ${sp.category}`, tx, tY);
    }

    // HP bar
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("❤️  BOSS HP", rx, 140);
    _gsDrawHpBar(ctx, rx, 148, rW, 26, boss.hp, boss.maxHp, 7);
    ctx.textAlign = "right"; ctx.fillStyle = _gsHpColor(hpPct);
    ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.fillText(`${Math.round(hpPct * 100)}%`, W - 22, 165);
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText(`${boss.participants?.size || 0} người đang tham chiến`, rx, 192);

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rx, 204); ctx.lineTo(W - 18, 204); ctx.stroke();

    // Base Stats
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("NĂNG LỰC CƠ BẢN", rx, 222);
    const stats4 = [
        ["HP",  bs.hp  || 0, "#ff6b6b"],
        ["ATK", bs.atk || 0, "#ffa94d"],
        ["DEF", bs.def || 0, "#ffd43b"],
        ["SPD", bs.spe || 0, "#cc5de8"],
    ];
    const colW = Math.floor(rW / 2);
    for (let i = 0; i < stats4.length; i++) {
        const [label, val, color] = stats4[i];
        const sx = rx + (i % 2) * colW;
        const sy = 240 + Math.floor(i / 2) * 22;
        _gsStatMini(ctx, sx, sy, label, val, color, colW - 50);
    }

    // Description
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("MÔ TẢ", rx, 296);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "13px BeVietnamPro, Sans";
    _gsWrapText(ctx, sp?.description, rx, 314, rW, 18, 2);

    // Physical info
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "12px BeVietnamPro, Sans";
    if (sp?.height || sp?.weight) {
        ctx.fillText(`📏 ${sp?.height || "—"}  ⚖️ ${sp?.weight || "—"}`, rx, 358);
    }

    // Attack command box
    drawRoundRect(ctx, rx, 372, rW, 70, 12);
    ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill();
    ctx.strokeStyle = "#ff444455"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "bold 10px BeVietnamPro, Sans";
    ctx.fillText("⚔️  LỆNH TẤN CÔNG", rx + 16, 392);
    ctx.fillStyle = "#ff9999"; ctx.font = "bold 22px BeVietnamProBold, Sans";
    ctx.fillText(`${prefix}gs attack`, rx + 16, 422);
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText("thêm [pokeball/greatball/ultraball] để tăng DMG", rx + 16, 436);

    // Reward
    drawRoundRect(ctx, rx, 452, rW, 62, 12);
    ctx.fillStyle = "rgba(255,215,0,0.06)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,215,0,0.2)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#ffd700"; ctx.font = "bold 11px BeVietnamProBold, Sans";
    ctx.fillText("🏆 PHẦN THƯỞNG", rx + 16, 472);
    ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(`👑 MVP hạ boss → Nhận ${sp?.name} (Lv.15–30)!`, rx + 16, 490);
    ctx.fillText(`🎁 Tất cả tham chiến → Xu thưởng`, rx + 16, 506);

    // Footer
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · Game Server ✦", W - 18, H - 12);
    return await canvas.toBuffer("png");
}

/**
 * DnD World Boss Raid — boss portrait to + thông tin đầy đủ
 */
export async function drawGsDndBossCard(boss, prefix = ".") {
    await ensureCanvas();
    if (!canvasAvailable || !boss) return null;

    const W = 900; const H = 560;
    const ART_W = 320;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const BOSS_PALETTES = {
        "🐉": { c1: "#4a0080", c2: "#7c4dff", text: "#d1a4ff" },
        "😈": { c1: "#6a0000", c2: "#c62828", text: "#ff9999" },
        "❄️": { c1: "#003049", c2: "#00b0ff", text: "#80deea" },
        "🔥": { c1: "#6a1800", c2: "#ff6f00", text: "#ffcc80" },
        "🌑": { c1: "#0a0a0a", c2: "#455a64", text: "#b0bec5" },
        "⚡": { c1: "#1a1a40", c2: "#f7d716", text: "#fff176" },
        "☠️": { c1: "#0d2600", c2: "#76ff03", text: "#ccff90" },
        "🗿": { c1: "#1a1200", c2: "#8d6e63", text: "#d7ccc8" },
        "🌊": { c1: "#00183d", c2: "#0077b6", text: "#90e0ef" },
        "💀": { c1: "#1a0028", c2: "#9c27b0", text: "#e040fb" },
    };
    const pal = BOSS_PALETTES[boss.emoji] || BOSS_PALETTES["😈"];

    // Background
    ctx.fillStyle = "#08080f"; ctx.fillRect(0, 0, W, H);

    // Right panel gradient
    const rBg = ctx.createLinearGradient(ART_W, 0, W, 0);
    rBg.addColorStop(0, pal.c2 + "22"); rBg.addColorStop(1, "#08080f");
    ctx.fillStyle = rBg; ctx.fillRect(ART_W, 0, W - ART_W, H);

    // Left panel — boss portrait (image or emoji fallback)
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, ART_W, H); ctx.clip();

    // Atmospheric background always
    const artBg = ctx.createRadialGradient(ART_W / 2, H * 0.4, 0, ART_W / 2, H / 2, ART_W);
    artBg.addColorStop(0, pal.c2 + "66");
    artBg.addColorStop(0.5, pal.c1 + "88");
    artBg.addColorStop(1, "#08080f");
    ctx.fillStyle = artBg; ctx.fillRect(0, 0, ART_W, H);

    // Try to load boss artwork image
    let bossImg = null;
    if (boss.imageUrl) {
        try { bossImg = await _pkLoadImg(boss.imageUrl); } catch {}
    }

    if (bossImg) {
        // Draw loaded artwork
        const ratio = Math.min(ART_W / bossImg.width, H / bossImg.height);
        const iw = bossImg.width * ratio; const ih = bossImg.height * ratio;
        ctx.globalAlpha = 0.92;
        ctx.shadowColor = pal.c2; ctx.shadowBlur = 30;
        ctx.drawImage(bossImg, (ART_W - iw) / 2, (H - ih) / 2, iw, ih);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    } else {
        // Fallback: decorative runes + big emoji
        ctx.globalAlpha = 0.07;
        for (let i = 0; i < 8; i++) {
            ctx.fillStyle = pal.text;
            ctx.font = `${20 + (i * 7) % 30}px Sans`;
            ctx.textAlign = "center";
            ctx.fillText(["✦","◆","⬟","⬡","★","◈","▲","⬛"][i], 40 + (i * 33) % (ART_W - 60), 40 + (i * 41) % (H - 60));
        }
        ctx.globalAlpha = 1;
        ctx.textAlign = "center"; ctx.font = "bold 140px Sans";
        ctx.shadowColor = pal.c2; ctx.shadowBlur = 60;
        ctx.fillStyle = "#fff"; ctx.globalAlpha = 0.9;
        ctx.fillText(boss.emoji, ART_W / 2, H * 0.55);
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    }

    // Bottom gradient overlay on portrait
    const nameG = ctx.createLinearGradient(0, H - 100, 0, H);
    nameG.addColorStop(0, "transparent"); nameG.addColorStop(1, "#08080fee");
    ctx.fillStyle = nameG; ctx.fillRect(0, H - 100, ART_W, 100);

    // Right fade on portrait
    const rFade = ctx.createLinearGradient(ART_W - 70, 0, ART_W, 0);
    rFade.addColorStop(0, "transparent"); rFade.addColorStop(1, "#08080f");
    ctx.fillStyle = rFade; ctx.fillRect(ART_W - 70, 0, 70, H);

    ctx.restore();

    // Left stripe
    const stripeG = ctx.createLinearGradient(0, 0, 0, H);
    stripeG.addColorStop(0, pal.c2); stripeG.addColorStop(1, pal.c2 + "55");
    ctx.fillStyle = stripeG; ctx.fillRect(0, 0, 5, H);

    // Rank badge on portrait
    if (boss.rank) {
        const rankBadgeX = 14; const rankBadgeY = H - 56;
        drawRoundRect(ctx, rankBadgeX, rankBadgeY, 68, 24, 10);
        ctx.fillStyle = pal.c2 + "cc"; ctx.fill();
        ctx.textAlign = "center"; ctx.fillStyle = "#fff";
        ctx.font = "bold 12px BeVietnamProBold, Sans";
        ctx.fillText(`RANK ${boss.rank}`, rankBadgeX + 34, rankBadgeY + 15);
    }
    ctx.textAlign = "left"; ctx.fillStyle = pal.text;
    ctx.font = "bold 11px BeVietnamPro, Sans"; ctx.globalAlpha = 0.85;
    ctx.fillText("WORLD BOSS", 14, H - 26);
    ctx.globalAlpha = 1;

    // ─── Right panel ──────────────────────────────────────────────────────────
    const rx = ART_W + 22; const rW = W - rx - 18;

    // Alert header
    ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(ART_W, 0, W - ART_W, 54);
    ctx.strokeStyle = pal.c2 + "44"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ART_W, 54); ctx.lineTo(W, 54); ctx.stroke();

    ctx.textAlign = "left"; ctx.fillStyle = pal.text;
    ctx.font = "bold 13px BeVietnamProBold, Sans";
    ctx.fillText(`${boss.emoji} DnD WORLD BOSS RAID!`, rx, 22);
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("Boss thế giới xuất hiện · Tập hợp chiến đấu!", rx, 40);
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText("⏰ 15 phút", W - 22, 32);

    // Boss name
    ctx.textAlign = "left"; ctx.fillStyle = "#fff";
    ctx.font = "bold 38px BeVietnamProBold, Sans";
    ctx.fillText(boss.name, rx, 96);

    // Type & Rank badges
    let bx = rx; const bY = 112;
    // Type badge
    if (boss.type) {
        const typeLabel = boss.type;
        const typeW = ctx.measureText(typeLabel).width + 20;
        drawRoundRect(ctx, bx, bY, typeW, 22, 8);
        ctx.fillStyle = pal.c2 + "55"; ctx.fill();
        ctx.strokeStyle = pal.c2 + "aa"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = pal.text; ctx.font = "bold 11px BeVietnamPro, Sans";
        ctx.fillText(typeLabel, bx + 10, bY + 14);
        bx += typeW + 8;
    }

    // HP
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("❤️  HP BOSS", rx, 152);
    _gsDrawHpBar(ctx, rx, 160, rW, 24, boss.hp, boss.maxHp, 7);
    ctx.textAlign = "right"; ctx.fillStyle = _gsHpColor(boss.hp / boss.maxHp);
    ctx.font = "bold 13px BeVietnamProBold, Sans";
    ctx.fillText(`${Math.round(boss.hp / boss.maxHp * 100)}%`, W - 22, 176);
    ctx.textAlign = "left";

    // Stats row (Giáp + Raider)
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(`🛡 Giáp: ${boss.def || 0}`, rx, 200);
    ctx.fillText(`👥 ${boss.raiders?.size || 0} chiến binh`, rx + 130, 200);

    // Phase badge
    const phaseLabel = boss.phase === "joining" ? "🟡 Đang tập hợp" : "🔴 Đang chiến đấu";
    const phaseColor = boss.phase === "joining" ? "#ffd700" : "#ff4444";
    drawRoundRect(ctx, rx, 212, 190, 24, 10);
    ctx.fillStyle = phaseColor + "28"; ctx.fill();
    ctx.strokeStyle = phaseColor + "88"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = phaseColor; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText(phaseLabel, rx + 10, 228);

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rx, 248); ctx.lineTo(W - 18, 248); ctx.stroke();

    // Weakness info
    if (boss.weaknessNames?.length) {
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 10px BeVietnamPro, Sans";
        ctx.fillText("💡 ĐIỂM YẾU", rx, 266);
        ctx.fillStyle = "#ffe082"; ctx.font = "bold 12px BeVietnamProBold, Sans";
        ctx.fillText(boss.weaknessNames.join(" / ") + "  →  DMG ×1.5!", rx, 282);
    }

    // Special ability
    if (boss.special?.name) {
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 10px BeVietnamPro, Sans";
        ctx.fillText("⚡ KỸ NĂNG ĐẶC BIỆT", rx, 302);
        ctx.fillStyle = pal.text; ctx.font = "bold 12px BeVietnamProBold, Sans";
        ctx.fillText(boss.special.name, rx, 318);
    }

    // Description
    if (boss.desc) {
        ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "11px BeVietnamPro, Sans";
        _gsWrapText(ctx, boss.desc, rx, 340, rW, 16, 2);
    }

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rx, 374); ctx.lineTo(W - 18, 374); ctx.stroke();

    // Commands
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 10px BeVietnamPro, Sans";
    ctx.fillText("LỆNH", rx, 392);
    const cmds = boss.phase === "joining"
        ? [[`${prefix}gs dnd join`, "Tham gia raid"], [`${prefix}gs dnd attack [nguyên tố]`, "Tấn công boss"]]
        : [[`${prefix}gs dnd attack [nguyên tố]`, "Tấn công boss"], [`${prefix}gs dnd status`, "Xem trạng thái"]];
    let cy = 406;
    for (const [cmd, desc] of cmds) {
        drawRoundRect(ctx, rx, cy, rW, 30, 8);
        ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fill();
        ctx.strokeStyle = pal.c2 + "44"; ctx.lineWidth = 1; ctx.stroke();
        ctx.fillStyle = pal.text; ctx.font = "bold 13px BeVietnamProBold, Sans";
        ctx.fillText(cmd, rx + 12, cy + 19);
        ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "11px BeVietnamPro, Sans";
        ctx.fillText(`— ${desc}`, rx + 12 + ctx.measureText(cmd).width + 6, cy + 19);
        cy += 36;
    }

    // Reward box
    drawRoundRect(ctx, rx, cy + 4, rW, 68, 12);
    ctx.fillStyle = "rgba(255,215,0,0.07)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,215,0,0.25)"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#ffd700"; ctx.font = "bold 10px BeVietnamProBold, Sans";
    ctx.fillText("🏆 PHẦN THƯỞNG", rx + 14, cy + 22);
    const gld = boss.reward?.gold || "?"; const xp = boss.reward?.xp || "?";
    ctx.fillStyle = "rgba(255,255,255,0.65)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(`👑 MVP: ${gld} vàng + ${xp} XP`, rx + 14, cy + 42);
    ctx.fillText(`🎁 Tất cả raider: Vàng + XP theo đóng góp`, rx + 14, cy + 58);

    // Footer
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · Game Server ✦", W - 18, H - 10);
    return await canvas.toBuffer("png");
}

/**
 * Attack card — ảnh boss to mờ + số damage + HP bar
 */
export async function drawGsAttackCard(boss, attackerName, damage, isCrit = false, type = "pokemon") {
    await ensureCanvas();
    if (!canvasAvailable || !boss) return null;

    const W = 900; const H = 300;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const isDnd     = type === "dnd";
    const sp        = isDnd ? null : boss.species;
    const bossName  = isDnd ? boss.name : sp?.name;
    const mainType  = sp?.types?.[0] || "Normal";
    const typeColor = isDnd ? "#c62828" : _pkTypeColor(mainType);
    const flashC    = isCrit ? "#ffd700" : "#ff4444";
    const hpPct     = boss.hp / boss.maxHp;

    // Background
    ctx.fillStyle = "#0d0510"; ctx.fillRect(0, 0, W, H);

    // Load artwork & draw full-bleed (faded)
    const artUrl = isDnd
        ? (boss.imageUrl || null)
        : (sp?.ogImage || (sp ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${sp.dexId}.png` : null));
    const artImg = artUrl ? await _pkLoadImg(artUrl) : null;
    if (artImg) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        const ratio = Math.min(W * 0.45 / artImg.width, H / artImg.height);
        const aw = artImg.width * ratio; const ah = artImg.height * ratio;
        ctx.shadowColor = typeColor; ctx.shadowBlur = 30;
        ctx.drawImage(artImg, (W * 0.25 - aw / 2), (H - ah) / 2, aw, ah);
        ctx.restore();
    } else if (isDnd && boss.emoji) {
        ctx.globalAlpha = 0.15; ctx.textAlign = "center";
        ctx.font = "bold 220px Sans"; ctx.fillStyle = "#fff";
        ctx.fillText(boss.emoji, W * 0.25, H * 0.75);
        ctx.globalAlpha = 1;
    }

    // Flash overlay
    const flashG = ctx.createRadialGradient(W * 0.62, H / 2, 0, W * 0.62, H / 2, 230);
    flashG.addColorStop(0, flashC + "30"); flashG.addColorStop(1, "transparent");
    ctx.fillStyle = flashG; ctx.fillRect(0, 0, W, H);

    // Left stripe
    ctx.fillStyle = typeColor;
    ctx.fillRect(0, 0, 5, H);

    // Border
    ctx.strokeStyle = typeColor + "44"; ctx.lineWidth = 1;
    drawRoundRect(ctx, 1, 1, W - 2, H - 2, 10); ctx.stroke();

    // Left info: attacker + boss
    const lx = 22;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("TẤN CÔNG", lx, 32);
    ctx.fillStyle = "#fff"; ctx.font = "bold 26px BeVietnamProBold, Sans";
    ctx.fillText(attackerName, lx, 62);
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "14px BeVietnamPro, Sans";
    ctx.fillText(`đánh ${bossName}!`, lx, 86);

    // HP bar
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("❤️ BOSS HP", lx, 120);
    _gsDrawHpBar(ctx, lx, 128, W * 0.46, 28, boss.hp, boss.maxHp, 8);
    ctx.textAlign = "left";
    ctx.fillStyle = _gsHpColor(hpPct); ctx.font = "bold 12px BeVietnamProBold, Sans";
    ctx.fillText(`${Math.round(hpPct * 100)}% còn lại`, lx, 176);

    const partSize = isDnd ? boss.raiders?.size : boss.participants?.size;
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(`👥 ${partSize || 0} người tham chiến`, lx, 200);

    // Types
    if (!isDnd && sp?.types_vi?.length) {
        let tx2 = lx;
        for (const t of sp.types_vi.slice(0, 2)) { tx2 += _pkDrawTypeBadge(ctx, t, tx2, 228, 11); }
    }

    // Center: DAMAGE NUMBER
    const cx = W * 0.62;
    ctx.textAlign = "center";
    ctx.shadowColor = flashC; ctx.shadowBlur = 30;
    ctx.fillStyle = flashC;
    ctx.font = `bold ${isCrit ? 80 : 72}px BeVietnamProBold, Sans`;
    ctx.fillText(`-${damage}`, cx, H / 2 + 20);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.fillText("DMG", cx, H / 2 + 46);
    if (isCrit) {
        ctx.fillStyle = "#ffd700"; ctx.font = "bold 18px BeVietnamProBold, Sans";
        ctx.shadowColor = "#ffd700"; ctx.shadowBlur = 15;
        ctx.fillText("💥 CRITICAL HIT!", cx, H / 2 + 76);
        ctx.shadowBlur = 0;
    }

    // Right: Boss artwork thumbnail (cleaner)
    if (artImg) {
        ctx.save();
        const rx2 = W * 0.82; const ry2 = H / 2 - 80;
        ctx.beginPath(); ctx.arc(rx2, ry2 + 70, 80, 0, Math.PI * 2); ctx.clip();
        ctx.globalAlpha = 0.7;
        ctx.shadowColor = typeColor; ctx.shadowBlur = 20;
        const r2 = Math.min(160 / artImg.width, 160 / artImg.height);
        ctx.drawImage(artImg, rx2 - artImg.width * r2 / 2, ry2, artImg.width * r2, artImg.height * r2);
        ctx.restore();
    } else if (isDnd) {
        ctx.textAlign = "center"; ctx.globalAlpha = 0.6;
        ctx.font = "bold 90px Sans"; ctx.fillStyle = "#fff";
        ctx.fillText(boss.emoji || "😈", W * 0.85, H * 0.65);
        ctx.globalAlpha = 1;
    }

    // Footer
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · Game Server ✦", W - 18, H - 12);
    return await canvas.toBuffer("png");
}

/**
 * Boss Defeated leaderboard — artwork boss tối + bảng chiến công
 */
export async function drawGsBossDefeatedCard(boss, sorted, mvpName, type = "pokemon") {
    await ensureCanvas();
    if (!canvasAvailable || !boss) return null;

    const top  = sorted.slice(0, 5);
    const W = 900; const H = 160 + top.length * 78 + 60;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const isDnd    = type === "dnd";
    const sp       = isDnd ? null : boss.species;
    const bossName = isDnd ? boss.name : sp?.name;
    const bossEmoji = isDnd ? (boss.emoji || "💀") : "👾";
    const mainType = sp?.types?.[0] || "Normal";
    const typeColor = isDnd ? "#c62828" : _pkTypeColor(mainType);

    // Background
    ctx.fillStyle = "#0a0c0a"; ctx.fillRect(0, 0, W, H);
    const bgG = ctx.createLinearGradient(0, 0, W, H);
    bgG.addColorStop(0, "#ffd70012"); bgG.addColorStop(1, "transparent");
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

    // Load boss artwork
    const artUrl = isDnd
        ? (boss.imageUrl || null)
        : (sp?.ogImage || (sp ? `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${sp?.dexId}.png` : null));
    const artImg = artUrl ? await _pkLoadImg(artUrl) : null;

    // Header background (with artwork)
    const hH = 140;
    ctx.fillStyle = "rgba(255,215,0,0.08)"; ctx.fillRect(0, 0, W, hH);

    // Boss artwork right side (faded)
    if (artImg) {
        ctx.save();
        ctx.globalAlpha = 0.2;
        const ratio = Math.min(W * 0.35 / artImg.width, hH / artImg.height);
        const aw = artImg.width * ratio; const ah = artImg.height * ratio;
        ctx.drawImage(artImg, W - aw - 10, (hH - ah) / 2, aw, ah);
        ctx.restore();
    } else if (isDnd) {
        ctx.globalAlpha = 0.15; ctx.textAlign = "center";
        ctx.font = "bold 100px Sans"; ctx.fillStyle = "#fff";
        ctx.fillText(boss.emoji, W - 110, hH - 10);
        ctx.globalAlpha = 1;
    }

    // Gold border top
    const glG = ctx.createLinearGradient(0, 0, W, 0);
    glG.addColorStop(0, "#ffd700"); glG.addColorStop(1, "#ffd70022");
    ctx.fillStyle = glG; ctx.fillRect(0, 0, W, 4);

    // Header text
    ctx.textAlign = "left";
    ctx.fillStyle = "#ffd700"; ctx.font = "bold 12px BeVietnamPro, Sans";
    ctx.fillText("🌐 GAME SERVER · BOSS ĐÃ BỊ HẠ!", 26, 28);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 38px BeVietnamProBold, Sans";
    ctx.fillText(`${bossEmoji} ${bossName} bị đánh bại!`, 26, 76);
    ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.font = "16px BeVietnamPro, Sans";
    ctx.fillText(`👑 MVP: ${mvpName}  ·  🏅 Mọi người nhận thưởng!`, 26, 104);

    ctx.textAlign = "right"; ctx.fillStyle = "#ffd700";
    ctx.font = "bold 28px BeVietnamProBold, Sans";
    ctx.fillText("🏆 CHIẾN THẮNG!", W - 26, 80);

    // Divider
    ctx.strokeStyle = "rgba(255,215,0,0.2)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(18, hH); ctx.lineTo(W - 18, hH); ctx.stroke();

    // Leaderboard header
    ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("📊 BẢNG CHIẾN CÔNG", 26, hH + 18);

    const rankColors = ["#ffd700", "#c0c0c0", "#cd7f32", "rgba(255,255,255,0.55)", "rgba(255,255,255,0.4)"];
    const rankEmojis = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
    const maxDmg = top[0]?.[1]?.dmg || 1;

    let ry = hH + 28;
    for (let i = 0; i < top.length; i++) {
        const [, pd] = top[i];
        const rColor = rankColors[i] || "rgba(255,255,255,0.4)";
        const rowH = 70;

        // Row background
        drawRoundRect(ctx, 14, ry, W - 28, rowH - 6, 10);
        ctx.fillStyle = i === 0 ? "rgba(255,215,0,0.12)" : "rgba(255,255,255,0.04)";
        ctx.fill();
        ctx.strokeStyle = i === 0 ? "rgba(255,215,0,0.3)" : "rgba(255,255,255,0.06)";
        ctx.lineWidth = 1; ctx.stroke();

        // Rank badge
        ctx.textAlign = "center"; ctx.font = "22px Sans";
        ctx.fillStyle = rColor;
        ctx.fillText(rankEmojis[i], 46, ry + 26);
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "bold 9px BeVietnamPro, Sans";
        ctx.fillText(`${pd.hits} đòn`, 46, ry + 42);

        // Name
        ctx.textAlign = "left"; ctx.fillStyle = i === 0 ? "#ffd700" : "#fff";
        ctx.font = `bold ${i === 0 ? 20 : 17}px BeVietnamProBold, Sans`;
        ctx.fillText(pd.name, 76, ry + 24);

        // DMG bar
        const barX = 76; const barW = W - barX - 160;
        const barY = ry + 34;
        drawRoundRect(ctx, barX, barY, barW, 8, 4);
        ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fill();
        const fillW = (pd.dmg / maxDmg) * barW;
        if (fillW > 0) {
            drawRoundRect(ctx, barX, barY, fillW, 8, 4);
            const barG = ctx.createLinearGradient(barX, 0, barX + fillW, 0);
            barG.addColorStop(0, rColor + "99"); barG.addColorStop(1, rColor);
            ctx.fillStyle = barG; ctx.fill();
        }

        // DMG number
        ctx.textAlign = "right"; ctx.fillStyle = rColor;
        ctx.font = `bold ${i === 0 ? 20 : 17}px BeVietnamProBold, Sans`;
        ctx.fillText(`${pd.dmg} DMG`, W - 26, ry + 26);
        ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.font = "11px BeVietnamPro, Sans";
        ctx.fillText(`${Math.round(pd.dmg / maxDmg * 100)}%`, W - 26, ry + 46);

        ry += rowH;
    }

    // Footer reward note
    ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "13px BeVietnamPro, Sans";
    ctx.fillText("💰 Tất cả người tham chiến đã nhận xu / vàng thưởng!", W / 2, ry + 20);
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · Game Server ✦", W - 18, H - 12);
    return await canvas.toBuffer("png");
}

/**
 * Game Server Status card
 */
export async function drawGsStatusCard(gsData, threadId, nowMoment, pkBoss = null, dndBoss = null) {
    await ensureCanvas();
    if (!canvasAvailable) return null;

    const W = 900; const H = 640;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const group       = gsData.groups?.[threadId];
    const totalGroups = Object.keys(gsData.groups || {}).length;
    const minLeft     = 30 - (nowMoment.minute() % 30);
    const timeStr     = nowMoment.format("HH:mm  DD/MM/YYYY");
    const pkActive    = pkBoss  && pkBoss.phase  === "active";
    const dndActive   = dndBoss && (dndBoss.phase === "joining" || dndBoss.phase === "battle");
    const registered  = !!group;

    // Background
    ctx.fillStyle = "#0c1020"; ctx.fillRect(0, 0, W, H);
    const bg2 = ctx.createLinearGradient(0, 0, W, H);
    bg2.addColorStop(0, "#1a237e18"); bg2.addColorStop(1, "#0f346015");
    ctx.fillStyle = bg2; ctx.fillRect(0, 0, W, H);

    // Header
    const hG = ctx.createLinearGradient(0, 0, W, 0);
    hG.addColorStop(0, "#1a237e"); hG.addColorStop(1, "#283593");
    ctx.fillStyle = hG; ctx.fillRect(0, 0, W, 120);

    // Decoration circles
    ctx.globalAlpha = 0.06; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(W - 60, -25, 120, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(W - 15, 105, 70, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;

    // Header content
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 12px BeVietnamPro, Sans";
    ctx.fillText("🌐 GAME SERVER", 28, 32);
    ctx.fillStyle = "#fff"; ctx.font = "bold 40px BeVietnamProBold, Sans";
    ctx.fillText("Trạng thái Server", 28, 84);

    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 12px BeVietnamPro, Sans";
    ctx.fillText("🕐 " + timeStr, W - 28, 38);
    ctx.fillStyle = "#69db7c"; ctx.font = "bold 16px BeVietnamProBold, Sans";
    ctx.fillText(`${totalGroups} nhóm đang tham gia`, W - 28, 64);
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(`HP Boss scale ×${totalGroups <= 3 ? "1.0" : totalGroups <= 6 ? "1.5" : "2.0"}`, W - 28, 84);

    // Registration badge
    const regY = 140;
    drawRoundRect(ctx, 20, regY, W - 40, 60, 12);
    ctx.fillStyle = registered ? "rgba(100,200,100,0.1)" : "rgba(255,100,100,0.08)";
    ctx.fill();
    ctx.strokeStyle = registered ? "#69db7c66" : "#ff6b6b66"; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = registered ? "#69db7c" : "#ff6b6b";
    ctx.font = "bold 22px BeVietnamProBold, Sans";
    ctx.fillText(registered ? "✅  Nhóm này ĐÃ ĐĂNG KÝ" : "❌  Nhóm chưa đăng ký Game Server", 36, regY + 28);
    if (registered) {
        const evts = Object.entries(group.events || {}).filter(([, v]) => v).map(([k]) => k === "pokemon" ? "Pokemon" : "DnD").join("  +  ");
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "13px BeVietnamPro, Sans";
        ctx.fillText(`Nhận sự kiện: ${evts || "tất cả"}`, 36, regY + 50);
    }

    // Event schedule cards (3 columns)
    const eY = 220; const eColW = (W - 40 - 24) / 3;
    const evts = [
        { icon: "🌿", label: "Wild Rush",         color: "#66bb6a", times: "Mỗi 30 phút",      next: `Còn ${minLeft} phút` },
        { icon: "⚡", label: "Pokemon Boss Raid", color: "#ffca28", times: "08h·12h·16h·20h",  next: "4 lần/ngày" },
        { icon: "🐉", label: "DnD World Boss",    color: "#7c4dff", times: "10h·16h·22h",       next: "3 lần/ngày" },
    ];
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("LỊCH SỰ KIỆN", 28, eY - 8);
    for (let i = 0; i < evts.length; i++) {
        const ev = evts[i]; const ex = 20 + i * (eColW + 12);
        drawRoundRect(ctx, ex, eY, eColW, 118, 12);
        ctx.fillStyle = ev.color + "15"; ctx.fill();
        ctx.strokeStyle = ev.color + "55"; ctx.lineWidth = 1; ctx.stroke();
        ctx.textAlign = "center";
        ctx.font = "30px Sans"; ctx.fillStyle = ev.color;
        ctx.fillText(ev.icon, ex + eColW / 2, eY + 44);
        ctx.fillStyle = "#fff"; ctx.font = "bold 15px BeVietnamProBold, Sans";
        ctx.fillText(ev.label, ex + eColW / 2, eY + 72);
        ctx.fillStyle = ev.color; ctx.font = "bold 12px BeVietnamPro, Sans";
        ctx.fillText(ev.next, ex + eColW / 2, eY + 94);
        ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "11px BeVietnamPro, Sans";
        ctx.fillText(ev.times, ex + eColW / 2, eY + 112);
    }

    // Active bosses section
    const bossY = eY + 140;
    ctx.textAlign = "left"; ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("BOSS ĐANG HOẠT ĐỘNG", 28, bossY);

    let by = bossY + 14;
    if (!pkActive && !dndActive) {
        drawRoundRect(ctx, 20, by, W - 40, 58, 12);
        ctx.fillStyle = "rgba(255,255,255,0.03)"; ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1; ctx.stroke();
        ctx.textAlign = "center"; ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.font = "14px BeVietnamPro, Sans";
        ctx.fillText("💤 Không có boss nào đang hoạt động", W / 2, by + 34);
        by += 64;
    } else {
        const bosses = [];
        if (pkActive)  bosses.push({ label: "⚡ POKEMON BOSS", name: pkBoss.species?.name, hp: pkBoss.hp, maxHp: pkBoss.maxHp, count: pkBoss.participants?.size, color: "#ffca28", time: pkBoss.expiresAt });
        if (dndActive) bosses.push({ label: `🐉 DnD BOSS`, name: dndBoss.name, hp: dndBoss.hp, maxHp: dndBoss.maxHp, count: dndBoss.raiders?.size, color: "#7c4dff", time: dndBoss.expiresAt });

        for (const b of bosses) {
            const remain = Math.max(0, Math.round((b.time - Date.now()) / 60000));
            drawRoundRect(ctx, 20, by, W - 40, 78, 12);
            ctx.fillStyle = b.color + "18"; ctx.fill();
            ctx.strokeStyle = b.color + "55"; ctx.lineWidth = 1; ctx.stroke();

            ctx.textAlign = "left"; ctx.fillStyle = b.color;
            ctx.font = "bold 11px BeVietnamPro, Sans";
            ctx.fillText(b.label, 36, by + 20);
            ctx.fillStyle = "#fff"; ctx.font = "bold 20px BeVietnamProBold, Sans";
            ctx.fillText(b.name, 36, by + 46);

            _gsDrawHpBar(ctx, 240, by + 30, W - 280, 20, b.hp, b.maxHp, 6);

            ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.4)";
            ctx.font = "12px BeVietnamPro, Sans";
            ctx.fillText(`👥 ${b.count || 0} người  ·  ⏰ ${remain} phút`, W - 30, by + 62);
            by += 86;
        }
    }

    // Footer
    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · Game Server ✦", W - 20, H - 12);
    return await canvas.toBuffer("png");
}

// ─────────────────────────────────────────────────────────────────────────────
//  DnD CANVAS FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

const DND_CHAR_COLORS = {
    warrior: "#e53935", mage: "#7c4dff", rogue: "#43a047", healer: "#1e88e5",
};

/**
 * Vẽ card trạng thái người chơi DnD (dùng cho .dnd status và explore)
 * @param {object} state - Session state từ dnd.js
 * @returns {Buffer|null}
 */
export async function drawDndStatusCard(state) {
    await ensureCanvas();
    if (!canvasAvailable || !state) return null;

    const W = 900; const H = 460;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const accent = DND_CHAR_COLORS[state.charKey] || "#4fc3f7";
    const hpPct  = Math.max(0, state.hp / state.maxHp);
    const hpColor = hpPct > 0.6 ? "#69db7c" : hpPct > 0.3 ? "#ffa94d" : "#ff6b6b";
    const xpForNext = 100 * state.level * state.level;
    const xpPct = Math.min(state.xp / xpForNext, 1);

    // Background
    ctx.fillStyle = "#0c1422"; ctx.fillRect(0, 0, W, H);
    const bgG = ctx.createRadialGradient(200, H / 2, 0, 200, H / 2, 320);
    bgG.addColorStop(0, accent + "22"); bgG.addColorStop(1, "transparent");
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

    // Border
    ctx.strokeStyle = accent + "55"; ctx.lineWidth = 2;
    drawRoundRect(ctx, 1, 1, W - 2, H - 2, 14); ctx.stroke();

    // Header bar
    const hGrad = ctx.createLinearGradient(0, 0, W, 0);
    hGrad.addColorStop(0, accent + "cc"); hGrad.addColorStop(1, accent + "33");
    ctx.fillStyle = hGrad; ctx.fillRect(0, 0, W, 100);

    // Character emoji
    ctx.textAlign = "center"; ctx.font = "60px Sans";
    ctx.globalAlpha = 0.9; ctx.fillStyle = "#fff";
    ctx.fillText(state.charEmoji, 62, 74); ctx.globalAlpha = 1;

    // Character name
    ctx.textAlign = "left"; ctx.fillStyle = "#fff";
    ctx.font = "bold 30px BeVietnamProBold, Sans";
    ctx.fillText(state.char, 108, 48);

    // Level badge
    drawRoundRect(ctx, 108, 56, 88, 26, 13);
    ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.fill();
    ctx.fillStyle = "#fff"; ctx.font = "bold 13px BeVietnamPro, Sans";
    ctx.fillText(`⭐ Lv. ${state.level}`, 120, 73);

    // Phase + Dungeon (right)
    const phaseColor = state.phase === "battle" ? "#ff6b6b" : "#69db7c";
    const phaseLabel = state.phase === "battle"
        ? `⚔️ Chiến đấu vs ${state.enemy?.name || "kẻ thù"}`
        : "🗺 Đang khám phá";
    ctx.textAlign = "right";
    ctx.fillStyle = phaseColor; ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.fillText(phaseLabel, W - 22, 36);
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(state.dungeon, W - 22, 58);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(`Phòng ${state.room}`, W - 22, 78);

    // HP bar
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("❤️  HP", 28, 128);
    ctx.fillStyle = hpColor; ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.fillText(`${state.hp} / ${state.maxHp}`, 68, 128);
    const barW1 = W - 56 - 220;
    drawRoundRect(ctx, 28, 136, barW1, 10, 5); ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fill();
    if (hpPct > 0) {
        drawRoundRect(ctx, 28, 136, barW1 * hpPct, 10, 5);
        ctx.fillStyle = hpColor; ctx.fill();
    }

    // XP bar
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText("⭐ XP", 28, 164);
    ctx.fillStyle = "#ffd700"; ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.fillText(`${state.xp} / ${xpForNext}`, 68, 164);
    drawRoundRect(ctx, 28, 172, barW1, 10, 5); ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fill();
    if (xpPct > 0) {
        drawRoundRect(ctx, 28, 172, barW1 * xpPct, 10, 5);
        ctx.fillStyle = "#ffd700"; ctx.fill();
    }

    // Stats grid
    const statBoxes = [
        { label: "🛡 DEF",       value: state.def,           color: "#4fc3f7" },
        { label: "⚔️ ATK",       value: state.atk,           color: "#ffa94d" },
        { label: "💰 Vàng",      value: state.gold,          color: "#ffd700" },
        { label: "🔮 Kỹ năng",   value: state.abilityUsed ? "Đã dùng" : "Sẵn sàng",
                                  color: state.abilityUsed ? "#666" : "#69db7c" },
    ];
    const sgW = (W - 56) / statBoxes.length;
    for (let i = 0; i < statBoxes.length; i++) {
        const s = statBoxes[i]; const sx = 28 + i * sgW;
        drawRoundRect(ctx, sx, 198, sgW - 8, 64, 10);
        ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fill();
        ctx.strokeStyle = s.color + "33"; ctx.lineWidth = 1; ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 9px BeVietnamPro, Sans";
        ctx.fillText(s.label, sx + (sgW - 8) / 2, 218);
        ctx.fillStyle = s.color; ctx.font = "bold 16px BeVietnamProBold, Sans";
        ctx.fillText(String(s.value), sx + (sgW - 8) / 2, 246);
    }

    // Ability info box
    drawRoundRect(ctx, 28, 278, W - 56, 60, 10);
    ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fill();
    ctx.strokeStyle = accent + "22"; ctx.lineWidth = 1; ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 10px BeVietnamPro, Sans";
    ctx.fillText("KỸ NĂNG ĐẶC BIỆT", 44, 298);
    ctx.fillStyle = state.abilityUsed ? "rgba(255,255,255,0.3)" : accent;
    ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.fillText(`✨ ${state.ability}${state.abilityUsed ? "  (đã dùng)" : ""}`, 44, 322);

    // Action footer bar
    ctx.fillStyle = "rgba(255,255,255,0.05)"; ctx.fillRect(0, 354, W, H - 354);
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 354); ctx.lineTo(W, 354); ctx.stroke();

    const footerActions = state.phase === "battle"
        ? [["1", "Tấn công", "#ff6b6b"], ["2", "Kỹ năng", accent], ["3", "Nghỉ", "#69db7c"], ["5", "Status", "#888"]]
        : [["4", "Khám phá", "#69db7c"], ["3", "Nghỉ", "#4fc3f7"], ["2", "Kỹ năng", accent], ["5", "Status", "#888"]];
    const aW = W / footerActions.length;
    for (let i = 0; i < footerActions.length; i++) {
        const [num, label, col] = footerActions[i]; const ax = i * aW;
        ctx.textAlign = "center";
        ctx.fillStyle = col; ctx.font = "bold 22px BeVietnamProBold, Sans";
        ctx.fillText(num, ax + aW / 2, 390);
        ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "11px BeVietnamPro, Sans";
        ctx.fillText(label, ax + aW / 2, 410);
        if (i > 0) {
            ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(ax, 359); ctx.lineTo(ax, H - 4); ctx.stroke();
        }
    }

    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · D&D System ✦", W - 20, H - 12);
    return await canvas.toBuffer("png");
}

/**
 * Vẽ card chiến đấu DnD (dùng khi gặp kẻ thù, tấn công, dùng kỹ năng)
 * @param {object} state - Session state từ dnd.js
 * @returns {Buffer|null}
 */
export async function drawDndBattleCard(state) {
    await ensureCanvas();
    if (!canvasAvailable || !state || !state.enemy) return null;

    const W = 900; const H = 400;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    const accent  = DND_CHAR_COLORS[state.charKey] || "#4fc3f7";
    const phPct   = Math.max(0, state.hp / state.maxHp);
    const phColor = phPct > 0.6 ? "#69db7c" : phPct > 0.3 ? "#ffa94d" : "#ff6b6b";
    const ehPct   = Math.max(0, state.enemy.hp / state.enemy.maxHp);
    const ehColor = ehPct > 0.6 ? "#69db7c" : ehPct > 0.3 ? "#ffa94d" : "#ff6b6b";
    const MID     = W / 2;

    // Background
    ctx.fillStyle = "#130a0a"; ctx.fillRect(0, 0, W, H);
    const bgG = ctx.createLinearGradient(0, 0, W, H);
    bgG.addColorStop(0, "#2a050522"); bgG.addColorStop(1, "#0a050a22");
    ctx.fillStyle = bgG; ctx.fillRect(0, 0, W, H);

    // Left glow (player) / Right glow (enemy)
    const lGlow = ctx.createRadialGradient(180, H / 2, 0, 180, H / 2, 220);
    lGlow.addColorStop(0, accent + "22"); lGlow.addColorStop(1, "transparent");
    ctx.fillStyle = lGlow; ctx.fillRect(0, 0, MID, H);
    const rGlow = ctx.createRadialGradient(W - 180, H / 2, 0, W - 180, H / 2, 220);
    rGlow.addColorStop(0, "#ff444422"); rGlow.addColorStop(1, "transparent");
    ctx.fillStyle = rGlow; ctx.fillRect(MID, 0, MID, H);

    // Border + accent stripes
    ctx.strokeStyle = "#ff444433"; ctx.lineWidth = 2;
    drawRoundRect(ctx, 1, 1, W - 2, H - 2, 12); ctx.stroke();
    ctx.fillStyle = accent; ctx.fillRect(0, 0, 4, H);
    ctx.fillStyle = "#ff4444"; ctx.fillRect(W - 4, 0, 4, H);

    // Header
    ctx.fillStyle = "rgba(255,50,50,0.15)"; ctx.fillRect(0, 0, W, 58);
    ctx.strokeStyle = "rgba(255,50,50,0.3)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 58); ctx.lineTo(W, 58); ctx.stroke();

    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6b6b"; ctx.shadowColor = "#ff4444"; ctx.shadowBlur = 14;
    ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.fillText("⚔️ CHIẾN ĐẤU!", MID, 24); ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText(`${state.dungeon}  ·  Phòng ${state.room}`, MID, 46);

    // Center divider + VS
    ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(MID, 68); ctx.lineTo(MID, H - 60); ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff4444"; ctx.shadowColor = "#ff4444"; ctx.shadowBlur = 20;
    ctx.font = "bold 32px BeVietnamProBold, Sans";
    ctx.fillText("VS", MID, H / 2); ctx.shadowBlur = 0;

    // ── PLAYER (left) ────────────────────────────────────────────────────────
    const pX = 50;
    ctx.textAlign = "left";
    ctx.font = "80px Sans"; ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.9; ctx.fillText(state.charEmoji, pX, 160); ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff"; ctx.font = "bold 26px BeVietnamProBold, Sans";
    ctx.fillText(state.char, pX, 188);
    ctx.fillStyle = accent; ctx.font = "bold 13px BeVietnamPro, Sans";
    ctx.fillText(`Lv. ${state.level}`, pX, 206);

    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText(`❤️  ${state.hp} / ${state.maxHp} HP`, pX, 228);
    const pBarW = MID - pX - 32;
    drawRoundRect(ctx, pX, 234, pBarW, 12, 6); ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fill();
    if (phPct > 0) {
        drawRoundRect(ctx, pX, 234, pBarW * phPct, 12, 6);
        ctx.fillStyle = phColor; ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(`🛡 DEF ${state.def}    ⚔️ ATK ${state.atk}`, pX, 264);
    ctx.fillStyle = state.abilityUsed ? "rgba(255,255,255,0.2)" : accent;
    ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText(`✨ ${state.ability}${state.abilityUsed ? " (đã dùng)" : ""}`, pX, 282);

    // ── ENEMY (right) ────────────────────────────────────────────────────────
    const eRX = W - 30;
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff"; ctx.font = "bold 32px BeVietnamProBold, Sans";
    ctx.fillText(state.enemy.name, eRX, 128);
    ctx.fillStyle = "#ff9999"; ctx.font = "bold 13px BeVietnamPro, Sans";
    ctx.fillText(`🛡 AC: ${state.enemy.ac}`, eRX, 150);
    ctx.font = "80px Sans"; ctx.fillStyle = "#ff4444";
    ctx.globalAlpha = 0.7; ctx.fillText("💀", eRX, 230); ctx.globalAlpha = 1;

    ctx.fillStyle = "rgba(255,255,255,0.4)"; ctx.font = "bold 11px BeVietnamPro, Sans";
    ctx.fillText(`❤️  ${state.enemy.hp} / ${state.enemy.maxHp} HP`, eRX, 254);
    const eX = MID + 30; const eBarW = eRX - eX;
    drawRoundRect(ctx, eX, 260, eBarW, 12, 6); ctx.fillStyle = "rgba(255,255,255,0.1)"; ctx.fill();
    if (ehPct > 0) {
        drawRoundRect(ctx, eX, 260, eBarW * ehPct, 12, 6);
        ctx.fillStyle = ehColor; ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.3)"; ctx.font = "12px BeVietnamPro, Sans";
    ctx.fillText(`⚔️ ATK: ${state.enemy.atk}`, eRX, 292);

    // ── ACTION BAR ───────────────────────────────────────────────────────────
    ctx.fillStyle = "rgba(255,255,255,0.04)"; ctx.fillRect(0, 316, W, H - 316);
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 316); ctx.lineTo(W, 316); ctx.stroke();

    const battleActions = [
        ["1", "Tấn công", "#ff6b6b"],
        ["2", state.abilityUsed ? "Kỹ năng✗" : "Kỹ năng", state.abilityUsed ? "#555" : accent],
        ["3", "Nghỉ (+3HP)", "#69db7c"],
        ["5", "Status", "#888"],
    ];
    const bAW = W / battleActions.length;
    for (let i = 0; i < battleActions.length; i++) {
        const [num, label, col] = battleActions[i]; const ax = i * bAW;
        ctx.textAlign = "center";
        ctx.fillStyle = col; ctx.font = "bold 24px BeVietnamProBold, Sans";
        ctx.fillText(num, ax + bAW / 2, 352);
        ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.font = "11px BeVietnamPro, Sans";
        ctx.fillText(label, ax + bAW / 2, 370);
        if (i > 0) {
            ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(ax, 321); ctx.lineTo(ax, H - 4); ctx.stroke();
        }
    }

    ctx.textAlign = "right"; ctx.fillStyle = "rgba(255,255,255,0.16)";
    ctx.font = "11px BeVietnamPro, Sans";
    ctx.fillText("✦ LauNa Bot · D&D System ✦", W - 20, H - 8);
    return await canvas.toBuffer("png");
}

/**
 * MANGA SEARCH CANVAS — danh sách kết quả tìm kiếm truyện
 */
export async function drawMangaSearch(items, query) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const max = Math.min(items.length, 8);
    const width = 1280;
    const CARD_W = 1200, CARD_H = 110, GAP = 14;
    const startY = 120;
    const height = startY + max * (CARD_H + GAP) + 50;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themePink = "#ff2d87";
    const themePurple = "#7a1bff";
    const goldColor = "#ffd166";

    const bg = ctx.createLinearGradient(0, 0, width, height);
    bg.addColorStop(0, "#160024");
    bg.addColorStop(1, "#040013");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);

    const glow = ctx.createRadialGradient(width, 0, 0, width, 0, 600);
    glow.addColorStop(0, "rgba(255,45,135,0.18)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);

    const accent = ctx.createLinearGradient(0, 0, 0, height);
    accent.addColorStop(0, themePink);
    accent.addColorStop(1, themePurple);
    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, 6, height);

    ctx.textAlign = "left";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 50px BeVietnamProBold, NotoEmojiBold, Sans";
    ctx.fillText("📚 MANGA", 30, 70);

    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "bold 22px BeVietnamProBold, Sans";
    let q = (query || "").toUpperCase();
    if (ctx.measureText(q).width > 600) q = q.substring(0, 40) + "...";
    ctx.fillText(`KẾT QUẢ: ${q}`, 230, 65);

    const instrText = `➜ REPLY 1-${max} ĐỂ XEM`;
    ctx.font = "bold 22px BeVietnamProBold, Sans";
    const instrW = ctx.measureText(instrText).width + 50;
    const grad = ctx.createLinearGradient(width - instrW - 30, 0, width - 30, 0);
    grad.addColorStop(0, themePink);
    grad.addColorStop(1, themePurple);
    ctx.fillStyle = grad;
    drawRoundRect(ctx, width - instrW - 30, 35, instrW, 48, 24);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText(instrText, width - instrW / 2 - 30, 66);

    const POSTER_W = 90, POSTER_H = 110;
    const startX = 40;

    const list = items.slice(0, max);
    const thumbs = await Promise.allSettled(list.map(async it => {
        const url = it.thumbnail || it.thumb || "";
        if (!url || !url.startsWith("http")) return null;
        const res = await axios.get(url, { responseType: "arraybuffer", timeout: 4500, headers: { "User-Agent": "Mozilla/5.0" } });
        return loadImage(Buffer.from(res.data));
    }));

    for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const y = startY + i * (CARD_H + GAP);

        ctx.fillStyle = i % 2 === 0 ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)";
        drawRoundRect(ctx, startX, y, CARD_W, CARD_H, 18);
        ctx.fill();

        const img = thumbs[i]?.status === "fulfilled" ? thumbs[i].value : null;
        if (img) {
            ctx.save();
            drawRoundRect(ctx, startX + 10, y, POSTER_W, POSTER_H, 12);
            ctx.clip();
            const sc = Math.max(POSTER_W / img.width, POSTER_H / img.height);
            ctx.drawImage(img, startX + 10 + (POSTER_W - img.width * sc) / 2, y + (POSTER_H - img.height * sc) / 2, img.width * sc, img.height * sc);
            ctx.restore();
        } else {
            ctx.fillStyle = "#1a0d28";
            drawRoundRect(ctx, startX + 10, y, POSTER_W, POSTER_H, 12);
            ctx.fill();
        }

        const badgeGrad = ctx.createLinearGradient(startX + 10, y, startX + 10, y + 36);
        badgeGrad.addColorStop(0, themePink);
        badgeGrad.addColorStop(1, themePurple);
        ctx.fillStyle = badgeGrad;
        ctx.beginPath();
        ctx.arc(startX + 18, y + 18, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "bold 16px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        ctx.fillText(i + 1, startX + 18, y + 24);

        const tx = startX + POSTER_W + 25;
        ctx.textAlign = "left";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 24px BeVietnamProBold, NotoEmojiBold, Sans";
        let title = it.title || "Không có tên";
        while (ctx.measureText(title).width > 950 && title.length > 5) title = title.slice(0, -1);
        if ((it.title || "").length > title.length) title += "...";
        ctx.fillText(title, tx, y + 38);

        ctx.fillStyle = goldColor;
        ctx.font = "bold 16px BeVietnamProBold, NotoEmojiBold, Sans";
        const tags = [];
        if (it.author) tags.push(`✍️ ${it.author}`);
        if (it.status) tags.push(`📊 ${it.status}`);
        if (it.lastChapter || it.last_chapter) tags.push(`📖 ${it.lastChapter || it.last_chapter}`);
        if (Array.isArray(it.genres) && it.genres.length) tags.push(`🏷️ ${it.genres.slice(0, 3).join(", ")}`);
        let tagText = tags.join("   ");
        while (ctx.measureText(tagText).width > 980 && tagText.length > 5) tagText = tagText.slice(0, -1);
        ctx.fillText(tagText, tx, y + 70);

        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.font = "14px BeVietnamPro, Sans";
        let desc = (it.description || "").replace(/\s+/g, " ").trim();
        if (ctx.measureText(desc).width > 980) {
            while (ctx.measureText(desc + "...").width > 980 && desc.length > 5) desc = desc.slice(0, -1);
            desc += "...";
        }
        ctx.fillText(desc, tx, y + 95);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.font = "bold 14px BeVietnamPro, Sans";
    ctx.fillText("LAUNA MANGA API • POWERED BY DGK SYSTEM", width / 2, height - 18);

    return await canvas.toBuffer("png");
}

/**
 * MANGA DETAIL CANVAS — chi tiết truyện + danh sách chương
 */
export async function drawMangaDetail(detail) {
    await ensureCanvas();
    if (!canvasAvailable) return null;
    const width = 1100, height = 640;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const themePink = "#ff2d87";
    const themePurple = "#7a1bff";
    const goldColor = "#ffd166";

    let posterImg = null;
    try {
        if (detail.thumbnail && detail.thumbnail.startsWith("http")) {
            const res = await axios.get(detail.thumbnail, { responseType: "arraybuffer", timeout: 6000, headers: { "User-Agent": "Mozilla/5.0" } });
            posterImg = await loadImage(Buffer.from(res.data));
        }
    } catch {}

    if (posterImg) {
        ctx.save();
        ctx.filter = "blur(55px) brightness(0.35)";
        const sc = Math.max(width / posterImg.width, height / posterImg.height);
        ctx.drawImage(posterImg, (width - posterImg.width * sc) / 2, (height - posterImg.height * sc) / 2, posterImg.width * sc, posterImg.height * sc);
        ctx.restore();
    } else {
        const bg = ctx.createLinearGradient(0, 0, width, height);
        bg.addColorStop(0, "#220033");
        bg.addColorStop(1, "#080014");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, width, height);
    }

    ctx.fillStyle = "rgba(8,0,20,0.72)";
    ctx.fillRect(0, 0, width, height);

    const POSTER_W = 230, POSTER_H = 330;
    const posterX = 40, posterY = 60;

    if (posterImg) {
        ctx.save();
        ctx.shadowColor = "rgba(255,45,135,0.5)";
        ctx.shadowBlur = 30;
        drawRoundRect(ctx, posterX, posterY, POSTER_W, POSTER_H, 18);
        ctx.clip();
        const sc = Math.max(POSTER_W / posterImg.width, POSTER_H / posterImg.height);
        ctx.drawImage(posterImg, posterX + (POSTER_W - posterImg.width * sc) / 2, posterY + (POSTER_H - posterImg.height * sc) / 2, posterImg.width * sc, posterImg.height * sc);
        ctx.restore();
    } else {
        ctx.fillStyle = "#1a0d28";
        drawRoundRect(ctx, posterX, posterY, POSTER_W, POSTER_H, 18);
        ctx.fill();
    }

    const tx = posterX + POSTER_W + 40;
    const contentW = width - tx - 30;
    let cY = 80;

    ctx.textAlign = "left";
    ctx.fillStyle = goldColor;
    ctx.font = "bold 16px BeVietnamProBold, Sans";
    ctx.fillText("📚 MANGA · LAUNA", tx, cY);
    cY += 32;

    ctx.fillStyle = "#fff";
    ctx.font = "bold 38px BeVietnamProBold, NotoEmojiBold, Sans";
    let title = detail.title || "Không có tên";
    while (ctx.measureText(title).width > contentW && title.length > 5) title = title.slice(0, -1);
    if ((detail.title || "").length > title.length) title += "...";
    ctx.fillText(title, tx, cY);
    cY += 42;

    const author = (detail.authors || []).filter(a => a && a !== "Đang cập nhật").join(", ") || "Đang cập nhật";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "20px BeVietnamPro, NotoEmojiBold, Sans";
    ctx.fillText(`✍️ ${author}`, tx, cY);
    cY += 30;

    if (Array.isArray(detail.genres) && detail.genres.length) {
        ctx.fillStyle = themePink;
        ctx.font = "bold 16px BeVietnamProBold, Sans";
        let g = detail.genres.slice(0, 6).join(" • ");
        while (ctx.measureText(g).width > contentW && g.length > 5) g = g.slice(0, -1);
        ctx.fillText(g, tx, cY);
        cY += 28;
    }

    ctx.strokeStyle = "rgba(255,45,135,0.45)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(tx, cY); ctx.lineTo(tx + contentW, cY); ctx.stroke();
    cY += 22;

    if (detail.description) {
        ctx.fillStyle = "rgba(255,255,255,0.78)";
        ctx.font = "16px BeVietnamPro, NotoEmojiBold, Sans";
        const desc = (detail.description || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        const words = desc.split(" ");
        let line = "", lineY = cY, lines = 0;
        const MAX_LINES = 5;
        for (const w of words) {
            const test = line + w + " ";
            if (ctx.measureText(test).width > contentW && line) {
                ctx.fillText(line.trim(), tx, lineY);
                line = w + " ";
                lineY += 24;
                lines++;
                if (lines >= MAX_LINES - 1) {
                    let last = line.trim();
                    while (ctx.measureText(last + "...").width > contentW && last.length > 5) last = last.slice(0, -1);
                    ctx.fillText(last + "...", tx, lineY);
                    line = "";
                    break;
                }
            } else { line = test; }
        }
        if (line) ctx.fillText(line.trim(), tx, lineY);
        cY = lineY + 36;
    }

    ctx.fillStyle = themePink;
    ctx.font = "bold 18px BeVietnamProBold, NotoEmojiBold, Sans";
    const chapterCount = (detail.chapters || []).length;
    ctx.fillText(`📖 ${chapterCount} chương — reply số chương để đọc`, tx, cY);

    // Hàng chương dưới poster
    const chapY = posterY + POSTER_H + 30;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "bold 14px BeVietnamProBold, Sans";
    ctx.fillText("CÁC CHƯƠNG MỚI NHẤT", 40, chapY);

    const COLS = 8, CW = 120, CH = 36, CGAP = 8;
    let cx = 40, cy2 = chapY + 14;
    const showChapters = (detail.chapters || []).slice(0, 16);
    for (let i = 0; i < showChapters.length; i++) {
        if (i > 0 && i % COLS === 0) { cx = 40; cy2 += CH + CGAP; }
        const g = ctx.createLinearGradient(cx, cy2, cx, cy2 + CH);
        g.addColorStop(0, "rgba(255,45,135,0.85)");
        g.addColorStop(1, "rgba(122,27,255,0.85)");
        ctx.fillStyle = g;
        drawRoundRect(ctx, cx, cy2, CW, CH, 8);
        ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.font = "bold 13px BeVietnamProBold, Sans";
        ctx.textAlign = "center";
        let label = `${i + 1}. ${showChapters[i].name || ""}`.replace(/\s+/g, " ").trim();
        while (ctx.measureText(label).width > CW - 12 && label.length > 4) label = label.slice(0, -1);
        ctx.fillText(label, cx + CW / 2, cy2 + 23);
        ctx.textAlign = "left";
        cx += CW + CGAP;
    }

    if (chapterCount > 16) {
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.font = "13px BeVietnamPro, Sans";
        ctx.fillText(`... và ${chapterCount - 16} chương khác`, 40, cy2 + CH + 22);
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.font = "bold 13px BeVietnamPro, Sans";
    ctx.fillText("LAUNA MANGA API • POWERED BY DGK SYSTEM", width / 2, height - 14);

    return await canvas.toBuffer("png");
}
