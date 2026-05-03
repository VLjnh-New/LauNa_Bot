import axios from 'axios';

const NCT_GRAPH_URL = 'https://graph.nhaccuatui.com/api/v3';

const FALLBACK_TOKEN = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJkdCI6IjE3NzE5Mjk5MjQwODUiLCJuYmYiOjE3NzE5Mjk5MjQsImxvZ2luTWV0aG9kIjoiNSIsImV4cGlyZWREYXRlIjoiMCIsImV4cCI6MTgwMzQ2NTkyNCwiZGV2aWNlaW5mbyI6IntcIkFkSURcIjpcIlwiLFwiQXBwTmFtZVwiOlwiV0VCXCIsXCJBcHBWZXJzaW9uXCI6XCIxXCIsXCJEZXZpY2VJRFwiOlwiZWEzZDQ4NGE2ODRkOTQ4OFwiLFwiRGV2aWNlTmFtZVwiOlwiXCIsXCJOZXR3b3JrXCI6XCJcIixcIk9zTmFtZVwiOlwiV0VCXCIsXCJPc1ZlcnNpb25cIjpcIldFQlwiLFwiUHJvdmlkZXJcIjpcIk5DVENvcnBcIixcIlVzZXJOYW1lXCI6XCJcIixcImlzVk5cIjpmYWxzZX0iLCJidmVkIjoiMCIsImRldmljZUlkIjoiZWEzZDQ4NGE2ODRkOTQ4OCIsImlhdCI6MTc3MTkyOTkyNCwidXQiOiIwIn0.667PW_WIX_hDh6qt-49KenVN-jfuMFTxI3qtdpaPkX8';
const FALLBACK_DEVICE_ID = 'ea3d484a684d9488';

let cachedToken = FALLBACK_TOKEN;
let cachedDeviceId = FALLBACK_DEVICE_ID;
let tokenExpiry = 1803465924 * 1000;

/**
 * Tạo deviceId ngẫu nhiên 16 ký tự hex
 */
function randomDeviceId() {
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}

/**
 * Parse JWT payload mà không cần thư viện
 */
function parseJwtExpiry(token) {
    try {
        const payload = token.split('.')[1];
        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
        return decoded.exp ? decoded.exp * 1000 : 0;
    } catch {
        return 0;
    }
}

/**
 * Tự động lấy token guest từ NhacCuaTui
 */
async function refreshNCTToken() {
    if (cachedToken && Date.now() < tokenExpiry - 24 * 60 * 60 * 1000) return;

    const deviceId = randomDeviceId();
    const deviceInfo = JSON.stringify({
        AdID: "", AppName: "WEB", AppVersion: "1", DeviceID: deviceId,
        DeviceName: "", Network: "", OsName: "WEB", OsVersion: "WEB",
        Provider: "NCTCorp", UserName: "", isVN: false
    });

    const endpoints = [
        {
            method: 'POST',
            url: 'https://graph.nhaccuatui.com/api/v3/users/login/anonymous',
            data: { deviceId, deviceInfo }
        },
        {
            method: 'POST',
            url: 'https://graph.nhaccuatui.com/api/v3/auth/anonymous',
            data: { deviceId, deviceInfo }
        },
        {
            method: 'POST',
            url: 'https://graph.nhaccuatui.com/api/v3/users/register',
            data: { deviceId, loginMethod: 5, deviceInfo }
        }
    ];

    for (const ep of endpoints) {
        try {
            const res = await axios({
                method: ep.method,
                url: ep.url,
                data: ep.data,
                headers: {
                    'content-type': 'application/json',
                    'origin': 'https://www.nhaccuatui.com',
                    'referer': 'https://www.nhaccuatui.com/',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                    'x-nct-appid': '6',
                    'x-nct-deviceid': deviceId,
                    'x-nct-os': 'web',
                    'x-nct-version': '1',
                    'x-nct-time': Date.now().toString()
                },
                timeout: 8000
            });

            const token = res.data?.data?.token || res.data?.token || res.data?.data?.accessToken;
            if (token) {
                cachedToken = token;
                cachedDeviceId = deviceId;
                tokenExpiry = parseJwtExpiry(token) || (Date.now() + 365 * 24 * 60 * 60 * 1000);
                return;
            }
        } catch {
            // Thử endpoint tiếp theo
        }
    }
}

function buildHeaders(overrides = {}) {
    const timestamp = Date.now();
    return {
        'accept': '*/*',
        'accept-encoding': 'gzip, deflate, br, zstd',
        'accept-language': 'en-US,en;q=0.9,vi;q=0.8',
        'authorization': cachedToken,
        'content-type': 'application/json',
        'origin': 'https://www.nhaccuatui.com',
        'referer': 'https://www.nhaccuatui.com/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'x-nct-appid': '6',
        'x-nct-deviceid': cachedDeviceId,
        'x-nct-language': 'en',
        'x-nct-os': 'web',
        'x-nct-time': timestamp.toString(),
        'x-nct-token': cachedToken,
        'x-nct-userid': '0',
        'x-nct-uuid': cachedDeviceId,
        'x-nct-version': '1',
        'x-sign': '0c1b209345155f5554822b01a6000f1488',
        ...overrides
    };
}

export async function searchNCT(query) {
    await refreshNCTToken();
    const timestamp = Date.now();
    try {
        const response = await axios.post(`${NCT_GRAPH_URL}/search/all`,
            {
                keyword: query,
                pageindex: 1,
                pagesize: 30,
                isShowLoading: true
            },
            {
                params: {
                    keyword: query,
                    correct: 'true',
                    timestamp: timestamp
                },
                headers: buildHeaders({ timestamp: timestamp.toString() })
            }
        );

        const songs = response.data?.data?.songs;
        if (songs && songs.length > 0) {
            return songs.filter(s => s.name && s.streamURL);
        } else {
            throw new Error(`Không tìm thấy kết quả cho từ khóa: "${query}".`);
        }
    } catch (e) {
        if (e.response?.status === 401 || e.response?.status === 403) {
            cachedToken = FALLBACK_TOKEN;
            cachedDeviceId = FALLBACK_DEVICE_ID;
            tokenExpiry = 0;
        }
        throw new Error(`Lỗi NCT Search API: ${e.response?.data?.message || e.message}`);
    }
}

/**
 * Lấy thông tin bài hát qua API V1
 */
export async function getSongInfoV1(songKey) {
    await refreshNCTToken();
    const timestamp = Date.now();
    try {
        const response = await axios.get(`https://graph.nhaccuatui.com/api/v1/songs/${songKey}`, {
            params: { timestamp },
            headers: buildHeaders({ 'x-sign': '785757628d9834307e56b058390f09de667' })
        });
        return response.data?.data;
    } catch (e) {
        return null;
    }
}

/**
 * Lấy các bài hát tương tự
 */
export async function getSimilarSongs(songKey) {
    await refreshNCTToken();
    const timestamp = Date.now();
    try {
        const response = await axios.get(`https://graph.nhaccuatui.com/api/v1/song/similar/${songKey}`, {
            params: {
                key: songKey,
                rn: 20,
                timestamp: timestamp
            },
            headers: buildHeaders({ 'x-sign': '785757628d9834307e56b058390f09de667' })
        });
        return response.data?.data?.list || [];
    } catch (e) {
        return [];
    }
}

export default { searchNCT, getSongInfoV1, getSimilarSongs };
