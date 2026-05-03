import axios from 'axios';
import { URLSearchParams } from 'url';

const SOUNDCLOUD_API_URL = 'https://api-v2.soundcloud.com';
const SEARCH_ENDPOINT = '/search';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Origin': 'https://soundcloud.com',
    'Referer': 'https://soundcloud.com/'
};

const COMMON_HEADERS = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
    'Origin': 'https://soundcloud.com',
    'Referer': 'https://soundcloud.com/',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'Host': 'api-v2.soundcloud.com',
    'Connection': 'keep-alive',
};

const FALLBACK_CLIENT_ID = '1IzwHiVxAHeYKAMqN0IIGD3ZARgJy2kl';
const CLIENT_ID_TTL = 30 * 60 * 1000;

let cachedClientId = null;
let clientIdFetchedAt = 0;

/**
 * Tự động lấy client_id từ SoundCloud website, cache 30 phút
 */
async function getClientID() {
    const now = Date.now();
    if (cachedClientId && now - clientIdFetchedAt < CLIENT_ID_TTL) {
        return cachedClientId;
    }
    try {
        const { data } = await axios.get('https://soundcloud.com/', { headers: HEADERS, timeout: 8000 });
        const splitted = data.split('<script crossorigin src="');
        const urls = [];
        splitted.forEach((r) => {
            if (r.startsWith('https')) {
                urls.push(r.split('"')[0]);
            }
        });
        if (urls.length === 0) throw new Error('Không tìm thấy script URL');
        const data2 = await axios.get(urls[urls.length - 1], { timeout: 8000 });
        const id = data2.data.split(',client_id:"')[1]?.split('"')[0];
        if (!id) throw new Error('Không parse được client_id');
        cachedClientId = id;
        clientIdFetchedAt = now;
        return cachedClientId;
    } catch (e) {
        cachedClientId = FALLBACK_CLIENT_ID;
        clientIdFetchedAt = now;
        return cachedClientId;
    }
}

function getBaseParams(clientId) {
    return {
        'client_id': clientId,
        'sc_a_id': '3c8801881e57e06df7d672272c5a04b9e0edec39',
        'facet': 'model',
        'user_id': '64639-829169-591460-315397',
        'limit': 10,
        'offset': 0,
        'linked_partitioning': 1,
        'app_version': 1763043258,
        'app_locale': 'en'
    };
}

export async function search(query) {
    const clientId = await getClientID();
    const params = getBaseParams(clientId);
    params.q = query;
    const searchUrl = `${SOUNDCLOUD_API_URL}${SEARCH_ENDPOINT}?${new URLSearchParams(params).toString()}`;

    try {
        const response = await axios.get(searchUrl, { headers: COMMON_HEADERS });
        if (response.data?.collection?.length > 0) {
            return response.data.collection;
        } else {
            throw new Error(`Không tìm thấy kết quả cho từ khóa: "${query}".`);
        }
    } catch (e) {
        if (e.response && (e.response.status === 401 || e.response.status === 403)) {
            cachedClientId = null;
            throw new Error("Lỗi Authorization: Client ID đã hết hạn, sẽ tự làm mới lần sau.");
        }
        throw new Error(`Lỗi SoundCloud API: ${e.response?.status || e.message}`);
    }
}

export async function download(link) {
    try {
        const formatNumber = (num) => num ? num.toLocaleString('de-DE') : 0;
        const conMs = ms => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

        const clientId = await getClientID();
        let finalLink = link;

        if (link.includes('on.soundcloud.com')) {
            const redirectRes = await axios.get(link, { headers: HEADERS });
            finalLink = redirectRes.request.res.responseUrl;
        }

        const cleanUrl = finalLink.replace("m.soundcloud.com", "soundcloud.com").split('?')[0];
        const { data } = await axios.get(`${SOUNDCLOUD_API_URL}/resolve?url=${encodeURIComponent(cleanUrl)}&client_id=${clientId}`, { headers: HEADERS });

        const progressiveUrl = data?.media?.transcodings?.find(t => t.format.protocol === 'progressive')?.url;
        if (!progressiveUrl) throw new Error('Không tìm thấy link tải (progressive)');

        const streamData = (await axios.get(`${progressiveUrl}?client_id=${clientId}&track_authorization=${data.track_authorization}`)).data;

        return {
            id: data.id,
            title: data.title,
            author: data.user.full_name || data.user.username,
            playback: formatNumber(data.playback_count),
            likes: formatNumber(data.likes_count),
            duration: conMs(data.duration),
            url: streamData.url
        };
    } catch (error) {
        throw new Error(`Lỗi tải nhạc: ${error.message}`);
    }
}

export default { search, download };
