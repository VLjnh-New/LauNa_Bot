/*
 * shop.js — Cửa hàng & Chuyển xu
 * .shop         — Xem cửa hàng
 * .buy <id>     — Mua vật phẩm
 * .transfer @mention <số> — Chuyển xu cho người khác
 */

import { readJSON, writeJSON } from "../utils/core/io-json.js";
import { log } from "../logger.js";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../data/shop_items.json");

export const name = "shop";
export const description = "Cửa hàng tiêu xu & chuyển xu giữa người dùng";

// ── Danh sách sản phẩm cố định ────────────────────────────────────────────
const SHOP_ITEMS = [
  // Danh hiệu
  { id: "title_hunter",    category: "🏷️ Danh Hiệu",  name: "Thợ Săn",         price: 500,   type: "title",   value: "🗡️ Thợ Săn"    },
  { id: "title_mage",      category: "🏷️ Danh Hiệu",  name: "Pháp Sư",          price: 1000,  type: "title",   value: "🔮 Pháp Sư"    },
  { id: "title_king",      category: "🏷️ Danh Hiệu",  name: "Vương Giả",        price: 5000,  type: "title",   value: "👑 Vương Giả"  },
  { id: "title_dragon",    category: "🏷️ Danh Hiệu",  name: "Rồng Chúa",        price: 10000, type: "title",   value: "🐲 Rồng Chúa" },
  { id: "title_legend",    category: "🏷️ Danh Hiệu",  name: "Huyền Thoại",      price: 25000, type: "title",   value: "⚡ Huyền Thoại" },
  // Vật phẩm Pokemon
  { id: "pokeball_x10",    category: "🎒 Pokémon",     name: "Pokéball x10",     price: 200,   type: "item",    value: { item: "pokeball",  qty: 10 } },
  { id: "greatball_x5",    category: "🎒 Pokémon",     name: "Greatball x5",     price: 300,   type: "item",    value: { item: "greatball", qty: 5  } },
  { id: "ultraball_x3",    category: "🎒 Pokémon",     name: "Ultraball x3",     price: 400,   type: "item",    value: { item: "ultraball", qty: 3  } },
  { id: "exp_candy_s_x5",  category: "🎒 Pokémon",     name: "Kẹo EXP S x5",    price: 250,   type: "item",    value: { item: "exp_candy_s", qty: 5 } },
  { id: "exp_candy_m_x3",  category: "🎒 Pokémon",     name: "Kẹo EXP M x3",    price: 500,   type: "item",    value: { item: "exp_candy_m", qty: 3 } },
  { id: "rename_tag",      category: "🎒 Pokémon",     name: "Thẻ Đổi Tên",      price: 800,   type: "item",    value: { item: "rename_tag", qty: 1 } },
  // Boost
  { id: "xp_boost_1h",     category: "⚡ Boost",       name: "2x XP (1 giờ)",    price: 1500,  type: "boost",   value: { boost: "xp2x", duration: 3600000 } },
  { id: "luck_boost_1h",   category: "⚡ Boost",       name: "Tăng May Mắn (1h)",price: 2000,  type: "boost",   value: { boost: "luck", duration: 3600000 } },
];

// ── Data helpers ───────────────────────────────────────────────────────────
function loadInventory() {
  try { return readJSON(DATA_FILE); } catch { return {}; }
}
function saveInventory(d) { writeJSON(DATA_FILE, d); }

function getBank() {
  if (!global.bankManager) return null;
  return global.bankManager.load();
}
function saveBank(b) {
  if (global.bankManager) global.bankManager.save(b);
}
function getBalance(bank, uid) {
  return bank?.accounts?.[uid]?.balance ?? 0;
}
function deductBalance(bank, uid, amount) {
  if (!bank.accounts[uid]) bank.accounts[uid] = { balance: 0, transactions: [] };
  bank.accounts[uid].balance -= amount;
  bank.accounts[uid].transactions.push({ type: "shop", amount: -amount, ts: Date.now() });
}
function addBalance(bank, uid, amount, note = "transfer") {
  if (!bank.accounts[uid]) bank.accounts[uid] = { balance: 0, transactions: [] };
  bank.accounts[uid].balance += amount;
  bank.accounts[uid].transactions.push({ type: note, amount, ts: Date.now() });
}

// ── Commands ───────────────────────────────────────────────────────────────
export const commands = [
  {
    name: "shop",
    aliases: ["store", "cuahang"],
    description: "Xem cửa hàng và mua vật phẩm",
    usage: ".shop | .shop mua <id>",
    async execute(ctx) {
      const { args, senderId, senderName, threadId, threadType } = ctx;
      const sub = (args[0] || "").toLowerCase();

      if (sub === "mua" || sub === "buy") {
        return ctx.api.sendMessage({ msg: "💡 Dùng lệnh .buy <id> để mua. VD: .buy pokeball_x10" }, threadId, threadType);
      }

      const bank = getBank();
      const balance = getBalance(bank, senderId);

      const categories = {};
      for (const item of SHOP_ITEMS) {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item);
      }

      let msg = `🏪 Cửa Hàng LauNa\n💰 Xu của bạn: ${balance.toLocaleString()} xu\n${"─".repeat(28)}\n`;
      for (const [cat, items] of Object.entries(categories)) {
        msg += `\n${cat}\n`;
        for (const it of items) {
          msg += `  [${it.id}] ${it.name} — ${it.price.toLocaleString()} xu\n`;
        }
      }
      msg += `\n💡 Dùng .buy <id> để mua. VD: .buy pokeball_x10`;
      ctx.api.sendMessage({ msg, quote: ctx.message?.data }, threadId, threadType);
    }
  },

  {
    name: "buy",
    aliases: ["mua"],
    description: "Mua vật phẩm trong cửa hàng",
    usage: ".buy <item_id>",
    async execute(ctx) {
      const { args, senderId, senderName, threadId, threadType } = ctx;
      const itemId = (args[0] || "").toLowerCase();
      const item = SHOP_ITEMS.find(i => i.id === itemId);
      if (!item) {
        return ctx.api.sendMessage({ msg: `❌ Không tìm thấy vật phẩm "${itemId}".\n💡 Dùng .shop để xem danh sách.` }, threadId, threadType);
      }

      const bank = getBank();
      if (!bank) return ctx.api.sendMessage({ msg: "❌ Hệ thống ngân hàng chưa sẵn sàng." }, threadId, threadType);

      const balance = getBalance(bank, senderId);
      if (balance < item.price) {
        return ctx.api.sendMessage({
          msg: `❌ Không đủ xu!\n💰 Bạn có: ${balance.toLocaleString()} xu\n🏷️ Giá: ${item.price.toLocaleString()} xu`
        }, threadId, threadType);
      }

      deductBalance(bank, senderId, item.price);

      const inv = loadInventory();
      if (!inv[senderId]) inv[senderId] = { titles: [], items: {}, boosts: [], activeTitle: null };

      if (item.type === "title") {
        if (!inv[senderId].titles.includes(item.value)) {
          inv[senderId].titles.push(item.value);
        }
        inv[senderId].activeTitle = item.value;
        saveInventory(inv);
        saveBank(bank);
        return ctx.api.sendMessage({
          msg: `✅ ${senderName} đã mua danh hiệu ${item.value}!\n💰 Còn lại: ${(balance - item.price).toLocaleString()} xu\n\n✨ Danh hiệu đã tự động được kích hoạt!`
        }, threadId, threadType);
      }

      if (item.type === "item") {
        const { item: iName, qty } = item.value;
        if (!inv[senderId].items[iName]) inv[senderId].items[iName] = 0;
        inv[senderId].items[iName] += qty;
        saveInventory(inv);
        saveBank(bank);
        return ctx.api.sendMessage({
          msg: `✅ ${senderName} đã mua ${item.name}!\n💰 Còn lại: ${(balance - item.price).toLocaleString()} xu`
        }, threadId, threadType);
      }

      if (item.type === "boost") {
        const { boost, duration } = item.value;
        const expires = Date.now() + duration;
        inv[senderId].boosts = inv[senderId].boosts.filter(b => b.boost !== boost || b.expires < Date.now());
        inv[senderId].boosts.push({ boost, expires });
        saveInventory(inv);
        saveBank(bank);
        return ctx.api.sendMessage({
          msg: `✅ ${senderName} đã kích hoạt ${item.name}!\n⏰ Có hiệu lực trong 1 giờ\n💰 Còn lại: ${(balance - item.price).toLocaleString()} xu`
        }, threadId, threadType);
      }
    }
  },

  {
    name: "inventory",
    aliases: ["inv", "tui"],
    description: "Xem túi đồ của bạn",
    usage: ".inventory",
    async execute(ctx) {
      const { senderId, senderName, threadId, threadType } = ctx;
      const inv = loadInventory();
      const u = inv[senderId];
      if (!u) return ctx.api.sendMessage({ msg: "🎒 Túi đồ của bạn đang trống." }, threadId, threadType);

      let msg = `🎒 Túi đồ của ${senderName}\n${"─".repeat(28)}\n`;
      msg += `🏷️ Danh hiệu hiện tại: ${u.activeTitle || "Chưa có"}\n`;
      if (u.titles?.length) {
        msg += `📜 Tất cả danh hiệu: ${u.titles.join(", ")}\n`;
      }
      if (Object.keys(u.items || {}).length) {
        msg += `\n🎒 Vật phẩm:\n`;
        for (const [k, v] of Object.entries(u.items)) {
          msg += `  ${k}: x${v}\n`;
        }
      }
      const now = Date.now();
      const activeBoosts = (u.boosts || []).filter(b => b.expires > now);
      if (activeBoosts.length) {
        msg += `\n⚡ Boost đang hoạt động:\n`;
        for (const b of activeBoosts) {
          const left = Math.ceil((b.expires - now) / 60000);
          msg += `  ${b.boost} — còn ${left} phút\n`;
        }
      }
      ctx.api.sendMessage({ msg, quote: ctx.message?.data }, threadId, threadType);
    }
  },

  {
    name: "title",
    aliases: ["dauhieu"],
    description: "Đổi danh hiệu đang đeo",
    usage: ".title <tên danh hiệu>",
    async execute(ctx) {
      const { args, senderId, senderName, threadId, threadType } = ctx;
      const inv = loadInventory();
      const u = inv[senderId];
      if (!u?.titles?.length) {
        return ctx.api.sendMessage({ msg: "❌ Bạn chưa có danh hiệu nào. Mua tại .shop" }, threadId, threadType);
      }
      const target = args.join(" ").trim();
      const found = u.titles.find(t => t.toLowerCase().includes(target.toLowerCase()));
      if (!found) {
        return ctx.api.sendMessage({ msg: `❌ Bạn không có danh hiệu "${target}".\n📜 Danh hiệu của bạn: ${u.titles.join(", ")}` }, threadId, threadType);
      }
      u.activeTitle = found;
      saveInventory(inv);
      ctx.api.sendMessage({ msg: `✅ ${senderName} đã đổi sang danh hiệu ${found}!` }, threadId, threadType);
    }
  },

  {
    name: "transfer",
    aliases: ["chuyenxu", "send"],
    description: "Chuyển xu cho người dùng khác",
    usage: ".transfer @mention <số xu>",
    async execute(ctx) {
      const { args, senderId, senderName, threadId, threadType, message } = ctx;
      const bank = getBank();
      if (!bank) return ctx.api.sendMessage({ msg: "❌ Hệ thống ngân hàng chưa sẵn sàng." }, threadId, threadType);

      // Lấy mention
      const mentions = message?.data?.mentions || [];
      if (!mentions.length) {
        return ctx.api.sendMessage({ msg: "❌ Cần tag người nhận!\nVD: .transfer @bạn 1000" }, threadId, threadType);
      }
      const targetId = mentions[0].uid || mentions[0].id;
      const targetName = mentions[0].displayName || mentions[0].name || "Người dùng";

      const amount = parseInt(args.find(a => /^\d+$/.test(a)));
      if (!amount || amount < 1) {
        return ctx.api.sendMessage({ msg: "❌ Số xu không hợp lệ. VD: .transfer @bạn 1000" }, threadId, threadType);
      }
      if (targetId === senderId) {
        return ctx.api.sendMessage({ msg: "❌ Không thể chuyển xu cho chính mình." }, threadId, threadType);
      }

      const balance = getBalance(bank, senderId);
      if (balance < amount) {
        return ctx.api.sendMessage({ msg: `❌ Không đủ xu!\n💰 Bạn có: ${balance.toLocaleString()} xu` }, threadId, threadType);
      }

      deductBalance(bank, senderId, amount);
      addBalance(bank, targetId, amount, "transfer_in");
      saveBank(bank);

      ctx.api.sendMessage({
        msg: `💸 Chuyển xu thành công!\n👤 ${senderName} → ${targetName}\n💰 ${amount.toLocaleString()} xu\n\n📊 Số dư còn lại: ${(balance - amount).toLocaleString()} xu`
      }, threadId, threadType);
    }
  }
];

/** Kiểm tra người dùng có boost nào không */
export function hasBoost(userId, boostType) {
  const inv = loadInventory();
  return (inv[userId]?.boosts || []).some(b => b.boost === boostType && b.expires > Date.now());
}

/** Lấy danh hiệu đang đeo */
export function getActiveTitle(userId) {
  const inv = loadInventory();
  return inv[userId]?.activeTitle || null;
}
