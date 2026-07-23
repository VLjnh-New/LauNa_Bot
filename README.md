<div align="center">

# 🌸 LauNa Bot

**Bot Zalo đa năng · Viết bằng Node.js · Kết nối real-time qua WebSocket**

[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Version](https://img.shields.io/badge/version-3.0.0-ff69b4?style=for-the-badge)](https://github.com/VLjnh-New/LauNa_Bot)
[![License](https://img.shields.io/badge/license-ISC-blue?style=for-the-badge)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Zalo-0068FF?style=for-the-badge)](https://zalo.me)

> Bot Zalo mạnh mẽ với **80+ module**, kết nối WebSocket real-time, hỗ trợ đa tài khoản, tích hợp AI, tải media, trò chơi, kinh tế xu và hệ thống quản lý nhóm toàn diện.

</div>

---

## 📖 Mục lục

<details>
<summary>Nhấn để mở rộng</summary>

- [✨ Tính năng](#-tính-năng)
- [🖥️ Yêu cầu hệ thống](#️-yêu-cầu-hệ-thống)
- [📦 Cài đặt](#-cài-đặt)
- [⚙️ Cấu hình chi tiết](#️-cấu-hình-chi-tiết)
- [🔐 Đăng nhập & Lấy Cookie](#-đăng-nhập--lấy-cookie)
- [🚀 Khởi chạy Bot](#-khởi-chạy-bot)
- [📜 Toàn bộ lệnh](#-toàn-bộ-lệnh)
- [🔄 Sự kiện tự động](#-sự-kiện-tự-động)
- [📁 Cấu trúc thư mục](#-cấu-trúc-thư-mục)
- [🔒 Bảo mật](#-bảo-mật)
- [❓ Câu hỏi thường gặp](#-câu-hỏi-thường-gặp)

</details>

---

## ✨ Tính năng

| Nhóm | Chi tiết |
|---|---|
| 🔌 **Kết nối** | WebSocket real-time, tự động reconnect khi mất kết nối |
| 🍪 **Đăng nhập** | Cookie Zalo hoặc QR Code (quét bằng app Zalo) |
| 🧩 **Module động** | Load/reload module mà không cần restart toàn bộ bot |
| 🎵 **Tải media** | TikTok, YouTube, Spotify, SoundCloud, ZingMP3, NCT, CapCut, Mixcloud, Pinterest |
| 🤖 **AI** | GPT-5, GPT-4o, Claude 3, Llama 3 miễn phí + LauNa AI tự build |
| 🎮 **Trò chơi** | Cờ Caro, Cờ Tướng, Tài Xỉu, Slot, Blackjack, DnD RPG, Đuổi hình bắt chữ, Nối từ |
| 💰 **Kinh tế** | Hệ thống xu, ngân hàng, cửa hàng, nhiệm vụ hàng ngày |
| 📊 **Cấp độ** | XP tự động khi nhắn tin, bảng xếp hạng nhóm |
| 🛡️ **Bảo vệ nhóm** | Chống link, spam, ảnh NSFW, tag hàng loạt, gọi điện làm phiền |
| 🗓️ **Lập lịch** | Đặt hẹn nhắc nhở, tự động gửi media theo giờ |
| 🖼️ **Canvas** | Tạo ảnh động, sticker, ghép mặt bằng `@napi-rs/canvas` |
| 📱 **Locket** | Upload ảnh/video lên Locket, xem moments, quản lý bạn bè |

---

## 🖥️ Yêu cầu hệ thống

Trước khi cài, hãy chắc chắn máy bạn đang có:

| Thành phần | Phiên bản tối thiểu | Ghi chú |
|---|---|---|
| **Node.js** | 20.x trở lên | Dùng `node -v` để kiểm tra |
| **npm** | 10.x trở lên | Đi kèm Node.js |
| **ffmpeg** | Bất kỳ | Đã tích hợp qua `ffmpeg-static`, không cần cài thêm |
| **OS** | Windows / Linux / macOS | Linux/macOS ổn định hơn khi host 24/7 |
| **RAM** | 512MB trở lên | Bot giới hạn heap 1GB bằng `--max-old-space-size=1024` |

> 💡 **Khuyến nghị**: Chạy bot trên VPS Linux Ubuntu 22.04 để đảm bảo uptime 24/7. Nếu dùng Windows thì vẫn hoạt động bình thường.

---

## 📦 Cài đặt

### Bước 1 — Clone repo về máy

```bash
git clone https://github.com/VLjnh-New/LauNa_Bot.git
cd LauNa_Bot
```

### Bước 2 — Đặt thư viện `api-custom` vào thư mục gốc

Bot dùng thư viện Zalo nội bộ (`zca-api`) ở dạng **local package**. Bạn cần đặt thư mục `api-custom/` vào thư mục gốc của project trước khi chạy `npm install`.

```
LauNa_Bot/
├── api-custom/        ← đặt thư mục này vào đây
├── src/
├── bot.js
└── package.json
```

> ⚠️ Nếu thiếu `api-custom/`, lệnh `npm install` sẽ báo lỗi và bot không thể khởi động.

### Bước 3 — Cài dependencies

```bash
npm install
```

Quá trình này sẽ cài tất cả thư viện trong `package.json` bao gồm ffmpeg, canvas, YouTube downloader, v.v. Có thể mất 1–3 phút tùy tốc độ mạng.

---

## ⚙️ Cấu hình chi tiết

### File `config.json`

Đây là file cấu hình chính của bot. Mở file lên và chỉnh theo tài khoản của bạn:

```json
{
  "bot": {
    "prefix": ".",
    "selfListen": true,
    "autoAcceptInvites": false,
    "adminOnly": true
  },
  "credentials": {
    "imei": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
    "cookie": []
  },
  "admin": {
    "ids": [
      "zalo_uid_của_bạn"
    ]
  },
  "storage": "diver"
}
```

**Giải thích từng trường:**

| Trường | Mô tả |
|---|---|
| `bot.prefix` | Ký tự kích hoạt lệnh. Mặc định là `.` → gõ `.help`, `.tiktok`... Có thể đổi per-group bằng `.setprefix` |
| `bot.selfListen` | `true` = bot nghe cả tin nhắn do chính tài khoản bot gửi. Hữu ích khi test |
| `bot.autoAcceptInvites` | `true` = bot tự chấp nhận lời mời vào nhóm |
| `bot.adminOnly` | `true` = các lệnh nhạy cảm chỉ admin trong `admin.ids` mới dùng được |
| `credentials.imei` | IMEI thiết bị Zalo. **Tự động điền sau khi chạy `node login.js`** |
| `credentials.userAgent` | User-Agent trình duyệt giả lập. **Tự động điền sau khi chạy `node login.js`** |
| `credentials.cookie` | Cookie phiên đăng nhập Zalo. **Tự động điền sau khi chạy `node login.js`** |
| `admin.ids` | Mảng Zalo UID của các admin bot. Lấy UID bằng cách nhờ người khác gửi tin, bot sẽ log UID ra console |
| `storage` | Loại storage (`diver` = dùng file `diver.json` làm DB nhẹ) |

### File `cookie.json`

File này lưu cookie session Zalo dưới dạng JSON array. **Không cần tạo thủ công** — chạy `node login.js` sẽ tự sinh ra.

Nếu bạn đã có cookie từ trình duyệt (xuất từ extension như Cookie-Editor), format đúng như sau:

```json
[
  { "name": "zpsid", "value": "...", "domain": ".zalo.me", ... },
  { "name": "zpw_sek", "value": "...", "domain": ".zalo.me", ... }
]
```

---

## 🔐 Đăng nhập & Lấy Cookie

Bot hỗ trợ 2 cách đăng nhập:

### Cách 1: Đăng nhập QR (Khuyến nghị cho lần đầu)

```bash
node login.js
```

Sau khi chạy lệnh này:

1. Terminal sẽ hiển thị file `qr.png` — mở file đó lên
2. Mở app **Zalo** trên điện thoại → vào **Cài đặt → Quét mã QR**
3. Quét mã QR trong ảnh
4. Script tự động lưu `imei`, `userAgent` và `cookie` vào `config.json`
5. Tắt script (Ctrl+C hoặc script tự thoát) → chạy `npm start`

> ✅ Sau khi quét QR thành công, bạn không cần quét lại trừ khi cookie hết hạn (thường 30–90 ngày).

### Cách 2: Bot tự login bằng cookie trong `config.json`

Nếu đã có cookie hợp lệ trong `config.json`, chỉ cần chạy `npm start` — bot sẽ đăng nhập tự động, không cần quét QR.

---

## 🚀 Khởi chạy Bot

```bash
# Chạy bình thường (production)
npm start

# Chạy dev mode — tự reload khi sửa file (dùng khi phát triển)
npm run dev
```

Khi khởi động thành công, console sẽ hiển thị:

```
[SYSTEM] Tải thành công XX module hoạt động.
[SYSTEM] Tải thành công XX handler sự kiện.
[INFO]   Bot đã kết nối Zalo · ID: xxxxxxxxxxxxxxxxx
[INFO]   WebSocket đang lắng nghe...
```

### Chạy 24/7 với PM2 (Khuyến nghị cho VPS)

[PM2](https://pm2.keymetrics.io/) là process manager giúp bot tự restart khi crash:

```bash
# Cài PM2 toàn cục
npm install -g pm2

# Khởi chạy bot với PM2
pm2 start bot.js --name "launa-bot" --max-memory-restart 900M

# Xem log real-time
pm2 logs launa-bot

# Tự khởi động khi VPS reboot
pm2 startup
pm2 save
```

**Các lệnh PM2 hữu ích:**

```bash
pm2 status          # Xem trạng thái
pm2 restart launa-bot   # Restart bot
pm2 stop launa-bot      # Dừng bot
pm2 delete launa-bot    # Xoá khỏi PM2
```

---

## 📜 Toàn bộ lệnh

> **Prefix mặc định:** `.`  
> Có thể đổi prefix riêng cho từng nhóm bằng lệnh `.setprefix`

---

### 🎵 Media & Tải nhạc/video

| Lệnh | Mô tả |
|---|---|
| `.tiktok [url]` | Tải video không watermark, nhạc MP3 hoặc xem thông tin tài khoản TikTok |
| `.yt [tên/url]` | Tìm kiếm và tải video hoặc nhạc từ YouTube |
| `.spt [url]` | Tải nhạc từ Spotify kèm thumbnail đẹp |
| `.zing [tên bài]` | Tìm kiếm và tải nhạc từ ZingMP3 |
| `.nct [tên bài]` | Tìm kiếm và nghe nhạc từ NhacCuaTui |
| `.soundcloud / .scl / .sc [url/tên]` | Tìm kiếm và tải nhạc từ SoundCloud |
| `.sing / .music [tên]` | Phát YouTube kèm card ảnh bìa âm nhạc |
| `.capcut [url]` | Tải video từ CapCut |
| `.mixcloud [url/tên]` | Tìm kiếm và tải nhạc từ Mixcloud |
| `.pinterest [từ khóa]` | Tìm kiếm hình ảnh trên Pinterest |
| `.pincheck` | Reply ảnh → tìm ảnh liên quan trên Pinterest |
| `.findmusic / .fm` | Reply hoặc gửi kèm file âm thanh/video → nhận dạng bài hát |
| `.hotmusic` | Gửi một bài nhạc Remix đang thịnh hành ngẫu nhiên |
| `.yanhh [tên phim]` | Tìm và tải phim từ yanhh3d |
| `.phim [tên phim]` | Tìm kiếm và xem phim qua KKPhim |
| `.getlink` | Reply tin nhắn → trích xuất link gốc hoặc dữ liệu nhúng |

---

### 🤖 AI & Tra cứu

| Lệnh | Mô tả |
|---|---|
| `.duck [câu hỏi]` | Chat AI miễn phí qua duck.ai — hỗ trợ GPT-5, GPT-4o, Claude 3, Llama 3 |
| `.launa [câu hỏi]` | LauNa AI — trợ lý AI tự build, đa provider, có tính cách riêng |
| `.wiki [từ khóa]` | Tra cứu nhanh trên Wikipedia tiếng Việt và tiếng Anh |
| `.thoitiet [thành phố]` | Xem thời tiết chi tiết qua wttr.in |
| `.giavang` | Giá vàng SJC cập nhật mới nhất từ Phú Quý Group |
| `.giaxang` | Giá xăng dầu hôm nay từ PVOIL |
| `.xsmb` | Kết quả XSMB hôm nay — tự động thông báo lúc 18h15 |
| `.ff [ID]` | Tra cứu thống kê tài khoản Free Fire theo UID |
| `.mail` | Tạo email tạm thời (temp-mail.org) để nhận mã OTP |
| `.nsfw` | Reply ảnh → kiểm tra xem ảnh có nội dung 18+ không |
| `.cap [url]` | Chụp ảnh màn hình của bất kỳ trang web nào |

---

### 🎮 Trò chơi & Giải trí

| Lệnh | Mô tả |
|---|---|
| `.caro` | Cờ Caro — đánh với máy hoặc thách đấu người khác trong nhóm |
| `.cotuong` | Cờ Tướng — vs Máy hoặc 2 người đấu nhau |
| `.taixiu [tai/xiu] [số xu]` | Tài Xỉu — đặt cược xu, lắc 3 xúc xắc, thắng nhân đôi |
| `.slots [số xu]` | Máy đánh bạc Slot 3 cuộn + Blackjack 21 |
| `.dnd` | DnD RPG — chọn nhân vật, khám phá dungeon, chiến đấu boss |
| `.batchu` | Đuổi hình bắt chữ — bot gửi ảnh gợi ý, đoán đúng nhận xu |
| `.altp` | Ai Là Triệu Phú — câu hỏi từ GameVui, có gợi ý và cứu trợ |
| `.vtv` | Vua Tiếng Việt — sắp xếp chữ cái thành từ có nghĩa |
| `.noitu` | Nối từ — trò chơi dây chuyền từ tiếng Việt trong nhóm |
| `.rps` | Oẳn tù xì với bot |
| `.rp / .ôm / .hôn / .vỗ đầu / .tát / .cắn / .khóc / .nhảy / .đấm / .liếm / .cù` | Roleplay GIF từ nekos.best |

---

### 💰 Kinh tế & Cấp độ

| Lệnh | Mô tả |
|---|---|
| `.rank` | Xem cấp độ, XP hiện tại và bao nhiêu XP lên rank tiếp theo |
| `.lvtop` | Bảng xếp hạng XP của nhóm (top 10) |
| `.shop / .store / .cuahang` | Mở cửa hàng — xem và mua vật phẩm bằng xu |
| `.quest / .nhv / .nhiemvu` | Danh sách nhiệm vụ hàng ngày và hàng tuần — hoàn thành nhận xu |
| `.checktt` | Kiểm tra thống kê tương tác của bạn trong nhóm |
| `.top` | Bảng xếp hạng hoạt động nhóm |
| `.call` | Gọi điện Zalo cho thành viên (tag, reply hoặc link profile) |

---

### 🛡️ Quản lý nhóm

| Lệnh | Mô tả |
|---|---|
| `.anti link [on/off]` | Bật/tắt chế độ chống spam link trong nhóm |
| `.anti spam [on/off]` | Bật/tắt chế độ chống spam tin nhắn |
| `.anti photo [on/off]` | Chặn gửi ảnh trong nhóm |
| `.anti sticker [on/off]` | Chặn gửi sticker trong nhóm |
| `.anti tag [on/off]` | Chặn tag hàng loạt thành viên |
| `.anti nude [on/off]` | Tự động xoá ảnh có nội dung nhạy cảm (NSFW) |
| `.anti call [on/off]` | Chặn tính năng gọi điện trong nhóm |
| `.group info` | Xem thông tin chi tiết của nhóm hiện tại |
| `.group rename [tên mới]` | Đổi tên nhóm |
| `.group add [số điện thoại]` | Thêm thành viên mới vào nhóm |
| `.kick @tag` | Đuổi thành viên được tag ra khỏi nhóm |
| `.mute @tag [thời gian]` | Tắt tiếng thành viên trong X phút/giờ |
| `.block @tag` | Thêm thành viên vào danh sách chặn nhóm |
| `.poll [câu hỏi] \| [lựa chọn A] \| [lựa chọn B]` | Tạo bình chọn trong nhóm |
| `.note [nội dung]` | Thêm ghi chú cho nhóm, xem lại sau |
| `.setprefix [ký tự]` | Đổi prefix riêng cho nhóm này (không ảnh hưởng nhóm khác) |
| `.thuhoi` | Reply tin nhắn của bot → thu hồi tin nhắn đó |

---

### 🖼️ Ảnh & Sticker

| Lệnh | Mô tả |
|---|---|
| `.stk` | Reply ảnh/GIF/video → tạo sticker Zalo |
| `.stk xoay [tốc độ] [thời gian]` | Sticker xoay tròn. VD: `.stk xoay 2 8s` |
| `.stk tron` | Sticker crop hình tròn |
| `.stk xt [tốc độ] [thời gian]` | Sticker xoay + hình tròn (hỗ trợ video) |
| `.stk xn` | Sticker xoá nền tự động |
| `.stk ai [mô tả]` | Vẽ ảnh bằng AI rồi tạo sticker |
| `.ghepmat` | Reply 2 ảnh → ghép mặt từ ảnh này sang ảnh kia |
| `.speak [văn bản]` | Chuyển text thành voice message (Text-to-Speech) |
| `.icon [on/off]` | Bật/tắt tự động thả reaction vào tin nhắn trong nhóm |
| `.vd [thể loại]` | Xem video ngẫu nhiên theo thể loại (gai, anime...) |

---

### 📱 Mạng xã hội & Kết nối

| Lệnh | Mô tả |
|---|---|
| `.locket upload` | Upload ảnh/video lên Locket Widget |
| `.locket moments` | Xem moments từ bạn bè trên Locket |
| `.locket friends` | Quản lý bạn bè trên Locket |
| `.friend accept` | Chấp nhận lời mời kết bạn Zalo đang chờ |
| `.friend reject` | Từ chối lời mời kết bạn |
| `.friend add [SĐT]` | Gửi lời mời kết bạn đến số điện thoại |
| `.find online` | Xem bạn bè đang online trên Zalo |
| `.find lastonline` | Xem bạn bè online gần nhất |
| `.find [SĐT]` | Tìm kiếm tài khoản Zalo theo số điện thoại |
| `.profile info` | Xem thông tin tài khoản bot |
| `.profile name [tên mới]` | Đổi tên hiển thị của bot |
| `.profile avatar` | Reply ảnh → đổi avatar của bot |
| `.profile bio [nội dung]` | Cập nhật trạng thái/bio của bot |
| `.profile online / offline` | Bật/tắt trạng thái online của bot |

---

### ⚙️ Cài đặt & Tự động hoá

| Lệnh | Mô tả |
|---|---|
| `.autoreply add [từ khóa] [phản hồi]` | Thêm câu trả lời tự động khi có từ khóa |
| `.autoreply list` | Xem danh sách auto-reply đang bật |
| `.autoreply delete [từ khóa]` | Xoá một auto-reply |
| `.shortcut add [từ khóa]` | Thêm phản hồi tự động theo từ khóa hoặc khi @tag |
| `.autosend` | Quản lý tự động gửi media theo lịch (nhạc/ảnh/video) |
| `.datlich [thời gian] [nội dung]` | Đặt lịch nhắc. VD: `.datlich 30p Họp nhóm` |
| `.datlich list` | Xem danh sách lịch nhắc đang chờ |
| `.ct forward` | Forward tin nhắn (reply để dùng) |
| `.ct pin` | Ghim tin nhắn trong nhóm |
| `.ct gif [từ khóa]` | Tìm và gửi GIF |
| `.ct hide` | Ẩn chat với người dùng |
| `.proxy [số] [loại]` | Lấy proxy sống từ 62+ nguồn. VD: `.proxy 10 https vn` |
| `.proxy check [ip:port]` | Kiểm tra proxy còn sống không |

---

### 🔑 Admin & Hệ thống

| Lệnh | Mô tả |
|---|---|
| `.help` | Xem menu tổng hợp lệnh theo danh mục |
| `.help [tên lệnh]` | Xem hướng dẫn chi tiết của một lệnh cụ thể |
| `.admin status` | Xem trạng thái hệ thống, RAM, uptime |
| `.admin listbox` | Liệt kê tất cả nhóm bot đang hoạt động |
| `.rent [nhóm] [ngày]` | Cho thuê quyền dùng bot theo ngày |
| `.activate [key]` | Kích hoạt key thuê bot |
| `.token add [key]` | Thêm token/API key vào hệ thống |
| `.token list` | Xem danh sách token đang có |
| `.token delete [key]` | Xoá token |
| `.gdrive upload` | Reply file → upload lên Google Drive cá nhân |
| `.share [đường dẫn]` | Duyệt thư mục và gửi file từ server (chỉ admin) |
| `.adc [code]` | Upload/thay thế code file trực tiếp lên server |
| `.bug [tin nhắn]` | Debug nội dung tin nhắn, chạy lệnh shell (admin) |
| `.login` | Đăng nhập/đổi tài khoản Zalo cho bot trong nhóm |

---

## 🔄 Sự kiện tự động

Các tính năng này chạy ngầm, không cần gõ lệnh:

| Sự kiện | Mô tả |
|---|---|
| **Anti-Unsend** | Khi ai đó thu hồi tin nhắn trong nhóm, bot sẽ tự gửi lại nội dung đó |
| **Auto-Download** | Tự động tải và gửi video/ảnh khi ai paste link TikTok, Instagram, YouTube, Facebook, Douyin, CapCut, Spotify, Mixcloud, Threads vào chat |
| **Auto-React** | Tự động thả reaction emoji vào tin nhắn theo danh sách đã cài |
| **Leveling** | Mỗi khi thành viên nhắn tin, bot cộng XP. Đủ XP sẽ tự động thông báo lên cấp |
| **LauNa AI** | Bot tự động trả lời khi được @tag hoặc nhắc đến tên trong chat |
| **Bảo vệ nhóm** | Giám sát liên tục — xoá tin/cảnh báo/kick khi phát hiện vi phạm theo cấu hình `.anti` |
| **Duyệt thành viên** | Tự động duyệt hoặc từ chối thành viên mới xin vào nhóm theo điều kiện đặt sẵn |
| **Thông báo nhóm** | Chào mừng thành viên mới, thông báo khi ai rời nhóm |
| **Hot Music** | Tự động gửi một bài nhạc Remix thịnh hành ngẫu nhiên mỗi giờ (nếu bật) |
| **Auto-send** | Gửi media tự động (nhạc, ảnh, tỷ giá Won→VND) theo lịch đã cài |
| **XSMB** | Tự động gửi kết quả xổ số miền Bắc vào lúc 18h15 mỗi ngày (nếu bật) |
| **Phản hồi Reaction** | Xử lý các xác nhận hoặc hoàn tác qua react vào tin nhắn bot |

---

## 📁 Cấu trúc thư mục

```
LauNa_Bot/
│
├── api-custom/                  # ⚠️ Thư viện zca-api nội bộ (KHÔNG commit lên git)
│
├── src/
│   ├── modules/                 # 80+ module lệnh, mỗi file là một nhóm tính năng
│   │   ├── tiktok.js            # Tải TikTok
│   │   ├── duckai.js            # Chat AI
│   │   ├── taixiu.js            # Tài Xỉu
│   │   ├── general.js           # Help, menu, info hệ thống
│   │   ├── cache/               # Cache module tạm thời
│   │   ├── data/                # Dữ liệu tĩnh của module (câu hỏi XSMB, v.v.)
│   │   └── ...                  # và nhiều module khác
│   │
│   ├── events/                  # Event handlers chạy ngầm
│   │   ├── antiunsend.js        # Bắt tin nhắn bị thu hồi
│   │   ├── autodown.js          # Tự động tải media từ link
│   │   ├── autoReact.js         # Tự động react
│   │   ├── leveling.js          # Cộng XP khi nhắn tin
│   │   ├── launa.js             # LauNa AI + mood scheduler
│   │   ├── protection.js        # Bảo vệ nhóm
│   │   ├── noitu.js             # Trò chơi nối từ
│   │   ├── groupNotify.js       # Thông báo vào/rời nhóm
│   │   └── ...
│   │
│   ├── utils/
│   │   ├── api/                 # Tích hợp API ngoài (AI, upload, custom Zalo API)
│   │   ├── canvas/              # Tạo ảnh/card bằng @napi-rs/canvas
│   │   ├── core/                # Nhân hệ thống (IO, logger, WebSocket, memory monitor)
│   │   ├── downloaders/         # Downloader chuyên biệt cho từng platform
│   │   ├── managers/            # Quản lý state (bank, cooldown, rental, proxy...)
│   │   └── music/               # Xử lý nhạc (search, stream, metadata)
│   │
│   ├── assets/
│   │   └── fonts/               # Font cho canvas (BeVietnamPro, DejaVu, NotoEmoji)
│   │
│   └── data/                    # Dữ liệu runtime (JSON) — XP, xu, cài đặt nhóm...
│
├── logs/                        # Log tự động theo ngày
│
├── bot.js                       # 🚀 Entry point chính
├── login.js                     # Tiện ích đăng nhập QR
├── config.json                  # Cấu hình bot (KHÔNG commit lên git)
├── cookie.json                  # Cookie Zalo (KHÔNG commit lên git)
├── diver.json                   # Database nhẹ dạng JSON
└── package.json
```

---

## 🔒 Bảo mật

> ❌ **TUYỆT ĐỐI KHÔNG** commit các file sau lên GitHub:

| File | Lý do |
|---|---|
| `cookie.json` | Chứa session đăng nhập Zalo — ai có file này = truy cập được tài khoản |
| `config.json` | Chứa IMEI, cookie và danh sách admin |
| `api-custom/` | Thư viện nội bộ, không chia sẻ công khai |
| `src/data/tokens.json` | Chứa API key các dịch vụ bên ngoài |
| `diver.json` | Chứa dữ liệu người dùng (xu, XP, lịch sử) |

Tất cả những file này đã được liệt kê trong `.gitignore`. **Kiểm tra kỹ trước khi push**.

**Một số thói quen tốt:**

- Đổi cookie mới mỗi 30–60 ngày bằng cách chạy lại `node login.js`
- Không chia sẻ file `config.json` hay `cookie.json` với bất kỳ ai
- Nếu lỡ push cookie lên GitHub, **hãy đăng xuất ngay tài khoản Zalo đó** và tạo session mới

## Đôi Lời
- Mình có thể sẽ không còn update nữa!
- hmmm vì mình hiện tại quá bận chạy theo đồng tiền.
- Project này mình phát triển và có dùng ai nhé.
- À còn nữa gốc của nó là từ D.Khanh nhé.
- Đây là web api của mình: `https://api.vljnh.qzz.io`
- Nó có một số bug nếu có thể hãy tự fix nhé!
- Ví dụ như là ai launa phản hồi rất chậm vì một số nguyên nhân.
- VLjnh
## Tạm Biệt! 😁
  
---

## ❓ Câu hỏi thường gặp

<details>
<summary><b>Bot báo lỗi "Cannot find module 'zca-api'"</b></summary>

Thư mục `api-custom/` bị thiếu. Đặt thư mục đúng vào thư mục gốc rồi chạy lại `npm install`.

</details>

<details>
<summary><b>QR Code xuất hiện nhưng quét không được</b></summary>

- Đảm bảo mở file `qr.png` chứ không phải nhìn text QR trong terminal (text QR có thể méo)
- Thử quét bằng app Zalo → Cài đặt → Quét mã QR
- Nếu QR hết hạn (thường sau 30 giây), chạy lại `node login.js`

</details>

<details>
<summary><b>Bot chạy được nhưng không nhận lệnh</b></summary>

- Kiểm tra prefix: mặc định là `.` → phải gõ `.help` chứ không phải `help`
- Kiểm tra `adminOnly` trong `config.json` — nếu `true`, chỉ UID trong `admin.ids` mới dùng được
- Xem log console để biết lỗi cụ thể

</details>

<details>
<summary><b>Tìm UID Zalo của mình ở đâu?</b></summary>

Nhờ một tài khoản khác gửi tin nhắn cho bot, bot sẽ log UID của người gửi ra console. Hoặc dùng lệnh `.find [số điện thoại của bạn]` để xem UID.

</details>

<details>
<summary><b>Cookie hết hạn, bot không đăng nhập được</b></summary>

Chạy lại `node login.js` để quét QR mới. Script sẽ tự cập nhật `config.json`.

</details>

<details>
<summary><b>Bot bị crash hoặc tự tắt</b></summary>

Dùng PM2 để bot tự restart khi crash. Xem phần **Chạy 24/7 với PM2** ở trên.

</details>

---

<div align="center">

Nếu thấy project hữu ích, hãy ⭐ **star repo** để ủng hộ nhé!

**[🐛 Báo lỗi](https://github.com/VLjnh-New/LauNa_Bot/issues)** · **[💡 Đề xuất tính năng](https://github.com/VLjnh-New/LauNa_Bot/issues)**

</div>
