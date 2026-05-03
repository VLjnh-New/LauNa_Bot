import { fs, path, log } from "../globals.js";
import { uploadUrlToDrive, uploadFileWithAutoClassify } from "../utils/core/driveUploader.js";
import { isDriveConfigured, saveDiverLink } from "../utils/core/diver.js";
import { readJSON, writeJSON } from "../utils/core/io-json.js";
import { downloadTikTok } from "../utils/downloaders/tiktokDownloader.js";
import { downloadFile, deleteFile } from "../utils/core/util.js";

export const name = "api";
export const description = "Bộ công cụ upload Google Drive và quét TikTok Bulk";

const DATA_DIR     = path.join(process.cwd(), "src/data");
const HISTORY_FILE = path.join(DATA_DIR, "tiktok_history.json");
const ROOT_FOLDER  = "LauNa_Upload";

function loadHistory() {
    return readJSON(HISTORY_FILE) || [];
}

function saveHistory(history) {
    writeJSON(HISTORY_FILE, history);
}

function saveToDatabase(category, links) {
    const dbPath = path.join(DATA_DIR, `${category.toLowerCase()}.json`);
    let data = readJSON(dbPath) || [];
    if (!Array.isArray(data)) data = [];
    const newData = [...new Set([...data, ...links])];
    writeJSON(dbPath, newData);
    return newData.length;
}

function extractUrlFromQuote(quote) {
    if (!quote) return null;
    try {
        const urlRegex = /(https?:\/\/[^\s"'<>]+)/g;
        if (quote.attach) {
            try {
                const attach = typeof quote.attach === "string" ? JSON.parse(quote.attach) : quote.attach;
                if (attach.href) return attach.href;
                if (attach.params) {
                    const p = typeof attach.params === "string" ? JSON.parse(attach.params) : attach.params;
                    if (p.videoUrl) return p.videoUrl;
                    if (p.url)      return p.url;
                }
            } catch {}
        }
        for (const t of [quote.content, quote.attach, quote.desc, quote.title, quote.href, quote.msg]) {
            if (typeof t === "string") {
                const m = t.match(urlRegex);
                if (m) return m[0].replace(/\\/g, "");
            }
        }
    } catch (e) { log.error("extractUrlFromQuote error:", e.message); }
    return null;
}

function mimeToType(mimeType = "") {
    if (mimeType.startsWith("video/"))  return "video";
    if (mimeType.startsWith("audio/"))  return "audio";
    if (mimeType.startsWith("image/"))  return "image";
    return "file";
}

async function uploadToDrive(url, suggestedName = null) {
    const result = await uploadUrlToDrive(url, suggestedName, ROOT_FOLDER);
    const link   = result?.rawLink || result?.webViewLink || null;
    if (link) saveDiverLink({ name: result?.name || suggestedName || "", link, type: mimeToType(result?.mimeType) });
    return link;
}

async function uploadFileToDrive(filePath) {
    const result = await uploadFileWithAutoClassify(filePath, ROOT_FOLDER);
    const link   = result?.rawLink || result?.webViewLink || null;
    if (link) saveDiverLink({ name: result?.name || path.basename(filePath), link, type: mimeToType(result?.mimeType) });
    return link;
}

export const commands = {
    api: async (ctx) => {
        const { api, message, args, threadId, threadType, prefix } = ctx;
        const subCommand = args[0]?.toLowerCase().trim();

        if (!isDriveConfigured()) {
            return api.sendMessage({ msg: `⚠️ Google Drive chưa cấu hình!\nDùng: ${prefix}gdrive auth` }, threadId, threadType);
        }

        // [ 1. API GET - QUÉT BULK TIKTOK ]
        if (subCommand === "get") {
            const userId     = args[1];
            const limit      = parseInt(args[2]) || 5;
            const filterType = args[3]?.toLowerCase();
            const category   = args[4]?.toLowerCase();

            if (!userId || !filterType || !category) {
                return api.sendMessage({ msg: `⚠️ Sai cú pháp! VD: ${prefix}api get [user] 10 [img/video] [kho]` }, threadId, threadType);
            }

            const waitMsg = await api.sendMessage({ msg: `⏳ Đang quét lọc ${filterType.toUpperCase()} của @${userId}...` }, threadId, threadType);

            try {
                const searchUrl = `https://fown.onrender.com/api/search?ttuser=${encodeURIComponent(userId)}&svl=${limit}`;
                const searchRes = await fetch(searchUrl);
                if (!searchRes.ok) throw new Error(`API trả về HTTP ${searchRes.status}`);
                const data = await searchRes.json();

                if (!data.results?.length) {
                    if (waitMsg?.message?.msgId) await api.deleteMessage({msgId: waitMsg.message.msgId, cliMsgId: waitMsg.message.cliMsgId}, threadId, threadType).catch(() => {});
                    return api.sendMessage({ msg: `⚠️ Không tìm thấy video nào của @${userId}` }, threadId, threadType);
                }

                const history = loadHistory();
                let dupCount = 0, skipCount = 0, totalNewLinks = 0;
                const processedPosts = [];

                const postsToProcess = data.results.filter(v => {
                    if (history.includes(v.id)) { dupCount++; return false; }
                    return true;
                });

                if (postsToProcess.length === 0) {
                    if (waitMsg?.message?.msgId) await api.deleteMessage({msgId: waitMsg.message.msgId, cliMsgId: waitMsg.message.cliMsgId}, threadId, threadType).catch(() => {});
                    return api.sendMessage({ msg: `📢 Không có gì mới từ @${userId}. (Bỏ qua ${dupCount} video cũ)` }, threadId, threadType);
                }

                for (const post of postsToProcess) {
                    const vUrl = post.url || `https://www.tiktok.com/@${userId}/video/${post.id}`;
                    try {
                        const snap = await downloadTikTok(vUrl);
                        if (!snap) continue;

                        const isImg = snap.images?.length > 0;
                        if ((filterType === "img" && !isImg) || (filterType === "video" && isImg)) {
                            skipCount++; continue;
                        }

                        const links = [];
                        if (isImg) {
                            for (let j = 0; j < snap.images.length; j++) {
                                const tPath = path.join(process.cwd(), `temp_${Date.now()}_${j}.jpg`);
                                await downloadFile(snap.images[j], tPath);
                                const link = await uploadFileToDrive(tPath);
                                if (link) links.push(link);
                                deleteFile(tPath);
                            }
                        } else if (snap.videoUrl) {
                            const tPath = path.join(process.cwd(), `temp_${Date.now()}.mp4`);
                            await downloadFile(snap.videoUrl, tPath);
                            const link = await uploadFileToDrive(tPath);
                            if (link) links.push(link);
                            deleteFile(tPath);
                        }

                        if (links.length > 0) {
                            saveToDatabase(category, links);
                            totalNewLinks += links.length;
                            history.push(post.id);
                            processedPosts.push(post.id);
                        }
                    } catch (err) { log.error(err.message); }
                }

                saveHistory(history);
                if (waitMsg?.message?.msgId) await api.deleteMessage({msgId: waitMsg.message.msgId, cliMsgId: waitMsg.message.cliMsgId}, threadId, threadType).catch(() => {});

                const _dbData = readJSON(path.join(DATA_DIR, `${category}.json`));
                const totalInDb = Array.isArray(_dbData) ? _dbData.length : 0;

                let report = `[ 🏁 API GET TIKTOK ]\n─────────────────\n👤 User: @${userId}\n🎯 Loại: ${filterType.toUpperCase()}\n✅ Thành công: ${processedPosts.length} bài.\n📥 Link mới: ${totalNewLinks}\n📂 Kho: ${category}.json (${totalInDb})\n`;
                if (skipCount > 0) report += `⏩ Lọc bỏ: ${skipCount} bài sai loại.\n`;
                if (dupCount  > 0) report += `🚫 Bỏ qua: ${dupCount} bài cũ.\n`;
                report += `─────────────────`;
                return api.sendMessage({ msg: report }, threadId, threadType);

            } catch (e) {
                return api.sendMessage({ msg: `⚠️ Lỗi hệ thống: ${e.message}` }, threadId, threadType);
            }
        }

        // [ 2. API ADD / UPLOAD ]
        const isAdd = subCommand === "add";
        const targetType = isAdd ? args[1]?.toLowerCase().trim() : null;
        let url = isAdd ? args.slice(2).join(" ").trim() : args.join(" ").trim();

        if (!url && message.data?.quote) url = extractUrlFromQuote(message.data.quote);

        if (!url || !url.startsWith("http")) {
            const guide = [
                `[ 🛠️ API TOOLS ]`,
                `─────────────────`,
                `1. ${prefix}api [URL]               — Upload Google Drive`,
                `2. ${prefix}api add [tên] [URL]     — Lưu database`,
                `3. ${prefix}api get [id] [n] [img/video] [kho]`,
                `─────────────────`,
                `💡 VD: ${prefix}api get user 10 video vdgai`,
            ].join("\n");
            return api.sendMessage({ msg: guide }, threadId, threadType);
        }

        try {
            await api.sendMessage({ msg: `⏳ Đang upload lên Google Drive...` }, threadId, threadType);

            const linksToStore = [];
            let mainLink = "";

            if (url.includes("tiktok.com") || url.includes("douyin.com")) {
                const snap = await downloadTikTok(url);
                if (snap) {
                    if (snap.videoUrl) {
                        mainLink = await uploadToDrive(snap.videoUrl);
                        if (mainLink) linksToStore.push(mainLink);
                    } else if (snap.images?.length > 0) {
                        for (const imgUrl of snap.images) {
                            const link = await uploadToDrive(imgUrl);
                            if (link) linksToStore.push(link);
                        }
                        mainLink = linksToStore[0];
                    }
                }
            }

            if (linksToStore.length === 0) {
                mainLink = await uploadToDrive(url);
                if (mainLink) linksToStore.push(mainLink);
            }

            if (linksToStore.length === 0) throw new Error("Không thể upload — kiểm tra lại URL.");

            if (isAdd && targetType) {
                const total = saveToDatabase(targetType, linksToStore);
                await api.sendMessage({
                    msg: [
                        `[ ✅ LƯU THÀNH CÔNG ]`,
                        `─────────────────`,
                        `📂 Kho: ${targetType}.json`,
                        `🔗 Link: ${mainLink}${linksToStore.length > 1 ? ` (+${linksToStore.length - 1} ảnh)` : ""}`,
                        `📊 Tổng kho: ${total} link.`,
                        `─────────────────`,
                    ].join("\n"),
                }, threadId, threadType);
            } else {
                await api.sendMessage({
                    msg: [
                        `[ ✅ UPLOAD THÀNH CÔNG ]`,
                        `─────────────────`,
                        `🔗 Google Drive:${linksToStore.length > 1 ? ` (${linksToStore.length} file)` : ""}`,
                        ...linksToStore,
                        `─────────────────`,
                    ].join("\n"),
                }, threadId, threadType);
            }
        } catch (e) {
            log.error("API command error:", e.message);
            await api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
        }
    }
};
