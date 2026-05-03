import axios from "axios";
import CryptoJS from "crypto-js";
import { log } from "../../logger.js";

const BASE_URL = "https://zingmp3.vn";
const ZING_API_URL = "https://zingmp3.vn/api/v2";
const API_KEY = "X5BM3w8N7MKozC0B85o4KMlzLZKhV00y";
const SECRET_KEY = "acOrvUS15XRW2o9JksiK1KgQ6Vbds8ZW";
const VERSION = "1.13.12";

const HEADERS = {
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
    'referer': 'https://zingmp3.vn/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
};

const paramsAllow = ["ctime", "id", "type", "page", "count", "version"];

let cachedCookie = "";
let cookieExpiry = 0;
const COOKIE_TTL = 60 * 60 * 1000;

async function getCookie() {
    if (cachedCookie && Date.now() < cookieExpiry) return cachedCookie;
    cachedCookie = "";
    try {
        const res = await axios.get(BASE_URL, { headers: HEADERS, timeout: 5000 });
        const cookies = res.headers["set-cookie"];
        if (cookies && cookies.length > 0) {
            cachedCookie = cookies.map(c => c.split(';')[0]).join('; ');
            cookieExpiry = Date.now() + COOKIE_TTL;
        }
        return cachedCookie;
    } catch (e) {
        return "zpsid=;";
    }
}

function sha256(str) {
    return CryptoJS.SHA256(str).toString();
}

function hmac512(str, key) {
    return CryptoJS.HmacSHA512(str, key).toString();
}

function getSig(path, params) {
    const sortedKeys = Object.keys(params).sort();
    let strParams = "";
    for (const key of sortedKeys) {
        if (paramsAllow.includes(key) && params[key]) {
            strParams += `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`;
        }
    }

    const hash256 = sha256(strParams);
    return hmac512(path + hash256, SECRET_KEY);
}

/**
 * Tìm kiếm âm nhạc trên ZingMP3
 */
export async function searchZing(query) {
    const path = "/api/v2/search";
    const ctime = Math.floor(Date.now() / 1000).toString();
    const params = {
        q: query,
        type: "song",
        count: "10",
        ctime: ctime,
        version: VERSION,
        apiKey: API_KEY
    };
    const sig = getSig(path, params);
    const cookie = await getCookie();

    try {
        const response = await axios.get(BASE_URL + path, {
            params: { ...params, sig },
            headers: { ...HEADERS, Cookie: cookie }
        });

        if (response.data?.err !== 0) {
            log.error(`Zing API Search Error: ${response.data?.msg} (code: ${response.data?.err})`);
            return [];
        }

        const items = response.data?.data?.items || [];
        return items.map(i => ({
            ...i,
            encodeId: i.encodeId || i.id,
            artistsNames: i.artistsNames || i.artists?.map(a => a.name).join(", ") || "Unknown"
        }));
    } catch (e) {
        log.error("ZingMP3 Search Request Error:", e.message);
        return [];
    }
}

/**
 * Lấy link stream bài hát từ encodeId
 */
export async function getStreamZing(encodeId) {
    const path = "/api/v2/song/get/streaming";
    const ctime = Math.floor(Date.now() / 1000).toString();
    const params = {
        id: encodeId,
        ctime: ctime,
        version: VERSION,
        apiKey: API_KEY
    };
    const sig = getSig(path, params);
    const cookie = await getCookie();

    try {
        const response = await axios.get(BASE_URL + path, {
            params: { ...params, sig },
            headers: { ...HEADERS, Cookie: cookie }
        });
        return response.data?.data;
    } catch (e) {
        log.error("ZingMP3 Stream Error:", e.message);
        return null;
    }
}

/**
 * Lấy danh sách bài hát gợi ý (Recommend) dựa trên ID bài hát
 */
export async function getRecommendZing(id) {
    const path = "/api/v2/recommend/get/songs";
    const ctime = Math.floor(Date.now() / 1000).toString();
    const params = {
        id: id,
        ctime: ctime,
        version: VERSION,
        apiKey: API_KEY
    };
    const sig = getSig(path, params);
    const cookie = await getCookie();

    try {
        const response = await axios.get(BASE_URL + path, {
            params: { ...params, sig, historyIds: id, start: 0, count: 20 },
            headers: { ...HEADERS, Cookie: cookie }
        });
        return response.data?.data?.items || [];
    } catch (e) {
        log.error("ZingMP3 Recommend Error:", e.message);
        return [];
    }
}

/**
 * Lấy chi tiết playlist (danh sách bài hát) từ ID
 */
export async function getDetailPlaylist(id) {
    const path = "/api/v2/page/get/playlist";
    const ctime = Math.floor(Date.now() / 1000).toString();
    const params = {
        id: id,
        ctime: ctime,
        version: VERSION,
        apiKey: API_KEY
    };
    const sig = getSig(path, params);
    const cookie = await getCookie();

    try {
        const response = await axios.get(BASE_URL + path, {
            params: { ...params, sig },
            headers: { ...HEADERS, Cookie: cookie }
        });
        return response.data?.data;
    } catch (e) {
        log.error("ZingMP3 Playlist Error:", e.message);
        return null;
    }
}

/**
 * Lấy Bảng xếp hạng Zing Chart Realtime
 */
export async function getZingChart() {
    const path = "/api/v2/page/get/chart-home";
    const ctime = Math.floor(Date.now() / 1000).toString();
    const params = {
        ctime: ctime,
        version: VERSION,
        apiKey: API_KEY
    };
    const sig = getSig(path, params);
    const cookie = await getCookie();

    try {
        const response = await axios.get(BASE_URL + path, {
            params: { ...params, sig },
            headers: { ...HEADERS, Cookie: cookie }
        });
        return response.data?.data;
    } catch (e) {
        log.error("ZingMP3 Chart Error:", e.message);
        return null;
    }
}

export default { searchZing, getStreamZing, getRecommendZing, getDetailPlaylist, getZingChart };
