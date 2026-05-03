import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { CoTuongEngine } from "../utils/engines/cotuongEngine.js";
import { drawCotuong } from "../utils/canvas/canvasHelper.js";
import { log } from "../logger.js";

export const name = "cotuong";
export const description = "Trò chơi Cờ Tướng (Vs Máy hoặc 2 Người)";

if (!global._cotuongGame) {
    global._cotuongGame = {};
}

async function sendBoard(ctx, game, lastMove = null, possibleMoves = null) {
    const { api, threadId, threadType } = ctx;
    try {
        // Withdraw previous board if exists
        if (game.lastMsgId) {
            api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType).catch(() => {});
            game.lastMsgId = null;
            game.lastCliMsgId = null;
        }

        const buffer = await drawCotuong({ board: game.engine.board, lastMove, possibleMoves });
        const tmpPath = path.join(process.cwd(), `chess_${threadId}_${Date.now()}.png`);
        writeFileSync(tmpPath, buffer);
        
        const header = `🎮 [ CỜ TƯỚNG ONLINE ]\n─────────────────\n`;
        const footer = `\n─────────────────\n👉 Di chuyển: -cotuong [từ][đến] (vd: -cotuong b2b5)\n👉 Xem nước đi: -cotuong show [tọa độ] (vd: -cotuong show b2)\n👉 Kết thúc: -cotuong stop`;
        
        let turnMsg = "";
        let mention = null;

        if (game.isMultiplayer) {
            const currentPlayerId = game.engine.my === 1 ? game.playerRed : game.playerBlack;
            const currentPlayerName = game.playerNames[currentPlayerId] || "Người chơi";
            turnMsg = `🔴 Lượt của: ${currentPlayerName}`;
            mention = { uid: currentPlayerId, len: currentPlayerName.length, pos: 0 }; 
            
            // Recalculate position after full message is constructed
            const fullMsgTemp = header + turnMsg + footer;
            mention.pos = fullMsgTemp.indexOf(currentPlayerName);
        } else {
            turnMsg = game.engine.my === 1 ? "🔴 Lượt của BẠN (QUÂN ĐỎ)" : "⚫ Lượt của MÁY (QUÂN ĐEN)";
        }
        
        const fullMsg = header + turnMsg + footer;
        
        let mentions = [];
        if (mention && mention.pos !== -1) {
            mentions.push(mention);
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
    } catch (e) {
        log.error("Cotuong Canvas Error:", e.message);
        api.sendMessage({ msg: "⚠️ Lỗi khi render bàn cờ." }, threadId, threadType);
    }
}

export async function handle(ctx) {
    const { threadId, content, senderId, api, threadType } = ctx;
    if (!global._cotuongGame || !global._cotuongGame[threadId]) return false;

    const game = global._cotuongGame[threadId];
    const input = content?.toLowerCase().trim();
    if (!input) return false;

    // Check if input is a move (e.g., b2b5)
    const moveRegex = /^[a-i][0-9][a-i][0-9]$/;
    if (moveRegex.test(input)) {
        const currentPlayerId = game.engine.my === 1 ? game.playerRed : game.playerBlack;
        if (game.isMultiplayer && senderId !== currentPlayerId) {
             api.sendMessage({ msg: `⏳ Chưa tới lượt của bạn! Đang là lượt của ${game.playerNames[currentPlayerId]}.` }, threadId, threadType);
             return true;
        }
        await commands.cotuong({ ...ctx, args: [input] });
        return true;
    }

    // Check if input is a show command (e.g., b2)
    const showRegex = /^[a-i][0-9]$/;
    if (showRegex.test(input)) {
        await commands.cotuong({ ...ctx, args: ["show", input] });
        return true;
    }

    if (input === "stop" || input === "off") {
        await commands.cotuong({ ...ctx, args: [input] });
        return true;
    }

    return false;
}

function parseCoords(str) {
    if (!str || str.length < 2) return null;
    const x = str.toLowerCase().charCodeAt(0) - 97;
    const y = parseInt(str.slice(1));
    if (isNaN(x) || isNaN(y) || x < 0 || x > 8 || y < 0 || y > 9) return null;
    return { x, y };
}

export const commands = {
    cotuong: async (ctx) => {
        const { api, threadId, threadType, args, senderId, senderName, message } = ctx;

        // Auto-undo the user command message to keep chat clean
        setTimeout(() => {
            api.undo({ msgId: message.data.msgId || message.data.globalMsgId, cliMsgId: message.data.cliMsgId }, threadId, threadType).catch(() => {});
        }, 1000);

        if (args[0] === "stop" || args[0] === "off") {
            if (global._cotuongGame[threadId]) {
                const game = global._cotuongGame[threadId];
                if (game.lastMsgId) {
                    api.undo({ msgId: game.lastMsgId, cliMsgId: game.lastCliMsgId }, threadId, threadType).catch(() => {});
                    game.lastMsgId = null;
                    game.lastCliMsgId = null;
                }
                delete global._cotuongGame[threadId];
                return api.sendMessage({ msg: "⏹️ Đã kết thúc ván cờ." }, threadId, threadType);
            }
            return api.sendMessage({ msg: "⚠️ Hiện chưa có ván cờ nào diễn ra." }, threadId, threadType);
        }

        // START GAME
        if (!global._cotuongGame[threadId]) {
            const mentions = message.data.mentions || [];
            let isMultiplayer = false;
            let playerRed = senderId;
            let playerBlack = "AI";
            const playerNames = { [senderId]: senderName };

            if (mentions.length > 0) {
                isMultiplayer = true;
                playerBlack = mentions[0].uid;
                playerNames[playerBlack] = mentions[0].nm || "Đối thủ";
                if (playerBlack === senderId) return api.sendMessage({ msg: "⚠️ Bạn không thể tự chơi với chính mình!" }, threadId, threadType);
            }

            global._cotuongGame[threadId] = { 
                engine: new CoTuongEngine(),
                isMultiplayer,
                playerRed,
                playerBlack,
                playerNames,
                lastBoard: null
            };
            
            // await api.sendMessage({ msg: `🎬 Bắt đầu ván cờ: ${playerNames[playerRed]} (Đỏ) VS ${playerBlack === "AI" ? "Máy" : playerNames[playerBlack]} (Đen)` }, threadId, threadType);
            await sendBoard(ctx, global._cotuongGame[threadId]);
            return;
        }

        const game = global._cotuongGame[threadId];
        const currentPlayerId = game.engine.my === 1 ? game.playerRed : game.playerBlack;

        if (game.isMultiplayer && senderId !== currentPlayerId) {
            return api.sendMessage({ msg: `⏳ Chưa tới lượt của bạn! Đang là lượt của ${game.playerNames[currentPlayerId]}.` }, threadId, threadType);
        }

        if (args[0] === "show" && args[1]) {
            const pos = parseCoords(args[1]);
            if (!pos) return api.sendMessage({ msg: "⚠️ Tọa độ không hợp lệ (vd: a0, b2...)" }, threadId, threadType);
            
            const key = game.engine.board[pos.y][pos.x];
            if (!key) return api.sendMessage({ msg: "⚠️ Không có quân cờ nào tại vị trí này." }, threadId, threadType);

            // Check if it's the player's piece
            const pieceColor = key === key.toLowerCase() ? 1 : -1;
            if (pieceColor !== game.engine.my) return api.sendMessage({ msg: "⚠️ Bạn chỉ có thể xem nước đi của quân mình!" }, threadId, threadType);
            
            const moves = game.engine.mans[key].bl(game.engine.board, game.engine.mans, pos.x, pos.y);
            await sendBoard(ctx, game, null, moves);
            return;
        }

        // Handle move
        const moveStr = args[0] || "";
        if (moveStr.length === 4) {
            const from = parseCoords(moveStr.slice(0, 2));
            const to = parseCoords(moveStr.slice(2, 4));

            if (!from || !to) return api.sendMessage({ msg: "⚠️ Tọa độ không hợp lệ (vd: b2b5)" }, threadId, threadType);

            const res = game.engine.move(from.x, from.y, to.x, to.y);
            if (!res) return api.sendMessage({ msg: "⚠️ Nước đi không hợp lệ!" }, threadId, threadType);

            if (res.captured && (res.captured.toLowerCase() === "j0")) {
                await sendBoard(ctx, game, { from, to });
                await api.sendMessage({ msg: `🎊 CHÚC MỪNG! ${game.playerNames[senderId]} đã thắng ván cờ này! 🏆` }, threadId, threadType);
                delete global._cotuongGame[threadId];
                return;
            }

            // VS AI
            if (!game.isMultiplayer && game.engine.my === -1) {
                await sendBoard(ctx, game, { from, to });
                await api.sendMessage({ msg: "🤖 Máy đang suy nghĩ..." }, threadId, threadType);
                
                setTimeout(async () => {
                    const aiMove = game.engine.searchBestMove();
                    if (aiMove && aiMove.x !== undefined) {
                        const aiRes = game.engine.move(aiMove.x, aiMove.y, aiMove.newX, aiMove.newY);
                        if (aiRes) {
                            if (aiRes.captured && aiRes.captured.toLowerCase() === "j0") {
                                await sendBoard(ctx, game, { from: { x: aiMove.x, y: aiMove.y }, to: { x: aiMove.newX, y: aiMove.newY } });
                                await api.sendMessage({ msg: "💀 MÁY ĐÃ THẮNG! Bạn đã mất Tướng. Rất tiếc!" }, threadId, threadType);
                                delete global._cotuongGame[threadId];
                            } else {
                                await sendBoard(ctx, game, { from: { x: aiMove.x, y: aiMove.y }, to: { x: aiMove.newX, y: aiMove.newY } });
                            }
                        }
                    } else {
                        await api.sendMessage({ msg: "🏳️ Máy đã nhận thua! Chúc mừng bạn." }, threadId, threadType);
                        delete global._cotuongGame[threadId];
                    }
                }, 1500);
            } else {
                // Multiplayer next turn
                await sendBoard(ctx, game, { from, to });
            }
            return;
        }

        await api.sendMessage({ msg: "👉 Dùng: -cotuong [tọa độ] (vd: -cotuong b2b5) để chơi tiếp." }, threadId, threadType);
    }
};
