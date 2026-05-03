import { axios, log, fs, path, uploadToTmpFiles } from "../globals.js";
import { drawMailCard } from "../utils/canvas/canvasHelper.js";

/**
 * Module: mail / tempmail
 * Tạo và quản lý email tạm thời qua temp-mail.org
 *
 * Cách dùng:
 *   .tempmail            → tạo email mới
 *   .tempmail check      → kiểm tra hộp thư
 *   .tempmail read <số>  → đọc nội dung email thứ <số>
 *   .tempmail del        → xoá email hiện tại
 */

const BASE    = "https://api.internal.temp-mail.io/api/v3";
const HEADERS = { "Content-Type": "application/json" };

const sessions = new Map();

function getSession(uid)       { return sessions.get(String(uid)) || null; }
function setSession(uid, data) { sessions.set(String(uid), data); }
function clearSession(uid)     { sessions.delete(String(uid)); }

async function createEmail() {
  const res = await axios.post(`${BASE}/email/new`, {}, { headers: HEADERS, timeout: 10000 });
  return res.data;
}

async function getMessages(email) {
  const res = await axios.get(`${BASE}/email/${email}/messages`, { timeout: 10000 });
  return Array.isArray(res.data) ? res.data : [];
}

async function deleteEmail(token) {
  await axios.delete(`${BASE}/email/${token}`, { timeout: 10000 });
}

function stripHtml(html) {
  if (!html) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 800);
}

const FLAG_MAP = { "-n": "new", "-c": "check", "-r": "read", "-d": "del" };

async function sendMailCard(api, threadId, threadType, email, action, content, msg) {
  const cacheDir = path.join(process.cwd(), "src/modules/cache");
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
  const imgPath = path.join(cacheDir, `mail-${Date.now()}.png`);
  try {
    const buffer = await drawMailCard({ email, action, content });
    if (!buffer || !Buffer.isBuffer(buffer)) throw new Error("canvas unavailable");
    fs.writeFileSync(imgPath, buffer);
    const remoteUrl = await uploadToTmpFiles(imgPath, api, threadId, threadType);
    if (remoteUrl && api.sendImageEnhanced) {
      await api.sendImageEnhanced({ imageUrl: remoteUrl, threadId, threadType, width: 1000, height: 380, msg });
    } else {
      await api.sendMessage({ msg, attachments: [imgPath] }, threadId, threadType);
    }
  } catch (e) {
    log.error("[mail] Canvas lỗi:", e.message);
    await api.sendMessage({ msg }, threadId, threadType);
  } finally {
    if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
  }
}

async function handleMail(ctx) {
  const { api, threadId, threadType, senderId, args } = ctx;
  const reply = (msg) => api.sendMessage({ msg }, threadId, threadType);
  const sub   = FLAG_MAP[args[0]] || (args[0] || "").toLowerCase();

  // ── Tạo email mới ───────────────────────────────────────────────────────────
  if (!sub || sub === "new") {
    await reply("⏳ Đang tạo email tạm thời...");
    try {
      const data = await createEmail();
      setSession(senderId, { email: data.email, token: data.token, createdAt: Date.now() });
      const msg =
        `[ 📧 TEMP MAIL ]\n─────────────────\n` +
        `✅ Email của bạn:\n${data.email}\n\n` +
        `📌 Lệnh:\n` +
        `• .tempmail check     — kiểm tra thư\n` +
        `• .tempmail read <số> — đọc thư\n` +
        `• .tempmail del       — xoá email\n` +
        `─────────────────\n` +
        `⚠️ Email chỉ tồn tại trong phiên bot chạy.`;
      return sendMailCard(api, threadId, threadType, data.email, "new",
        "• .tempmail check — kiem tra hop thu\n• .tempmail read <so> — doc thu\n• .tempmail del — xoa email", msg);
    } catch (err) {
      log.error(`[tempmail] Tạo email lỗi: ${err?.message}`);
      return reply(`❌ Không thể tạo email: ${err?.message || "lỗi không xác định"}`);
    }
  }

  // ── Kiểm tra hộp thư ────────────────────────────────────────────────────────
  if (sub === "check") {
    const session = getSession(senderId);
    if (!session) return reply('⚠️ Bạn chưa có email. Dùng ".tempmail" để tạo.');

    await reply(`⏳ Đang kiểm tra hộp thư...\n📧 ${session.email}`);
    try {
      const messages = await getMessages(session.email);
      if (!messages.length) {
        const msg =
          `[ 📬 HỘP THƯ ]\n─────────────────\n` +
          `📧 ${session.email}\n\n📭 Chưa có thư nào.\n─────────────────\n` +
          `Thử lại sau vài giây nếu vừa đăng ký.`;
        return sendMailCard(api, threadId, threadType, session.email, "check", "Chua co thu nao trong hop thu.", msg);
      }

      const list = messages.slice(0, 10).map((m, i) => {
        const from    = m.from    || "Không rõ";
        const subject = m.subject || "(Không có tiêu đề)";
        const date    = m.created_at ? new Date(m.created_at * 1000).toLocaleString("vi-VN") : "";
        return `${i + 1}. 📩 ${subject}\n   Từ: ${from}${date ? `\n   ${date}` : ""}`;
      }).join("\n\n");

      const msg =
        `[ 📬 HỘP THƯ ]\n─────────────────\n` +
        `📧 ${session.email}\n📨 ${messages.length} thư\n\n${list}\n` +
        `─────────────────\nDùng ".tempmail read <số>" để đọc thư.`;

      const previewLines = messages.slice(0, 3).map((m, i) =>
        `• Thu ${i + 1}: ${(m.subject || "No Subject").substring(0, 30)}`
      ).join("\n");

      return sendMailCard(api, threadId, threadType, session.email, "check", previewLines, msg);
    } catch (err) {
      log.error(`[tempmail] Check lỗi: ${err?.message}`);
      return reply(`❌ Không thể kiểm tra thư: ${err?.message || "lỗi không xác định"}`);
    }
  }

  // ── Đọc thư ─────────────────────────────────────────────────────────────────
  if (sub === "read") {
    const session = getSession(senderId);
    if (!session) return reply('⚠️ Bạn chưa có email. Dùng ".tempmail" để tạo.');

    const idx = parseInt(args[1], 10);
    if (!args[1] || isNaN(idx) || idx < 1) {
      return reply('❓ Cú pháp: .tempmail read <số>\nVD: .tempmail read 1');
    }

    try {
      const messages = await getMessages(session.email);
      if (!messages.length) return reply("📭 Hộp thư trống.");
      if (idx > messages.length) return reply(`❌ Chỉ có ${messages.length} thư. Nhập số từ 1–${messages.length}.`);

      const m       = messages[idx - 1];
      const from    = m.from    || "Không rõ";
      const subject = m.subject || "(Không có tiêu đề)";
      const date    = m.created_at ? new Date(m.created_at * 1000).toLocaleString("vi-VN") : "";
      const body    = stripHtml(m.body_html || m.body_text || m.text || "");

      const msg =
        `[ 📩 THƯ #${idx} ]\n─────────────────\n` +
        `📧 Đến: ${session.email}\n` +
        `👤 Từ: ${from}\n` +
        `📌 Tiêu đề: ${subject}\n` +
        (date ? `🕐 ${date}\n` : "") +
        `─────────────────\n` +
        `${body || "(Nội dung trống)"}` +
        (body.length >= 800 ? "\n...(nội dung quá dài, đã cắt bớt)" : "");

      const cardContent = `• Tu: ${from}\n• Tieu de: ${(subject).substring(0, 40)}\n• ${date || ""}`;
      return sendMailCard(api, threadId, threadType, session.email, "read", cardContent, msg);
    } catch (err) {
      log.error(`[tempmail] Read lỗi: ${err?.message}`);
      return reply(`❌ Không thể đọc thư: ${err?.message || "lỗi không xác định"}`);
    }
  }

  // ── Xoá email ───────────────────────────────────────────────────────────────
  if (sub === "del" || sub === "delete" || sub === "xoa") {
    const session = getSession(senderId);
    if (!session) return reply("⚠️ Bạn không có email nào đang dùng.");

    const deletedEmail = session.email;
    try { await deleteEmail(session.token); } catch (_) {}
    clearSession(senderId);

    const msg =
      `[ 🗑️ ĐÃ XOÁ ]\n─────────────────\n` +
      `✅ Đã xoá email: ${deletedEmail}\n\n` +
      `Dùng ".tempmail" để tạo email mới.`;
    return sendMailCard(api, threadId, threadType, deletedEmail, "del", "Da xoa email thanh cong.", msg);
  }

  return reply(
    `[ 📧 TEMP MAIL ]\n` +
    `─────────────────\n` +
    `Cách dùng:\n` +
    `• .tempmail           — tạo email mới\n` +
    `• .tempmail check     — kiểm tra hộp thư\n` +
    `• .tempmail read <số> — đọc thư\n` +
    `• .tempmail del       — xoá email`
  );
}

export const name        = "mail";
export const description = "Tạo & quản lý email tạm thời (temp-mail.org)";

export const commands = {
  mail: handleMail,
};
