/**
 * CARO (GOMOKU) ENGINE
 * 15x15 Board
 * X = 1 (Player 1 / Red)
 * O = 2 (Player 2 / AI / Blue)
 */

export class CaroEngine {
    constructor(size = 16) {
        this.size = size;
        this.board = Array.from({ length: size }, () => Array(size).fill(0));
        this.turn = 1; // 1: X, 2: O
    }

    reset() {
        this.board = Array.from({ length: this.size }, () => Array(this.size).fill(0));
        this.turn = 1;
    }

    move(x, y) {
        if (x < 0 || x >= this.size || y < 0 || y >= this.size) return false;
        if (this.board[y][x] !== 0) return false;

        this.board[y][x] = this.turn;
        const result = this.checkWin(x, y);
        this.turn = this.turn === 1 ? 2 : 1;
        
        return { success: true, win: result };
    }

    checkWin(x, y) {
        const color = this.board[y][x];
        const directions = [
            [1, 0],  // Horizontal
            [0, 1],  // Vertical
            [1, 1],  // Diagonal \
            [1, -1]  // Diagonal /
        ];

        for (const [dx, dy] of directions) {
            let count = 1;
            
            // Forward
            let tx = x + dx;
            let ty = y + dy;
            while (tx >= 0 && tx < this.size && ty >= 0 && ty < this.size && this.board[ty][tx] === color) {
                count++;
                tx += dx;
                ty += dy;
            }
            
            // Backward
            tx = x - dx;
            ty = y - dy;
            while (tx >= 0 && tx < this.size && ty >= 0 && ty < this.size && this.board[ty][tx] === color) {
                count++;
                tx -= dx;
                ty -= dy;
            }

            if (count >= 5) return color;
        }

        return 0;
    }

    /**
     * SIMPLE AI EVALUATION
     * Weights: 
     * 5-in-a-row: 1000000
     * Open 4: 100000
     * Blocked 4: 10000
     * Open 3: 5000
     * Blocked 3: 1000
     */
    getBestMove() {
        let bestScore = -1;
        let bestMoves = [];

        // Check for immediate win for AI (O=2)
        // Check for immediate block for AI (threat from X=1)
        
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.board[y][x] !== 0) continue;

                const score = this.evaluateCell(x, y);
                if (score > bestScore) {
                    bestScore = score;
                    bestMoves = [{x, y}];
                } else if (score === bestScore) {
                    bestMoves.push({x, y});
                }
            }
        }

        if (bestMoves.length === 0) return null;
        return bestMoves[Math.floor(Math.random() * bestMoves.length)];
    }

    evaluateCell(x, y) {
        let totalScore = 0;
        
        // Check scores for both players (AI=2 and Player=1)
        // AI score = offensive, Player score = defensive (blocking)
        totalScore += this.getScoreForPlayer(x, y, 2) * 1.2; // AI weight
        totalScore += this.getScoreForPlayer(x, y, 1);       // Defensive weight

        // Proximity to center
        const center = (this.size - 1) / 2;
        const distToCenter = Math.sqrt(Math.pow(x - center, 2) + Math.pow(y - center, 2));
        totalScore += (15 - distToCenter);

        return totalScore;
    }

    getScoreForPlayer(x, y, player) {
        const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
        let score = 0;

        for (const [dx, dy] of directions) {
            let count = 1;
            let block = 0;
            
            // Forward
            let tx = x + dx;
            let ty = y + dy;
            while (tx >= 0 && tx < this.size && ty >= 0 && ty < this.size && this.board[ty][tx] === player) {
                count++;
                tx += dx;
                ty += dy;
            }
            if (tx < 0 || tx >= this.size || ty < 0 || ty >= this.size || (this.board[ty][tx] !== 0 && this.board[ty][tx] !== player)) {
                block++;
            }

            // Backward
            tx = x - dx;
            ty = y - dy;
            while (tx >= 0 && tx < this.size && ty >= 0 && ty < this.size && this.board[ty][tx] === player) {
                count++;
                tx -= dx;
                ty -= dy;
            }
            if (tx < 0 || tx >= this.size || ty < 0 || ty >= this.size || (this.board[ty][tx] !== 0 && this.board[ty][tx] !== player)) {
                block++;
            }

            if (count >= 5) score += 1000000;
            else if (count === 4) {
                if (block === 0) score += 100000;
                else if (block === 1) score += 5000;
            } else if (count === 3) {
                if (block === 0) score += 10000;
                else if (block === 1) score += 1000;
            } else if (count === 2) {
                if (block === 0) score += 500;
                else if (block === 1) score += 100;
            }
        }
        return score;
    }
}
