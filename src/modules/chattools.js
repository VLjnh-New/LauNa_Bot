import { log } from "../globals.js";

export const name = "chattools";
export const description = "Công cụ hội thoại: forward, link, gif, priv, todo, pin, ẩn chat";

function send(ctx, msg) {
    return ctx.api.sendMessage({ msg, quote: ctx.message.data }, ctx.threadId, ctx.threadType);
}

const HELP_MSG = (prefix) =>
    `[ 🛠️ CHAT TOOLS ]\n─────────────────\n` +
    `${prefix}ct forward [threadId] — Chuyển tiếp tin nhắn (reply)\n` +
    `${prefix}ct link [URL] [tiêu đề] — Gửi link\n` +
    `${prefix}ct gif [URL]           — Gửi GIF\n` +
    `${prefix}ct priv [UID] [nội dung] — Gửi tin riêng tư\n` +
    `${prefix}ct todo [nội dung]     — Tạo việc cần làm\n` +
    `${prefix}ct pin [on/off]        — Ghim / bỏ ghim hội thoại\n` +
    `${prefix}ct hide [on/off]       — Ẩn / hiện hội thoại\n` +
    `─────────────────`;

export const commands = {
    ct: async (ctx) => {
        const { api, args, message, threadId, threadType, adminIds, senderId, prefix } = ctx;
        const sub = args[0]?.toLowerCase();
        const subArgs = args.slice(1);

        if (!adminIds.includes(String(senderId))) return send(ctx, "⚠️ Chỉ Admin Bot mới được dùng lệnh này!");

        switch (sub) {
            case "forward": {
                const quote = message.data?.quote;
                if (!quote) return send(ctx, `◈ Cú pháp: Reply vào tin nhắn rồi dùng ${prefix}ct forward [threadId đích]`);
                const toThread = subArgs[0];
                if (!toThread || !/^\d+$/.test(toThread)) return send(ctx, `◈ Cú pháp: ${prefix}ct forward [threadId đích]`);
                try {
                    const msgText = typeof quote.content === "string"
                      ? quote.content
                      : (quote.content?.title || quote.content?.message || JSON.stringify(quote.content || ""));
                    await api.forwardMessage(
                        {
                            message: msgText,
                            reference: {
                                id: String(quote.globalMsgId || quote.msgId),
                                ts: Number(quote.ts) || Date.now(),
                                logSrcType: 0,
                                fwLvl: 1,
                            },
                        },
                        [toThread], threadType
                    );
                    await send(ctx, `✅ Đã chuyển tiếp tin nhắn đến thread: ${toThread}`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                break;
            }
            case "link": {
                const url = subArgs[0];
                const title = subArgs.slice(1).join(" ").trim() || url;
                if (!url || !url.startsWith("http")) return send(ctx, `◈ Cú pháp: ${prefix}ct link [URL] [tiêu đề (tùy chọn)]`);
                try {
                    await api.sendLink({ link: url, title, thumb: "", desc: "" }, threadId, threadType);
                } catch (e) { await send(ctx, `⚠️ Lỗi gửi link: ${e.message}`); }
                break;
            }
            case "gif": {
                const gifUrl = subArgs[0];
                if (!gifUrl || !gifUrl.startsWith("http")) return send(ctx, `◈ Cú pháp: ${prefix}ct gif [URL gif]`);
                try {
                    await api.sendImage({ src: gifUrl, msg: subArgs.slice(1).join(" ").trim() }, threadId, threadType);
                } catch (e) { await send(ctx, `⚠️ Lỗi gửi GIF: ${e.message}`); }
                break;
            }
            case "priv": {
                const uid = subArgs[0];
                const text = subArgs.slice(1).join(" ").trim();
                if (!uid || !/^\d+$/.test(uid) || !text) return send(ctx, `◈ Cú pháp: ${prefix}ct priv [UID] [nội dung]`);
                try {
                    await api.sendMessagePrivate({ msg: text }, uid);
                    await send(ctx, `✅ Đã gửi tin nhắn riêng tư đến UID: ${uid}`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                break;
            }
            case "todo": {
                const input = subArgs.join(" ").split("|").map(s => s.trim());
                const content = input[0];
                const assigneeStr = input[1] || "";
                const desc = input[2] || "";
                if (!content) return send(ctx, `◈ Cú pháp: ${prefix}ct todo [nội dung] | [UID người nhận] | [mô tả]`);
                const assignees = assigneeStr ? assigneeStr.split(",").map(s => s.trim()).filter(Boolean) : [];
                const mentions = message.data?.mentions || [];
                mentions.forEach(m => { if (!assignees.includes(String(m.uid))) assignees.push(String(m.uid)); });
                // Mặc định gán cho người tạo nếu không chỉ định ai
                if (!assignees.length) assignees.push(String(senderId));
                try {
                    await api.sendToDo(
                        { ...message, threadId, type: threadType, data: message.data },
                        content, assignees, -1, desc
                    );
                    await send(ctx, `✅ Đã tạo việc cần làm: "${content}"`);
                } catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                break;
            }
            case "pin": {
                const pinSub = subArgs[0]?.toLowerCase();
                if (pinSub === "off") {
                    try { await api.setPinnedConversations(false, threadId, threadType); return send(ctx, "✅ Đã bỏ ghim cuộc hội thoại này."); }
                    catch (e) { return send(ctx, `⚠️ Lỗi: ${e.message}`); }
                }
                try { await api.setPinnedConversations(true, threadId, threadType); await send(ctx, "✅ Đã ghim cuộc hội thoại này."); }
                catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                break;
            }
            case "hide": {
                const hideSub = subArgs[0]?.toLowerCase();
                if (hideSub === "off") {
                    try { await api.setHiddenConversations(false, threadId, threadType); return send(ctx, "✅ Đã hiện lại cuộc hội thoại này."); }
                    catch (e) { return send(ctx, `⚠️ Lỗi: ${e.message}`); }
                }
                try { await api.setHiddenConversations(true, threadId, threadType); await send(ctx, "✅ Đã ẩn cuộc hội thoại này."); }
                catch (e) { await send(ctx, `⚠️ Lỗi: ${e.message}`); }
                break;
            }
            default:
                return send(ctx, HELP_MSG(prefix));
        }
    }
};
