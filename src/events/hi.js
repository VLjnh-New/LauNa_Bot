
export const name = "hi";
export const description = "Tự động chào khi có người gửi: hi, chào, hello... với tính năng chống spam";

// Lưu thời gian phản hồi cuối cùng theo từng thread để chống spam (cooldown)
const cooldowns = new Map();

export async function handle(ctx) {
    const { api, threadId, threadType, senderName, content, isSelf, senderId } = ctx;

    if (isSelf) return false;
    if (!content || typeof content !== "string") return false;

    const text = content.toLowerCase().trim();
    const words = text.split(/\s+/);
    
    // Nếu tin nhắn quá dài (trên 3 từ) thì không phải là câu chào ngắn -> Bỏ qua để tránh nhận nhầm
    if (words.length > 3) return false;

    // Danh sách các từ khóa chào hỏi
    const greetings = ["hi", "hello", "chào", "chao", "helo", "hé lô", "hế lô", "chào bot", "hi hi", "hihi", "hí hí", "hi²", "hi bot"];
    const goodbyes = ["bye", "bai", "tạm biệt", "ngủ đây", "goobye"];

    const isGreeting = greetings.some(g => text === g || text === g + " bot" || text === "bot " + g);
    const isGoodbye = goodbyes.some(g => text === g || text === g + " bot" || text === "bot " + g);

    if (!isGreeting && !isGoodbye) return false;

    // Kiểm tra cooldown (3 phút - 180,000ms)
    const now = Date.now();
    const lastGreet = cooldowns.get(threadId) || 0;
    if (now - lastGreet < 180000) {
        // Nếu đang trong thời gian cooldown, không trả lời để tránh spam
        return false;
    }

    if (isGreeting) {
        const replies = [
            `Chào @${senderName} nhé! Chúc bạn một ngày tốt lành. ✨`,
            `Hi @${senderName}, mình là Bot. Bạn có cần giúp gì không? 🤖`,
            `Chào @${senderName}! Rất vui được gặp bạn. Chúc bạn một ngày tràn đầy năng lượng! 🌈`,
            `Hello @${senderName}! Bot đây, bạn khỏe không? 💖`
        ];
        const randomReply = replies[Math.floor(Math.random() * replies.length)];
        
        cooldowns.set(threadId, now); // Cập nhật thời gian gửi
        await api.sendMessage({ 
            msg: randomReply,
            mentions: [{ uid: senderId, pos: randomReply.indexOf("@" + senderName), len: senderName.length + 1 }]
        }, threadId, threadType);
        return true; 
    }

    if (isGoodbye) {
        const msg = `Tạm biệt @${senderName} nhé! Hẹn gặp lại bạn sau. 👋✨`;
        cooldowns.set(threadId, now); // Cập nhật thời gian gửi
        await api.sendMessage({ 
            msg,
            mentions: [{ uid: senderId, pos: msg.indexOf("@" + senderName), len: senderName.length + 1 }]
        }, threadId, threadType);
        return true;
    }

    return false;
}
