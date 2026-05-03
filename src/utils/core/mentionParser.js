/**
 * mentionParser.js
 * Parse @[Tên] trong AI response → resolve ra UID thật → tạo Mention[] Zalo.
 *
 * Cú pháp AI dùng:
 *   @[Nguyễn Văn An]  → bracket form (ưu tiên, hỗ trợ tên có dấu cách)
 *   @AnMot             → bare form (tiện lợi, chỉ tên không dấu cách)
 *
 * Cả hai đều được resolve thành Mention{ uid, pos, len } đúng chuẩn Zalo.
 * Nếu tên trùng → trả về danh sách ambiguous để AI hỏi lại người dùng.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 phút
const CACHE_MAX    = 50;             // tối đa 50 nhóm

// groupId → { index: GroupMemberIndex, members: RawMember[], cachedAt: number }
const memberCache = new Map();

/**
 * @typedef {{ uid: string, name: string }} RawMember
 * @typedef {{ byNameLower: Array<{nameLower:string,nameOriginal:string,uid:string}>, uniqueNameToUid: Map<string,string> }} GroupMemberIndex
 */

function buildIndex(members) {
    const cleaned = members.filter(m => m.uid && m.name && m.name.trim().length > 0);
    const counts = new Map();
    for (const m of cleaned) {
        const k = m.name.toLowerCase();
        counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const uniqueNameToUid = new Map();
    for (const m of cleaned) {
        const k = m.name.toLowerCase();
        if (counts.get(k) === 1) uniqueNameToUid.set(k, m.uid);
    }
    const byNameLower = cleaned
        .map(m => ({ nameLower: m.name.toLowerCase(), nameOriginal: m.name, uid: m.uid }))
        .sort((a, b) => b.nameLower.length - a.nameLower.length);
    return { byNameLower, uniqueNameToUid };
}

/**
 * Lấy members từ response của getGroupMembersInfo hoặc getGroupMembers.
 * Xử lý nhiều format response khác nhau của Zalo API.
 */
function extractMembersFromResp(resp) {
    if (!resp) return [];

    // Format 1: { profiles: { uid: { displayName, dName, zaloName } } }
    // uid key có thể dạng "123_0" → strip "_0" suffix
    const profileMap = resp?.profiles ?? resp?.data?.profiles ?? {};
    if (Object.keys(profileMap).length > 0) {
        return Object.entries(profileMap).map(([rawKey, p]) => ({
            uid: rawKey.endsWith("_0") ? rawKey.slice(0, -2) : rawKey,
            name: String(p.displayName ?? p.dName ?? p.zaloName ?? p.name ?? "").trim(),
        })).filter(m => m.uid && m.name);
    }

    // Format 2: array hoặc { data: [...], friends: [...] }
    const rawList = Array.isArray(resp)
        ? resp
        : (resp?.data?.friends ?? resp?.data ?? resp?.friends ?? []);

    if (Array.isArray(rawList) && rawList.length > 0) {
        return rawList.map(m => ({
            uid: String(m.userId ?? m.uid ?? m.id ?? ""),
            name: String(m.displayName ?? m.dName ?? m.zaloName ?? m.name ?? "").trim(),
        })).filter(m => m.uid && m.name);
    }

    return [];
}

/**
 * Lấy danh sách member nhóm và build index (có cache TTL 5 phút).
 * @returns {{ index: GroupMemberIndex, members: RawMember[] }}
 */
async function loadGroupMemberData(api, groupId) {
    const cached = memberCache.get(groupId);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
        return { index: cached.index, members: cached.members };
    }

    let members = [];
    try {
        const groupResp = await api.getGroupInfo([groupId]);
        const info = groupResp?.gridInfoMap?.[groupId]
                  || groupResp?.[groupId]
                  || groupResp;

        // Thử lấy tên trực tiếp từ groupInfo
        const directMembers = info?.members ?? info?.memberList ?? [];
        if (Array.isArray(directMembers) && directMembers.length > 0) {
            members = directMembers.map(m => ({
                uid: String(m.userId ?? m.uid ?? m.id ?? ""),
                name: String(m.displayName ?? m.dName ?? m.zaloName ?? m.name ?? "").trim(),
            })).filter(m => m.uid && m.name);
        }

        // Lấy danh sách memberIds
        let memberIds = info?.memberIds ?? [];
        if (!memberIds.length) {
            const memVerList = info?.memVerList ?? [];
            memberIds = memVerList.map(e => String(e).split("_")[0]).filter(Boolean);
        }

        if (!members.length && memberIds.length > 0) {
            // Thử getGroupMembersInfo (factory chính thức, có _0 suffix) trước
            let resolved = false;
            if (typeof api.getGroupMembersInfo === "function") {
                try {
                    const infoResp = await api.getGroupMembersInfo(memberIds);
                    const extracted = extractMembersFromResp(infoResp);
                    if (extracted.length > 0) {
                        members = extracted;
                        resolved = true;
                    }
                } catch {}
            }

            // Fallback: getGroupMembers (custom, không _0)
            if (!resolved && typeof api.getGroupMembers === "function") {
                try {
                    const membersResp = await api.getGroupMembers(memberIds);
                    const extracted = extractMembersFromResp(membersResp);
                    if (extracted.length > 0) {
                        members = extracted;
                    }
                } catch {}
            }
        }
    } catch {}

    const cleanedMembers = members.filter(m => m.uid && m.name);
    const index = buildIndex(cleanedMembers);

    if (memberCache.size >= CACHE_MAX) {
        const firstKey = memberCache.keys().next().value;
        if (firstKey) memberCache.delete(firstKey);
    }
    memberCache.set(groupId, { index, members: cleanedMembers, cachedAt: Date.now() });
    return { index, members: cleanedMembers };
}

function isWordChar(ch) {
    if (!ch) return false;
    return /[\p{L}\p{N}_]/u.test(ch);
}

/**
 * Tìm TẤT CẢ các uid khớp với query (để hỗ trợ disambiguation).
 * Trả về mảng { uid, name } sắp xếp theo độ ưu tiên.
 */
function fuzzyFindAll(query, index) {
    const q = query.toLowerCase().trim();
    if (!q) return [];

    const results = [];
    const seen = new Set();

    // 1. Exact unique
    const exactUnique = index.uniqueNameToUid.get(q);
    if (exactUnique && !seen.has(exactUnique)) {
        const entry = index.byNameLower.find(e => e.uid === exactUnique);
        results.push({ uid: exactUnique, name: entry?.nameOriginal ?? query });
        seen.add(exactUnique);
    }

    // 2. Exact full name match (kể cả trùng tên)
    for (const entry of index.byNameLower) {
        if (entry.nameLower === q && !seen.has(entry.uid)) {
            results.push({ uid: entry.uid, name: entry.nameOriginal });
            seen.add(entry.uid);
        }
    }

    // 3. Last-word match (vd: "Khánh" → "Nguyễn Văn Khánh")
    for (const entry of index.byNameLower) {
        const parts = entry.nameLower.split(/\s+/);
        if (parts[parts.length - 1] === q && !seen.has(entry.uid)) {
            results.push({ uid: entry.uid, name: entry.nameOriginal });
            seen.add(entry.uid);
        }
    }

    // 4. Contains match
    for (const entry of index.byNameLower) {
        if (entry.nameLower.includes(q) && !seen.has(entry.uid)) {
            results.push({ uid: entry.uid, name: entry.nameOriginal });
            seen.add(entry.uid);
        }
    }

    return results;
}

/**
 * Tìm uid duy nhất (lấy kết quả đầu tiên của fuzzyFindAll).
 */
function fuzzyFindUid(query, index) {
    const all = fuzzyFindAll(query, index);
    return all.length > 0 ? all[0].uid : null;
}

/** Match tên dài nhất trong index bắt đầu từ `rest` */
function longestNameMatch(rest, index) {
    const restLower = rest.toLowerCase();
    for (const entry of index.byNameLower) {
        if (restLower.startsWith(entry.nameLower)) {
            const after = rest[entry.nameLower.length];
            if (isWordChar(after)) continue;
            return rest.substring(0, entry.nameLower.length);
        }
    }
    return null;
}

/**
 * Parse `@[Name]` và `@Name` trong input text.
 * Trả về { text, mentions, ambiguous: [{ query, candidates }] }
 */
function parseMentions(input, index) {
    if (!input) return { text: input, mentions: [], ambiguous: [] };
    if (!input.includes("@")) return { text: input, mentions: [], ambiguous: [] };
    if (!index.byNameLower.length) {
        const strippedText = input.replace(/@\[([^\]]+)\]/g, "@$1");
        return { text: strippedText, mentions: [], ambiguous: [] };
    }

    let output = "";
    const mentions = [];
    const ambiguous = [];
    let i = 0;

    while (i < input.length) {
        const ch = input[i];
        if (ch === "@") {
            const prev = i > 0 ? input[i - 1] : undefined;
            if (isWordChar(prev)) { output += ch; i++; continue; }

            // Form 1: @[Tên Có Dấu Cách]
            if (input[i + 1] === "[") {
                const close = input.indexOf("]", i + 2);
                if (close !== -1) {
                    const name = input.substring(i + 2, close);
                    const candidates = fuzzyFindAll(name, index);
                    const pos = output.length;
                    output += "@" + name;

                    if (candidates.length === 1) {
                        mentions.push({ uid: candidates[0].uid, pos, len: 1 + name.length });
                    } else if (candidates.length > 1) {
                        // Nhiều người cùng tên → đánh dấu cần hỏi lại
                        ambiguous.push({ query: name, candidates });
                        // Dùng uid đầu tiên tạm thời (best-guess)
                        mentions.push({ uid: candidates[0].uid, pos, len: 1 + name.length });
                    }
                    // candidates.length === 0 → chỉ emit text, không mention
                    i = close + 1;
                    continue;
                }
            }

            // Form 2: @TênLiền (không dấu cách)
            const rest = input.substring(i + 1);
            const matchedName = longestNameMatch(rest, index);
            if (matchedName) {
                const candidates = fuzzyFindAll(matchedName, index);
                if (candidates.length > 0) {
                    const pos = output.length;
                    output += "@" + matchedName;
                    mentions.push({ uid: candidates[0].uid, pos, len: 1 + matchedName.length });
                    if (candidates.length > 1) {
                        ambiguous.push({ query: matchedName, candidates });
                    }
                    i += 1 + matchedName.length;
                    continue;
                }
            }
        }
        output += ch;
        i++;
    }

    return { text: output, mentions, ambiguous };
}

/**
 * Hàm chính: resolve @[Name] trong text → Zalo Mention[].
 * Nếu có tên trùng → trả thêm field `ambiguous` để caller hỏi lại user.
 *
 * @returns {Promise<{text: string, mentions: Mention[], ambiguous: Array<{query:string, candidates:{uid,name}[]}>}>}
 */
export async function resolveOutboundMentions(api, groupId, text) {
    if (!text || !groupId || !text.includes("@")) return { text, mentions: [], ambiguous: [] };
    try {
        const { index } = await loadGroupMemberData(api, groupId);
        return parseMentions(text, index);
    } catch {
        const strippedText = text.replace(/@\[([^\]]+)\]/g, "@$1");
        return { text: strippedText, mentions: [], ambiguous: [] };
    }
}

/**
 * Trả về chuỗi context danh sách thành viên nhóm để inject vào AI prompt.
 * Format: "[THÀNH VIÊN NHÓM]\n- Tên A\n- Tên B\n..."
 *
 * @param {object} api
 * @param {string} groupId
 * @returns {Promise<string>} - Chuỗi context hoặc "" nếu không lấy được
 */
export async function getGroupMembersContext(api, groupId) {
    if (!api || !groupId) return "";
    try {
        const { members } = await loadGroupMemberData(api, groupId);
        if (!members.length) return "";
        const list = members.map(m => `- ${m.name}`).join("\n");
        return `[THÀNH VIÊN NHÓM — dùng để tag đúng người]\n${list}`;
    } catch {
        return "";
    }
}

/**
 * Xoá cache của 1 nhóm (vd: khi thành viên thay đổi).
 */
export function clearGroupMemberCache(groupId) {
    if (groupId) memberCache.delete(groupId);
    else memberCache.clear();
}

// Dọn cache hết hạn mỗi 10 phút
setInterval(() => {
    const now = Date.now();
    for (const [gid, entry] of memberCache.entries()) {
        if (now - entry.cachedAt > CACHE_TTL_MS) memberCache.delete(gid);
    }
}, 10 * 60 * 1000);
