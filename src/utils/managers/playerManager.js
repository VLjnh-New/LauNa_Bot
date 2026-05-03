/**
 * playerManager.js — Hệ thống tài khoản thống nhất cho pk, dnd, gs
 * File dữ liệu: src/data/players.json
 * Cấu trúc: { players: { [zaloId]: { name, joinedAt, pk, dnd, gs } }, spawns: {} }
 *
 * Cross-link:
 *   - Tiêu diệt quái DnD  → +50% gold vào pk.credits
 *   - Thắng GS boss raid  → +10% gold vào pk.credits
 */

import path from "node:path";
import { readJSON, writeJSON } from "../core/io-json.js";

const PLAYERS_PATH = path.join(process.cwd(), "src", "data", "players.json");
const OLD_PK_PATH  = path.join(process.cwd(), "src", "data", "pokemon.json");
const OLD_GS_PATH  = path.join(process.cwd(), "src", "data", "gameserver_players.json");

// ─── Default structures ────────────────────────────────────────────────────────
const DEFAULT_PK = () => ({
    credits: 200, pokemons: [], maxBoxSize: 30,
    inventory: { pokeball: 3, greatball: 0, ultraball: 0, exp_candy_s: 0, exp_candy_m: 0, rename_tag: 0, box_upgrade: 0 },
    stats: { caught: 0, shinyCaught: 0, duelsWon: 0, duelsLost: 0 },
    cooldowns: { daily: 0 },
});

const DEFAULT_DND = () => ({
    heroClass: null, heroLevel: 1,
    totalXp: 0, totalGold: 0,
    kills: 0, dungeonsCleared: 0, bestDungeon: 0,
    lastPlayed: 0,
});

const DEFAULT_GS = () => ({
    pkBossKills: 0, dndBossKills: 0,
    totalDmg: 0, totalGold: 0, totalXp: 0,
    raidCount: 0, mvpCount: 0, history: [],
});

export const DEFAULT_PLAYER = (name = "Người chơi") => ({
    name, joinedAt: Date.now(),
    pk: DEFAULT_PK(), dnd: DEFAULT_DND(), gs: DEFAULT_GS(),
});

function ensureSections(player) {
    if (!player.pk)  player.pk  = DEFAULT_PK();
    if (!player.dnd) player.dnd = DEFAULT_DND();
    if (!player.gs)  player.gs  = DEFAULT_GS();
    if (!player.pk.inventory) player.pk.inventory = DEFAULT_PK().inventory;
    if (!player.pk.stats)     player.pk.stats     = DEFAULT_PK().stats;
    if (!player.pk.cooldowns) player.pk.cooldowns  = DEFAULT_PK().cooldowns;
    return player;
}

// ─── One-time migration from old files ────────────────────────────────────────
let _migrationDone = false;

function migrateOnce(data) {
    if (_migrationDone) return;
    _migrationDone = true;

    // Migrate pokemon.json → players[uid].pk
    const pkRaw = readJSON(OLD_PK_PATH);
    if (pkRaw?.users) {
        for (const [uid, user] of Object.entries(pkRaw.users)) {
            if (!data.players[uid]) data.players[uid] = DEFAULT_PLAYER();
            const p = data.players[uid];
            ensureSections(p);
            // Chỉ migrate nếu pk section chưa có data
            const hasData = p.pk.pokemons?.length || p.pk.credits !== 200;
            if (!hasData) {
                p.pk = {
                    credits:    user.credits    ?? 200,
                    pokemons:   user.pokemons   ?? [],
                    maxBoxSize: user.maxBoxSize  ?? 30,
                    inventory:  user.inventory  ?? DEFAULT_PK().inventory,
                    stats:      user.stats       ?? DEFAULT_PK().stats,
                    cooldowns:  user.cooldowns   ?? DEFAULT_PK().cooldowns,
                };
            }
        }
        if (!data.spawns && pkRaw.spawns) data.spawns = pkRaw.spawns;
    }

    // Migrate gameserver_players.json → players[uid].gs
    const gsRaw = readJSON(OLD_GS_PATH);
    if (gsRaw?.players) {
        for (const [uid, gsp] of Object.entries(gsRaw.players)) {
            if (!data.players[uid]) data.players[uid] = DEFAULT_PLAYER(gsp.name);
            const p = data.players[uid];
            ensureSections(p);
            if (gsp.name) p.name = gsp.name;
            const s = gsp.stats || {};
            if (!p.gs.raidCount && s.raidCount) {
                p.gs = {
                    pkBossKills:  s.pkBossKills  || 0,
                    dndBossKills: s.dndBossKills || 0,
                    totalDmg:     s.totalDmg     || 0,
                    totalGold:    s.totalGold    || 0,
                    totalXp:      s.totalXp      || 0,
                    raidCount:    s.raidCount    || 0,
                    mvpCount:     s.mvpCount     || 0,
                    history:      gsp.history    || [],
                };
            }
        }
    }
}

// ─── Core load/save ────────────────────────────────────────────────────────────
function loadAll() {
    const data = readJSON(PLAYERS_PATH) || {};
    if (!data.players) data.players = {};
    if (!data.spawns)  data.spawns  = {};
    migrateOnce(data);
    return data;
}

function saveAll(data) {
    writeJSON(PLAYERS_PATH, data);
}

// ─── Player access ─────────────────────────────────────────────────────────────
export function getPlayer(userId, name) {
    const data = loadAll();
    if (!data.players[userId]) {
        data.players[userId] = DEFAULT_PLAYER(name || "Người chơi");
        saveAll(data);
    } else {
        ensureSections(data.players[userId]);
        if (name && name !== "Người chơi" && data.players[userId].name !== name) {
            data.players[userId].name = name;
            saveAll(data);
        }
    }
    return data.players[userId];
}

export function getAllPlayers() {
    return loadAll().players || {};
}

// ─── Pokemon (pk) — tương thích hoàn toàn với pokemon.js cũ ──────────────────
export function loadPokemonData() {
    const data = loadAll();
    const users = {};
    for (const [uid, p] of Object.entries(data.players)) {
        users[uid] = ensureSections(p).pk;
    }
    return { users, spawns: data.spawns };
}

export function savePokemonData(pkData) {
    const data = loadAll();
    for (const [uid, pk] of Object.entries(pkData.users || {})) {
        if (!data.players[uid]) data.players[uid] = DEFAULT_PLAYER();
        ensureSections(data.players[uid]);
        data.players[uid].pk = pk;
    }
    if (pkData.spawns !== undefined) data.spawns = pkData.spawns;
    saveAll(data);
}

export function saveSpawns(spawnsObj) {
    const data = loadAll();
    data.spawns = spawnsObj;
    saveAll(data);
}

// ─── DnD (dnd) ────────────────────────────────────────────────────────────────
export function getDndData(userId, name) {
    return getPlayer(userId, name).dnd;
}

export function saveDndData(userId, dnd) {
    const data = loadAll();
    if (!data.players[userId]) data.players[userId] = DEFAULT_PLAYER();
    ensureSections(data.players[userId]);
    data.players[userId].dnd = dnd;
    saveAll(data);
}

/**
 * Ghi nhận kết quả DnD (chiến thắng/thua/kết thúc)
 * Cross-link: gold DnD → +50% vào pk.credits
 */
export function rewardDndPlayer(userId, name, {
    gold = 0, xp = 0, kills = 0,
    dungeonsCleared = 0, dungeonIdx = 0, heroClass = null,
} = {}) {
    const data = loadAll();
    if (!data.players[userId]) data.players[userId] = DEFAULT_PLAYER(name);
    const player = data.players[userId];
    ensureSections(player);
    if (name && name !== "Người chơi") player.name = name;

    const dnd = player.dnd;
    dnd.totalGold       = (dnd.totalGold       || 0) + gold;
    dnd.totalXp         = (dnd.totalXp         || 0) + xp;
    dnd.kills           = (dnd.kills           || 0) + kills;
    dnd.dungeonsCleared = (dnd.dungeonsCleared || 0) + dungeonsCleared;
    dnd.bestDungeon     = Math.max(dnd.bestDungeon || 0, dungeonIdx);
    dnd.lastPlayed      = Date.now();
    if (heroClass) dnd.heroClass = heroClass;
    dnd.heroLevel = Math.floor(Math.sqrt((dnd.totalXp || 0) / 100)) + 1;

    // Cross-link: 50% gold DnD → pk credits
    const pkBonus = Math.floor(gold * 0.5);
    if (pkBonus > 0) player.pk.credits = (player.pk.credits || 0) + pkBonus;

    saveAll(data);
    return { dnd, pkBonus };
}

// ─── Game Server (gs) ─────────────────────────────────────────────────────────
export function getGsData(userId, name) {
    return getPlayer(userId, name).gs;
}

/**
 * Ghi nhận phần thưởng boss raid GS
 * Cross-link: gold GS → +10% vào pk.credits
 */
export function rewardGsPlayer(userId, name, {
    gold = 0, xp = 0, dmg = 0,
    isMvp = false, bossType = "pk", bossName = "",
} = {}) {
    const data = loadAll();
    if (!data.players[userId]) data.players[userId] = DEFAULT_PLAYER(name);
    const player = data.players[userId];
    ensureSections(player);
    if (name && name !== "Người chơi") player.name = name;

    const gs = player.gs;
    gs.totalGold  = (gs.totalGold  || 0) + gold;
    gs.totalXp    = (gs.totalXp    || 0) + xp;
    gs.totalDmg   = (gs.totalDmg   || 0) + dmg;
    gs.raidCount  = (gs.raidCount  || 0) + 1;
    if (isMvp) gs.mvpCount = (gs.mvpCount || 0) + 1;
    if (bossType === "pk")  gs.pkBossKills  = (gs.pkBossKills  || 0) + 1;
    if (bossType === "dnd") gs.dndBossKills = (gs.dndBossKills || 0) + 1;
    if (!gs.history) gs.history = [];
    gs.history.unshift({ bossName, bossType, gold, xp, dmg, isMvp, at: Date.now() });
    if (gs.history.length > 10) gs.history.length = 10;

    // Cross-link: 10% gold GS → pk credits
    const pkBonus = Math.floor(gold * 0.1);
    if (pkBonus > 0) player.pk.credits = (player.pk.credits || 0) + pkBonus;

    saveAll(data);
}
