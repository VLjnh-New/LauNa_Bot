import { log } from "../logger.js";

export const name = "call";
export const description = "Gọi điện cho một người dùng hoặc nhóm (Tag, Reply hoặc Link)";

const logTarget = (uid) => String(uid).trim().replace(/_0$/, "");
const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
};

const normalizeLink = (raw) => {
    let l = String(raw || "").trim().replace(/[\s\u200B-\u200D\uFEFF]/g, "");
    if (!l.startsWith("http") && l.includes("zalo.me/")) l = "https://" + l.replace(/^\/+/, "");
    return l.split("?")[0].replace(/\/$/, "");
};

async function callOneUser(api, { groupId, userId, callId, groupName }) {
    return api.callGroup(String(groupId), [String(userId)], {
        callId: callId ?? Math.floor(Date.now() / 1000),
        groupName: groupName || "ZaloBot Support",
    });
}

export const commands = {
    call: async (ctx) => {
        const { api, threadId, threadType, message, args } = ctx;
        const mentions = message.data.mentions || [];
        const quote = message.data.quote || message.data.content?.quote;

        const linkArg = args.find(a => typeof a === "string" && a.includes("zalo.me/g/"));

        // ============ CALL VIA LINK (BATCH) ============
        if (linkArg) {
            const link = normalizeLink(linkArg);

            let waves = 1;
            for (const arg of args) {
                if (arg === linkArg) continue;
                const n = parseInt(arg, 10);
                if (!isNaN(n)) { waves = n; break; }
            }
            if (waves > 15) waves = 15;
            if (waves < 1) waves = 1;

            try {
                await api.sendMessage({ msg: `🔍 Đang phân tích link nhóm: ${link}...` }, threadId, threadType);

                await api.joinGroupLink(link).catch((e) => {
                    if (e?.code !== 178) log.warn?.(`[Call Link] Join error or already joined: ${e.message}`);
                });

                const info = await api.getGroupLinkInfo(link).catch((e) => {
                    log.error?.(`[Call Link] Get Info Error: ${e.message}`);
                    return null;
                });
                if (!info) {
                    return api.sendMessage({ msg: "❎ Không lấy được thông tin nhóm từ link." }, threadId, threadType);
                }

                const groupId = info.groupId || info.group_id;
                const gName = info.name || "Group Link";
                const myUid = String(api.getOwnId?.() || "");
                const memberIds = [...new Set(
                    (info.currentMems || [])
                        .map(m => logTarget(m.id || m.uid || m.userId))
                        .filter(id => id && id !== myUid)
                )];

                if (memberIds.length === 0) {
                    return api.sendMessage({ msg: `❎ Nhóm "${gName}" không có thành viên công khai để quét (hoặc Bot bị chặn).` }, threadId, threadType);
                }

                await api.sendMessage({ msg: `🚀 Đã tìm thấy ${memberIds.length} thành viên.\n🌊 Bắt đầu ${waves} đợt gọi cho nhóm: "${gName}"` }, threadId, threadType);

                for (let w = 1; w <= waves; w++) {
                    const batch = shuffle(memberIds);
                    const parallel = 5;
                    let ok = 0, fail = 0;

                    for (let i = 0; i < batch.length; i += parallel) {
                        const chunk = batch.slice(i, i + parallel);
                        const results = await Promise.all(chunk.map((uid, idx) =>
                            callOneUser(api, {
                                groupId: String(groupId || threadId),
                                userId: uid,
                                callId: Math.floor(Date.now() / 1000) + idx,
                                groupName: gName,
                            }).then(() => true).catch(() => false)
                        ));
                        ok += results.filter(Boolean).length;
                        fail += results.length - results.filter(Boolean).length;
                        await new Promise(r => setTimeout(r, 800));
                    }

                    if (waves > 1) {
                        await api.sendMessage({ msg: `📊 Đợt ${w}/${waves} hoàn tất. (Thành công: ${ok} · Thất bại: ${fail})` }, threadId, threadType);
                    }
                    if (w < waves) await new Promise(r => setTimeout(r, 4000));
                }

                await api.sendMessage({ msg: `✅ Đã hoàn tất chiến dịch Call Batch cho nhóm!` }, threadId, threadType);
            } catch (err) {
                api.sendMessage({ msg: "❌ Lỗi thực thi Link Call: " + err.message }, threadId, threadType);
            }
            return;
        }

        // ============ SINGLE USER CALL (TAG / REPLY) ============
        let targetId = null;
        let targetName = "Người dùng";

        if (mentions.length > 0) {
            targetId = String(mentions[0].uid || mentions[0].id);
            targetName = mentions[0].nm || "Người dùng";
        } else if (quote) {
            targetId = String(quote.uidFrom || quote.ownerId);
            targetName = quote.dName || "Người dùng";
        }

        if (!targetId) {
            return api.sendMessage({ msg: "⚠️ Vui lòng tag người dùng, reply hoặc dán link nhóm để thực hiện cuộc gọi!" }, threadId, threadType);
        }

        let count = 1;
        for (const arg of args) {
            const n = parseInt(arg, 10);
            if (!isNaN(n) && !arg.includes("@")) { count = n; break; }
        }
        if (count > 20) count = 20;
        if (count < 1) count = 1;

        try {
            if (count === 1) {
                await api.sendMessage({ msg: `📞 Đang gọi cho ${targetName}...` }, threadId, threadType);
            } else {
                await api.sendMessage({ msg: `🚀 Đang bắt đầu ${count} đợt gọi cho ${targetName}...` }, threadId, threadType);
            }

            for (let i = 0; i < count; i++) {
                try {
                    await callOneUser(api, {
                        groupId: threadId,
                        userId: targetId,
                        callId: Math.floor(Date.now() / 1000) + i,
                        groupName: "ZaloBot Support",
                    });
                } catch (e) {
                    log.error?.(`[CallOneUser] Error calling ${targetId}: ${e.message}`);
                }
                if (i < count - 1) await new Promise(r => setTimeout(r, 2000));
            }

            if (count > 1) {
                await api.sendMessage({ msg: `✅ Đã hoàn tất ${count} đợt gọi cho ${targetName}!` }, threadId, threadType);
            }
        } catch (err) {
            api.sendMessage({ msg: "❌ Lỗi call: " + err.message }, threadId, threadType);
        }
    }
};
