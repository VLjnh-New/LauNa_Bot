import { Zalo } from "./src/api-zalo/index.js";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { log } from "./src/logger.js";

const CONFIG_FILE = "config.json";

// Danh sách User-Agents phổ biến để giả lập các trình duyệt khác nhau
const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.2210.121",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3.1 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0",
    "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Mobile Safari/537.36",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
];
async function startLogin() {
    log.info("┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓");
    log.info("┃   ✦  ZALO QR LOGIN & EXTRACTOR  ✦  ┃");
    log.info("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛");

    // Chọn ngẫu nhiên 1 User-Agent
    const randomUA = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    log.info(`◈ Sử dụng Fake User-Agent:\n  ❯ ${randomUA}`);

    const zalo = new Zalo();

    try {
        log.info("◈ Đang khởi tạo mã QR... Vui lòng mở file qr.png để quét.");

        // Thực hiện login QR với userAgent đã chọn
        const api = await zalo.loginQR({ userAgent: randomUA });

        log.info("✦ Đăng nhập thành công!");

        const ctx = api.getContext();
        const cookies = ctx.cookie;
        const imei = ctx.imei;

        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
        log.info("📊 THÔNG TIN ĐĂNG NHẬP CỦA BẠN:");
        log.info(`❯ imei: ${imei}`);
        log.info(`❯ userAgent: ${randomUA}`);
        log.info("❯ cookies: (Đã được định dạng JSON)");
        log.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

        // Cập nhật vào config.json (Dùng path tuyệt đối để tránh lỗi khi chạy từ thư mục khác)
        const __dirname = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([a-zA-Z]:)/, '$1');
        const configPath = path.join(__dirname, CONFIG_FILE);

        if (existsSync(configPath)) {
            try {
                const config = JSON.parse(readFileSync(configPath, "utf-8"));

                config.credentials = {
                    imei: imei,
                    userAgent: randomUA,
                    cookie: cookies
                };

                writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
                log.info(`✦ Đã tự động cập nhật thông tin vào config.json`);
            } catch (err) {
                log.error("✖ Không thể cập nhật config.json:", err.message);
            }
        } else {
            log.warn(`⚠️ Không tìm thấy file config.json tại ${configPath}. Hãy copy thông tin trên thủ công.`);
        }

        log.info("✦ Hoàn tất! Bạn có thể tắt script này và chạy 'npm start' để mở Bot.");
        process.exit(0);

    } catch (error) {
        log.error("✖ Lỗi trong quá trình đăng nhập QR:", error.message);
        process.exit(1);
    }
}

startLogin();
