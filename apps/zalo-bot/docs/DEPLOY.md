# Deploy lên VPS bằng Coolify

Bot này chạy 24/7 và **giữ phiên đăng nhập Zalo** + **token Facebook** ở dạng file. Trong container, dữ liệu phải nằm trên **volume bền** thì mới sống sót qua mỗi redeploy.

> ⚠️ **Rủi ro Zalo:** `zca-js` không chính thức. Đăng nhập một tài khoản Zalo từ **IP VPS nước ngoài (Singapore)** dễ bị Zalo coi là bất thường → có thể yêu cầu xác minh hoặc **khoá tài khoản**. Hãy **dùng tài khoản phụ để thử trước**, không dùng acc chính. VPS đặt ở Việt Nam sẽ an toàn hơn.

---

## 1. Tạo resource trên Coolify

- **New Resource → Application →** nguồn Git (repo của bạn) **hoặc** "Dockerfile".
- **Build Pack: Dockerfile** (repo đã có sẵn `Dockerfile` + `.dockerignore`).
- **Port (Ports Exposes): `8088`** → Coolify tự cấp **domain + HTTPS** (Let's Encrypt). Dashboard sẽ vào qua `https://<domain>`.

## 2. Persistent Storage (BẮT BUỘC)

Thêm 1 **Persistent Storage / Volume**:

| Mount Path trong container | Ý nghĩa |
|---|---|
| `/app/data` | Toàn bộ dữ liệu: `zalo-creds.json`, `qr.png`, `routes.json`, `tokens.json`, `data/` (bài chờ, phiên, pages, groups, sessions), `output/` (ảnh đã xử lý) |

Chỉ cần **một** volume `/app/data` là đủ (mọi thứ ghi-runtime đã gom về đây).

## 3. Environment Variables

Đặt trong tab **Environment Variables** của Coolify:

| Biến | Bắt buộc | Ghi chú |
|---|---|---|
| `FB_APP_ID` | ✅ | App ID Facebook |
| `FB_APP_SECRET` | ✅ | App Secret Facebook |
| `ANTHROPIC_API_KEY` | ✅ | Khoá API Claude (viết caption/lọc ảnh) |
| `DASHBOARD_USER` | ✅ | Tài khoản đăng nhập dashboard |
| `DASHBOARD_PASS` | ✅ | Mật khẩu dashboard (đặt mạnh) |
| `CLAUDE_MODEL` | tuỳ | Mặc định `claude-sonnet-4-6` |
| `FB_GRAPH_VERSION` | tuỳ | Mặc định `v21.0` |

> Token TỪNG TRANG Facebook **không** đặt ở đây — bạn cấp qua dashboard (tab Token), hệ thống tự lưu vào `/app/data/data/tokens.json` trên volume.
>
> `DATA_DIR`, `ROUTES_FILE`, `WEB_PORT`, `NODE_ENV` đã set sẵn trong `Dockerfile` — không cần khai lại.

## 4. Restart policy

Đặt **Restart: Always / Unless-stopped**. Khi mất kết nối Zalo, service tự `exit` → Coolify dựng lại container (thay cho vòng lặp `start.bat` ở bản local).

## 5. Deploy & chạy lần đầu

1. Bấm **Deploy**. Chờ build (cài ffmpeg + sharp).
2. Mở `https://<domain>` → đăng nhập dashboard (USER/PASS đã đặt).
3. Vào tab **Cài đặt** → **mã QR Zalo hiện ra** → mở Zalo trên điện thoại → **Quét** để đăng nhập.
4. Vào tab **Token** → dán **User Token** Facebook → hệ thống tự lấy token mọi Trang.
5. Vào **Nhóm → Page** → chọn nhóm Zalo + Trang Facebook → **Lưu cấu hình**.
6. Xong — bot bắt đầu lắng nghe.

## Cập nhật về sau (auto-deploy)

Đã bật **Auto Deploy** + **GitHub webhook** (push event). Quy trình:

```
sửa code → PR → CI test → merge main → GitHub webhook → Coolify tự build & deploy
```

Mỗi lần merge vào `main`, VPS tự cập nhật. Dữ liệu/phiên/token **giữ nguyên** nhờ volume `/app/data` (không phải quét QR lại).

## Chạy local vẫn như cũ

Không đụng gì tới cách chạy local: vẫn `start.bat` (hoặc `npm start`), `DATA_DIR` mặc định là thư mục dự án nên file nằm đúng chỗ cũ.
