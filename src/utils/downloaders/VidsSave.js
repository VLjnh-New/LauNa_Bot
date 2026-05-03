import axios from "axios";
import { log } from "../../logger.js";
import { getDesktopUA } from "../core/userAgents.js";

const BASE = "https://api.vidssave.com/api/contentsite_api";
const AUTH = "20250901majwlqo";
const DOMAIN = "com.vidssave.com.web";
const REFERER = "https://vidssave.com/vi/home";
const ORIGIN = "https://vidssave.com";
const TIMEOUT = 45_000;

const http = axios.create({
    timeout: TIMEOUT,
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    validateStatus: () => true,
    headers: {
        "User-Agent": getDesktopUA(),
        "Accept": "application/json, text/plain, */*",
        "Origin": ORIGIN,
        "Referer": REFERER,
    },
});

function form(data = {}) {
    return new URLSearchParams({ auth: AUTH, domain: DOMAIN, ...data }).toString();
}

function asError(body, fallback) {
    if (!body) return fallback;
    if (typeof body === "string") return body.trim() || fallback;
    return body.msg || body.message || body.error || fallback;
}

function qualityNumber(quality = "") {
    const n = String(quality).match(/\d+/)?.[0];
    return n ? Number(n) : 0;
}

function normalizeResource(item = {}) {
    const type = String(item.type || "video").toLowerCase();
    const format = String(item.format || (type === "audio" ? "MP3" : "MP4")).toLowerCase();
    return {
        type,
        quality: item.quality || (type === "audio" ? "audio" : "default"),
        url: item.download_url || null,
        extension: format || (type === "audio" ? "mp3" : "mp4"),
        format: item.format || "",
        size: item.size || 0,
        resourceId: item.resource_id || null,
        resourceContent: item.resource_content || null,
        downloadMode: item.download_mode || null,
        hasAudio: item.has_audio ?? null,
        raw: item,
    };
}

function normalize(data = {}) {
    const resources = Array.isArray(data.resources) ? data.resources : [];
    return {
        source: "vidssave",
        id: data.id || null,
        title: data.title || "",
        author: "Unknown",
        thumbnail: data.thumbnail || null,
        duration: data.duration || 0,
        medias: resources.map(normalizeResource).filter(m => m.url || m.resourceContent),
        raw: data,
    };
}

export async function parse(link) {
    const url = String(link || "").trim();
    if (!url) throw new Error("URL rỗng");

    const res = await http.post(`${BASE}/media/parse`, form({ origin: "source", link: url }), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (res.status !== 200) throw new Error(`Vidssave HTTP ${res.status}`);
    if (!res.data || res.data.status !== 1 || !res.data.data) {
        throw new Error(asError(res.data, "Vidssave parse thất bại"));
    }

    const data = normalize(res.data.data);
    if (!data.medias.length) throw new Error("Vidssave không trả về media");
    return data;
}

export async function createDownloadTask(resourceContent) {
    const request = String(resourceContent || "").trim();
    if (!request) throw new Error("Thiếu resource_content");

    const res = await http.post(`${BASE}/media/download`, form({ request, no_encrypt: 1 }), {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (res.status !== 200) throw new Error(`Vidssave download HTTP ${res.status}`);
    if (!res.data || res.data.status !== 1 || !res.data.data?.task_id) {
        throw new Error(asError(res.data, "Vidssave không tạo được task tải"));
    }

    return res.data.data.task_id;
}

function parseSseBlock(block) {
    const event = block.match(/^event:\s*(.+)$/m)?.[1]?.trim() || "message";
    const lines = [...block.matchAll(/^data:\s*(.*)$/gm)].map(m => m[1]);
    const text = lines.join("\n").trim();
    if (!text) return { event, data: null };
    try {
        return { event, data: JSON.parse(text) };
    } catch {
        return { event, data: text };
    }
}

export async function queryDownloadLink(taskId, { timeout = 60_000 } = {}) {
    const task = String(taskId || "").trim();
    if (!task) throw new Error("Thiếu task_id");

    const params = new URLSearchParams({
        auth: AUTH,
        domain: DOMAIN,
        task_id: task,
        download_domain: "vidssave.com",
        origin: "content_site",
    });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
        const res = await fetch(`${BASE.replace("/api/", "/sse/")}/media/download_query?${params}`, {
            headers: {
                "User-Agent": getDesktopUA(),
                "Accept": "text/event-stream",
                "Origin": ORIGIN,
                "Referer": REFERER,
            },
            signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Vidssave SSE HTTP ${res.status}`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const blocks = buffer.split(/\n\n+/);
            buffer = blocks.pop() || "";

            for (const block of blocks) {
                const msg = parseSseBlock(block);
                if (msg.event === "success" && msg.data?.download_link) return msg.data.download_link;
                if (msg.event === "failed") throw new Error(asError(msg.data, "Vidssave tạo link tải thất bại"));
            }
        }

        throw new Error("Vidssave SSE kết thúc nhưng không có link tải");
    } catch (e) {
        if (e?.name === "AbortError") throw new Error("Vidssave tạo link tải quá thời gian chờ");
        throw e;
    } finally {
        clearTimeout(timer);
    }
}

export async function getDownloadLink(resourceContent, options = {}) {
    const taskId = await createDownloadTask(resourceContent);
    return queryDownloadLink(taskId, options);
}

export function pickBestVideo(medias = []) {
    return medias
        .filter(m => m.type === "video")
        .sort((a, b) => qualityNumber(b.quality) - qualityNumber(a.quality) || (b.size || 0) - (a.size || 0))[0] || null;
}

export function pickBestAudio(medias = []) {
    return medias
        .filter(m => m.type === "audio")
        .sort((a, b) => qualityNumber(b.quality) - qualityNumber(a.quality) || (b.size || 0) - (a.size || 0))[0] || null;
}

export async function downloadAll(link, { resolveLinks = true, resolveLimit = Infinity, timeout = 60_000 } = {}) {
    try {
        const data = await parse(link);
        if (resolveLinks) {
            const targets = data.medias
                .filter(m => !m.url && m.resourceContent)
                .slice(0, resolveLimit === Infinity ? data.medias.length : (resolveLimit || data.medias.length));
            for (const media of targets) {
                try {
                    media.url = await getDownloadLink(media.resourceContent, { timeout });
                } catch (e) {
                    log.warn(`[VIDSSAVE] Không lấy được link cho ${media.type} ${media.quality || ""}: ${e.message}`);
                }
            }
        }
        return data;
    } catch (e) {
        log.error(`[VIDSSAVE] downloadAll lỗi: ${e?.message || String(e)}`);
        return { error: true, message: e?.message || String(e) };
    }
}

export default { parse, createDownloadTask, queryDownloadLink, getDownloadLink, downloadAll, pickBestVideo, pickBestAudio };
