import { log } from "../globals.js";
export const name = "poll";
export const description = "Tạo và quản lý bình chọn Zalo";

async function send(ctx, msg) {
    return ctx.api.sendMessage({ msg }, ctx.threadId, ctx.threadType);
}

function requireGroup(ctx) {
    if (ctx.threadType !== 1) {
        send(ctx, "⚠️ Lệnh bình chọn chỉ dùng được trong Nhóm Chat!");
        return false;
    }
    return true;
}

function requireAdmin(ctx) {
    if (!ctx.adminIds.includes(String(ctx.senderId))) {
        send(ctx, "⚠️ Chỉ Admin Bot mới được dùng lệnh này!");
        return false;
    }
    return true;
}

export const commands = {
    poll: async (ctx) => {
        const { api, args, threadId, threadType, prefix, adminIds, senderId } = ctx;
        const sub = args[0]?.toLowerCase();

        // ── poll vote [pollId] [optionId] ────────────────────────────────────
        if (sub === "vote") {
            const pollId   = args[1];
            const optionId = args[2];
            if (!pollId || !optionId) return send(ctx, `◈ Cú pháp: ${prefix}poll vote [pollId] [optionId]`);
            try {
                await api.votePoll(pollId, optionId);
                await send(ctx, `✅ Đã vote lựa chọn ${optionId} trong poll ${pollId}!`);
            } catch (e) { await send(ctx, `⚠️ Lỗi vote: ${e.message}`); }
            return;
        }

        // ── poll info [pollId] ────────────────────────────────────────────────
        if (sub === "info") {
            const pollId = args[1];
            if (!pollId) return send(ctx, `◈ Cú pháp: ${prefix}poll info [pollId]`);
            try {
                const data = await api.getPollDetail(pollId);
                const poll = data?.poll || data;
                let msg = `[ 📊 THÔNG TIN BÌNH CHỌN ]\n─────────────────\n`;
                msg += `◈ Câu hỏi: ${poll?.question || "N/A"}\n`;
                msg += `◈ ID: ${poll?.pollId || pollId}\n`;
                msg += `◈ Trạng thái: ${poll?.isClosed ? "Đã đóng" : "Đang mở"}\n`;
                const opts = poll?.options || [];
                if (opts.length > 0) {
                    msg += `◈ Lựa chọn:\n`;
                    opts.forEach((o, i) => msg += `  ${i + 1}. ${o.name} (${o.totalVote || 0} vote) — ID: ${o.optionId}\n`);
                }
                msg += `─────────────────`;
                await send(ctx, msg);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }

        // ── poll lock [pollId] (admin only) ───────────────────────────────────
        if (sub === "lock") {
            if (!requireAdmin(ctx)) return;
            const pollId = args[1];
            if (!pollId) return send(ctx, `◈ Cú pháp: ${prefix}poll lock [pollId]`);
            try {
                await api.lockPoll(pollId);
                await send(ctx, `✅ Đã khóa bình chọn ${pollId}!`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }

        // ── poll share [pollId] ───────────────────────────────────────────────
        if (sub === "share") {
            const pollId = args[1];
            if (!pollId) return send(ctx, `◈ Cú pháp: ${prefix}poll share [pollId]`);
            try {
                await api.sharePoll(pollId);
                await send(ctx, `✅ Đã chia sẻ bình chọn ${pollId}!`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }

        // ── poll add [pollId] [lựa chọn] ─────────────────────────────────────
        if (sub === "add") {
            const pollId = args[1];
            const option = args.slice(2).join(" ").trim();
            if (!pollId || !option) return send(ctx, `◈ Cú pháp: ${prefix}poll add [pollId] [tên lựa chọn]`);
            try {
                await api.addPollOptions({ pollId, options: [option] });
                await send(ctx, `✅ Đã thêm lựa chọn "${option}" vào poll ${pollId}!`);
            } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
            return;
        }

        // ── poll [Câu hỏi] | [Lựa chọn 1] | [Lựa chọn 2] ... (tạo mới) ──────
        if (!requireGroup(ctx)) return;

        const raw = args.join(" ");
        if (!raw.includes("|")) {
            return send(ctx, [
                `[ 📊 BÌNH CHỌN ZALO ]`,
                `─────────────────`,
                `Tạo poll: ${prefix}poll [Câu hỏi] | [Lựa chọn 1] | [Lựa chọn 2] | ...`,
                `Ví dụ:   ${prefix}poll Hôm nay đi ăn gì? | Phở | Lẩu | Nhịn`,
                ``,
                `Quản lý:`,
                `  ${prefix}poll vote [id] [optionId]  — Vote`,
                `  ${prefix}poll info [id]              — Xem kết quả`,
                `  ${prefix}poll add [id] [lựa chọn]   — Thêm lựa chọn`,
                `  ${prefix}poll share [id]             — Chia sẻ`,
                `  ${prefix}poll lock [id]              — Khóa poll (Admin)`,
                `─────────────────`,
            ].join("\n"));
        }

        const input = raw.split("|").map(s => s.trim()).filter(Boolean);
        if (input.length < 3) return send(ctx, `⚠️ Cần ít nhất 1 câu hỏi và 2 lựa chọn.\n◈ Ví dụ: ${prefix}poll Câu hỏi? | Lựa chọn A | Lựa chọn B`);

        try {
            await api.createPoll({
                question: input[0],
                options:  input.slice(1),
                expiredTime:        0,
                allowMultiChoices:  true,
                allowAddNewOption:  true,
                hideVotePreview:    false,
                isAnonymous:        false,
            }, threadId);
        } catch (e) {
            log.error("Lỗi tạo poll:", e.message);
            await send(ctx, `⚠️ Lỗi tạo bình chọn: ${e.message}`);
        }
    },
};
