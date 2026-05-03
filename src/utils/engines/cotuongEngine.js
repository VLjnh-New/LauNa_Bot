/**
 * Chinese Chess Engine (Co Tuong)
 * Ported and adapted from GameVui source
 */

export class CoTuongEngine {
    constructor() {
        this.board = this.initMap();
        this.mans = this.createMans(this.board);
        this.my = 1; // 1 for Red (Player), -1 for Black (AI)
        this.isFoul = [0, 0, 0, 0];
        this.depth = 3;
    }

    initMap() {
        return [
            ['C0', 'M0', 'X0', 'S0', 'J0', 'S1', 'X1', 'M1', 'C1'],
            [null, null, null, null, null, null, null, null, null],
            [null, 'P0', null, null, null, null, null, 'P1', null],
            ['Z0', null, 'Z1', null, 'Z2', null, 'Z3', null, 'Z4'],
            [null, null, null, null, null, null, null, null, null],
            [null, null, null, null, null, null, null, null, null],
            ['z0', null, 'z1', null, 'z2', null, 'z3', null, 'z4'],
            [null, 'p0', null, null, null, null, null, 'p1', null],
            [null, null, null, null, null, null, null, null, null],
            ['c0', 'm0', 'x0', 's0', 'j0', 's1', 'x1', 'm1', 'c1']
        ];
    }

    createMans(map) {
        const mans = {};
        for (let y = 0; y < map.length; y++) {
            for (let x = 0; x < map[y].length; x++) {
                const key = map[y][x];
                if (key) {
                    mans[key] = new Man(key, x, y);
                }
            }
        }
        return mans;
    }

    getMoves(map, my) {
        const moves = [];
        for (let y = 0; y < map.length; y++) {
            for (let x = 0; x < map[y].length; x++) {
                const key = map[y][x];
                if (key && this.mans[key].my === my) {
                    const manMoves = this.mans[key].bl(map, this.mans, x, y);
                    for (const m of manMoves) {
                        moves.push([x, y, m[0], m[1], key]);
                    }
                }
            }
        }
        return moves;
    }

    evaluate(map, my) {
        let val = 0;
        for (let y = 0; y < map.length; y++) {
            for (let x = 0; x < map[y].length; x++) {
                const key = map[y][x];
                if (key) {
                    val += this.mans[key].value[y][x] * this.mans[key].my;
                }
            }
        }
        return val * my;
    }

    getAlphaBeta(A, B, depth, map, my) {
        if (depth === 0) return { value: this.evaluate(map, my) };
        
        const moves = this.getMoves(map, my);
        if (moves.length === 0) return { value: -8888 }; // Checkmate

        let bestMove = null;

        for (const move of moves) {
            const [oldX, oldY, newX, newY, key] = move;
            const clearKey = map[newY][newX];

            map[newY][newX] = key;
            delete map[oldY][oldX];
            
            if (clearKey === "j0" || clearKey === "J0") {
                map[oldY][oldX] = key;
                map[newY][newX] = clearKey;
                return { x: oldX, y: oldY, newX, newY, value: 8888 };
            }

            const res = this.getAlphaBeta(-B, -A, depth - 1, map, -my);
            const val = -res.value;

            map[oldY][oldX] = key;
            if (clearKey) map[newY][newX] = clearKey;
            else delete map[newY][newX];

            if (val >= B) return { x: oldX, y: oldY, newX, newY, value: B };
            if (val > A) {
                A = val;
                if (depth === this.depth) bestMove = { x: oldX, y: oldY, newX, newY, value: A };
            }
        }

        if (depth === this.depth) return bestMove || { value: A };
        return { value: A };
    }

    searchBestMove() {
        const mapClone = this.board.map(row => [...row]);
        const res = this.getAlphaBeta(-99999, 99999, this.depth, mapClone, this.my);
        return res;
    }

    move(x, y, newX, newY) {
        const key = this.board[y][x];
        if (!key) return false;
        
        const man = this.mans[key];
        // Check if legal
        const moves = man.bl(this.board, this.mans, x, y);
        if (!moves.some(m => m[0] === newX && m[1] === newY)) return false;

        const captured = this.board[newY][newX];
        this.board[newY][newX] = key;
        delete this.board[y][x];
        
        this.my = -this.my;
        return { success: true, captured };
    }
}

class Man {
    constructor(key, x, y) {
        this.key = key;
        const type = key.charAt(0);
        const data = ARGS[type];
        this.my = data.my;
        this.text = data.text;
        this.value = data.value;
        this.blFunc = data.bl;
    }

    bl(map, mans, x, y) {
        return this.blFunc(x, y, map, this.my, mans);
    }
}

const BYLAW = {
    c: (x, y, map, my, mans) => {
        const d = [];
        for (let i = x - 1; i >= 0; i--) {
            if (map[y][i]) { if (mans[map[y][i]].my !== my) d.push([i, y]); break; }
            else d.push([i, y]);
        }
        for (let i = x + 1; i <= 8; i++) {
            if (map[y][i]) { if (mans[map[y][i]].my !== my) d.push([i, y]); break; }
            else d.push([i, y]);
        }
        for (let i = y - 1; i >= 0; i--) {
            if (map[i][x]) { if (mans[map[i][x]].my !== my) d.push([x, i]); break; }
            else d.push([x, i]);
        }
        for (let i = y + 1; i <= 9; i++) {
            if (map[i][x]) { if (mans[map[i][x]].my !== my) d.push([x, i]); break; }
            else d.push([x, i]);
        }
        return d;
    },
    m: (x, y, map, my, mans) => {
        const d = [];
        const pts = [[1, -2, 0, -1], [2, -1, 1, 0], [2, 1, 1, 0], [1, 2, 0, 1], [-1, 2, 0, 1], [-2, 1, -1, 0], [-2, -1, -1, 0], [-1, -2, 0, -1]];
        for (const p of pts) {
            const nx = x + p[0], ny = y + p[1], bx = x + p[2], by = y + p[3];
            if (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 9 && !map[by][bx]) {
                if (!map[ny][nx] || mans[map[ny][nx]].my !== my) d.push([nx, ny]);
            }
        }
        return d;
    },
    x: (x, y, map, my, mans) => {
        const d = [];
        const pts = [[2, 2, 1, 1], [-2, 2, -1, 1], [2, -2, 1, -1], [-2, -2, -1, -1]];
        for (const p of pts) {
            const nx = x + p[0], ny = y + p[1], bx = x + p[2], by = y + p[3];
            if (nx >= 0 && nx <= 8 && ny >= 0 && ny <= 9 && !map[by][bx]) {
                if (my === 1 && ny < 5) continue;
                if (my === -1 && ny > 4) continue;
                if (!map[ny][nx] || mans[map[ny][nx]].my !== my) d.push([nx, ny]);
            }
        }
        return d;
    },
    s: (x, y, map, my, mans) => {
        const d = [];
        const pts = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
        for (const p of pts) {
            const nx = x + p[0], ny = y + p[1];
            if (nx >= 3 && nx <= 5 && ((my === 1 && ny >= 7 && ny <= 9) || (my === -1 && ny >= 0 && ny <= 2))) {
                if (!map[ny][nx] || mans[map[ny][nx]].my !== my) d.push([nx, ny]);
            }
        }
        return d;
    },
    j: (x, y, map, my, mans) => {
        const d = [];
        const pts = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const p of pts) {
            const nx = x + p[0], ny = y + p[1];
            if (nx >= 3 && nx <= 5 && ((my === 1 && ny >= 7 && ny <= 9) || (my === -1 && ny >= 0 && ny <= 2))) {
                if (!map[ny][nx] || mans[map[ny][nx]].my !== my) d.push([nx, ny]);
            }
        }
        // General face-to-face
        const otherJ = my === 1 ? mans['J0'] : mans['j0'];
        // Wait, I need to find other J position dynamically in map
        let ojX = -1, ojY = -1;
        for (let row=0; row<map.length; row++) {
            for (let col=0; col<map[row].length; col++) {
                if (map[row][col] === (my === 1 ? 'J0' : 'j0')) { ojX = col; ojY = row; break; }
            }
        }
        if (x === ojX) {
            let blocked = false;
            for (let i = Math.min(y, ojY) + 1; i < Math.max(y, ojY); i++) {
                if (map[i][x]) { blocked = true; break; }
            }
            if (!blocked) d.push([ojX, ojY]);
        }
        return d;
    },
    p: (x, y, map, my, mans) => {
        const d = [];
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const dir of dirs) {
            let jump = false;
            for (let i = 1; i < 10; i++) {
                const nx = x + dir[0] * i, ny = y + dir[1] * i;
                if (nx < 0 || nx > 8 || ny < 0 || ny > 9) break;
                if (!map[ny][nx]) { if (!jump) d.push([nx, ny]); }
                else {
                    if (!jump) jump = true;
                    else {
                        if (mans[map[ny][nx]].my !== my) d.push([nx, ny]);
                        break;
                    }
                }
            }
        }
        return d;
    },
    z: (x, y, map, my, mans) => {
        const d = [];
        const forward = my === 1 ? -1 : 1;
        if (y + forward >= 0 && y + forward <= 9) {
            if (!map[y + forward][x] || mans[map[y + forward][x]].my !== my) d.push([x, y + forward]);
        }
        const crossed = (my === 1 && y <= 4) || (my === -1 && y >= 5);
        if (crossed) {
            if (x + 1 <= 8 && (!map[y][x + 1] || mans[map[y][x + 1]].my !== my)) d.push([x + 1, y]);
            if (x - 1 >= 0 && (!map[y][x - 1] || mans[map[y][x - 1]].my !== my)) d.push([x - 1, y]);
        }
        return d;
    }
};

const VALUE = {
    c: [
        [206, 208, 207, 213, 214, 213, 207, 208, 206],
        [206, 212, 209, 216, 233, 216, 209, 212, 206],
        [206, 208, 207, 214, 216, 214, 207, 208, 206],
        [206, 213, 213, 216, 216, 216, 213, 213, 206],
        [208, 211, 211, 214, 215, 214, 211, 211, 208],
        [208, 212, 212, 214, 215, 214, 212, 212, 208],
        [204, 209, 204, 212, 214, 212, 204, 209, 204],
        [198, 208, 204, 212, 212, 212, 204, 208, 198],
        [200, 208, 206, 212, 200, 212, 206, 208, 200],
        [194, 206, 204, 212, 200, 212, 204, 206, 194]
    ],
    m: [
        [90, 90, 90, 96, 90, 96, 90, 90, 90],
        [90, 96, 103, 97, 94, 97, 103, 96, 90],
        [92, 98, 99, 103, 99, 103, 99, 98, 92],
        [93, 108, 100, 107, 100, 107, 100, 108, 93],
        [90, 100, 99, 103, 104, 103, 99, 100, 90],
        [90, 98, 101, 102, 103, 102, 101, 98, 90],
        [92, 94, 98, 95, 98, 95, 98, 94, 92],
        [93, 92, 94, 95, 92, 95, 94, 92, 93],
        [85, 90, 92, 93, 78, 93, 92, 90, 85],
        [88, 85, 90, 88, 90, 88, 90, 85, 88]
    ],
    x: [
        [0, 0, 20, 0, 0, 0, 20, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 23, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 20, 0, 0, 0, 20, 0, 0],
        [0, 0, 20, 0, 0, 0, 20, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [18, 0, 0, 0, 23, 0, 0, 0, 18],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 20, 0, 0, 0, 20, 0, 0]
    ],
    s: [
        [0, 0, 0, 20, 0, 20, 0, 0, 0],
        [0, 0, 0, 0, 23, 0, 0, 0, 0],
        [0, 0, 0, 20, 0, 20, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 20, 0, 20, 0, 0, 0],
        [0, 0, 0, 0, 23, 0, 0, 0, 0],
        [0, 0, 0, 20, 0, 20, 0, 0, 0]
    ],
    j: [
        [0, 0, 0, 8888, 8888, 8888, 0, 0, 0],
        [0, 0, 0, 8888, 8888, 8888, 0, 0, 0],
        [0, 0, 0, 8888, 8888, 8888, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 8888, 8888, 8888, 0, 0, 0],
        [0, 0, 0, 8888, 8888, 8888, 0, 0, 0],
        [0, 0, 0, 8888, 8888, 8888, 0, 0, 0]
    ],
    p: [
        [100, 100, 96, 91, 90, 91, 96, 100, 100],
        [98, 98, 96, 92, 89, 92, 96, 98, 98],
        [97, 97, 96, 91, 92, 91, 96, 97, 97],
        [96, 99, 99, 98, 100, 98, 99, 99, 96],
        [96, 96, 96, 96, 100, 96, 96, 96, 96],
        [95, 96, 99, 96, 100, 96, 99, 96, 95],
        [96, 96, 96, 96, 96, 96, 96, 96, 96],
        [97, 96, 100, 99, 101, 99, 100, 96, 97],
        [96, 97, 98, 98, 98, 98, 98, 97, 96],
        [96, 96, 97, 99, 99, 99, 97, 96, 96]
    ],
    z: [
        [9, 9, 9, 11, 13, 11, 9, 9, 9],
        [19, 24, 34, 42, 44, 42, 34, 24, 19],
        [19, 24, 32, 37, 37, 37, 32, 24, 19],
        [19, 23, 27, 29, 30, 29, 27, 23, 19],
        [14, 18, 20, 27, 29, 27, 20, 18, 14],
        [7, 0, 13, 0, 16, 0, 13, 0, 7],
        [7, 0, 7, 0, 15, 0, 7, 0, 7],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0, 0, 0]
    ]
};

const ARGS = {
    'c': { text: "Xe", my: 1, bl: BYLAW.c, value: VALUE.c },
    'm': { text: "Mã", my: 1, bl: BYLAW.m, value: VALUE.m },
    'x': { text: "Tượng", my: 1, bl: BYLAW.x, value: VALUE.x },
    's': { text: "Sĩ", my: 1, bl: BYLAW.s, value: VALUE.s },
    'j': { text: "Tống", my: 1, bl: BYLAW.j, value: VALUE.j },
    'p': { text: "Pháo", my: 1, bl: BYLAW.p, value: VALUE.p },
    'z': { text: "Tốt", my: 1, bl: BYLAW.z, value: VALUE.z },
    'C': { text: "Xe", my: -1, bl: BYLAW.c, value: [...VALUE.c].reverse() },
    'M': { text: "Mã", my: -1, bl: BYLAW.m, value: [...VALUE.m].reverse() },
    'X': { text: "Tượng", my: -1, bl: BYLAW.x, value: VALUE.x },
    'S': { text: "Sĩ", my: -1, bl: BYLAW.s, value: VALUE.s },
    'J': { text: "Tướng", my: -1, bl: BYLAW.j, value: VALUE.j },
    'P': { text: "Pháo", my: -1, bl: BYLAW.p, value: [...VALUE.p].reverse() },
    'Z': { text: "Tốt", my: -1, bl: BYLAW.z, value: [...VALUE.z].reverse() }
};
