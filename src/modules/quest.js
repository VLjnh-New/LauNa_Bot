/*
 * quest.js — Hệ thống Nhiệm vụ Hàng ngày & Hàng tuần
 * Nhiệm vụ hàng ngày reset lúc 00:00 VN
 * Nhiệm vụ tuần reset Thứ Hai 00:00 VN
 */

import { readJSON, writeJSON } from "../utils/core/io-json.js";
import { log } from "../logger.js";
import moment from "moment-timezone";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "../data/quests.json");
const TZ = "Asia/Ho_Chi_Minh";

export const name = "quest";
export const description = "Hệ thống nhiệm vụ hàng ngày & hàng tuần";

// ── Định nghĩa nhiệm vụ ────────────────────────────────────────────────────
const DAILY_QUESTS = [
  { id: "daily_catch",    label: "🎣 Bắt 3 Pokémon",        type: "catch",      goal: 3,  reward: { xu: 200, xp: 50 } },
  { id: "daily_msg",      label: "💬 Gửi 20 tin nhắn",       type: "message",    goal: 20, reward: { xu: 100, xp: 30 } },
  { id: "daily_game",     label: "🎲 Chơi 2 minigame",       type: "play_game",  goal: 2,  reward: { xu: 150, xp: 40 } },
  { id: "daily_boss",     label: "⚔️ Tham chiến 1 Boss",     type: "boss_fight", goal: 1,  reward: { xu: 300, xp: 80 } },
  { id: "daily_login",    label: "📅 Điểm danh hôm nay",     type: "login",      goal: 1,  reward: { xu: 50,  xp: 20 } },
];

const WEEKLY_QUESTS = [
  { id: "week_catch",     label: "🎣 Bắt 15 Pokémon",        type: "catch",      goal: 15, reward: { xu: 1200, xp: 300 } },
  { id: "week_boss",      label: "⚔️ Hạ Boss 5 lần",         type: "boss_fight", goal: 5,  reward: { xu: 2000, xp: 500 } },
  { id: "week_game",      label: "🎲 Chơi 10 minigame",       type: "play_game",  goal: 10, reward: { xu: 800,  xp: 200 } },
  { id: "week_shiny",     label: "✨ Bắt 1 Pokémon Shiny",    type: "shiny",      goal: 1,  reward: { xu: 3000, xp: 700 } },
  { id: "week_msg",       label: "💬 Gửi 100 tin nhắn",       type: "message",    goal: 100,reward: { xu: 500,  xp: 150 } },
];

// ── Helpers ────────────────────────────────────────────────────────────────
function loadData() {
  try { return readJSON(DATA_FILE); } catch { return {}; }
}
function saveData(d) { writeJSON(DATA_FILE, d); }

function getDailyKey()  { return moment().tz(TZ).format("YYYYMMDD"); }
function getWeekKey()   { return moment().tz(TZ).startOf("isoWeek").format("YYYYMMDD"); }

function ensureUser(data, uid) {
  if (!data[uid]) data[uid] = { daily: {}, weekly: {}, dailyKey: "", weekKey: "" };
  const dKey = getDailyKey(), wKey = getWeekKey();
  if (data[uid].dailyKey !== dKey) {
    data[uid].daily = {};
    data[uid].dailyKey = dKey;
  }
  if (data[uid].weekKey !== wKey) {
    data[uid].weekly = {};
    data[uid].weekKey = wKey;
  }
}

function ensureQuest(user, questId, period) {
  if (!user[period][questId]) user[period][questId] = { progress: 0, done: false, claimed: false };
}

/** Gọi từ module khác để cộng tiến trình nhiệm vụ */
export function progressQuest(userId, type, amount = 1) {
  const data = loadData();
  ensureUser(data, userId);
  const u = data[userId];
  for (const q of DAILY_QUESTS) {
    if (q.type !== type) continue;
    ensureQuest(u, q.id, "daily");
    const e = u.daily[q.id];
    if (e.done) continue;
    e.progress = Math.min(e.progress + amount, q.goal);
    if (e.progress >= q.goal) e.done = true;
  }
  for (const q of WEEKLY_QUESTS) {
    if (q.type !== type) continue;
    ensureQuest(u, q.id, "weekly");
    const e = u.weekly[q.id];
    if (e.done) continue;
    e.progress = Math.min(e.progress + amount, q.goal);
    if (e.progress >= q.goal) e.done = true;
  }
  saveData(data);
}

// ── Commands ───────────────────────────────────────────────────────────────
export const commands = [
  {
    name: "quest",
    aliases: ["nhv", "nhiemvu"],
    description: "Xem danh sách nhiệm vụ của bạn",
    usage: ".quest [claim|ngay|tuan]",
    async execute(ctx) {
      const { args, senderId, senderName, threadId, threadType } = ctx;
      const sub = (args[0] || "").toLowerCase();
      const data = loadData();
      ensureUser(data, senderId);
      const u = data[senderId];

      if (sub === "claim" || sub === "nhan") {
        let earned = { xu: 0, xp: 0 };
        let msgs = [];
        for (const q of [...DAILY_QUESTS, ...WEEKLY_QUESTS]) {
          const period = DAILY_QUESTS.find(x => x.id === q.id) ? "daily" : "weekly";
          ensureQuest(u, q.id, period);
          const e = u[period][q.id];
          if (e.done && !e.claimed) {
            e.claimed = true;
            earned.xu += q.reward.xu;
            earned.xp += q.reward.xp;
            msgs.push(`✅ ${q.label}`);
          }
        }
        if (!msgs.length) {
          return ctx.api.sendMessage({ msg: "❌ Bạn không có nhiệm vụ nào hoàn thành cần nhận thưởng." }, threadId, threadType);
        }
        // Cộng xu qua bankManager
        if (global.bankManager) {
          const bank = global.bankManager.load();
          if (!bank.accounts[senderId]) bank.accounts[senderId] = { balance: 0, transactions: [] };
          bank.accounts[senderId].balance += earned.xu;
          global.bankManager.save(bank);
        }
        saveData(data);
        const msg = `🎁 ${senderName} nhận thưởng nhiệm vụ!\n\n`
          + msgs.join("\n")
          + `\n\n💰 +${earned.xu.toLocaleString()} xu\n⭐ +${earned.xp} XP`;
        return ctx.api.sendMessage({ msg, quote: ctx.message?.data }, threadId, threadType);
      }

      // Hiển thị bảng nhiệm vụ
      const showPeriod = (label, list, periodKey) => {
        let out = `${label}\n`;
        for (const q of list) {
          ensureQuest(u, q.id, periodKey);
          const e = u[periodKey][q.id];
          const bar = Math.round((e.progress / q.goal) * 10);
          const fill = "█".repeat(bar) + "░".repeat(10 - bar);
          const status = e.claimed ? "✅" : e.done ? "🎁" : "⬜";
          out += `${status} ${q.label}\n   [${fill}] ${e.progress}/${q.goal} — +${q.reward.xu}xu +${q.reward.xp}XP\n`;
        }
        return out;
      };

      const show = (sub === "tuan" || sub === "weekly") ? "weekly"
                 : (sub === "ngay" || sub === "daily")  ? "daily"
                 : "both";

      let reply = `📋 Nhiệm Vụ của ${senderName}\n${"─".repeat(28)}\n`;
      if (show !== "weekly") reply += showPeriod("🌅 HÀNG NGÀY", DAILY_QUESTS, "daily") + "\n";
      if (show !== "daily")  reply += showPeriod("📆 HÀNG TUẦN", WEEKLY_QUESTS, "weekly");
      reply += "\n💡 .quest claim — Nhận tất cả phần thưởng hoàn thành";
      ctx.api.sendMessage({ msg: reply, quote: ctx.message?.data }, threadId, threadType);
    }
  }
];
