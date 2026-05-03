import Table from "cli-table3";
import chalk from "chalk";

const C = {
    r:  "\x1b[0m",
    b:  "\x1b[1m",
    d:  "\x1b[2m",
    i:  "\x1b[3m",

    // --- Foreground ---
    gray:    "\x1b[90m",
    red:     "\x1b[91m",
    green:   "\x1b[92m",
    yellow:  "\x1b[93m",
    blue:    "\x1b[94m",
    magenta: "\x1b[95m",
    cyan:    "\x1b[96m",
    white:   "\x1b[97m",

    // --- Background ---
    bgBlack:   "\x1b[40m",
    bgRed:     "\x1b[41m",
    bgGreen:   "\x1b[42m",
    bgYellow:  "\x1b[43m",
    bgBlue:    "\x1b[44m",
    bgMagenta: "\x1b[45m",
    bgCyan:    "\x1b[46m",
    bgGray:    "\x1b[100m",
};

const tag = (bg, label) =>
    `${bg}${C.bgBlack}${C.b}${C.white} ${label} ${C.r}`;

function _fmtDetail(detail) {
    if (detail === undefined || detail === null || detail === "") return "";
    if (detail instanceof Error) {
        return detail.message || detail.toString() || String(detail);
    }
    if (typeof detail === "object") {
        return detail.message
            || detail.error?.message
            || detail.error
            || (() => { try { return JSON.stringify(detail); } catch { return String(detail); } })();
    }
    return String(detail);
}

export const log = {
    info: (msg, detail = "") => {
        const d = _fmtDetail(detail);
        console.log(
            `${tag(C.bgCyan, "◈ INF")} ${C.cyan}${msg}` +
            `${d ? ` ${C.gray}▸ ${d}` : ""}${C.r}`
        );
    },

    success: (msg, detail = "") => {
        const d = _fmtDetail(detail);
        console.log(
            `${tag(C.bgGreen, "✓ ACK")} ${C.green}${C.b}${msg}${C.r}` +
            `${d ? ` ${C.gray}▸ ${d}` : ""}${C.r}`
        );
    },

    warn: (msg, detail = "") => {
        const d = _fmtDetail(detail);
        console.log(
            `${tag(C.bgYellow, "⚠ ALT")} ${C.yellow}${msg}` +
            `${d ? ` ${C.gray}▸ ${d}` : ""}${C.r}`
        );
    },

    error: (msg, detail = "") => {
        const d = _fmtDetail(detail);
        console.log(
            `${tag(C.bgRed, "✗ CRIT")} ${C.red}${msg}` +
            `${d ? ` ${C.gray}▸ ${d}` : ""}${C.r}`
        );
    },

    debug: () => {},

    mem: (msg, detail = "") => {
        const d = _fmtDetail(detail);
        console.log(
            `${tag(C.bgMagenta, "◈ MEM")} ${C.magenta}${msg}` +
            `${d ? ` ${C.gray}▸ ${d}` : ""}${C.r}`
        );
    },

    // --- LOG CHAT BOX ---
    chat: (type, name, threadId, text, groupName = null, data = null) => {
        // Chat log hiện đang tắt — thoát sớm, không xây string
        return;
        const isGroup = type === "GROUP";
        const hash = [...threadId].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);

        const palette = [C.cyan, C.green, C.magenta, C.blue, C.yellow];
        const gColor  = palette[hash % palette.length];

        const source = isGroup
            ? `${C.b}${gColor}⟨ ${groupName || "GROUP"} ⟩${C.r}`
            : `${C.b}${C.magenta}⟨ PRIVATE ⟩${C.r}`;

        const senderId  = data?.uidFrom || data?.uid || "N/A";
        const senderTag = `${C.b}${C.cyan}${name}${C.r}${C.gray} #${senderId}${C.r}`;

        const msgType   = data?.msgType || "chat.text";
        let contentStr  = text || (typeof data?.content === "string" ? data.content : "");
        let icon        = `${C.green}▸${C.r}`;

        if (msgType.includes("photo")) {
            icon = `${C.cyan}⬡ IMG${C.r}`;
            const url = data?.content?.href || data?.attach?.url || data?.attach?.hdUrl || "";
            contentStr = `${C.d}${C.gray}${contentStr || "Đã gửi một ảnh"}${C.r} ${C.gray}▸ ${C.blue}${url}${C.r}`;
        } else if (msgType.includes("sticker")) {
            icon = `${C.magenta}⬡ STK${C.r}`;
            let sd = {};
            try { sd = typeof data?.content === "string" ? JSON.parse(data.content) : (data?.content || data?.attach || {}); } catch {}
            contentStr = `${C.magenta}id:${sd.id || "N/A"} cat:${sd.catId || sd.cateId || "N/A"}${C.r}`;
        } else if (msgType.includes("video")) {
            icon = `${C.blue}⬡ VID${C.r}`;
            contentStr = `${C.d}${contentStr || "Đã gửi một video"}${C.r}`;
        } else if (msgType.includes("voice") || msgType.includes("audio")) {
            icon = `${C.yellow}⬡ AUD${C.r}`;
            contentStr = `${C.d}${contentStr || "Đã gửi tin nhắn thoại"}${C.r}`;
        } else if (msgType.includes("file")) {
            icon = `${C.cyan}⬡ FIL${C.r}`;
            contentStr = `${C.b}${C.blue}${contentStr || "Tệp đính kèm"}${C.r}`;
        } else if (msgType.includes("link")) {
            icon = `${C.green}⬡ LNK${C.r}`;
        }

        const firstLine  = contentStr.split("\n")[0] || "";
        const displayText = firstLine.length > 80 ? firstLine.slice(0, 80) + "…" : firstLine;

        // console.log(`${C.gray}┌──${C.r} ${source} ${C.gray}╴${C.r} ${senderTag}`);
        // console.log(`${C.gray}└─${C.r} ${icon} ${C.white}${displayText}${C.r}`);
    },

    event: (type, threadId, text) =>
        console.log(
            `${tag(C.bgYellow, "⚡ EVT")} ${C.b}${C.magenta}${type.toUpperCase()}${C.r}` +
            ` ${C.gray}[${threadId}]${C.r} ${C.cyan}${text}${C.r}`
        ),

    system: (msg) =>
        console.log(`${tag(C.bgBlue, "▸ SYS")} ${C.b}${C.blue}${msg}${C.r}`),

    divider: () =>
        console.log(`${C.gray}${C.d}${"━".repeat(65)}${C.r}`),

    table: (rows = [], headers = ["USER", "ACTION", "RESULT"]) => {
        const borderless = {
            'top': '', 'top-mid': '', 'top-left': '', 'top-right': '',
            'bottom': '', 'bottom-mid': '', 'bottom-left': '', 'bottom-right': '',
            'left': '', 'left-mid': '', 'mid': '', 'mid-mid': '',
            'right': '', 'right-mid': '', 'middle': '  '
        };
        const t = new Table({
            head: headers.map(h => chalk.bold.cyanBright(h)),
            chars: borderless,
            style: { head: [], border: [] }
        });
        for (const row of rows) {
            const [user, action, result] = row;
            const resultStr =
                result === true  || result === "ok"   || result === "✔" ? chalk.greenBright("✔") :
                result === false || result === "fail"  || result === "✖" ? chalk.redBright("✖")  :
                String(result);
            t.push([
                chalk.cyanBright(String(user)),
                chalk.yellowBright(String(action)),
                resultStr
            ]);
        }
        console.log(t.toString());
    }
};
