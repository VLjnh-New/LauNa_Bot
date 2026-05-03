import { log, axios } from "../globals.js";

export const name = "nsfw";
export const description = "Kiểm tra ảnh có nội dung NSFW (18+) hay không";

const API_KEYS = [
    "718666fe27msha3d76d92bdc47b1p1b6c5bjsnb96eaa8b5170",
    "1b20ad47f6msh84b3688bbce2c15p1919c9jsn782265672a3a"
];

function send(ctx, msg) {
    return ctx.api.sendMessage({ msg, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

async function checkNSFW(imageUrl) {
    const key = API_KEYS[Math.floor(Math.random() * API_KEYS.length)];
    const res = await axios.post(
        "https://nsfw-image-classification1.p.rapidapi.com/img/nsfw",
        { url: imageUrl },
        {
            headers: {
                "content-type": "application/json",
                "x-rapidapi-host": "nsfw-image-classification1.p.rapidapi.com",
                "x-rapidapi-key": key
            },
            timeout: 15000
        }
    );
    const prob = res.data.NSFW_Prob * 100;
    return {
        score: Number(prob.toFixed(0)),
        percent: prob.toFixed(1) + "%"
    };
}

export const commands = {

    nsfw: async (ctx) => {
        const { args, prefix, message } = ctx;

        const quote = message?.data?.quote;
        const quoteAttach = quote?.attach;

        let imageUrl = args[0];

        if (!imageUrl && quoteAttach) {
            try {
                const attach = typeof quoteAttach === "string" ? JSON.parse(quoteAttach) : quoteAttach;
                imageUrl = attach?.href || attach?.url || attach?.thumb;
            } catch { }
        }

        if (!imageUrl) {
            return send(ctx,
                `[ 🔞 NSFW CHECKER ]\n` +
                `─────────────────\n` +
                `Kiểm tra ảnh có nội dung 18+ hay không\n\n` +
                `Cách dùng:\n` +
                `◈ ${prefix}nsfw <link ảnh>\n` +
                `◈ Reply ảnh + ${prefix}nsfw\n` +
                `─────────────────`
            );
        }

        try {
            const result = await checkNSFW(imageUrl);
            const { score, percent } = result;

            let level, icon;
            if (score >= 80) {
                level = "RẤT CAO ⛔";
                icon = "🔞";
            } else if (score >= 50) {
                level = "CAO ⚠️";
                icon = "⚠️";
            } else if (score >= 20) {
                level = "TRUNG BÌNH";
                icon = "🟡";
            } else {
                level = "AN TOÀN ✅";
                icon = "✅";
            }

            const bar = buildBar(score);

            return send(ctx,
                `[ ${icon} NSFW CHECKER ]\n` +
                `─────────────────\n` +
                `📊 Xác suất NSFW: ${percent}\n` +
                `${bar}\n` +
                `🏷️ Mức độ: ${level}\n` +
                `─────────────────`
            );

        } catch (e) {
            log.error("nsfw error:", e.message);
            return send(ctx, `⚠️ Không thể kiểm tra ảnh: ${e.message}`);
        }
    }

};

function buildBar(score) {
    const filled = Math.round(score / 10);
    const empty = 10 - filled;
    return "█".repeat(filled) + "░".repeat(empty) + ` ${score}%`;
}
