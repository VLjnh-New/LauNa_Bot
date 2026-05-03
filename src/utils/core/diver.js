import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { google } from "googleapis";
import ngrok from "@ngrok/ngrok";
import { log } from "../../logger.js";

const DIVER_FILE      = path.resolve("diver.json");
const DIVER_LINKS_DIR = path.resolve("diver_links");
const CALLBACK_PORT   = 7788;
const SCOPES        = ["https://www.googleapis.com/auth/drive"];
const AUTH_TIMEOUT  = 5 * 60 * 1000;

let _oauth2Client = null;
let _drive        = null;
let _activeSession = null;

// ── diver.json ───────────────────────────────────────────────────────────────

export function readDiver() {
    if (!existsSync(DIVER_FILE)) return {};
    try { return JSON.parse(readFileSync(DIVER_FILE, "utf8")); }
    catch { return {}; }
}

export function writeDiver(data) {
    const merged = { ...readDiver(), ...data };
    writeFileSync(DIVER_FILE, JSON.stringify(merged, null, 2), "utf8");
}

export function isDiverReady() {
    const d = readDiver();
    return !!(d.client_id && d.client_secret);
}

// type: "video" | "audio" | "image" | "file"
export function saveDiverLink({ name, link, type = "file", source = "api" }) {
    try {
        if (!existsSync(DIVER_LINKS_DIR)) mkdirSync(DIVER_LINKS_DIR, { recursive: true });

        const validTypes = ["video", "audio", "image", "file"];
        const key  = validTypes.includes(type) ? type : "file";
        const file = path.join(DIVER_LINKS_DIR, `${key}.json`);

        let list = [];
        if (existsSync(file)) {
            try { list = JSON.parse(readFileSync(file, "utf8")); } catch {}
        }
        list.push({ time: new Date().toISOString(), source, name: name || "", link: link || "" });
        // Giữ tối đa 500 mục mới nhất — tránh file phình vô hạn
        if (list.length > 500) list = list.slice(list.length - 500);
        writeFileSync(file, JSON.stringify(list, null, 2), "utf8");
    } catch (e) {
        log.warn("[Diver] Không lưu được link:", e.message);
    }
}

// ── Drive client ─────────────────────────────────────────────────────────────

function loadCredentials() {
    if (!existsSync(DIVER_FILE)) return null;
    try {
        const d = JSON.parse(readFileSync(DIVER_FILE, "utf8"));
        if (d.drive_auth_invalid) return null;
        if (d.client_id && d.client_secret && d.refresh_token) {
            return {
                clientId:     d.client_id,
                clientSecret: d.client_secret,
                refreshToken: d.refresh_token,
                accessToken:  d.access_token  || null,
                expiryDate:   d.expiry_date   || null,
            };
        }
    } catch (e) { log.warn("[Diver] diver.json lỗi:", e.message); }
    return null;
}

function saveTokens(tokens) {
    if (!existsSync(DIVER_FILE)) return;
    try {
        const d = JSON.parse(readFileSync(DIVER_FILE, "utf8"));
        if (tokens.access_token)  d.access_token  = tokens.access_token;
        if (tokens.refresh_token) d.refresh_token = tokens.refresh_token;
        if (tokens.expiry_date)   d.expiry_date   = tokens.expiry_date;
        d.last_refreshed = new Date().toISOString();
        writeFileSync(DIVER_FILE, JSON.stringify(d, null, 2), "utf8");
    } catch {}
}

function getClient() {
    if (_drive) return _drive;
    const creds = loadCredentials();
    if (!creds) throw new Error("Chưa có thông tin Google Drive — dùng .gdrive auth");

    _oauth2Client = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
    _oauth2Client.setCredentials({
        refresh_token: creds.refreshToken,
        access_token:  creds.accessToken,
        expiry_date:   creds.expiryDate,
    });
    _oauth2Client.on("tokens", saveTokens);
    _drive = google.drive({ version: "v3", auth: _oauth2Client });
    return _drive;
}

export function resetDriveClient() {
    _oauth2Client = null;
    _drive        = null;
}

export function isDriveAuthError(error) {
    const parts = [
        error?.message,
        error?.code,
        error?.response?.data?.error,
        error?.response?.data?.error_description,
        error?.errors?.[0]?.reason,
    ].filter(Boolean).map(v => String(v).toLowerCase());
    return parts.some(v => v.includes("invalid_grant") || v.includes("invalid credentials") || v.includes("token has been expired or revoked"));
}

export function markDriveAuthInvalid(error = null) {
    const reason = error?.message || error?.response?.data?.error_description || error?.response?.data?.error || "invalid_grant";
    resetDriveClient();
    writeDiver({
        access_token: null,
        expiry_date: null,
        drive_auth_invalid: true,
        drive_auth_invalid_at: new Date().toISOString(),
        drive_auth_invalid_reason: String(reason).slice(0, 200),
    });
}

export function isDriveConfigured() {
    return loadCredentials() != null;
}

export function getRootFolderId() {
    if (!existsSync(DIVER_FILE)) return null;
    try { return JSON.parse(readFileSync(DIVER_FILE, "utf8")).root_folder_id || null; }
    catch { return null; }
}

// ── Folder ───────────────────────────────────────────────────────────────────

export async function ensureFolder(folderName, parentId = null) {
    const drive = getClient();
    const q = [
        `name = '${folderName}'`,
        `mimeType = 'application/vnd.google-apps.folder'`,
        `trashed = false`,
        parentId ? `'${parentId}' in parents` : `'root' in parents`,
    ].join(" and ");

    const res = await drive.files.list({ q, fields: "files(id)", pageSize: 1 });
    if (res.data.files.length > 0) return res.data.files[0].id;

    const f = await drive.files.create({
        requestBody: {
            name: folderName,
            mimeType: "application/vnd.google-apps.folder",
            parents: parentId ? [parentId] : ["root"],
        },
        fields: "id",
    });
    return f.data.id;
}

// ── Xóa file cũ cùng tên ─────────────────────────────────────────────────────

export async function deleteExistingByName(fileName, folderId = null) {
    const drive = getClient();
    const escaped = fileName.replace(/'/g, "\\'");
    const q = [
        `name = '${escaped}'`,
        `trashed = false`,
        `'me' in owners`,
        folderId ? `'${folderId}' in parents` : `'root' in parents`,
    ].join(" and ");

    const res = await drive.files.list({ q, fields: "files(id, name)", pageSize: 50 });
    let deleted = 0;
    for (const f of (res.data.files || [])) {
        try { await drive.files.delete({ fileId: f.id }); deleted++; }
        catch (e) { log.warn(`[Diver] Không xóa được ${f.id}: ${e.message}`); }
    }
    if (deleted > 0) log.info(`[Diver] Đã xóa ${deleted} file cũ "${fileName}"`);
    return deleted;
}

// ── Upload ───────────────────────────────────────────────────────────────────

export function getRawLink(fileId, mimeType = "", fileName = "") {
    if (mimeType.startsWith("image/")) {
        return `https://lh3.googleusercontent.com/d/${fileId}`;
    }
    const base = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&authuser=0&confirm=t`;
    // Thêm tên file vào cuối URL để link có đuôi .mp4/.mp3/...
    if (fileName) {
        const safe = encodeURIComponent(fileName);
        return `${base}&name=${safe}`;
    }
    return base;
}

export async function uploadFile(filePath, folderId = null, fileName = null) {
    if (!existsSync(filePath)) throw new Error(`File không tồn tại: ${filePath}`);

    const drive  = getClient();
    const name   = fileName || path.basename(filePath);
    const sizeMB = (statSync(filePath).size / 1024 / 1024).toFixed(2);

    const replacedOld = await deleteExistingByName(name, folderId).catch(() => 0);

    const res = await drive.files.create({
        requestBody: { name, parents: folderId ? [folderId] : ["root"] },
        media: { body: createReadStream(filePath) },
        fields: "id, name, mimeType, webViewLink, webContentLink, size",
    });

    const file = res.data;
    await drive.permissions.create({ fileId: file.id, requestBody: { role: "reader", type: "anyone" } });

    const shareRes = await drive.files.get({ fileId: file.id, fields: "webViewLink, webContentLink, mimeType" });
    const rawLink  = getRawLink(file.id, shareRes.data.mimeType || "", name);

    return {
        id:             file.id,
        name:           file.name,
        mimeType:       shareRes.data.mimeType || "",
        webViewLink:    shareRes.data.webViewLink,
        webContentLink: shareRes.data.webContentLink,
        rawLink,
        sizeMB,
        replacedOld,
    };
}

// ── List ─────────────────────────────────────────────────────────────────────

export async function listFiles(folderId = null, maxFiles = 20) {
    const drive       = getClient();
    const effectiveId = folderId || getRootFolderId();
    const q = effectiveId
        ? `'${effectiveId}' in parents and trashed = false`
        : `'root' in parents and trashed = false`;

    const res = await drive.files.list({
        q,
        fields:   "files(id, name, size, mimeType, webViewLink, createdTime)",
        pageSize: maxFiles,
        orderBy:  "createdTime desc",
    });
    return res.data.files;
}

// ── Delete ───────────────────────────────────────────────────────────────────

export async function deleteFile(fileId) {
    await getClient().files.delete({ fileId });
}

export async function deleteAllInFolder(folderId) {
    const drive = getClient();
    let pageToken = null, deleted = 0, errors = 0;
    const errDetails = [];

    do {
        const res = await drive.files.list({
            q:        `'${folderId}' in parents and trashed = false and 'me' in owners`,
            fields:   "nextPageToken, files(id, name)",
            pageSize: 100,
            ...(pageToken ? { pageToken } : {}),
        });
        for (const f of (res.data.files || [])) {
            try { await drive.files.delete({ fileId: f.id }); deleted++; }
            catch (e) { errors++; errDetails.push(`${f.name}: ${e?.errors?.[0]?.reason || e.message}`); }
        }
        pageToken = res.data.nextPageToken || null;
    } while (pageToken);

    return { deleted, errors, errDetails };
}

export async function deleteAllFiles() {
    const rootId = getRootFolderId();
    if (rootId) return deleteAllInFolder(rootId);

    const drive = getClient();
    let pageToken = null, deleted = 0, errors = 0;
    const errDetails = [];

    do {
        const res = await drive.files.list({
            q:        "trashed = false and 'me' in owners",
            fields:   "nextPageToken, files(id, name)",
            pageSize: 100,
            ...(pageToken ? { pageToken } : {}),
        });
        for (const f of (res.data.files || [])) {
            try { await drive.files.delete({ fileId: f.id }); deleted++; }
            catch (e) { errors++; errDetails.push(`${f.name}: ${e?.errors?.[0]?.reason || e.message}`); }
        }
        pageToken = res.data.nextPageToken || null;
    } while (pageToken);

    return { deleted, errors, errDetails };
}

// ── Storage info ─────────────────────────────────────────────────────────────

export async function getDriveStorageInfo() {
    const res = await getClient().about.get({ fields: "storageQuota" });
    const q   = res.data.storageQuota;
    const toMB = v => v ? (parseInt(v) / 1024 / 1024).toFixed(1) : "∞";
    return { used: toMB(q.usage), total: toMB(q.limit), inDrive: toMB(q.usageInDrive) };
}

// ── OAuth auth flow ──────────────────────────────────────────────────────────

export async function cancelDriveAuth() {
    if (!_activeSession) return false;
    const { server, listener, reject, timer } = _activeSession;
    if (timer)  clearTimeout(timer);
    if (reject) reject(new Error("AUTH_CANCELLED"));
    try { server?.close(); } catch {}
    try { await listener?.close(); } catch {}
    _activeSession = null;
    return true;
}

export async function startDriveAuth(onStatus) {
    if (_activeSession) {
        if (_activeSession.currentAuthUrl) {
            await onStatus([
                "🔐 Đang có phiên xác thực chạy!",
                "🔗 Mở link này để đăng nhập Google:",
                _activeSession.currentAuthUrl,
                "",
                "⏳ Dùng .gdrive authcancel để huỷ.",
            ].join("\n")).catch(() => {});
        }
        return await _activeSession.promise;
    }

    const diver = readDiver();
    if (!diver.client_id || !diver.client_secret) {
        throw new Error("Chưa có client_id / client_secret — dùng .gdrive setup");
    }

    let listener;
    try {
        const opts = { addr: CALLBACK_PORT };
        if (diver.ngrok_token)  opts.authtoken = diver.ngrok_token;
        if (diver.ngrok_domain) opts.domain    = diver.ngrok_domain;
        listener = await ngrok.connect(opts);
    } catch (e) {
        throw new Error(`Không mở được ngrok tunnel: ${e.message}`);
    }

    const redirectUri  = `${listener.url()}/oauth/callback`;
    const isStatic     = !!diver.ngrok_domain;
    const oauth2Client = new google.auth.OAuth2(diver.client_id, diver.client_secret, redirectUri);
    const authUrl      = oauth2Client.generateAuthUrl({ access_type: "offline", scope: SCOPES, prompt: "consent" });

    const lines = ["🔐 XÁC THỰC GOOGLE DRIVE", "──────────────────────────"];
    if (isStatic) {
        lines.push("🔗 Mở link này để đăng nhập:", authUrl, "", "⏳ Bot đang chờ (timeout 5 phút)...");
    } else {
        lines.push(
            "📋 Bước 1 — Thêm Redirect URI vào Google Console:", `   ${redirectUri}`, "",
            "🔗 Bước 2 — Mở link này để đăng nhập:", authUrl, "",
            "💡 Dùng .gdrive setdomain để cố định URL.", "",
            "⏳ Bot đang chờ (timeout 5 phút)...",
        );
    }
    await onStatus(lines.join("\n"));

    _activeSession = { server: null, listener, resolve: null, reject: null, timer: null, currentAuthUrl: authUrl, promise: null };

    const promise = new Promise((resolve, reject) => {
        const server = createServer(async (req, res) => {
            res.setHeader("ngrok-skip-browser-warning", "true");
            res.setHeader("Content-Type", "text/html; charset=utf-8");

            const u = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
            if (u.pathname !== "/oauth/callback") {
                res.writeHead(404); res.end("<h2>Not found</h2>"); return;
            }

            const code  = u.searchParams.get("code");
            const error = u.searchParams.get("error");

            if (error || !code) {
                res.writeHead(400);
                res.end(htmlPage("❌ Lỗi xác thực", `<p style="color:#f85149">${error || "Không có code"}</p>`));
                cleanup(); reject(new Error(`OAuth error: ${error || "no code"}`)); return;
            }

            try {
                const { tokens } = await oauth2Client.getToken(code);

                if (!tokens.refresh_token) {
                    res.writeHead(200);
                    res.end(htmlPage("⚠️ Thiếu refresh_token", `
                        <p>Thu hồi quyền tại: <a href="https://myaccount.google.com/permissions" style="color:#58a6ff">myaccount.google.com/permissions</a></p>
                    `));
                    cleanup(); reject(new Error("NO_REFRESH_TOKEN")); return;
                }

                oauth2Client.setCredentials(tokens);
                let email = null;
                try {
                    const r = await google.oauth2({ version: "v2", auth: oauth2Client }).userinfo.get();
                    email = r.data.email;
                } catch {}

                writeDiver({
                    refresh_token: tokens.refresh_token,
                    access_token:  tokens.access_token  || null,
                    token_type:    tokens.token_type     || "Bearer",
                    expiry_date:   tokens.expiry_date    || null,
                    email,
                    saved_at: new Date().toISOString(),
                    drive_auth_invalid: false,
                    drive_auth_invalid_at: null,
                    drive_auth_invalid_reason: null,
                });

                resetDriveClient();
                res.writeHead(200);
                res.end(htmlPage("✅ Xác thực thành công!", `
                    <p>Email: ${email || "?"}</p>
                    <p style="color:#3fb950">✅ Token lưu vào diver.json — Bot sẵn sàng!</p>
                    <p>Bạn có thể đóng tab này.</p>
                `));
                cleanup(); resolve({ email, refresh_token: tokens.refresh_token });

            } catch (e) {
                res.writeHead(500); res.end(htmlPage("❌ Lỗi", `<p>${e.message}</p>`));
                cleanup(); reject(e);
            }
        });

        const timer = setTimeout(() => { cleanup(); reject(new Error("AUTH_TIMEOUT")); }, AUTH_TIMEOUT);

        async function cleanup() {
            clearTimeout(timer);
            try { server.close(); } catch {}
            try { await listener.close(); } catch {}
            _activeSession = null;
        }

        server.listen(CALLBACK_PORT);
        _activeSession.server  = server;
        _activeSession.resolve = resolve;
        _activeSession.reject  = reject;
        _activeSession.timer   = timer;
    });

    if (_activeSession) _activeSession.promise = promise;
    return promise;
}

function htmlPage(title, body) {
    return `<!DOCTYPE html><html lang="vi"><head><meta charset="UTF-8"><title>${title}</title>
<style>body{font-family:sans-serif;padding:30px;background:#0d1117;color:#e6edf3;max-width:600px;margin:0 auto}a{color:#58a6ff}</style>
</head><body><h2>${title}</h2>${body}</body></html>`;
}
