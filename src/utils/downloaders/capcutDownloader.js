import axios from "axios";
import * as cheerio from "cheerio";
import JSONBigInit from "json-bigint";
import { getMobileUA, getDesktopUA } from "../core/userAgents.js";
const JSONBig = JSONBigInit({ storeAsString: true });

/**
 * CapCut Downloader using ssscap.net (V1)
 */
export async function downloadCapCutV1(url) {
    try {
        let results = {
            id: '',
            message: '',
            usage: '',
            attachments: []
        };
        const getUrlResponse = await axios.get(`https://ssscap.net/api/download/get-url?url=${url}`);
        if (!getUrlResponse.data || !getUrlResponse.data.url) return null;

        const videoId = getUrlResponse.data.url.split("/")[4].split("?")[0];
        const options = {
            method: 'GET',
            url: `https://ssscap.net/api/download/${videoId}`,
            headers: {
                'Connection': 'keep-alive',
                'User-Agent': getDesktopUA(),
                'Cookie': 'sign=08321c1cc11dbdd2d6e3c63f44248dcf; device-time=1699454542608',
                'Referer': 'https://ssscap.net/vi',
                'Host': 'ssscap.net',
                'Accept-Language': 'vi-VN,vi;q=0.9',
                'Accept': 'application/json, text/plain, */*',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Site': 'same-origin',
                'Sec-Fetch-Mode': 'cors'
            }
        };
        const response = await axios.request(options);
        const { title, description, usage, originalVideoUrl } = response.data;
        if (!originalVideoUrl) return null;

        const base64String = originalVideoUrl.replace("/api/cdn/", "");
        const buffer = Buffer.from(base64String, 'base64');
        const decodedString = buffer.toString('utf-8');

        results.id = videoId;
        results.message = `${title || ""} - ${description || ""}`.trim();
        results.usage = usage;
        results.attachments.push({
            type: "video",
            url: decodedString,
        });
        return results;
    } catch (error) {
        console.error('Error occurred in CapCut V1:', error.message);
        return null;
    }
}

/**
 * CapCut Downloader using direct API (V2)
 */
export async function downloadCapCutV2(url) {
    const randomIP = () => `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;

    const headersss = () => ({
        "User-Agent": getMobileUA(),
        "X-Forwarded-For": randomIP(),
    });

    const extractLinks = (text) => {
        const regex = /(https:\/\/www.capcut.com\/t\/[a-zA-Z0-9_-]+)|(https:\/\/www.capcut.com\/tv2\/[a-zA-Z0-9_-]+)|(https:\/\/www.capcut.com\/template-detail\/[a-zA-Z0-9_-]+)/g;
        const matches = text.match(regex);
        return matches ? matches[0] : null;
    };

    const link = extractLinks(url) || url;
    if (!link) return null;

    try {
        let videoId = null;
        if (link.match(/\d+$/) && !link.includes("/t/") && !link.includes("/tv2/")) {
            // If it's just an ID or template-detail with ID at end
            videoId = link.match(/\d+$/)[0];
        }

        if (!videoId) {
            try {
                const a = await axios.get(`https://ssscap.net/api/download/get-url?url=${link}`, { timeout: 10000 });
                if (a.data && a.data.url) {
                    videoId = a.data.url.split("/")[4].split("?")[0];
                }
            } catch (e) {
            }
        }

        if (!videoId) {
            // Manual resolution
            const resp = await axios.get(link, {
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400,
                headers: {
                    'User-Agent': getMobileUA()
                }
            });
            const location = resp.headers.location;
            if (location) {
                const idMatch = location.match(/template-detail\/(\d+)/) || location.match(/template\/(\d+)/) || location.match(/template_id=(\d+)/);
                if (idMatch) videoId = idMatch[1];
            }
        }

        if (!videoId) return null;

        const headers = {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'vi,en;q=0.9',
            'App-Sdk-Version': '48.0.0',
            'Appvr': '5.8.0',
            'Content-Type': 'application/json',
            'Cookie': 'passport_csrf_token=fea6749fed6008d79372ea4131efb483; passport_csrf_token_default=fea6749fed6008d79372ea4131efb483; passport_auth_status=6f01e86273e10de44e9a2ea3891f1a25%2C; passport_auth_status_ss=6f01e86273e10de44e9a2ea3891f1a25%2C; sid_guard=8437e2a5e8f43d0bcc46bf26aa479ae5%7C1717844956%7C34560000%7CSun%2C+13-Jul-2025+11%3A09%3A16+GMT; uid_tt=e34ead5d420362c0e3d71761308ff9c74276f6e50a2a774c217bcf2320b46658; uid_tt_ss=e34ead5d420362c0e3d71761308ff9c74276f6e50a2a774c217bcf2320b46658; sid_tt=8437e2a5e8f43d0bcc46bf26aa479ae5; sessionid=8437e2a5e8f43d0bcc46bf26aa479ae5; sessionid_ss=8437e2a5e8f43d0bcc46bf26aa479ae5; sid_ucp_v1=1.0.0-KGI2YTQ3YzBhMjZlNWQ1NGYwZjhmZThlNTdlNzQ3NzgxOGFlMGE0MzEKIAiCiIqEifaqymUQ3PeQswYYnKAVIAww29fSrAY4CEASEAMaA3NnMSIgODQzN2UyYTVlOGY0M2QwYmNjNDZiZjI2YWE0NzlhZTU; ssid_ucp_v1=1.0.0-KGI2YTQ3YzBhMjZlNWQ1NGYwZjhmZThlNTdlNzQ3NzgxOGFlMGE0MzEKIAiCiIqEifaqymUQ3PeQswYYnKAVIAww29fSrAY4CEASEAMaA3NnMSIgODQzN2UyYTVlOGY0M2QwYmNjNDZiZjI2YWE0NzlhZTU; store-idc=alisg; store-country-code=vn; store-country-code-src=uid; _clck=gewwr2%7C2%7Cfmg%7C0%7C1620; _clsk=1auat5k%7C1717845282705%7C5%7C0%7Ct.clarity.ms%2Fcollect; ttwid=1|lzYqbBKYnM2qubxO7orNtAxCXMz3BbnaAMgB-zy4ICY|1717845379|b03fb4bf974d1ec2f5f2cee73c42e6c4d800e57e63795cf2db298385b1742fc5; _uetsid=8d048170258711efb10015e2f330cee7; _uetvid=8d04cee0258711ef8d278993f44c7fbe; odin_tt=f9c81c0021bbd9d87817b4d8a50057bedd96b05b1f1d892df0ac5f9cf669290204dc406ea997bb85e51d6160f3b1ad589361574345e9833327b0ad4f15d5d18f; msToken=yLylj1zd1B0_KRakyX66qTDGIyY6skmEN5KS3Imyn4J8gyKnfOMf7QBg1qaJKOkPzq0xl_OYAU2PvcikPI0-6KOCLxLX_jmrzJOZQ2sUdwCmtaFNk172h79rmfnlqIK0jwe4EA==',
            'Device-Time': '1717845388',
            'Lan': 'vi-VN',
            'Loc': 'va',
            'Origin': 'https://www.capcut.com',
            'Pf': '7',
            'Priority': 'u=1, i',
            'Referer': 'https://www.capcut.com/',
            'Sec-Ch-Ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-site',
            'Sign': '2cd3272c536081caeafe7c07949d023d',
            'Sign-Ver': '1',
            'Tdid': '',
            ...headersss(),
        };
        const data = {
            sdk_version: "86.0.0",
            biz_id: null,
            id: [videoId],
            enter_from: "",
            cc_web_version: 0
        };
        const response = await axios.post(`https://edit-api-sg.capcut.com/lv/v1/cc_web/replicate/multi_get_templates`, data, {
            headers,
            transformResponse: [data => data]
        });
        const parsed = JSONBig.parse(response.data);
        const templates = parsed.data?.templates || parsed.data?.video_templates || [];

        if (templates.length === 0) {
            return null;
        }

        const template = templates[0];
        return {
            id: template.web_id,
            title: template.title,
            short_title: template.short_title,
            duration: template.duration,
            fragment_count: template.fragment_count,
            usage_amount: template.usage_amount,
            play_amount: template.play_amount,
            favorite_count: template.favorite_count,
            like_count: template.like_count,
            comment_count: template.interaction?.comment_count,
            create_time: template.create_time,
            author: {
                unique_id: template.author.unique_id,
                name: template.author.name
            },
            videoUrl: template.video_url
        };
    } catch (error) {
        console.error('Error occurred in CapCut V2:', error.message);
        return null;
    }
}

/**
 * CapCut Downloader using Scraping (V3)
 */
export async function downloadCapCutV3(url) {
    try {
        // Resolve URL first if needed
        let targetUrl = url;
        if (url.includes("/t/") || url.includes("/tv2/")) {
            const resp = await axios.get(url, {
                maxRedirects: 0,
                validateStatus: (status) => status >= 200 && status < 400,
                headers: {
                    'User-Agent': getDesktopUA()
                }
            });
            if (resp.headers.location) targetUrl = resp.headers.location;
        }

        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': getDesktopUA()
            }
        });
        const $ = cheerio.load(response.data);

        // Try the user's selector
        let videoUrl = $('.player-o3g3Ag').attr('src');

        // Fallback: look for video_url in __NEXT_DATA__
        if (!videoUrl) {
            const nextDataMatch = response.data.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
            if (nextDataMatch) {
                const nextData = JSONBig.parse(nextDataMatch[1]);
                videoUrl = nextData.props?.pageProps?.templateDetail?.video_url;
            }
        }

        if (!videoUrl) throw new Error('Video URL not found');

        return {
            videoUrl,
            title: $('.template-title').text().trim() || "CapCut Video",
            author: { name: $('.author-name').text().trim() || "Unknown" }
        };

    } catch (error) {
        console.error('Error fetching CapCut V3:', error.message);
        return null;
    }
}

export async function searchCapCut(keyword) {
    if (!keyword) return null;
    const options = {
        method: 'POST',
        url: 'https://edit-api-sg.capcut.com/lv/v1/cc_web/replicate/search_templates',
        transformResponse: [data => data], // Giữ data dạng String để JSONBig parse
        headers: {
            'Host': 'edit-api-sg.capcut.com',
            'Content-Type': 'application/json',
            'accept-language': 'vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5',
            'app-sdk-version': '48.0.0',
            'appvr': '5.8.0',
            'cookie': '_ga=GA1.1.382841626.1704093538; _clck=udqiju%7C2%7Cfi1%7C0%7C1461; passport_csrf_token=01a7a2ffdee0c9c90c25c96c74c3c30a; passport_csrf_token_default=01a7a2ffdee0c9c90c25c96c74c3c30a; passport_auth_status=fa3fafccdbf54b72a5ae969153a8367c%2C; passport_auth_status_ss=fa3fafccdbf54b72a5ae969153a8367c%2C; sid_guard=d7a0d457a8ccbd28c80d9eb4c9da3a45%7C1704093581%7C34560000%7CTue%2C+04-Feb-2025+07%3A19%3A41+GMT; uid_tt=2911adf660e32d4908db5d59a794e00a60aafee969aff391ec0b4538fe56b680; uid_tt_ss=2911adf660e32d4908db5d59a794e00a60aafee969aff391ec0b4538fe56b680; sid_tt=d7a0d457a8ccbd28c80d9eb4c9da3a45; sessionid=d7a0d457a8ccbd28c80d9eb4c9da3a45; sessionid_ss=d7a0d457a8ccbd28c80d9eb4c9da3a45; sid_ucp_v1=1.0.0-KGMwZGQ2ZDc2YzQzNzBlZjNhYThmNWFjNGFlMGVmYzY5ODNiOTA2OGEKIAiCiK_K0u2ZyWUQjc_JrAYYnKAVIAwwjc_JrAY4CEASEAMaA3NnMSIgZDdhMGQ0NTdhOGNjYmQyOGM4MGQ5ZWI0YzlkYTNhNDU; ssid_ucp_v1=1.0.0-KGMwZGQ2ZDc2YzQzNzBlZjNhYThmNWFjNGFlMGVmYzY5ODNiOTA2OGEKIAiCiK_K0u2ZyWUQjc_JrAYYnKAVIAwwjc_JrAY4CEASEAMaA3NnMSIgZDdhMGQ0NTdhOGNjYmQyOGM4MGQ5ZWI0YzlkYTNhNDU; store-idc=alisg; store-country-code=vn; store-country-code-src=uid; odin_tt=f0f86a4fba8632aac92b736a20a51eea7b68464e0e6e8f36504001c2863c987d35e356093ad7c65cc41c4ee3d011a08d37b531eec47f6ada19a8bd0780acccd0; csrf_session_id=a837de9ddb8e5a4e263bad23c1453480; ttwid=1|2P_Y7hiaQHOgRN2dfMNzFES4MewtjPWkZKughSH8Sjs|1704116592|c038d929f11a4ce2bc34850c5e38f5957b008cbef30e5103a2fbef9cceb27f05; _uetsid=0830e720a87611ee9d58776762c93b1d; _uetvid=08345970a87611eebf7e650c56cc879e; _ga_F9J0QP63RB=GS1.1.1704116587.7.1.1704116598.0.0.0; _clsk=jq6pma%7C1704116600519%7C1%7C0%7Cy.clarity.ms%2Fcollect; msToken=sj6PJlGDkuSAJAkgVRcGlc_divtmWrAboGYd-zzn3ZN1O-rAksovTw4JTyBiNyvDLgpsAyIuAuQo8pZwpv2PhhBQqhMm9Bm3q3j0Mqt8NTLo',
            'device-time': '1704116611',
            'lan': 'vi-VN',
            'loc': 'va',
            'origin': 'https://www.capcut.com',
            'pf': '7',
            'referer': 'https://www.capcut.com/',
            'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-site',
            'sign': '6edde988911c68544a053e83f0e3b814',
            'sign-ver': '1',
            'user-agent': getDesktopUA()
        },
        data: JSON.stringify({
            'sdk_version': '86.0.0',
            'count': 20,
            'cursor': '0',
            'enter_from': 'workspace',
            'query': keyword,
            'scene': 1,
            'search_version': 2,
            'cc_web_version': 1
        })
    };

    try {
        const response = await axios.request(options);
        const parsed = JSONBig.parse(response.data);
        return parsed.data;
    } catch (error) {
        console.error('Error in CapCut search:', error.message);
        return null;
    }
}

