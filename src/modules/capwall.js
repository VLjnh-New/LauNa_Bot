import { fs, path, axios, log } from "../globals.js";

export const name = "cap";
export const description = "Chụp ảnh màn hình một trang web bất kỳ";

const CACHE_DIR = path.join(process.cwd(), "src/modules/cache/temp");
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

export const commands = {
    cap: async (ctx) => {
        const { api, args, threadId, threadType, senderName } = ctx;

        const url = args[0];
        if (!url || !/^https?:\/\//i.test(url)) {
            return api.sendMessage({ msg: `⚠️ Vui lòng cung cấp URL hợp lệ.\nVD: .cap https://example.com` }, threadId, threadType);
        }

        await api.sendMessage({ msg: `Đợi tý đi ${senderName}!!` }, threadId, threadType);

        const screenshotUrl = `https://api.screenshotmachine.com/?key=644a81&url=${encodeURIComponent(url)}&dimension=1024x768`;
        const outPath = path.join(CACHE_DIR, `cap_${Date.now()}.png`);

        try {
            const res = await axios({
                method: "GET",
                url: screenshotUrl,
                responseType: "arraybuffer",
                timeout: 60000,
            });

            fs.writeFileSync(outPath, Buffer.from(res.data));

            await api.sendMessage(
                { msg: `Ây dô xong rồi nè ${senderName}`, attachments: [outPath] },
                threadId,
                threadType
            );
        } catch (err) {
            log.error(`[cap] Lỗi chụp ${url}: ${err.message}`);
            await api.sendMessage({ msg: `⚠️ Không chụp được trang. Lỗi: ${err.message}` }, threadId, threadType);
        } finally {
            setTimeout(() => {
                try { if (fs.existsSync(outPath)) fs.unlinkSync(outPath); } catch {}
            }, 20000);
        }
    }
};
