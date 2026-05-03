import { log } from "../globals.js";
import { uploadFromZaloMessage, uploadUrlToDrive, detectMediaType } from "../utils/core/driveUploader.js";
import {
    listFiles, deleteFile, getDriveStorageInfo, isDriveConfigured,
    ensureFolder, uploadFile, deleteAllFiles, deleteAllInFolder, getRawLink,
    getRootFolderId, startDriveAuth, cancelDriveAuth, readDiver, writeDiver, isDiverReady,
} from "../utils/core/diver.js";
import { tempDir } from "../utils/core/io-json.js";
import fs from "node:fs";
import path from "node:path";
import axios from "axios";

export const name = "gdrive";
export const description = "Upload video, mp3, ảnh, file lên Google Drive cá nhân";

const ROOT_FOLDER = "LauNa_Upload";

const TYPE_ICON = { video: "🎬", audio: "🎵", image: "🖼️", file: "📄" };

function send(ctx, msg) {
    return ctx.api.sendMessage({ msg, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

function isAdmin(ctx) {
    return ctx.adminIds?.includes(String(ctx.senderId));
}

function formatSize(bytes) {
    if (!bytes && bytes !== 0) return "?";
    const n = parseInt(bytes);
    if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
    return n + " B";
}

export const commands = {

    gdrive: async (ctx) => {
        const { args, prefix } = ctx;
        const sub = args[0]?.toLowerCase();

        // ── Chặn ngay nếu không phải Admin ───────────────────────────────────

        if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới được dùng lệnh này!");

        // ── Các lệnh cấu hình (chỉ Admin, không cần Drive đã config) ──────────

        if (sub === "setup")       return handleSetup(ctx);
        if (sub === "setngrok")    return handleSetNgrok(ctx);
        if (sub === "setdomain")   return handleSetDomain(ctx);
        if (sub === "setfolder")   return handleSetFolder(ctx);
        if (sub === "auth")        return handleAuth(ctx);
        if (sub === "authcancel")  return handleAuthCancel(ctx);

        // ── Nếu Drive chưa cấu hình → hướng dẫn ─────────────────────────────

        if (!isDriveConfigured()) {
            const diver = readDiver();
            if (diver.drive_auth_invalid) {
                return send(ctx, [
                    "⚠️ Token Google Drive đã hết hạn hoặc bị thu hồi.",
                    "──────────────────────────",
                    `Dùng lệnh này để xác thực lại: ${prefix}gdrive auth`,
                ].join("\n"));
            }
            return send(ctx, [
                "⚠️ Google Drive chưa cấu hình!",
                "──────────────────────────",
                "Bước 1 — Nhập credentials:",
                `  ${prefix}gdrive setup [client_id] [client_secret]`,
                "",
                "Bước 2 — (Tuỳ chọn) Nhập ngrok token:",
                `  ${prefix}gdrive setngrok [ngrok_token]`,
                "",
                "Bước 3 — Xác thực Google:",
                `  ${prefix}gdrive auth`,
            ].join("\n"));
        }

        // ── Menu chính ────────────────────────────────────────────────────────

        const HELP = [
            `[ 📂 GOOGLE DRIVE ]`,
            `──────────────────────────`,
            `${prefix}gdrive up              — Upload file đang reply`,
            `${prefix}gdrive up [url]        — Upload từ link`,
            `${prefix}gdrive list            — Xem file trong root folder`,
            `${prefix}gdrive info            — Dung lượng Drive`,
            `${prefix}gdrive del [id]        — Xóa 1 file (Admin)`,
            `${prefix}gdrive delall          — Xóa TẤT CẢ trong root folder (Admin)`,
            `${prefix}gdrive auth            — Xác thực lại Google (Admin)`,
            `${prefix}gdrive setdomain [d]   — Cố định URL ngrok (Admin)`,
            `──────────────────────────`,
            `📁 auto phân loại: Videos / Audio / Images / Files`,
        ].join("\n");

        if (!sub) return send(ctx, HELP);

        if (sub === "up" || sub === "upload")  return handleUpload(ctx);
        if (sub === "list" || sub === "ls")    return handleList(ctx);
        if (sub === "info" || sub === "disk")  return handleInfo(ctx);
        if (sub === "del"  || sub === "rm")    return handleDelete(ctx);
        if (sub === "delall")                  return handleDeleteAll(ctx);
        if (sub === "mkdir" || sub === "mf")   return handleMkdir(ctx);
        if (sub === "raw")                     return handleRaw(ctx);

        return send(ctx, HELP);
    },
};

// ─── SETUP credentials ────────────────────────────────────────────────────────

async function handleSetup(ctx) {
    if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới dùng được lệnh này!");

    const [, clientId, clientSecret] = ctx.args;
    if (!clientId || !clientSecret) {
        return send(ctx, `⚠️ Cú pháp: ${ctx.prefix}gdrive setup [client_id] [client_secret]`);
    }

    writeDiver({ client_id: clientId, client_secret: clientSecret });

    return send(ctx, [
        "✅ Đã lưu client_id & client_secret vào diver.json!",
        "",
        `Tiếp theo dùng: ${ctx.prefix}gdrive auth để lấy token`,
    ].join("\n"));
}

// ─── SET ngrok token ──────────────────────────────────────────────────────────

async function handleSetNgrok(ctx) {
    if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới dùng được lệnh này!");

    const token = ctx.args[1];
    if (!token) return send(ctx, `⚠️ Cú pháp: ${ctx.prefix}gdrive setngrok [ngrok_authtoken]`);

    writeDiver({ ngrok_token: token });
    return send(ctx, "✅ Đã lưu ngrok token vào diver.json!");
}

// ─── SET ngrok static domain ──────────────────────────────────────────────────

async function handleSetDomain(ctx) {
    if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới dùng được lệnh này!");

    const domain = ctx.args[1];

    if (!domain) {
        const current = readDiver().ngrok_domain;
        return send(ctx, [
            `⚠️ Cú pháp: ${ctx.prefix}gdrive setdomain [domain]`,
            ``,
            `📌 Domain hiện tại: ${current || "(chưa đặt — URL random mỗi lần)"}`,
            ``,
            `Cách lấy static domain miễn phí:`,
            `1. Vào https://dashboard.ngrok.com/domains`,
            `2. Nhấn "New Domain" → copy domain (vd: abc-xyz.ngrok-free.app)`,
            `3. Dùng: ${ctx.prefix}gdrive setdomain abc-xyz.ngrok-free.app`,
            ``,
            `Sau đó thêm 1 lần duy nhất vào Google Console:`,
            `   https://[domain]/oauth/callback`,
        ].join("\n"));
    }

    // Chuẩn hóa: bỏ https:// nếu có
    const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    const redirectUri = `https://${cleanDomain}/oauth/callback`;

    writeDiver({ ngrok_domain: cleanDomain });

    return send(ctx, [
        `✅ Đã lưu ngrok static domain!`,
        ``,
        `🔗 Redirect URI cố định (thêm vào Google Console 1 lần duy nhất):`,
        `   ${redirectUri}`,
        ``,
        `Từ giờ dùng ${ctx.prefix}gdrive auth sẽ không cần thêm redirect URI nữa.`,
    ].join("\n"));
}

// ─── SET ROOT FOLDER ──────────────────────────────────────────────────────────

async function handleSetFolder(ctx) {
    if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới dùng được lệnh này!");

    const folderId = ctx.args[1];

    if (!folderId) {
        const current = getRootFolderId();
        return send(ctx, [
            `📁 ROOT FOLDER HIỆN TẠI`,
            `──────────────────────────`,
            current
                ? `📌 ID: ${current}\n🔗 Link: https://drive.google.com/drive/folders/${current}`
                : `⚠️ Chưa pin folder — mọi thao tác đang dùng Drive root`,
            ``,
            `Cách pin folder:`,
            `  1. Mở Google Drive → vào folder muốn dùng`,
            `  2. Nhìn URL: drive.google.com/drive/folders/[ID]`,
            `  3. Copy [ID] rồi dùng: ${ctx.prefix}gdrive setfolder [ID]`,
            ``,
            `Xóa pin (về Drive root): ${ctx.prefix}gdrive setfolder clear`,
        ].join("\n"));
    }

    if (folderId.toLowerCase() === "clear") {
        writeDiver({ root_folder_id: null });
        return send(ctx, "✅ Đã xóa pin folder — Bot sẽ dùng Drive root.");
    }

    // Xác minh folder tồn tại và có quyền truy cập
    try {
        await listFiles(folderId, 1);
    } catch (e) {
        return send(ctx, [
            `❌ Không truy cập được folder ${folderId}`,
            `Lỗi: ${e.message}`,
            ``,
            `Kiểm tra lại:`,
            `• ID có đúng không?`,
            `• Folder có được chia sẻ với tài khoản Drive này không?`,
        ].join("\n"));
    }

    writeDiver({ root_folder_id: folderId });
    return send(ctx, [
        `✅ Đã pin root folder!`,
        `──────────────────────────`,
        `📌 ID: ${folderId}`,
        `🔗 Link: https://drive.google.com/drive/folders/${folderId}`,
        ``,
        `Từ giờ tất cả thao tác Drive sẽ chỉ trong folder này:`,
        `• Upload → tự phân loại vào Videos/Audio/Images/Files bên trong`,
        `• List   → chỉ hiện file trong folder này`,
        `• Delall → chỉ xóa file trong folder này (an toàn!)`,
        `• Mkdir  → tạo subfolder trong folder này`,
    ].join("\n"));
}

// ─── AUTH — lấy token qua chat ───────────────────────────────────────────────

async function handleAuth(ctx) {
    if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới dùng được lệnh này!");

    if (!isDiverReady()) {
        return send(ctx, [
            "❌ Chưa có client_id / client_secret!",
            `Dùng: ${ctx.prefix}gdrive setup [client_id] [client_secret]`,
        ].join("\n"));
    }

    try {
        await startDriveAuth(async (msg) => {
            await send(ctx, msg);
        });

        const diver = readDiver();
        return send(ctx, [
            "✅ Xác thực Google Drive thành công!",
            `📧 Email: ${diver.email || "?"}`,
            `📅 Lưu lúc: ${diver.saved_at ? new Date(diver.saved_at).toLocaleString("vi-VN") : "?"}`,
            "",
            `Giờ dùng ${ctx.prefix}gdrive up để upload file nhé!`,
        ].join("\n"));

    } catch (e) {
        if (e.message === "AUTH_CANCELLED") {
            return send(ctx, "🚫 Phiên xác thực đã bị huỷ.");
        }
        if (e.message === "AUTH_TIMEOUT") {
            return send(ctx, "⏰ Hết thời gian xác thực (5 phút). Thử lại bằng !gdrive auth.");
        }
        if (e.message === "NO_REFRESH_TOKEN") {
            return send(ctx, [
                "⚠️ Google không trả về refresh_token!",
                "Thu hồi quyền tại: https://myaccount.google.com/permissions",
                "Rồi thử lại lệnh auth.",
            ].join("\n"));
        }
        log.error("[GDrive Auth] Lỗi:", e.message);
        return send(ctx, `❌ Lỗi xác thực: ${e.message}`);
    }
}

// ─── AUTH CANCEL ──────────────────────────────────────────────────────────────

async function handleAuthCancel(ctx) {
    if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới dùng được lệnh này!");
    const cancelled = await cancelDriveAuth();
    return send(ctx, cancelled
        ? "🚫 Đã huỷ phiên xác thực!"
        : "ℹ️ Không có phiên xác thực nào đang chạy."
    );
}

// ─── UPLOAD ──────────────────────────────────────────────────────────────────

async function handleUpload(ctx) {
    const { args, message, api, threadId, threadType } = ctx;

    const wait = await api.sendMessage(
        { msg: "⏳ Đang xử lý và upload lên Google Drive..." },
        threadId, threadType
    );

    const extraUrls = args.slice(1).filter(a => a.startsWith("http"));

    try {
        const { count, results, skipped = 0 } = await uploadFromZaloMessage(
            message.data,
            extraUrls,
            ROOT_FOLDER,
        );

        if (count === 0) {
            if (wait?.message?.msgId) await api.deleteMessage({msgId: wait.message.msgId, cliMsgId: wait.message.cliMsgId}, threadId, threadType).catch(() => {});
            const skipNote = skipped > 0 ? `\n⏭️ Đã bỏ qua ${skipped} tin hệ thống.` : "";
            return send(ctx, [
                "⚠️ Không tìm thấy file để upload!",
                "Cách dùng:",
                "• Reply video/mp3/ảnh/file rồi gõ lệnh",
                `• ${ctx.prefix}gdrive up [link trực tiếp]`,
            ].join("\n") + skipNote);
        }

        const errorLines = [];
        const okLines = [];
        let okCount = 0;

        for (const r of results) {
            if (r.ok) {
                okCount++;
                const icon    = TYPE_ICON[r.mediaType] || "📄";
                const raw     = r.rawLink || getRawLink(r.id || "", r.mimeType || "");
                const replaced = r.replacedOld > 0 ? `\n   🔄 Đã xóa ${r.replacedOld} file cũ cùng tên` : "";
                okLines.push(
                    `${icon} ${r.name}`,
                    `   📦 ${r.sizeMB} MB${replaced}`,
                    `   🔗 View: ${r.webViewLink}`,
                    `   📡 Raw:  ${raw}`,
                );
            } else {
                // Hiện lỗi sạch — không lộ đường dẫn file
                const cleanErr = r.error?.replace(/\/home\/runner\/workspace\/[^\s'"]*/g, "[file]") || "Lỗi không rõ";
                errorLines.push(`❌ ${r.name || "file"}: ${cleanErr}`);
            }
        }

        const msgParts = [`✅ Upload xong! (${okCount}/${count} file)`];
        if (okLines.length)    msgParts.push("──────────────────────────", ...okLines);
        if (errorLines.length) msgParts.push("──────────────────────────", ...errorLines);
        msgParts.push("──────────────────────────", `📂 ${ROOT_FOLDER}/`);
        if (skipped > 0) msgParts.push(`⏭️ Bỏ qua ${skipped} tin hệ thống`);

        const msg = msgParts.join("\n");
        await api.sendMessage({ msg, quote: message.data }, threadId, threadType);
    } catch (e) {
        log.error("[GDrive] Upload lỗi:", e.message);
        await send(ctx, `❌ Upload thất bại: ${e.message}`);
    } finally {
        if (wait?.msgId) if (wait?.message?.msgId) await api.deleteMessage({msgId: wait.message.msgId, cliMsgId: wait.message.cliMsgId}, threadId, threadType).catch(() => {});
    }
}

// ─── LIST ─────────────────────────────────────────────────────────────────────

async function handleList(ctx) {
    const wait = await ctx.api.sendMessage(
        { msg: "⏳ Đang lấy danh sách file..." },
        ctx.threadId, ctx.threadType
    );
    try {
        const files = await listFiles(null, 20);
        if (!files?.length) return send(ctx, "📂 Drive chưa có file nào.");

        const lines = files.map((f, i) => {
            const icon = TYPE_ICON[detectMediaType(f.name)] || "📄";
            return `${i + 1}. ${icon} ${f.name}\n   📦 ${formatSize(f.size)} | 🆔 ${f.id}`;
        });

        await ctx.api.sendMessage({
            msg: [
                `[ 📂 DANH SÁCH GOOGLE DRIVE ]`,
                `──────────────────────────`,
                ...lines,
                `──────────────────────────`,
                `📝 Tổng: ${files.length} file`,
            ].join("\n"),
        }, ctx.threadId, ctx.threadType);
    } catch (e) {
        await send(ctx, `❌ Lỗi: ${e.message}`);
    } finally {
        if (wait?.message?.msgId) await ctx.api.deleteMessage({msgId: wait.message.msgId, cliMsgId: wait.message.cliMsgId}, ctx.threadId, ctx.threadType).catch(() => {});
    }
}

// ─── INFO ─────────────────────────────────────────────────────────────────────

async function handleInfo(ctx) {
    try {
        const info = await getDriveStorageInfo();
        const pct  = info.total !== "∞"
            ? ` (${Math.round((parseFloat(info.used) / parseFloat(info.total)) * 100)}%)`
            : "";
        await send(ctx, [
            `[ 💾 GOOGLE DRIVE INFO ]`,
            `──────────────────────────`,
            `📊 Đã dùng: ${info.used} MB${pct}`,
            `📁 Trong Drive: ${info.inDrive} MB`,
            `💿 Tổng: ${info.total} MB`,
        ].join("\n"));
    } catch (e) {
        await send(ctx, `❌ Lỗi: ${e.message}`);
    }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

async function handleDelete(ctx) {
    if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới được xóa file!");

    const input = ctx.args[1];
    if (!input) return send(ctx, `⚠️ Cú pháp:\n  ${ctx.prefix}gdrive del [số thứ tự]  — xóa theo số trong list\n  ${ctx.prefix}gdrive del [fileId]     — xóa theo ID`);

    let fileId = input;
    let fileName = input;

    // Nếu nhập số thứ tự → lấy file ID từ list
    const idx = parseInt(input);
    if (!isNaN(idx) && String(idx) === input) {
        try {
            const files = await listFiles(null, 20);
            const target = files?.[idx - 1];
            if (!target) {
                return send(ctx, `⚠️ Không có file số ${idx} trong danh sách.\nDùng ${ctx.prefix}gdrive list để xem.`);
            }
            fileId   = target.id;
            fileName = target.name;
        } catch (e) {
            return send(ctx, `❌ Không lấy được danh sách: ${e.message}`);
        }
    }

    try {
        await deleteFile(fileId);
        await send(ctx, `✅ Đã xóa: ${fileName}`);
    } catch (e) {
        await send(ctx, `❌ Lỗi xóa: ${e.message}`);
    }
}

// ─── DELETE ALL ───────────────────────────────────────────────────────────────

async function handleDeleteAll(ctx) {
    if (!isAdmin(ctx)) return send(ctx, "⚠️ Chỉ Admin mới được xóa toàn bộ!");

    const confirm  = ctx.args[1]?.toLowerCase();
    const folderId = ctx.args[2] || null;

    // Nếu có folderId ở arg[1] (không phải "confirm") → xóa trong folder
    const isFolder = ctx.args[1] && ctx.args[1] !== "confirm" && ctx.args[1] !== "yes";

    if (!isFolder && confirm !== "confirm" && confirm !== "yes") {
        return send(ctx, [
            "⚠️ Lệnh này sẽ XÓA VĨNH VIỄN toàn bộ file & folder trong Drive!",
            "",
            `Xóa toàn bộ Drive:  ${ctx.prefix}gdrive delall confirm`,
            `Xóa trong 1 folder: ${ctx.prefix}gdrive delall [folderId]`,
            "",
            "❗ Không thể khôi phục sau khi xóa!",
        ].join("\n"));
    }

    const targetFolderId = isFolder ? ctx.args[1] : null;
    const scopeLabel = targetFolderId ? `folder \`${targetFolderId}\`` : "toàn bộ Google Drive";

    const wait = await ctx.api.sendMessage(
        { msg: `⏳ Đang xóa ${scopeLabel}...` },
        ctx.threadId, ctx.threadType
    );

    try {
        const result = targetFolderId
            ? await deleteAllInFolder(targetFolderId)
            : await deleteAllFiles();

        const lines = [
            `✅ Xóa xong ${scopeLabel}!`,
            `──────────────────────────`,
            `🗑️ Đã xóa: ${result.deleted} mục`,
        ];
        if (result.errors > 0) {
            lines.push(`⚠️ Lỗi: ${result.errors} mục`);
            const details = result.errDetails || [];
            if (details.length > 0) {
                lines.push(`──────────────────────────`);
                // Hiện tối đa 10 dòng lỗi đầu để không spam
                details.slice(0, 10).forEach(d => lines.push(`  • ${d}`));
                if (details.length > 10) lines.push(`  ... và ${details.length - 10} lỗi khác`);
            }
        } else {
            lines.push(`✔️ Không có lỗi`);
        }
        await send(ctx, lines.join("\n"));
    } catch (e) {
        log.error("[GDrive] DelAll lỗi:", e.message);
        await send(ctx, `❌ Lỗi xóa all: ${e.message}`);
    } finally {
        if (wait?.message?.msgId) await ctx.api.deleteMessage({msgId: wait.message.msgId, cliMsgId: wait.message.cliMsgId}, ctx.threadId, ctx.threadType).catch(() => {});
    }
}

// ─── MKDIR ────────────────────────────────────────────────────────────────────

async function handleMkdir(ctx) {
    const folderName = ctx.args[1];
    // Ưu tiên: parentId truyền vào → root_folder_id đã pin → null (Drive root)
    const parentId   = ctx.args[2] || getRootFolderId() || null;

    if (!folderName) {
        const rootNow = getRootFolderId();
        return send(ctx, [
            `⚠️ Cú pháp: ${ctx.prefix}gdrive mkdir [tên folder]`,
            `           ${ctx.prefix}gdrive mkdir [tên] [parentFolderId]`,
            ``,
            `Ví dụ:`,
            `  ${ctx.prefix}gdrive mkdir Thumbs`,
            `  ${ctx.prefix}gdrive mkdir Thumbs 1a2b3c4d5e6f`,
            ``,
            rootNow
                ? `📌 Mặc định tạo trong root folder: ${rootNow}`
                : `⚠️ Chưa pin folder — sẽ tạo ở Drive root`,
        ].join("\n"));
    }

    try {
        const folderId = await ensureFolder(folderName, parentId);
        const viewLink = `https://drive.google.com/drive/folders/${folderId}`;
        await send(ctx, [
            `✅ Folder sẵn sàng: ${folderName}`,
            `──────────────────────────`,
            `🆔 ID: ${folderId}`,
            `🔗 Link: ${viewLink}`,
            parentId ? `📁 Nằm trong: ${parentId}` : `📁 Nằm ở Drive root`,
        ].join("\n"));
    } catch (e) {
        log.error("[GDrive] Mkdir lỗi:", e.message);
        await send(ctx, `❌ Lỗi tạo folder: ${e.message}`);
    }
}

// ─── RAW LINK ─────────────────────────────────────────────────────────────────

async function handleRaw(ctx) {
    const fileId = ctx.args[1];

    if (!fileId) {
        return send(ctx, [
            `⚠️ Cú pháp: ${ctx.prefix}gdrive raw [fileId]`,
            ``,
            `FileId lấy từ lệnh: ${ctx.prefix}gdrive list`,
            `hoặc từ link Drive: drive.google.com/file/d/[fileId]/view`,
        ].join("\n"));
    }

    // Tạo cả hai dạng raw link phổ biến
    const rawDownload = `https://drive.google.com/uc?id=${fileId}&export=download`;
    const rawEmbed    = `https://lh3.googleusercontent.com/d/${fileId}`;
    const viewLink    = `https://drive.google.com/file/d/${fileId}/view`;

    await send(ctx, [
        `[ 📡 RAW LINKS — ${fileId} ]`,
        `──────────────────────────`,
        `🔗 View:`,
        `   ${viewLink}`,
        ``,
        `📥 Download (mọi loại file):`,
        `   ${rawDownload}`,
        ``,
        `🖼️ Embed ảnh trực tiếp (image only):`,
        `   ${rawEmbed}`,
        `──────────────────────────`,
        `💡 Dùng link Download để nhúng vào project (fetch/img src/...)`,
    ].join("\n"));
}
