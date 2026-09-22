# 🚚 Dời toàn bộ Việt Anh Media Hub sang máy host (DESKTOP-DGV1VHG)

> Cập nhật: **2026-09-21**. File này là bộ nhớ chung cho việc di chuyển. Làm xong mục nào thì tick và ghi lại bên dưới.
> Mục tiêu cuối: **bỏ hẳn máy A**, mọi thứ (code, chạy, deploy, chat với Claude) đều ở máy B.

---

## 0. ⛔ ĐANG CHỜ QUYẾT ĐỊNH (chặn bước tiếp theo)

| # | Câu hỏi | Vì sao chặn | Ai chốt | Trạng thái |
|---|---|---|---|---|
| ~~Q1~~ | ~~Cong 4007 bi `postiz` official chiem~~ | - | Phi Hung | CHOT 2026-09-21: **chay song song**, ban custom len cong **4008**, khong dung ban official. |
| Q2 | File `.env` (máy A: `C:\Media_Hub_VietAnh\.env`) ai copy sang `D:\media-hub\.env`? | Không có trong git. **Phiên Claude ở máy A bị deny rule chặn đọc `.env`** nên không tự copy được. Hoặc chủ máy tự copy, hoặc mở quyền cho Claude. | Phi Hùng | ⏳ chưa chốt (hỏi 2026-09-21) |

> Chốt xong thì **sửa bảng này** (ghi quyết định + ngày) rồi mới làm tiếp mục tương ứng ở §3.

---

## 1. Hai máy

| | Máy A (bỏ dần) | Máy B (đích) |
|---|---|---|
| Tên | ASUS — Tailscale node `bin` | `DESKTOP-DGV1VHG` — Tailscale node `desktop-dgv1vhg` |
| IP tailnet | 100.122.124.13 | **100.105.113.97** |
| SSH | — | `ssh machineB` (user **`claudia`**, profile `C:\Users\Anti Gravity`, key `~/.ssh/id_ed25519_machineB`) |
| Repo thật | `C:\Media_Hub_VietAnh` | **`D:\media-hub`** ✅ đã clone |
| Node / pnpm | — | node **v24.16.0**; `pnpm install` chạy bằng **pnpm 10.6.1** (theo `packageManager`) |
| git | — | `C:\Program Files\Git\cmd\git.exe` (**chưa nằm trong PATH** của phiên SSH non-interactive → thêm `$env:PATH += ';C:\Program Files\Git\cmd'`) |
| Claude Code | — | `claude.exe` **2.1.278** tại `C:\Users\Anti Gravity\.local\bin\` |
| Ổ đĩa | — | D: còn **~13 GB** (đã trừ node_modules), C: còn ~65 GB |

⚠️ **Cạm bẫy:** folder `D:\01-Truong-Viet-Anh\Media_Hub_VietAnh` trên máy A là **bản Postiz gốc clone 2026-07-01** (remote `gitroomhq/postiz-app`), KHÔNG phải dự án thật. Dự án thật là repo **`phihung13/medida-hub`** (public) — có `apps/orchestrator`, module `viral`, `scripts/run.mjs`, `docker-compose.prod.yaml`. Luôn kiểm bằng `git remote -v`.

---

## 2. Đã xong (2026-09-21)

- [x] SSH máy A → máy B thông. (`~/.ssh/config` trước ghi sai `User "Anti Gravity"`, đúng phải là `claudia`.)
- [x] `git clone https://github.com/phihung13/medida-hub.git D:\media-hub` — HEAD `51371efe`, khớp bản thật ở máy A.
- [x] `pnpm install` tại `D:\media-hub` (7m34s, Prisma Client v6.5.0 đã generate).
- [x] Thêm tính năng **sửa ảnh ngay trong màn tạo bài viết**: `apps/frontend/src/components/media/media.component.tsx` — rê chuột lên ảnh đính kèm → hiện nút bút chì → mở `FilerobotEditor` với chính ảnh đó làm nguồn → lưu xong **thay luôn ảnh cũ trong bài**. (Trước đó chỉ thư viện media mới sửa được ảnh; trong composer chỉ có "Design Media" tạo ảnh mới.)
  - `npx tsc --noEmit -p apps/frontend/tsconfig.json` → **EXIT=0**.
  - **Chưa commit, chưa chạy thử trên app thật.**

---

## 3. Còn phải làm

### A. Môi trường & bí mật
- [ ] Copy `.env` từ máy A sang: `scp C:/Media_Hub_VietAnh/.env machineB:D:/media-hub/.env` (file này **không có trong git**). Đối chiếu với `.env.production.example`. → **xem Q2 ở §0**: phiên Claude ở máy A bị deny rule chặn đọc `.env`, phải chủ máy tự copy hoặc mở quyền.
- [ ] Nếu bản đang chạy ở máy A có thư mục `CONFIG_DIR` / volume `/config` (nơi lưu API key nhập qua UI) → copy sang.

### B. Dữ liệu đang chạy
- [ ] Postgres: dump ở máy A → restore ở máy B.
- [ ] `uploads/`: copy toàn bộ media.
- [ ] ⚠️ **Máy B đang chạy sẵn một Postiz BẢN OFFICIAL**: container `postiz` = `ghcr.io/gitroomhq/postiz-app:latest`, compose `C:\va-apps\docker-compose.postiz.yml`, **cổng 4007**, volumes `postiz_postiz-uploads` + `postiz_postiz-config`, kèm `postiz-postgres` + `postiz-redis`. Bản này **không có custom** (Claude caption, Zalo, /viral, thương hiệu).
  → **QUYẾT ĐỊNH CẦN ANH DƯƠNG/PHI HÙNG CHỐT:** thay hẳn nó bằng bản custom, hay chạy song song ở cổng khác? Cổng 4007 hiện đang bận. Nếu container cũ có dữ liệu thật thì phải migrate/ giữ lại.

### C. Deploy (theo `docs/DEPLOY.md` đã có sẵn trong repo)
- [ ] `cp .env.production.example .env` → điền `FRONTEND_URL`, `JWT_SECRET`, `POSTGRES_PASSWORD`, `HUB_BOT_TOKEN`, `ZALO_DASHBOARD_PASS`.
- [ ] `docker compose -f docker-compose.prod.yaml up -d --build` (build từ source, lần đầu 15–30 phút; gồm backend + frontend + **orchestrator/Temporal** + Elasticsearch → cần **RAM ≥ 4 GB** cho riêng stack này).
- [ ] Kiểm tra: `curl -I http://localhost:4007/` → **307** là OK.
- [ ] Reverse proxy HTTPS (Caddy/nginx) nếu ra domain.

### D. CI/CD
- [ ] Xem `.github/workflows/`: `build-containers.yml`, `build.yml`, `deploy.yml`, `codeql.yml`, `build-extension.yaml`, `publish-extension.yml`, `stale.yml` — kiểm `deploy.yml` đang deploy đi đâu và cần secrets GitHub nào.
- [ ] `gh` trên máy B: token của **cả hai** account (`hungnguyen-phi`, `phihung13`) đã **hết hạn** → `gh auth login -h github.com` để push/pull private được. (Clone thì không cần vì repo public.)

### E. Tri thức + lịch sử chat Claude Code
- [ ] Lịch sử chat dự án: máy A `C:\Users\ASUS\.claude\projects\C--Media-Hub-VietAnh` (**22 MB**, 4 transcript) → máy B `C:\Users\Anti Gravity\.claude\projects\D--media-hub` (**phải đổi tên folder theo đường dẫn mới** — Claude Code đặt tên folder theo cwd: `D:\media-hub` → `D--media-hub`).
- [ ] Bộ nhớ (memory) của Claude trong các folder `projects\<tên>\memory\*`.
- [ ] Skills + plugins: `C:\Users\ASUS\.claude\skills\`, `C:\Users\ASUS\.claude\plugins\`, `settings.json`, `history.jsonl`.
- [ ] `C:\Users\ASUS\.claude.json` (cấu hình MCP server) — ⚠️ **chứa token**, cân nhắc lọc trước khi copy.
- [x] Docs & tri thức trong repo đã sẵn theo git: `CLAUDE.md`, `.claude/settings.json`, `docs/DEPLOY.md`, `docs/MEDIA_HUB_HANDOFF.md`, `docs/PRODUCT.md`, `docs/TRI-THUC-COWORK-CAO-FACEBOOK.md`, `docs/demo-blueprint`, `docs/postiz-goc`.

### F. Dọn máy A
- [ ] Chỉ xoá/ngưng sau khi máy B chạy ổn + dữ liệu khớp. Folder rác cần dọn: `D:\01-Truong-Viet-Anh\Media_Hub_VietAnh` (bản Postiz cũ).

---

## 4. Quy tắc làm việc

1. **Không build/chạy app trên máy A.** Máy A chỉ còn để copy dữ liệu sang.
2. Trước khi sửa code: `git remote -v` phải ra `phihung13/medida-hub`.
3. Đụng tới container đang chạy trên máy B (postiz, n8n, moodle, planka, va-*, major-dashboard) → **hỏi trước**, đó là dịch vụ đang phục vụ thật.
4. Lệnh qua SSH từ máy A: `ssh machineB "powershell -NoProfile -Command \"cd D:\media-hub; <lệnh>\""`.
5. **Mọi câu hỏi / quyết định / phát hiện đều phải ghi vào file này** (§0 nếu đang chờ chốt, §5 nếu đã xong). Nói trong chat mà không ghi vào đây = mất khi hết phiên.

## ⚠️ 5.1 SU CO DA XU LY: Docker Desktop khong len sau khi khoi dong lai may B (2026-09-21)

**Trieu chung:** Nguoi dung tat/bat lai may B de ranh tay dung ban song song. Sau khi bat lai,
Docker Desktop bao hop thoai "There was a problem with WSL":
```
Wsl/Service/RegisterDistro/MountDisk/HCS/E_ACCESSDENIED:
wsl.exe --import-in-place docker-desktop f:\docker-wsl\dockerdesktopwsl\main\ext4.vhdx
Failed to attach disk ... Access is denied.
```
Sau buoc do, ket tiep o man "Starting the Docker Engine" - treo hon 14 phut, log
com.docker.backend.exe.log lap lai {"docker":"starting",...} khong tien trien,
`wsl --list --verbose` bao "has no installed distributions".

**Chan doan (theo thu tu da loai tru):**
1. `docker ps` sau reboot bao loi ket noi npipe (daemon chua chay).
2. `Get-Process 'Docker Desktop'` khong co tien trinh nao - Docker Desktop KHONG tu khoi dong
   cung Windows tren may nay.
3. `Start-Process` qua SSH thuong (non-interactive) ban ra nhung tien trinh "bien mat" ngay.
   Nguyen nhan: SSH (OpenSSH server) chay trong session dich vu rieng (Session 0), tach biet
   khoi session desktop tuong tac (`query session` cho thay user claudia dang o session console
   ID 1). App GUI launch tu SSH khong "nhin thay" desktop do.
   -> Cach lach: dung Task Scheduler ban vao dung session tuong tac:
   ```
   schtasks /create /tn "TempStartDocker" /tr "\"C:\Program Files\Docker\Docker\Docker Desktop.exe\"" /sc once /st 00:00 /ru claudia /it /f
   schtasks /run /tn "TempStartDocker"
   ```
   (`/it` = chay tuong tac, khong can mat khau, chi chay duoc khi user do dang dang nhap.)
4. Len GUI duoc nhung van bao loi WSL y het -> kiem `icacls` tren file .vhdx that:
   `F:\Docker-WSL\DockerDesktopWSL\main\ext4.vhdx` (dia he thong WSL, 104 MB) va
   `...\disk\docker_data.vhdx` (dia du lieu container that, 47 GB, ghi lan cuoi dung luc
   truoc khi tat may - DU LIEU KHONG MAT). ACL chi co Administrators/SYSTEM/Authenticated Users/
   Users - THIEU nhom `NT VIRTUAL MACHINE\Virtual Machines` (SID S-1-5-83-0), nhom bat buoc
   de Hyper-V/HCS duoc phep mount file .vhdx vao VM. Day la nguyen nhan goc cua E_ACCESSDENIED.
5. Fix: cap quyen (chi them, khong xoa ACE nao khac):
   ```
   icacls "F:\Docker-WSL" /grant "NT VIRTUAL MACHINE\Virtual Machines:(OI)(CI)F" /T
   ```
   Chay tay lai dung lenh mount de xac nhan:
   `wsl --import-in-place docker-desktop "F:\...\ext4.vhdx"` -> "The operation completed
   successfully." `wsl --list --verbose` sau do thay distro docker-desktop (Stopped). Kill het
   tien trinh Docker Desktop cu, chay lai qua scheduled task -> engine len binh thuong
   (`docker info` -> ServerVersion 29.3.1).
6. He qua phu: ca 15 container tu khoi dong lai theo `restart: always`, nhung 3 container cua
   `moodle-lms-vas` (moodle/redis/db) bi vuong race-condition, Exited (255) ngay khi vua len
   (log ung dung ben trong hoan toan sach, khong phai loi app) - chi can
   `docker start moodle-lms-vas-db-1 moodle-lms-vas-redis-1` roi
   `docker start moodle-lms-vas-moodle-1` (dung thu tu phu thuoc) la khoi phuc binh thuong.
   KHONG mat du lieu o bat ky container nao.

**Bai hoc cho lan khoi dong lai may B sau nay:**
- Docker Desktop KHONG tu chay cung Windows tren may nay -> sau khi bat may, phai tu tay bat
  Docker Desktop (hoac dung thu thuat scheduled-task o tren neu lam qua SSH).
- Neu gap lai loi WSL E_ACCESSDENIED khi mount .vhdx tren o F: -> kiem tra ACL truoc tien,
  khong voi "Reset to factory defaults" (thao tac do xoa sach du lieu container).
- Sau khi engine len, luon `docker ps -a` doi chieu lai dung 15 container nhu truoc khi tat may -
  container nao Exited do race-condition thi `docker start` lai theo thu tu phu thuoc (DB/cache
  truoc, app sau), khong can `docker compose up`, khong dung volume.

---

## 5. Nhật ký

- **2026-09-21** — Dựng SSH máy A→B; clone repo về `D:\media-hub`; `pnpm install`; thêm nút sửa ảnh trong composer (typecheck pass, chưa commit). Phát hiện máy B đang chạy Postiz bản official ở cổng 4007 → cần chốt hướng thay thế.
- **2026-09-21 (tiep)** - Chot Q1: chay song song o cong 4008. Nguoi dung khoi dong lai may B; Docker Desktop khong tu len (khong auto-start cung Windows) + loi WSL E_ACCESSDENIED (thieu ACL NT VIRTUAL MACHINE\Virtual Machines tren F:\Docker-WSL) -> da chan doan va sua (xem SS5.1). 15 container that da khoi phuc du, khong mat du lieu. Dang tiep tuc dung ban custom song song cong 4008.
- **2026-09-22 — Loạt sửa lớn, đã test bằng dev server cục bộ (Postgres/Redis/Temporal riêng, DB test, KHÔNG đụng dữ liệu thật):**
  - **Trình quản lý media** (`media.component.tsx`): nút "Design Media" trong composer giờ mở modal lưới ảnh — kéo-thả đổi thứ tự (kèm phím mũi tên thay thế cho ai không dùng chuột), sửa từng ảnh bằng Filerobot ngay tại chỗ, thêm ảnh/thiết kế mới không cần đóng modal. Thay hẳn dải ảnh 40px vỡ trận khi đính nhiều chục ảnh.
  - **Ảnh ẩn (hidden) thay vì xoá hẳn**: `MediaDto` + `post.activity.ts` hỗ trợ cờ `hidden`/`hiddenReason` trên từng media — ảnh ẩn vẫn hiện trong composer (mờ đi + huy hiệu, nút mắt 👁 để bật/tắt) nhưng bị lọc khỏi nội dung gửi cho nền tảng lúc đăng thật.
  - **Filerobot editor**: bỏ nút đóng (✕) trùng với nút gốc của thư viện + bỏ dòng gợi ý thừa trong thanh công cụ.
  - **Zalo — bỏ tính năng "Lọc nhóm hiển thị"** (groupAllowlist) theo yêu cầu user: dropdown chọn nhóm ở tab Nhóm→Trang giờ luôn hiện đủ mọi nhóm; tự xoá allowlist cũ nếu có khi tải trang.
  - **Nhãn nền tảng trong dropdown chọn kênh** (Nhóm→Trang): hiện dạng "Tên kênh · Facebook" thay vì chỉ tên (nhiều kênh trùng tên khác nền tảng, không phân biệt được).
  - **Facebook — bình luận tự động không đăng được thật**: thiếu scope OAuth `pages_manage_engagement` (khác `pages_manage_posts`, chỉ cho đăng BÀI không cho đăng BÌNH LUẬN) → đã thêm vào `facebook.provider.ts`. ⚠️ Kênh đã nối từ trước phải bấm "Nối lại" (Reconnect) mới có quyền mới.
  - **Chân bài (footer) chèn sai chỗ khi hashtag nối liền câu cuối** (không xuống dòng riêng): `apply.post.footer.ts` trước chỉ nhận diện hashtag đứng riêng dòng → đã sửa sang bắt dải hashtag ở SÁT CUỐI toàn bộ nội dung bất kể xuống dòng hay không, chân bài luôn nằm trên hashtag.
  - **Gộp repo bot Zalo vào monorepo**: `apps/zalo-bot` (trước đây `docker-compose.prod.yaml` build thẳng từ `github.com/phihung13/zalo-bot-group-put-image-video`, tách rời dễ thất lạc thay đổi) — gộp bằng `git subtree add --prefix=apps/zalo-bot ... --squash`, giữ lịch sử commit gốc. `docker-compose.prod.yaml` build LOCAL (`./apps/zalo-bot`) thay vì kéo GitHub. `pnpm-workspace.yaml` loại trừ `apps/zalo-bot` (tự quản lý bằng npm riêng, không chung dependency graph pnpm).
    - Trong lúc gộp, cũng sửa luôn 2 việc user yêu cầu cho pipeline lọc ảnh của bot: (1) ảnh bị lọc (trùng/mờ/tối) **không xoá** — vẫn lưu + đẩy sang Hub, chỉ gắn `hidden:true` cho người duyệt tự xem lại; (2) thêm lớp AI mới `safety.mjs` (Claude vision) chấm từng ảnh giữ lại, gắn `hidden` nếu mặt bị che khuất phần lớn hoặc có nguy cơ lộ da thịt/riêng tư trẻ em — fail-open (thiếu key/lỗi API thì không chặn ảnh nào). Luồng đăng Facebook/GBP trực tiếp kiểu cũ (không qua Hub) chỉ dùng ảnh an toàn, không bao giờ lộ ảnh đã bị lọc/chặn.
    - Bản clone rời cũ vẫn còn ở `D:\zalo-bot-repo` (dùng để làm subtree merge) — có thể xoá sau khi xác nhận `apps/zalo-bot` trong `D:\media-hub` chạy ổn.
  - **CHƯA COMMIT** các thay đổi trên (trừ 2 commit subtree merge zalo-bot) — đang chờ user duyệt trước khi commit.
