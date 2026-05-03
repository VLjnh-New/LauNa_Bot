/*
 * slots.js — Máy Đánh Bạc & Blackjack
 * .slots <cược>     — Quay máy slot
 * .blackjack <cược> — Chơi Blackjack 21
 * .bj hit|stand     — Tiếp tục ván Blackjack đang chơi
 */

import { readJSON, writeJSON } from "../utils/core/io-json.js";
import { log } from "../logger.js";
import path from "node:path";
import { fileURLToPath } from "url";
import { randomInt } from "crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const name = "slots";
export const description = "Máy đánh bạc Slot & Blackjack 21";

// ── Slot Machine Config ────────────────────────────────────────────────────
const REELS = ["🍒", "🍋", "🍊", "🍇", "🎰", "💎", "7️⃣", "⭐"];
const PAYOUTS = {
  "7️⃣7️⃣7️⃣": 50,
  "💎💎💎": 20,
  "🎰🎰🎰": 15,
  "⭐⭐⭐":  10,
  "🍇🍇🍇": 8,
  "🍊🍊🍊": 5,
  "🍋🍋🍋": 4,
  "🍒🍒🍒": 3,
};
const MIN_BET = 50, MAX_BET = 100000;

// ── Blackjack State ────────────────────────────────────────────────────────
const BJ_SESSIONS = new Map(); // key: userId

const CARD_VALUES = {
  "A": [1, 11], "2": 2, "3": 3, "4": 4, "5": 5,
  "6": 6, "7": 7, "8": 8, "9": 9, "10": 10,
  "J": 10, "Q": 10, "K": 10
};
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];

function newDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push(`${r}${s}`);
  for (let i = d.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardValue(card) { return CARD_VALUES[card.slice(0, -1)]; }

function handScore(hand) {
  let score = 0, aces = 0;
  for (const c of hand) {
    const v = cardValue(c);
    if (Array.isArray(v)) { score += 11; aces++; }
    else score += v;
  }
  while (score > 21 && aces > 0) { score -= 10; aces--; }
  return score;
}

function handStr(hand, hideSecond = false) {
  if (hideSecond && hand.length >= 2) return `[${hand[0]}, 🂠]`;
  return `[${hand.join(", ")}]`;
}

// ── Bank Helpers ───────────────────────────────────────────────────────────
function getBank() {
  const bm = global.bankManager;
  if (!bm) return null;
  if (!bm._loaded) bm.load();
  return bm;
}
function saveBank(b) { if (b) b.save(); }
function getBalance(bank, uid) { return bank ? bank.getBalance(uid) : 0; }
function changeBalance(bank, uid, delta, _note) {
  if (!bank) return;
  if (delta > 0) bank.add(uid, delta);
  else if (delta < 0) bank.subtract(uid, -delta);
}

// ── Commands ───────────────────────────────────────────────────────────────
export const commands = [
  // ── SLOTS ──────────────────────────────────────────────────────────────
  {
    name: "slots",
    aliases: [],
    description: "Quay máy đánh bạc Slot",
    usage: ".slots <số xu cược>",
    async execute(ctx) {
      const { args, senderId, senderName, threadId, threadType } = ctx;
      const bank = getBank();
      if (!bank) return ctx.api.sendMessage({ msg: "❌ Ngân hàng chưa sẵn sàng." }, threadId, threadType);

      const bet = parseInt(args[0]);
      if (!bet || bet < MIN_BET || bet > MAX_BET) {
        return ctx.api.sendMessage({ msg: `❌ Cược từ ${MIN_BET.toLocaleString()} đến ${MAX_BET.toLocaleString()} xu.\nVD: .slots 500` }, threadId, threadType);
      }

      const balance = getBalance(bank, senderId);
      if (balance < bet) {
        return ctx.api.sendMessage({ msg: `❌ Không đủ xu! Bạn có ${balance.toLocaleString()} xu.` }, threadId, threadType);
      }

      // Spin!
      const r1 = REELS[randomInt(0, REELS.length)];
      const r2 = REELS[randomInt(0, REELS.length)];
      const r3 = REELS[randomInt(0, REELS.length)];
      const key = `${r1}${r2}${r3}`;
      const multiplier = PAYOUTS[key] || 0;

      let delta, resultMsg;
      if (multiplier > 0) {
        delta = bet * (multiplier - 1);
        resultMsg = `🎊 THẮNG! x${multiplier}\n💰 +${(bet * multiplier - bet).toLocaleString()} xu`;
      } else if (r1 === r2 || r2 === r3 || r1 === r3) {
        delta = Math.floor(-bet * 0.5);
        resultMsg = `🙂 Gần rồi… Mất ${Math.floor(bet * 0.5).toLocaleString()} xu`;
      } else {
        delta = -bet;
        resultMsg = `😢 Thua! Mất ${bet.toLocaleString()} xu`;
      }

      changeBalance(bank, senderId, delta, delta >= 0 ? "slots_win" : "slots_lose");
      saveBank(bank);

      const spin = [
        "🎰 Quay...",
        `╔═══╦═══╦═══╗`,
        `║ ${r1} ║ ${r2} ║ ${r3} ║`,
        `╚═══╩═══╩═══╝`,
      ];

      const payInfo = Object.entries(PAYOUTS).slice(0, 4).map(([k,v]) => `${k} → x${v}`).join(" | ");
      ctx.api.sendMessage({
        msg: `${spin.join("\n")}\n\n${resultMsg}\n💰 Số dư: ${(balance + delta).toLocaleString()} xu\n\n💡 ${payInfo}`
      }, threadId, threadType);
    }
  },

  // ── BLACKJACK ──────────────────────────────────────────────────────────
  {
    name: "blackjack",
    aliases: ["21"],
    description: "Chơi Blackjack 21",
    usage: ".blackjack <cược> | .bj hit | .bj stand",
    async execute(ctx) {
      const { args, senderId, senderName, threadId, threadType } = ctx;
      const sub = (args[0] || "").toLowerCase();

      if (sub === "hit" || sub === "rut") {
        return handleBjAction(ctx, "hit");
      }
      if (sub === "stand" || sub === "dung") {
        return handleBjAction(ctx, "stand");
      }
      if (sub === "double" || sub === "2x") {
        return handleBjAction(ctx, "double");
      }

      // Bắt đầu ván mới
      const bank = getBank();
      if (!bank) return ctx.api.sendMessage({ msg: "❌ Ngân hàng chưa sẵn sàng." }, threadId, threadType);

      if (BJ_SESSIONS.has(senderId)) {
        return ctx.api.sendMessage({ msg: "❌ Bạn đang có ván Blackjack dở!\nDùng .bj hit hoặc .bj stand" }, threadId, threadType);
      }

      const bet = parseInt(args[0]);
      if (!bet || bet < MIN_BET || bet > MAX_BET) {
        return ctx.api.sendMessage({ msg: `❌ Cược từ ${MIN_BET.toLocaleString()} đến ${MAX_BET.toLocaleString()} xu.\nVD: .blackjack 500` }, threadId, threadType);
      }

      const balance = getBalance(bank, senderId);
      if (balance < bet) {
        return ctx.api.sendMessage({ msg: `❌ Không đủ xu! Bạn có ${balance.toLocaleString()} xu.` }, threadId, threadType);
      }

      const deck = newDeck();
      const playerHand = [deck.pop(), deck.pop()];
      const dealerHand = [deck.pop(), deck.pop()];
      const session = { bet, deck, playerHand, dealerHand };
      BJ_SESSIONS.set(senderId, session);
      setTimeout(() => BJ_SESSIONS.delete(senderId), 5 * 60 * 1000);

      const score = handScore(playerHand);
      if (score === 21) {
        BJ_SESSIONS.delete(senderId);
        const win = Math.floor(bet * 1.5);
        changeBalance(bank, senderId, win, "bj_blackjack");
        saveBank(bank);
        return ctx.api.sendMessage({
          msg: `🃏 BLACKJACK!\n\n👤 Bạn: ${handStr(playerHand)} = 21\n🏦 Dealer: ${handStr(dealerHand)}\n\n🎊 BLACKJACK! +${win.toLocaleString()} xu\n💰 Số dư: ${(balance + win).toLocaleString()} xu`
        }, threadId, threadType);
      }

      ctx.api.sendMessage({
        msg: `🃏 Blackjack — Cược ${bet.toLocaleString()} xu\n\n`
          + `👤 Bạn: ${handStr(playerHand)} = ${score}\n`
          + `🏦 Dealer: ${handStr(dealerHand, true)}\n\n`
          + `💡 .bj hit (rút) | .bj stand (dừng) | .bj double (cược gấp đôi)`
      }, threadId, threadType);
    }
  },

  {
    name: "bj",
    hidden: true,
    async execute(ctx) {
      const { args } = ctx;
      const sub = (args[0] || "").toLowerCase();
      if (["hit","rut","stand","dung","double"].includes(sub)) {
        return handleBjAction(ctx, sub === "rut" ? "hit" : sub === "dung" ? "stand" : sub);
      }
      return ctx.api.sendMessage({ msg: "💡 .bj hit (rút thêm) | .bj stand (dừng)" }, ctx.threadId, ctx.threadType);
    }
  }
];

async function handleBjAction(ctx, action) {
  const { senderId, senderName, threadId, threadType } = ctx;
  const session = BJ_SESSIONS.get(senderId);
  if (!session) {
    return ctx.api.sendMessage({ msg: "❌ Bạn chưa có ván Blackjack nào!\nBắt đầu bằng .blackjack <cược>" }, threadId, threadType);
  }

  const bank = getBank();
  const balance = getBalance(bank, senderId);
  const { bet, deck, playerHand, dealerHand } = session;

  if (action === "double") {
    if (balance < bet) {
      return ctx.api.sendMessage({ msg: "❌ Không đủ xu để double!" }, threadId, threadType);
    }
    session.bet *= 2;
    playerHand.push(deck.pop());
    if (handScore(playerHand) > 21) {
      BJ_SESSIONS.delete(senderId);
      changeBalance(bank, senderId, -session.bet, "bj_bust");
      saveBank(bank);
      return ctx.api.sendMessage({
        msg: `💥 BỊ BUST! (Double)\n👤 Bạn: ${handStr(playerHand)} = ${handScore(playerHand)}\n😢 Thua ${session.bet.toLocaleString()} xu\n💰 Còn: ${(balance - session.bet).toLocaleString()} xu`
      }, threadId, threadType);
    }
    action = "stand";
  }

  if (action === "hit") {
    playerHand.push(deck.pop());
    const score = handScore(playerHand);
    if (score > 21) {
      BJ_SESSIONS.delete(senderId);
      changeBalance(bank, senderId, -bet, "bj_lose");
      saveBank(bank);
      return ctx.api.sendMessage({
        msg: `💥 BỊ BUST!\n👤 Bạn: ${handStr(playerHand)} = ${score}\n😢 Thua ${bet.toLocaleString()} xu\n💰 Còn: ${(balance - bet).toLocaleString()} xu`
      }, threadId, threadType);
    }
    if (score === 21) { action = "stand"; }
    else {
      return ctx.api.sendMessage({
        msg: `🃏 Rút thêm!\n👤 Bạn: ${handStr(playerHand)} = ${score}\n🏦 Dealer: ${handStr(dealerHand, true)}\n\n💡 .bj hit | .bj stand`
      }, threadId, threadType);
    }
  }

  if (action === "stand") {
    BJ_SESSIONS.delete(senderId);
    while (handScore(dealerHand) < 17) dealerHand.push(deck.pop());

    const pScore = handScore(playerHand);
    const dScore = handScore(dealerHand);

    let delta, resultMsg;
    if (dScore > 21 || pScore > dScore) {
      delta = bet;
      resultMsg = `🎊 THẮNG! +${bet.toLocaleString()} xu`;
    } else if (pScore === dScore) {
      delta = 0;
      resultMsg = "🤝 Hòa — Hoàn lại xu";
    } else {
      delta = -bet;
      resultMsg = `😢 THUA! -${bet.toLocaleString()} xu`;
    }

    changeBalance(bank, senderId, delta, delta > 0 ? "bj_win" : delta < 0 ? "bj_lose" : "bj_push");
    saveBank(bank);

    ctx.api.sendMessage({
      msg: `🃏 Kết quả Blackjack\n\n👤 Bạn: ${handStr(playerHand)} = ${pScore}\n🏦 Dealer: ${handStr(dealerHand)} = ${dScore}\n\n${resultMsg}\n💰 Số dư: ${(balance + delta).toLocaleString()} xu`
    }, threadId, threadType);
  }
}
