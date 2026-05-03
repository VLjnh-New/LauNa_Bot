import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CaroEngine } from "../utils/engines/caroEngine.js";
import { drawCaro, drawCaroLeaderboard } from "../utils/canvas/canvasHelper.js";
import { log } from "../logger.js";
import { readJSON, writeJSON } from "../utils/core/io-json.js";

export const name = "caro";
export const description = "Trò chơi Cờ Caro (Vs Máy hoặc Đối đầu)";

const statsPath = path.join(process.cwd(), "src/modules/data/caro_stats.json");

if (!global._caroGame) global._caroGame = {};
if (!global._caroWait) global._caroWait = {};

function getStats() {
    return readJSON(statsPath) || {};
}

function saveStats(userId, name, won = false) {
    const stats = getStats();
    if (!stats[userId]) {
        stats[userId] = { name, wins: 0, matches: 0 };
    }
    stats[userId].name = name;
    stats[userId].matches++;
    if (won) stats[userId].wins++;
    writeJSON(statsPath, stats);
}

async function sendBoard(ctx, game, lastMove = null) {
    const { api, threadId, threadType } = ctx;
    try {
        // Withdraw previous board if exists
        if (game.lastMsgId) {
            api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType).catch(() => {});
            game.lastMsgId = null;
            game.lastCliMsgId = null;
        }

        const buffer = await drawCaro({ board: game.engine.board, lastMove });
        const tmpPath = path.join(process.cwd(), `caro_${threadId}_${Date.now()}.png`);
        writeFileSync(tmpPath, buffer);
        
        const isXTurn = game.engine.turn === 1;
        const currentPlayerId = game.players[game.turnIdx];
        const currentPlayerName = game.playerNames[currentPlayerId];
        let turnMsg = "";
        let mention = null;

        if (game.isMultiplayer) {
            turnMsg = `${isXTurn ? "🔴" : "🔵"} Lượt của: ${currentPlayerName}`;
            mention = { uid: currentPlayerId, len: currentPlayerName.length, pos: turnMsg.indexOf(currentPlayerName) };
        } else {
            turnMsg = isXTurn ? `🔴 Lượt của BẠN (X): ${currentPlayerName}` : "🔵 Lượt của MÁY (O)";
            if (isXTurn) mention = { uid: currentPlayerId, len: currentPlayerName.length, pos: turnMsg.indexOf(currentPlayerName) };
        }
        
        const header = `🎮 [ CỜ CARO ONLINE ]\n─────────────────\n`;
        const body = `${turnMsg}\n─────────────────\n👉 Nhập 1-256 để đánh\n👉 Nhập 0 để thoát`;
        const fullMsg = header + body;

        let mentions = [];
        if (mention) {
            mention.pos = fullMsg.indexOf(currentPlayerName);
            if (mention.pos !== -1) mentions.push(mention);
        }

        const res = await api.sendMessage({
            msg: fullMsg,
            mentions,
            attachments: [tmpPath]
        }, threadId, threadType);
        
        const att_ = res.attachment?.[0];
        const msg__ = res.message;
        game.lastMsgId = att_?.msgId || att_?.globalMsgId || msg__?.msgId || msg__?.globalMsgId || null;
        game.lastCliMsgId = att_?.cliMsgId || msg__?.cliMsgId || null;

        if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch (e) {
        log.error("Caro Canvas Error:", e.message);
    }
}

export async function handle(ctx) {
    const { threadId, content, senderId, api, threadType } = ctx;
    const input = content?.toLowerCase().trim();
    if (!input) return false;

    // Game is active
    if (global._caroGame[threadId]) {
        const game = global._caroGame[threadId];
        const num = parseInt(input);
        if (!isNaN(num) && num >= 1 && num <= 256) {
            if (senderId !== game.players[game.turnIdx]) {
                api.sendMessage({ msg: `⏳ Chưa tới lượt của bạn! Đang là lượt của ${game.playerNames[game.players[game.turnIdx]]}.` }, threadId, threadType);
                return true;
            }
            await commands.caro({ ...ctx, args: [input] });
            return true;
        }
        if (input === "0") {
            await commands.caro({ ...ctx, args: ["stop"] });
            return true;
        }
    }

    return false;
}

function parseCoords(str) {
    const num = parseInt(str);
    if (isNaN(num) || num < 1 || num > 256) return null;
    const r = Math.floor((num - 1) / 16);
    const c = (num - 1) % 16;
    return { x: c, y: r };
}

export const commands = {
    caro: async (ctx) => {
        const { api, threadId, threadType, args, senderId, senderName, message } = ctx;
        const input = args[0]?.toLowerCase() || "";

        // Auto-undo the user command message
        setTimeout(() => {
            api.undo({ msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId }, threadId, threadType).catch(() => {});
        }, 1000);

        // LEADERBOARD
        if (input === "bxh") {
            const stats = getStats();
            const top = Object.entries(stats)
                .map(([id, s]) => ({ id, ...s }))
                .sort((a, b) => b.wins - a.wins)
                .slice(0, 10);

            if (top.length === 0) return api.sendMessage({ msg: "📊 Hiện chưa có ai trong bảng xếp hạng!" }, threadId, threadType);

            const buffer = await drawCaroLeaderboard(top);
            const tmpPath = path.join(process.cwd(), `caro_bxh_${Date.now()}.png`);
            writeFileSync(tmpPath, buffer);
            await api.sendMessage({ msg: "🏆 [ BẢNG XẾP HẠNG CAO THỦ CARO ]", attachments: [tmpPath] }, threadId, threadType);
            if (existsSync(tmpPath)) unlinkSync(tmpPath);
            return;
        }

        // STOP GAME
        if (input === "stop" || input === "off") {
            if (global._caroGame[threadId]) {
                const game = global._caroGame[threadId];
                if (game.lastBoard) {
                    const d = game.lastBoard.attachment?.[0] || game.lastBoard.message || game.lastBoard;
                    if (d.msgId || d.globalMsgId) {
                        api.undo({ msgId: d.globalMsgId || d.msgId, cliMsgId: d.cliMsgId }, threadId, threadType).catch(() => {});
                    }
                    game.lastBoard = null;
                }
                delete global._caroGame[threadId];
                return api.sendMessage({ msg: "⏹️ Đã kết thúc ván cờ Caro." }, threadId, threadType);
            }
            global._caroWait[threadId] = []; // Reset pool too
            return api.sendMessage({ msg: "⚠️ Hiện không có ván cờ nào diễn ra." }, threadId, threadType);
        }

        // JOIN GAME
        if (input === "join") {
            if (global._caroGame[threadId]) return api.sendMessage({ msg: "⚠️ Ván cờ đang diễn ra rồi!" }, threadId, threadType);
            
            if (!global._caroWait[threadId]) global._caroWait[threadId] = [];
            
            if (global._caroWait[threadId].some(p => p.id === senderId)) {
                return api.sendMessage({ msg: "⚠️ Bạn đã ở trong danh sách chờ!" }, threadId, threadType);
            }

            global._caroWait[threadId].push({ id: senderId, name: senderName });
            const count = global._caroWait[threadId].length;
            
            let reply = `✅ @tag đã tham gia phòng chờ Caro (${count}/4)\n👉 Gõ "-caro start" để bắt đầu ván đấu.`;
            if (count === 2) reply += "\n💡 Bạn có thể chơi ngay bây giờ hoặc đợi thêm người để chơi 2VS2.";
            if (count === 4) {
                reply = `🚀 Đã đủ 4 người! Ván đấu 2VS2 bắt đầu ngay bây giờ!`;
                await api.sendMessage({ msg: reply, mentions: [{ uid: senderId, pos: 2, len: 4 }] }, threadId, threadType);
                args[0] = "start"; // Auto start
            } else {
                return api.sendMessage({ msg: reply, mentions: [{ uid: senderId, pos: 2, len: 4 }] }, threadId, threadType);
            }
        }

        // START GAME
        const mentions = message.data.mentions || [];
        if (input === "start" || (mentions.length > 0 && !global._caroGame[threadId])) {
            if (global._caroGame[threadId]) {
                if (input === "start" || mentions.length > 0) {
                     return api.sendMessage({ msg: "⚠️ Ván cờ đang diễn ra rồi! Gõ \"-caro stop\" để kết thúc trước khi tạo mới." }, threadId, threadType);
                }
                return;
            }

            let players = global._caroWait[threadId] || [];
            let playerNames = {};

            // If empty pool but mentions used, use mentions instead (shortcut)
            if (players.length < 2) {
                if (mentions.length > 0) {
                    players = [{ id: String(senderId), name: senderName }];
                    for (const m of mentions) {
                        const mUid = String(m.uid || m.id || "");
                        if (mUid && players.length < 4 && !players.some(p => p.id === mUid)) {
                            players.push({ id: mUid, name: m.nm || "Đối thủ" });
                        }
                    }
                }
            }

            // VS AI fallback
            if (players.length < 2 && input === "start") {
                players = [{ id: String(senderId), name: senderName }, { id: "AI", name: "Máy" }];
            }

            if (players.length < 2) {
                 return api.sendMessage({ msg: "⚠️ Thách đấu thất bại! Hãy tag người chơi khác hoặc gõ \"-caro join\"." }, threadId, threadType);
            }

            const playerIds = players.map(p => p.id);
            players.forEach(p => playerNames[p.id] = p.name);

            global._caroGame[threadId] = {
                engine: new CaroEngine(),
                isMultiplayer: !playerIds.includes("AI"),
                players: playerIds,
                playerNames,
                turnIdx: 0,
                lastMsgId: null,
                lastCliMsgId: null
            };
            
            global._caroWait[threadId] = []; // Clear pool

            try {
                await sendBoard(ctx, global._caroGame[threadId]);
            } catch (err) {
                log.error("Caro Start Error:", err.message);
                api.sendMessage({ msg: "⚠️ Không thể tạo bàn cờ. Lỗi render bàn cờ." }, threadId, threadType);
            }
            return;
        }

        // HANDLE MOVE
        if (global._caroGame[threadId]) {
            const game = global._caroGame[threadId];
            const pos = parseCoords(input);
            if (!pos) return; // Wait for handle() or error out

            const currentPlayerId = game.players[game.turnIdx];
            if (senderId !== currentPlayerId) return;

            const res = game.engine.move(pos.x, pos.y);
            if (!res.success) return api.sendMessage({ msg: "⚠️ Vị trí này không hợp lệ!" }, threadId, threadType);

            // Notification
            const moveMsg = senderId === "AI" ? `🤖 Bot đánh ô ${input}` : `@tag đánh ô ${input}`;
            await api.sendMessage({ msg: moveMsg, mentions: senderId === "AI" ? [] : [{ uid: senderId, pos: 0, len: 4 }] }, threadId, threadType);

            game.turnIdx = (game.turnIdx + 1) % game.players.length;

            if (res.win) {
                await sendBoard(ctx, game, pos);
                const winnerName = game.playerNames[currentPlayerId];
                await api.sendMessage({ msg: `🎊 CHÚC MỪNG! ${winnerName} và đồng đội đã thắng ván cờ! 🏆 /-bd` }, threadId, threadType);
                
                // Save winners stats
                const team = game.players.filter((_, i) => i % 2 === (game.turnIdx - 1 + game.players.length) % game.players.length % 2);
                const opponents = game.players.filter(id => !team.includes(id));
                
                team.forEach(id => { if (id !== "AI") saveStats(id, game.playerNames[id], true); });
                opponents.forEach(id => { if (id !== "AI") saveStats(id, game.playerNames[id], false); });

                delete global._caroGame[threadId];
                return;
            }

            // AI TURN
            if (!game.isMultiplayer && game.players[game.turnIdx] === "AI") {
                await sendBoard(ctx, game, pos);
                setTimeout(async () => {
                    const aiMove = game.engine.getBestMove();
                    if (aiMove) {
                        const aiInput = aiMove.y * 16 + aiMove.x + 1;
                        const aiRes = game.engine.move(aiMove.x, aiMove.y);
                        game.turnIdx = (game.turnIdx + 1) % game.players.length;
                        if (aiRes.win) {
                            await sendBoard(ctx, game, aiMove);
                            await api.sendMessage({ msg: "💀 MÁY ĐÃ THẮNG! Hẹn gặp lại bạn ở ván sau. ;-s" }, threadId, threadType);
                            game.players.forEach(id => { if (id !== "AI") saveStats(id, game.playerNames[id], false); });
                            delete global._caroGame[threadId];
                        } else {
                            await api.sendMessage({ msg: `🤖 Bot đánh ô ${aiInput}`, mentions: [] }, threadId, threadType);
                            await sendBoard(ctx, game, aiMove);
                        }
                    }
                }, 1000);
            } else {
                await sendBoard(ctx, game, pos);
            }
            return;
        }

        // DEFAULT: SHOW INSTRUCTIONS
        const helpMsg = `🎮 [ HƯỚNG DẪN CỜ CARO ]\n─────────────────\n👉 -caro join : Tham gia phòng chờ\n👉 -caro start : Bắt đầu ván (Khi có >2 người)\n👉 -caro @tag : Thách đấu trực tiếp\n👉 -caro bxh : Xem bảng xếp hạng\n👉 -caro stop : Hủy ván đấu\n─────────────────\n💡 Cách chơi: Trong ván, chỉ cần gõ số ô (1-256) để đánh.`;
        await api.sendMessage({ msg: helpMsg }, threadId, threadType);
    }
};
