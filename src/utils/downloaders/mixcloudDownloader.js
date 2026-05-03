import axios from "axios";
import http from 'http';
import https from 'https';

const XOR_KEY = "IFYOUWANTTHEARTISTSTOGETPAIDDONOTDOWNLOADFROMMIXCLOUD";

const xorDecrypt = (cipher) => {
    try {
        if (!cipher) return null;
        const data = Buffer.from(cipher, 'base64');
        return Array.from(data).map((b, i) => String.fromCharCode(b ^ XOR_KEY.charCodeAt(i % XOR_KEY.length))).join('');
    } catch { return null; }
};

const axiosInstance = axios.create({
    httpAgent: new http.Agent({ keepAlive: false }),
    httpsAgent: new https.Agent({ keepAlive: false })
});

const gql = (query, variables) => axiosInstance.post("https://app.mixcloud.com/graphql",
    { query, variables },
    {
        headers: {
            'content-type': 'application/json',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
            'origin': 'https://www.mixcloud.com',
            'referer': 'https://www.mixcloud.com/',
            'x-mixcloud-client-version': 'e2a7e6d33e00252014cbbd99294f9caab2325e6d',
            'x-mixcloud-platform': 'www',
            'Connection': 'close'
        },
        timeout: 10000
    }
);

export async function downloadMixcloud(inputUrl) {
    try {
        let path = inputUrl.split('?')[0].replace(/https?:\/\/www\.mixcloud\.com/, "").replace(/\/$/, "");
        if (!path.startsWith("/")) path = "/" + path;

        const parts = path.split('/').filter(Boolean);
        if (parts.length < 2) return { error: "Link không hợp lệ (Cần cả tên người dùng và tên bài)." };

        let username = parts[0];
        let slug = parts[1];

        const mainQuery = `query GetMixFull($l: CloudcastLookup!) {
          cloudcastLookup(lookup: $l) {
            ... on Cloudcast {
              id name audioLength isExclusive
              owner { displayName username }
              picture { urlRoot }
              streamInfo(timestamper: false) { url hlsUrl }
            }
          }
        }`;

        let cc = null;
        const tries = [
            { u: username, s: slug },
            { u: decodeURIComponent(username), s: decodeURIComponent(slug) }
        ];

        for (const t of tries) {
            try {
                const resp = await gql(mainQuery, { l: { username: t.u, slug: t.s } });
                cc = resp?.data?.data?.cloudcastLookup;
                if (cc) break;
            } catch { }
        }

        if (!cc) {
            try {
                const rest = await axiosInstance.get(`https://api.mixcloud.com/${username}/${slug}/`, {
                    timeout: 8000,
                    headers: {
                        'Connection': 'close',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
                    }
                });
                if (rest.data?.key) {
                    const p = rest.data.key.split('/').filter(Boolean);
                    if (p.length >= 2) {
                        const resp = await gql(mainQuery, { l: { username: p[0], slug: p[1] } });
                        cc = resp?.data?.data?.cloudcastLookup;
                    }
                }
            } catch { }
        }

        if (!cc) {
            return { error: "Không tìm thấy thông tin bài hát trên Mixcloud. Có thể link đã bị xóa." };
        }

        const rawUrl = cc.streamInfo?.url || cc.streamInfo?.hlsUrl;
        if (!rawUrl) {
            return {
                error: (cc.isExclusive)
                    ? "Bản mix này thuộc hàng độc quyền (Mixcloud Select), không thể tải."
                    : "Lỗi bản quyền Mixcloud, không có link stream."
            };
        }

        return {
            title: cc.name,
            author: cc.owner?.displayName || cc.owner?.username,
            duration: cc.audioLength,
            streamUrl: xorDecrypt(rawUrl),
            hlsUrl: xorDecrypt(cc.streamInfo?.hlsUrl),
            thumb: cc.picture?.urlRoot ? `https://thumbnail.mixcloud.com/600x600/${cc.picture.urlRoot}` : null,
        };
    } catch (e) {
        return { error: `Lỗi bất ngờ: ${e.message}` };
    }
}

export async function searchMixcloud(term, limit = 10) {
    try {
        const resp = await axiosInstance.get("https://api.mixcloud.com/search/", {
            params: { q: term, type: "cloudcast", limit },
            timeout: 10000,
            headers: {
                'Connection': 'close',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
            }
        });
        return (resp.data?.data || []).map(item => ({
            name: item.name,
            url: item.key || item.url?.replace("https://www.mixcloud.com", ""),
            author: item.user?.name,
            duration: item.audio_length,
            thumb: item.pictures?.extra_large || item.pictures?.large || null,
        })).filter(r => r.name);
    } catch (e) {
        return null;
    }
}
