import axios from "axios";
import fs from "node:fs";
import sizeOf from "image-size";
import path from "node:path";
import { uploadToFileIo } from "./fileio.js";
import { getDesktopUA } from "./userAgents.js";

export async function uploadTempFile(filePath) {
    return uploadToFileIo(filePath);
}

export const uploadToCatbox = uploadTempFile;

export async function downloadFile(url, dest, headers = {}) {
    try {
        const response = await axios({
            url,
            method: 'GET',
            responseType: 'stream',
            headers: {
                "user-agent": getDesktopUA(),
                ...headers
            }
        });
        const writer = fs.createWriteStream(dest);
        response.data.pipe(writer);
        return new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
    } catch (e) {
        console.error("Lỗi downloadFile:", e.message);
        throw e;
    }
}

export function deleteFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            return true;
        }
    } catch (e) {
        console.error("Lỗi deleteFile:", e.message);
    }
    return false;
}

export async function getImageInfo(url) {
    const tempPath = path.join(process.cwd(), "temp", `img_${Date.now()}.jpg`);
    try {
        await downloadFile(url, tempPath);
        const dimensions = sizeOf(tempPath);
        const stats = fs.statSync(tempPath);
        return {
            width: dimensions.width,
            height: dimensions.height,
            totalSize: stats.size
        };
    } catch (e) {
        console.error("Lỗi getImageInfo:", e.message);
        return null;
    } finally {
        deleteFile(tempPath);
    }
}

export async function checkExstentionFileRemote(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const ext = pathname.split('.').pop();
        return ext || "bin";
    } catch (e) {
        return "bin";
    }
}
export async function fetchTikTokUserVideos(secUid, uniqueId = null, cursor = 0, count = 10) {
    try {
        const params = {
            WebIdLastTime: "1747474501",
            aid: "1988",
            app_language: "en",
            app_name: "tiktok_web",
            browser_language: "en-US",
            browser_name: "Mozilla",
            browser_online: "true",
            browser_platform: "Win32",
            browser_version: "5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
            channel: "tiktok_web",
            clientABVersions: "70508271,72437276,73720540,75004379,75077940,75163115,75182840,75204946,75294819,75308230,75331216,75381397,75388126,75436983,75440143,75440607,75492090,75528340,75580041,75583894,75604573,75611598,75615158,75616570,75635434,75636449,75637792,75662097,75665224,75667003,75669899,75675273,75677772,75694121,75694602,75704990,75709820,75710567,75719512,75744128,70138197,70156809,70405643,71057832,71200802,71381811,71516509,71803300,71962127,72360691,72408100,72854054,72892778,73004916,73171280,73208420,73952802,73952825,73989921,74276218,74844724,75330961",
            cookie_enabled: "true",
            count: count,
            coverFormat: "2",
            cursor: cursor,
            data_collection_enabled: "true",
            device_id: "7505345809991910930",
            device_platform: "web_pc",
            enable_cache: "false",
            focus_state: "true",
            from_page: "search",
            history_len: "3",
            is_fullscreen: "false",
            is_page_visible: "true",
            language: "en",
            needPinnedItemIds: "false",
            odinId: "7272359542775759880",
            os: "windows",
            post_item_list_request_type: "0",
            priority_region: "VN",
            referer: "https://www.tiktok.com/",
            region: "VN",
            root_referer: "https://www.tiktok.com/",
            screen_height: "1080",
            screen_width: "1920",
            secUid: secUid,
            tz_name: "Asia/Saigon",
            user_is_login: "true",
            verifyFp: "verify_mn20yion_rviWJNYw_kgW3_4xku_BPId_ggvPSMEYwyVA",
            video_encoding: "dash",
            webcast_language: "en",
            msToken: "Z7NcIxoVZUs9H3DFq9Xmb6mVBW2K7G40nESJKpiXV0NJ1PkjbPg1OhbpU4uppFe8xeIQnqlsrpIRcmAYGNCX-dHnM0WIBjpM8ibyssZCyQzEtKXbMKxcGomEMhkHPeBznto-uH5OoerW4W0rfR0ZpSUwrw==",
            "X-Bogus": "DFSzsIVLf/GANJ6MCq3OqW6-55y6",
            "X-Gnarly": "McX1CY1B9572hR8prSBAttemys4Luy2XWMIky564dmo5V6eC9DYs53t1CmstirELTeoduw4O89ldyHNFzNGnAgoJ6wyNiWiu0NgljCkI7q2JE9hKdvanqwpOcoaTEfnYLCxktUgFYYpZK78-s5KF10PlYgL0hSQBVz8ze9d/XjRbh-X1mbqrs2lW7JDoI96WePf8RMn0UFE3BrqQ4w2okYgfbvoMM-oA3Xomhz5C9E9rVeKEa04G5oKr5naoEEwAWpfvKXGAX72j3Gat4-Yy5GcJAkEgbvQYYF0k7Wt7otmMgASiI5YBfFROB/LpqzfOOwG="
        };
        const headers = {
            "user-agent": getDesktopUA(),
            "referer": "https://www.tiktok.com/",
            "cookie": TT_COOKIE
        };

        const targetUrl = `https://www.tiktok.com/api/post/item_list/?${new URLSearchParams(params).toString()}`;

        let response = await axios.get(targetUrl, { headers }).catch(() => null);

        if (!response || !response.data || !response.data.itemList || response.data.itemList.length === 0) {
            const mirrors = ["www.tikwm.com", "tikwm.site", "tikwm.fit"];
            let tikwmData = null;

            for (const domain of mirrors) {
                try {
                    const tikwmRes = await axios.get(`https://${domain}/api/user/posts?sec_uid=${secUid}`).catch(() => null);
                    if (tikwmRes && tikwmRes.data && tikwmRes.data.code === 0 && tikwmRes.data.data.videos) {
                        tikwmData = tikwmRes.data.data;
                        break;
                    }
                } catch (e) {}
            }

            if (tikwmData) {
                return {
                    success: true,
                    videos: tikwmData.videos.map(v => ({
                        video_id: v.video_id,
                        title: v.title,
                        create_time: v.create_time,
                        duration: v.duration,
                        play: v.play,
                        cover: v.cover,
                        author: {
                            nickname: v.author?.nickname,
                            unique_id: v.author?.unique_id,
                            avatar: v.author?.avatar
                        },
                        stats: {
                            diggCount: v.digg_count,
                            commentCount: v.comment_count,
                            playCount: v.play_count
                        }
                    }))
                };
            }
            return { success: false, error: "No data found", raw: response?.data };
        }

        return {
            success: true,
            hasMore: response.data.hasMore,
            cursor: response.data.cursor,
            videos: response.data.itemList.map(item => ({
                video_id: item.id,
                title: item.desc,
                create_time: item.createTime,
                duration: item.video?.duration,
                play: item.video?.playAddr,
                cover: item.video?.cover,
                author: {
                    nickname: item.author?.nickname,
                    unique_id: item.author?.uniqueId,
                    sec_uid: item.author?.secUid,
                    avatar: item.author?.avatarThumb
                },
                stats: item.stats
            }))
        };
    } catch (e) {
        console.error("Lỗi fetchTikTokUserVideos:", e.message);
        return { success: false, error: e.message };
    }
}

const TT_COOKIE = "ttwid=1%7CqtHxKqvii5DYqvCIK1nu3spDQjd5LXRnfD5v-Rsibho%7C1774202284%7C72ffee323a52535471e3d307d3b41361b2952fd671c11cba7e87126dc5d15f96; odin_tt=b702bd27d0e92000b77a5734b49c935336218d85f7d8edd19be2a7ddd45669cdc20deefa4c88bd54500a4817b9a02665519bf5b25edd32b0c66603db2ed90954fe5702d8f1169654099bd2039e06a0c0; _ttp=2wFi2JNsA1b9Rlj3Y4mhcsnhlXP; sessionid=87e4ea1219fb32ff23f7a19e2ded79c8; tt_csrf_token=IZLKAlYW-oW_VgRl4qU0-8E0SnHRIK0VuEt4";
const TT_HEADERS = {
    "user-agent": getDesktopUA(),
    "referer": "https://www.tiktok.com/",
    "cookie": TT_COOKIE
};

async function resolveTikTokSecUid(username) {
    try {
        const url = `https://www.tiktok.com/api/user/detail/?uniqueId=${encodeURIComponent(username)}&aid=1988&app_language=en&app_name=tiktok_web&device_platform=web_pc`;
        const res = await axios.get(url, { headers: TT_HEADERS, timeout: 10000 }).catch(() => null);
        if (res?.data?.userInfo?.user?.secUid) {
            return { success: true, secUid: res.data.userInfo.user.secUid, nickname: res.data.userInfo.user.nickname };
        }
    } catch (_) {}
    return { success: false };
}

export async function fetchVideosByYtDlp(uniqueId, limit = 5) {
    try {
        const username = uniqueId.replace(/^@/, "");

        const resolved = await resolveTikTokSecUid(username);
        if (resolved.success) {
            const data = await fetchTikTokUserVideos(resolved.secUid, username, 0, limit);
            if (data.success && data.videos && data.videos.length > 0) {
                return { success: true, videos: data.videos };
            }
        }

        const postUrl = `https://www.tiktok.com/api/post/item_list/?aid=1988&app_language=en&app_name=tiktok_web&device_platform=web_pc&count=${limit}&cursor=0`;
        if (resolved.success) {
            const r2 = await axios.get(postUrl + `&secUid=${encodeURIComponent(resolved.secUid)}`, {
                headers: TT_HEADERS, timeout: 12000
            }).catch(() => null);
            if (r2?.data?.itemList?.length) {
                return {
                    success: true,
                    videos: r2.data.itemList.map(item => ({
                        video_id: item.id,
                        title: item.desc,
                        create_time: item.createTime,
                        duration: item.video?.duration,
                        play: item.video?.playAddr,
                        cover: item.video?.cover,
                        author: { nickname: item.author?.nickname, unique_id: item.author?.uniqueId },
                        stats: item.stats
                    }))
                };
            }
        }

        return { success: false, error: "Không lấy được danh sách video từ TikTok" };
    } catch (e) {
        console.error("Lỗi fetchVideosByYtDlp:", e.message);
        return { success: false, error: e.message };
    }
}

export async function resolveTikTokUser(uniqueId) {
    try {
        const cleanId = uniqueId.toString().replace("@", "");
        const res = await axios.get(`https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(cleanId)}`);
        if (res.data && res.data.code === 0 && res.data.data.user) {
            return {
                success: true,
                secUid: res.data.data.user.secUid,
                nickname: res.data.data.user.nickname,
                uniqueId: res.data.data.user.uniqueId
            };
        }
        return { success: false, error: res.data?.msg || "User not found" };
    } catch (e) {
        console.error("Lỗi resolveTikTokUser:", e.message);
        return { success: false, error: e.message };
    }
}
