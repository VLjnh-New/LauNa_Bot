import fs from 'node:fs';
import path from 'node:path';

export const name = "share";
export const description = "Trình quản lý tệp tin: Duyệt thư mục và gửi tệp tin (Chỉ Admin Bot)";

const shareSessions = new Map();
const PAGE_SIZE = 20;

function fmtSize(bytes) {
    if (bytes == null) return "";
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    if (bytes >= 1024 * 1024)        return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    if (bytes >= 1024)               return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " B";
}

export const commands = {
    share: async (ctx) => {
        const { api, threadId, threadType, senderId, args, adminIds } = ctx;

        if (!adminIds.includes(String(senderId))) {
            return api.sendMessage({ msg: "⚠️ Lệnh này cực kỳ nhạy cảm và chỉ dành cho Admin Bot!" }, threadId, threadType);
        }

        let targetPath = args.join(" ").trim();
        if (!targetPath) targetPath = process.cwd();
        else if (!path.isAbsolute(targetPath)) targetPath = path.resolve(process.cwd(), targetPath);

        if (!fs.existsSync(targetPath)) {
            return api.sendMessage({ msg: "⚠️ Đường dẫn không tồn tại!" }, threadId, threadType);
        }

        const stats = fs.statSync(targetPath);
        if (stats.isFile()) {
            return sendFile(api, threadId, threadType, targetPath);
        } else {
            return listDirectory(api, threadId, threadType, senderId, targetPath, 1);
        }
    }
};

async function listDirectory(api, threadId, threadType, senderId, dirPath, page = 1) {
    try {
        const files = fs.readdirSync(dirPath);
        const folderName = path.basename(dirPath) || dirPath;

        const allItems = files.map(f => {
            const fPath = path.join(dirPath, f);
            try {
                const stat = fs.statSync(fPath);
                return { name: f, path: fPath, isDir: stat.isDirectory(), mtime: stat.mtimeMs, size: stat.isDirectory() ? null : stat.size };
            } catch {
                return { name: f, path: fPath, isDir: false, mtime: 0, size: null };
            }
        });

        allItems.sort((a, b) => {
            if (a.isDir !== b.isDir) return b.isDir - a.isDir;
            return b.mtime - a.mtime;
        });

        const totalPages = Math.max(1, Math.ceil(allItems.length / PAGE_SIZE));
        const safePage   = Math.min(Math.max(1, page), totalPages);
        const start      = (safePage - 1) * PAGE_SIZE;
        const pageItems  = allItems.slice(start, start + PAGE_SIZE);

        const key = `${threadId}-${senderId}`;

        // ── Canvas card ─────────────────────────────────────────────────────────
        let imagePath = null;
        try {
            const buffer = await drawShareBrowser(
                dirPath,
                pageItems.map((item, i) => ({ ...item, index: start + i + 1 })),
                allItems.length,
                safePage,
                totalPages
            );
            if (buffer) {
                imagePath = path.join(process.cwd(), `src/modules/cache/share_${Date.now()}.png`);
                fs.writeFileSync(imagePath, buffer);
            }
        } catch {}

        // ── Text fallback ────────────────────────────────────────────────────────
        let msg = `📂 [ ${folderName.toUpperCase()} ]  (Trang ${safePage}/${totalPages})\n`;
        msg += `─────────────────\n`;
        msg += `📁 0. .. (Thư mục cha)\n`;

        pageItems.forEach((item, i) => {
            const idx  = start + i + 1;
            const icon = item.isDir ? "📁" : "📄";
            const sz   = (!item.isDir && item.size != null) ? `  [${fmtSize(item.size)}]` : "";
            msg += `${idx}. ${icon} ${item.name}${sz}\n`;
        });

        msg += `─────────────────\n`;
        msg += `💡 Phản hồi STT để Mở/Gửi  •  "up" để quay lại\n`;
        if (totalPages > 1) {
            msg += `📄 Trang ${safePage}/${totalPages}  •  Gõ "tiếp" hoặc số trang (vd: t2) để chuyển\n`;
        }
        msg += `📌 ${dirPath}`;

        const sendOpts = imagePath
            ? { msg, attachments: [imagePath] }
            : { msg };

        const sent = await api.sendMessage(sendOpts, threadId, threadType);
        if (imagePath) try { if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath); } catch {}

        shareSessions.set(key, {
            currentPath: dirPath,
            allItems,
            page: safePage,
            totalPages,
            messageId: sent?.messageId || sent?.globalMsgId
        });
        setTimeout(() => shareSessions.delete(key), 3 * 60 * 1000);
    } catch (e) {
        api.sendMessage({ msg: `⚠️ Lỗi: ${e.message}` }, threadId, threadType);
    }
}

async function sendFile(api, threadId, threadType, filePath) {
    try {
        const fileName    = path.basename(filePath);
        const stats       = fs.statSync(filePath);
        const fileSizeStr = fmtSize(stats.size);

        if (stats.size > 100 * 1024 * 1024) {
            return api.sendMessage({ msg: `⚠️ File quá lớn (${fileSizeStr}). Zalo chỉ hỗ trợ tối đa 100MB qua Bot.` }, threadId, threadType);
        }

        await api.sendMessage({ msg: `⏳ Đang gửi file: ${fileName} (${fileSizeStr})...` }, threadId, threadType);
        await api.sendMessage({ msg: `📄 File: ${fileName}  [${fileSizeStr}]`, attachments: [filePath] }, threadId, threadType);
    } catch (e) {
        api.sendMessage({ msg: `⚠️ Lỗi gửi file: ${e.message}` }, threadId, threadType);
    }
}

export async function handle(ctx) {
    const { api, threadId, threadType, senderId, content } = ctx;
    const key     = `${threadId}-${senderId}`;
    const session = shareSessions.get(key);
    if (!session) return false;

    const input   = content.trim().toLowerCase();
    const { currentPath, allItems, page, totalPages } = session;

    // ── Điều hướng trang ──────────────────────────────────────────────────────
    if (input === "tiếp" || input === "tiep" || input === "next") {
        if (page >= totalPages) {
            await api.sendMessage({ msg: `⚠️ Đây là trang cuối (${page}/${totalPages}).` }, threadId, threadType);
            return true;
        }
        shareSessions.delete(key);
        await listDirectory(api, threadId, threadType, senderId, currentPath, page + 1);
        return true;
    }

    if (input === "trước" || input === "truoc" || input === "prev") {
        if (page <= 1) {
            await api.sendMessage({ msg: `⚠️ Đây là trang đầu.` }, threadId, threadType);
            return true;
        }
        shareSessions.delete(key);
        await listDirectory(api, threadId, threadType, senderId, currentPath, page - 1);
        return true;
    }

    const pageMatch = input.match(/^t(?:rang)?\s*(\d+)$/);
    if (pageMatch) {
        shareSessions.delete(key);
        await listDirectory(api, threadId, threadType, senderId, currentPath, parseInt(pageMatch[1]));
        return true;
    }

    // ── Quay lại thư mục cha ─────────────────────────────────────────────────
    if (input === "up" || input === "0") {
        const parentPath = path.dirname(currentPath);
        shareSessions.delete(key);
        await listDirectory(api, threadId, threadType, senderId, parentPath, 1);
        return true;
    }

    // ── Chọn item theo STT ────────────────────────────────────────────────────
    const choice = parseInt(input);
    if (isNaN(choice) || choice < 1 || choice > allItems.length) return false;

    const selected = allItems[choice - 1];
    shareSessions.delete(key);

    if (selected.isDir) {
        await listDirectory(api, threadId, threadType, senderId, selected.path, 1);
    } else {
        await sendFile(api, threadId, threadType, selected.path);
    }

    return true;
}
