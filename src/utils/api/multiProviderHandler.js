import { log } from "../../globals.js";
import { pollinationsChat, getPollinationsKey } from "./apiai.js";
import { askDuckAI } from "./duckai.js";

/**
 * Per-thread AI provider preference (in-memory)
 * key: threadId, value: { provider, model }
 */
const threadProviders = new Map();

export const PROVIDERS = {
    pollinations: {
        label: "Pollinations (GPT)",
        defaultModel: "openai",
        models: { gpt: "openai", gemini: "gemini-fast", deepseek: "deepseek", mistral: "mistral" },
    },
    duck: {
        label: "Duck.ai (GPT-5/4o)",
        defaultModel: "gpt-4o",
        models: { "gpt5": "gpt-5-mini", "4o": "gpt-4o", "mini": "gpt-4o-mini" },
    },
};

export function getThreadProvider(threadId) {
    return threadProviders.get(String(threadId)) || { provider: "pollinations", model: "openai" };
}

export function setThreadProvider(threadId, provider, model) {
    threadProviders.set(String(threadId), { provider, model });
}

/**
 * Chat với provider đã chọn cho thread
 */
export async function chatWithProvider(threadId, prompt) {
    const { provider, model } = getThreadProvider(threadId);

    switch (provider) {
        case "pollinations": {
            const key = getPollinationsKey();
            if (!key) throw new Error("Chưa cấu hình pollinations.apiKey trong tokens.json!");
            return await pollinationsChat("Bạn là trợ lý thông minh, trả lời bằng tiếng Việt tự nhiên.", prompt, [], model);
        }
        case "duck": {
            return await askDuckAI(prompt, model);
        }
        default:
            throw new Error(`Provider không hợp lệ: ${provider}`);
    }
}

export const name = "multiprovider";
export const description = "Chọn nhà cung cấp AI per-thread: Pollinations hoặc Duck.ai (miễn phí)";

export const commands = {
    aipick: async (ctx) => {
        const { api, args, threadId, threadType, prefix } = ctx;

        if (!args.length) {
            const current = getThreadProvider(threadId);
            const provInfo = PROVIDERS[current.provider];
            return api.sendMessage({
                msg: [
                    `🔀 Multi-Provider AI`,
                    `Provider hiện tại: ${provInfo?.label || current.provider} [${current.model}]`,
                    ``,
                    `Chọn provider: ${prefix}aipick [provider] [model]`,
                    ``,
                    `Provider:`,
                    `  pollinations — Pollinations GPT (mặc định)`,
                    `    model: gpt, gemini, deepseek, mistral`,
                    `  duck         — Duck.ai GPT-5/4o (miễn phí)`,
                    `    model: gpt5, 4o, mini`,
                    ``,
                    `Ví dụ:`,
                    `  ${prefix}aipick duck gpt5`,
                    `  ${prefix}aipick pollinations gemini`,
                ].join("\n"),
            }, threadId, threadType);
        }

        const providerKey = args[0]?.toLowerCase();
        if (!PROVIDERS[providerKey]) {
            return api.sendMessage({
                msg: `❌ Provider không hợp lệ!\nDùng: pollinations | duck`,
            }, threadId, threadType);
        }

        const provCfg    = PROVIDERS[providerKey];
        const modelAlias = args[1]?.toLowerCase();
        const model      = provCfg.models[modelAlias] || provCfg.defaultModel;

        setThreadProvider(threadId, providerKey, model);
        log.info(`[MultiProvider] Thread ${threadId} → ${providerKey}/${model}`);

        await api.sendMessage({
            msg: `✅ Đã chọn: ${provCfg.label} [${model}]\nDùng ${prefix}aiask <câu hỏi> để chat.`,
        }, threadId, threadType);
    },

    aiask: async (ctx) => {
        const { api, args, threadId, threadType, raw, prefix } = ctx;

        let prompt = args.join(" ").trim();
        if (!prompt && raw?.quote?.msg) prompt = raw.quote.msg.trim();
        if (!prompt) {
            return api.sendMessage({
                msg: `🔀 Cú pháp: ${prefix}aiask <câu hỏi>\nProvider hiện tại: ${getThreadProvider(threadId).provider}`,
            }, threadId, threadType);
        }

        const { provider, model } = getThreadProvider(threadId);
        const label = PROVIDERS[provider]?.label || provider;

        const thinking = await api.sendMessage({ msg: `🔀 [${label}] đang trả lời...` }, threadId, threadType);

        try {
            const reply = await chatWithProvider(threadId, prompt);
            await api.sendMessage({ msg: `🔀 [${label}/${model}]\n${reply}`, quote: raw }, threadId, threadType);
        } catch (e) {
            log.error("[MultiProvider]", e.message);
            await api.sendMessage({ msg: `❌ Lỗi: ${e.message}` }, threadId, threadType);
        } finally {
            try { await api.undo({msgId: thinking.message?.msgId}, threadId, threadType); } catch {}
        }
    },

    aistatus: async (ctx) => {
        const { api, threadId, threadType } = ctx;
        const { provider, model } = getThreadProvider(threadId);
        const provInfo = PROVIDERS[provider];
        await api.sendMessage({
            msg: `🔀 Provider của nhóm này:\n• ${provInfo?.label || provider}\n• Model: ${model}`,
        }, threadId, threadType);
    },
};
