import { fs, path, axios, log } from "../globals.js";
import querystring from "node:querystring";

export const name = "pin";
export const description = "Tìm kiếm hình ảnh trên Pinterest";

const PINTEREST_COOKIE = 'csrftoken=6044a8a6c65d538760e70c78b3c82bd0; ar_debug=1; _routing_id="26362549-c12f-4ef0-ad1a-46db9831079e"; sessionFunnelEventLogged=1; _auth=1; _pinterest_sess=TWc9PSZ1RWUyRGQrWVRsSzdacUVIaU9VQkZoWGZlUGkxcnh4SmhGTmpoSkdlNm8vckg3QXBjV2swV0VDbDEvaTFuMUx4UUlVUVlKRUwvbVp4aWJGcnlhVDg2QmNFT0hPaG9NdWxsVGlNNUtvbDg1THE0Kyt0OFZJdGw3dVBBUEU0VHViMXdBaTlZbzFodEFDYTE1c0lMUFpRTHB2OGowN1JidVBxanQrdkxGWEZwc3pqRGdNZm5CWDFDYWlLakE1UUFWQXhuNWtzdjVCR0Q0UjB6LzlHa05BcHh6amhzcTc0WmNLaGdteDRxTFJPU3ZFTElHNS84WTVkOGtxc0ZPNUNWYnRMTHVOdk8vTXN5eFRuWWVJeWo3ZUdhWHZFek9abUQ4eWZBTHZtZTdta0dmdzJXcUp5d08zTVdobEE2NU92akJkeUE4bVVFRmVMZkRnRVpVSU84Y1k1bFh4ZHAzRklTVVlobGwvQzFmN2Q0U2FGTFRlWHVYS3BTbVIwWFd0a3NrMmRXZXdRMEs3MHZSbnd4aTVuRWl6aUFNckwwM2tya29RRXNMaElRQ29mM3l5aWlGSmJHczZvR2RkdjhzaTl6TGF0R1h2TnpUNG5Yb3p4ZkdpMWtHaTRlRjlLSzdsR3lpZXJpRUZRSGt0dFVOaFBaY0taY2h6bS9JTFc1RzE2TEV0UzZlZTJWdEZsNWJkRmk0aFlVVysvcGtVVzU4d1NtelN5VmY5cTlya1EzMVNoNFJTdHJXdmgwNm5qSkZFMk90bmw4bnQyeXdPU086U0pJWm1SUGdqb3BYa1pxWkE5Vk9mUm5DWW96YTBrdFZKZ2g4V1hEcEZwU3JBK3V5YmhxenkzZ3VkZmN1ZXlKOXBpOUtwT1d5QVg3bHhrMjBmaWl6L3JtRHFWUWprZ3FGWUY0K3JDQUd0aXFjSGYzYUFKY3JsYnJLa29NT3ZITTkzaWl0enFjeE9lMkhTbXh5amVYL0ZFaFY0cEJJbnNlZGd1Ry9hS3R3c3N4YXMwSGxCZkRzY3djY0sxUGxOVWJPQk5TaUdxWS93Rmp1SWo4dDVENE1yL2lWUjRUQnJ1cUw1dWxjbzgxN3VuK01PalhlQWFPbWZ6K0VMRm1GdUdYR1dwUVVSUVJMS3ZzaWNVMDd2TERoVHoyWUZqVDEzdVRqNEpkZjZoVCtpcnlwV09VYUc5Z0hyOGZUbS9mQWZ1R1lOYzQ0d0FzUHlWVmRodWRGK0NiaU0ycjhVNklheHNKZ0FIbHg5VE41ajlpVWVoNnUycXFzNk5uOGdBRUdSYzZoRXBqMElaTjVYQTIyVTNtS3QwdjdHVDA4TUNTcm9XdEx6QzN1ajZMM2pkQkpKTXIrZWpvcXQ4REZiYkVsdlNPd2V0T1puRUdpUFpGSnh1T00vczlCWjV5VEtIQ3IzWDdneXZmREJlNHVUTTIwSkVEOWQ3cUdBYnlRT3diTFhNVEJkQysyTzUwMFlRL01td1JHN2JlZkM3Y1RnNnVZSjJPOUI5QXl6a2hncUFKVnZ5UG9SVHpZUU9HMGFGMGJvTHllcjNLaFRlTTN4cDZnZzhvT1NmVXR5VlBEMmJFUGI4TjVjMDB1b0VnUUdHcGUvMFFITnM1SkJ3d1ZMRHBIRU9aczc2QjhkNVZkQU1tNHBnK05Fdy93YjlXNkVLL3BwSE9TeUtsY0oyM2YvM0AbSEJNUWZVcTIrcUdJRDNsQTV3WEFlQmNwd2VyZnZKQ0NUaWhYUnV4NUt6UjBTYW9oL051L2NuRURheEpMRElMdlhFbS9SeVMzMkUmc0NoSFhDWTk2Q2ZLelltOXNGWDFack1LcEhVPQ==; __Secure-s_a=Y1QvZ05nSmNURGdxemx6L1UwOUFkUTFsYVB1eEgwK2lEbHJMZXNzeW80SjZqMXhoazVVUVZVRVFaWkpOWWRSS3JjZFBCQW5rb1NCRE15djFDS3FIVDE1WUdDL0Z6UkdFMW1kcVBKYndnTVA0dUN4bDVOVzhod0E0TmlGSlhCYkpzYVdwWFNTRUxpbkk3bDFDamp2UG5UY0szd0pmMy9wbFlzZkJnWEpYRkdmN2FaT2Z5bFA1aUgybG1OYTlqamw5RmZtL1RmQzlNcmkwQXZGZkRtWlVqM1N2M29LV3RYRnVmNSs4ZU5odjVYRTRDWkZRRHkwZ1VLbXhMZUVicFpBT0EvbHVWL0hyeDhuOC85RmxBd0lTSEZvQVVLSkpXNWNFNnhoWWFFbVBiNmxxR3MzM0V6Rjl1TjV6RlJQa3hkdGFjeWVkOFN4ZmRobkZCeUJ3d2xkR0hmKzRmWkw3TFAwc08xc0wvbS9XL3drbmVVdjJtUmV5M1hRYUpmLzJsQnNWWStEUmt5T28rYU1zQ0gyY1F2djJ6V1Z2anovcGlydVVYc2xjK2IzR2xNTnI4cmNobkZXL2szSTFka01LWUE5ckxOS0NmclNDSHRoTTlObzFMTk1YNGRHZnJoVmlXYVQxdElOelJERW5sNm5Sc2hoYXB3b2lmVzJDd0ZqWUlqWjExOUtYZjVsRW42Z2U2YnBkMDdXb2VBU2duV2NxaVRJOC93azE4TytMK0hWM3FrRmJZOUNhMXZ3MXZoa2lNeHg4OUQ2SGlERm1CczhJQkp0RERDZERxMWF5aFV5QlFTSERYN09vbWEwaUxLTVV6VzZ1anhYbUJtbG4zcDRqNVJ6SEZTTXFaT0lna00rQUFCZkt0VWp1UEFWVjVPY3cySUpYbU5CTHVHaGxWNit0dFF5QVpHY09nTVduOVZTY2IvblJDeUcrV3dWZG9qNlRSQ3cxcVhSTDBRbWxINGZtZVNkaE41R1djMzdjbjBhbzJDa2kxVk85SVlIeXlSSW9QNndmY2VqWjFzUXoyaFZPYVNnUXF6dm1SbWZWa0ttTk5hRWFqV0FtYWVNYkgzM0s1Q1BNVGd0Szdwb2pIcWJ5eS94QXVMTkZ6VHNRdlNUQmFGeUVpbDFkY1VTa3A1RHhwWHkyNzgvM0RFTnplUnk3Y0l1R01yQjhFVHAxU2Q2R2NjRVlhTUs1TWoycXozMGdGZ084TDVmbXBYVXBQVHVPTXNQaHVLVWdzeWFld3drTTZtNWRvcjJ5bmU5WExwR1B0V3NkNFVEY2VvQzB1QzVkUDJVVU40L00rNGhpNWtLcHl5U2ZMWFBVM3ZtYWtaQT0mU09YaVFnRExQMi9XRWNxRFJMSHA1NkIzaE80PQ==; _b="AYovPepp2ENJH6lC2RgyOsJvWs+laEqNVOhdITARklV8PlbhotyboglDk79sjQRzsm4="';

export const commands = {
    // !pin [từ khóa]
    pin: async (ctx) => {
        const { api, threadId, threadType, args } = ctx;
        const query = args.join(" ");

        if (!query) {
            return api.sendMessage("⚠️ Vui lòng nhập từ khóa tìm kiếm!\nVí dụ: !pin mèo", threadId, threadType);
        }

        const clockEmojis = ["🕐", "🕑", "🕒", "🕓", "🕔", "🕕", "🕖", "🕗", "🕘", "🕙", "🕚", "🕛"];
        let clockIdx = 0;
        const reactionInterval = setInterval(() => {
            if (ctx.message && ctx.message.data) {
                api.addReaction(clockEmojis[clockIdx % clockEmojis.length], {
                    msgId: ctx.message.data?.globalMsgId || ctx.message.data?.msgId, cliMsgId: ctx.message.data?.cliMsgId
                }, threadId, threadType).catch(() => { });
                clockIdx++;
            }
        }, 2000);

        try {
            const searchUrl = `https://www.pinterest.com/resource/BaseSearchResource/get/`;
            // ... (rest of the postData and axios call) ...
            const postData = {
                source_url: `/search/pins/?q=${encodeURIComponent(query)}&rs=typed`,
                data: JSON.stringify({
                    options: {
                        article: null,
                        appliedProductFilters: "---",
                        auto_correction_disabled: false,
                        corpus: null,
                        customized_rerank_type: null,
                        filters: null,
                        query: query,
                        query_pin_sigs: null,
                        redux_normalize_feed: true,
                        rs: "typed",
                        scope: "pins",
                        source_id: null,
                        no_fetch_context_on_resource: false
                    },
                    context: {}
                })
            };

            const response = await axios.post(searchUrl, querystring.stringify(postData), {
                headers: {
                    'Accept': 'application/json, text/javascript, */*, q=0.01',
                    'Accept-Language': 'en-US,en;q=0.9,vi;q=0.8',
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': PINTEREST_COOKIE,
                    'Origin': 'https://www.pinterest.com',
                    'Referer': `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(query)}`,
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
                    'X-APP-VERSION': '9960888',
                    'X-CSRFToken': '6044a8a6c65d538760e70c78b3c82bd0',
                    'X-Pinterest-AppState': 'active',
                    'X-Pinterest-Source-Url': `/search/pins/?q=${encodeURIComponent(query)}`,
                    'X-Requested-With': 'XMLHttpRequest'
                }
            });

            const results = response.data?.resource_response?.data?.results || [];
            if (results.length === 0) {
                return api.sendMessage(`⚠️ Không tìm thấy kết quả nào cho "${query}"`, threadId, threadType);
            }

            const pins = results.slice(0, 10);
            const attachments = [];
            let resultMsg = `[ 📌 PINTEREST SEARCH ]\n─────────────────\n🔎 Từ khóa: "${query}"\n\n`;

            const cacheDir = path.join(process.cwd(), 'src', 'modules', 'cache');
            if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

            for (let i = 0; i < pins.length; i++) {
                const pin = pins[i];
                const imageUrl = pin.images?.['474x']?.url || pin.images?.['236x']?.url || pin.images?.orig?.url;
                const title = pin.grid_title || pin.title || pin.description || `Hình ${i + 1}`;

                if (imageUrl) {
                    try {
                        const imagePath = path.join(cacheDir, `pin_${Date.now()}_${i}.jpg`);
                        const imageResponse = await axios.get(imageUrl, {
                            responseType: 'stream',
                            headers: {
                                'Referer': 'https://www.pinterest.com/',
                                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36'
                            }
                        });

                        const writer = fs.createWriteStream(imagePath);
                        imageResponse.data.pipe(writer);

                        await new Promise((resolve, reject) => {
                            writer.on('finish', resolve);
                            writer.on('error', reject);
                        });

                        attachments.push(imagePath);
                        const pinUrl = `https://www.pinterest.com/pin/${pin.id}/`;
                        resultMsg += `${i + 1}. ${title.substring(0, 40)}${title.length > 40 ? '...' : ''}\n`;
                    } catch (err) {
                        log.error(`Lỗi tải ảnh Pinterest ${i}:`, err.message);
                    }
                }
            }

            if (attachments.length === 0) {
                return api.sendMessage("⚠️ Không thể tải hình ảnh. Vui lòng thử lại sau!", threadId, threadType);
            }

            resultMsg += `─────────────────\n💡 Gõ "${ctx.prefix}pin [từ khóa]" để tìm kiếm khác`;

            await api.sendMessage({
                msg: resultMsg,
                attachments: attachments
            }, threadId, threadType);

            // Dọn dẹp
            attachments.forEach(p => {
                if (fs.existsSync(p)) fs.unlinkSync(p);
            });

        } catch (error) {
            log.error("Pinterest search error:", error.message);
            if (error.response?.status === 403) {
                api.sendMessage("⚠️ Cookie Pinterest đã hết hạn. Vui lòng cập nhật!", threadId, threadType);
            } else {
                api.sendMessage(`⚠️ Có lỗi xảy ra: ${error.message}`, threadId, threadType);
            }
        } finally {
            clearInterval(reactionInterval);
        }
    }
};
