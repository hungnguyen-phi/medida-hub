# 📋 Prompt mẫu: dời một app sang máy host để làm việc tiếp với Claude

File này có 2 phần:
- **Phần A** — prompt thật đã dùng cho **Việt Anh Media Hub** (dán vào Claude là chạy).
- **Phần B** — cùng prompt đó nhưng để trống, dùng lại cho **app khác**.
- **Phần C** — các bẫy đã gặp thật + kinh nghiệm, đọc trước khi làm app tiếp theo.

---

## A. Prompt cho Việt Anh Media Hub

```
Hãy dời app "Việt Anh Media Hub" sang máy host rồi làm việc tiếp ở đó. Máy hiện tại chỉ
dùng để lấy dữ liệu, KHÔNG build/chạy gì trên máy này nữa.

== MÁY ĐÍCH ==
- Host: DESKTOP-DGV1VHG, Tailscale IP 100.105.113.97
- SSH: `ssh machineB` (alias sẵn trong ~/.ssh/config), key ~/.ssh/id_ed25519_machineB
- ⚠ Username đăng nhập là "claudia" — KHÔNG phải "Anti Gravity" (đó chỉ là tên thư mục
  profile C:\Users\Anti Gravity). Ghi sai user sẽ ra lỗi "Permission denied (publickey)"
  dù key đã được nạp đúng.
- Thư mục app bên host: D:\media-hub
- Bên host: node v24.16, pnpm (chạy v10.6.1 theo field packageManager), Docker Desktop,
  claude.exe 2.1.278. git có ở C:\Program Files\Git\cmd\git.exe nhưng KHÔNG nằm trong PATH
  của phiên SSH non-interactive → thêm: $env:PATH += ';C:\Program Files\Git\cmd'

== NGUỒN ==
- Repo thật: https://github.com/phihung13/medida-hub (PUBLIC → clone không cần đăng nhập)
- Bản làm việc ở máy cũ: C:\Media_Hub_VietAnh
- ⚠ BẪY: folder D:\01-Truong-Viet-Anh\Media_Hub_VietAnh là bản clone Postiz gốc cũ
  (remote gitroomhq/postiz-app), KHÔNG phải app thật. Luôn `git remote -v` để xác nhận
  trước khi sửa bất cứ dòng code nào.

== VIỆC CẦN LÀM ==
1) Clone repo sang D:\media-hub bên host, kiểm tra HEAD khớp với bản ở máy cũ.
2) `pnpm install` bên host (~8 phút, postinstall tự chạy prisma generate).
3) Mang những thứ KHÔNG nằm trong git sang:
   - .env  (từ C:\Media_Hub_VietAnh\.env → D:\media-hub\.env). Đối chiếu .env.production.example.
   - Thư mục uploads (media đã đăng).
   - Dump Postgres của bản đang chạy → restore bên host.
   - Thư mục CONFIG_DIR / volume /config (nơi lưu API key nhập qua UI).
   - Mọi nhánh/commit chưa push: kiểm `git status` + `git rev-list --count --left-right @{u}...HEAD`
     cho MỌI nhánh, push hết hoặc `git bundle` mang sang, trước khi bỏ máy cũ.
4) Mang tri thức + lịch sử chat Claude sang, để phiên Claude bên host hiểu tiếp mạch việc:
   - Lịch sử chat: máy cũ C:\Users\ASUS\.claude\projects\C--Media-Hub-VietAnh
     → host C:\Users\Anti Gravity\.claude\projects\D--media-hub
     ⚠ PHẢI đổi tên thư mục theo đường dẫn mới: Claude Code đặt tên folder = đường dẫn cwd
       với mọi ký tự không phải chữ/số đổi thành "-" (D:\media-hub → D--media-hub).
       Không đổi tên thì mở claude ở thư mục mới sẽ không thấy lịch sử cũ.
   - Bộ nhớ (memory) của Claude: các file trong projects\<tên>\memory\ + MEMORY.md
   - Skills + plugins + settings: C:\Users\ASUS\.claude\{skills,plugins,settings.json,history.jsonl}
   - ⚠ C:\Users\ASUS\.claude.json chứa token MCP → lọc/ cân nhắc trước khi copy.
   - Cỡ dữ liệu: .claude tổng ~3.1 GB (riêng projects 2.9 GB) → kiểm dung lượng ổ đích trước.
5) Deploy + CI/CD — đọc và nắm trong repo (đã có sẵn, không phải viết lại):
   - docs/DEPLOY.md: `docker compose -f docker-compose.prod.yaml up -d --build`
     (build TỪ SOURCE để có đủ custom: Claude caption, Zalo, /viral; gồm backend + frontend +
     orchestrator/Temporal + Elasticsearch; RAM ≥ 4 GB; lần đầu build 15–30 phút).
     Kiểm tra: `curl -I http://localhost:4007/` phải ra 307.
   - docker-compose.yaml (image official, KHÔNG có custom) vs docker-compose.prod.yaml (bản custom) — đừng lẫn.
   - .github/workflows/: build.yml, build-containers.yml, deploy.yml, codeql.yml,
     build-extension.yaml, publish-extension.yml, stale.yml → đọc deploy.yml xem deploy đi đâu,
     cần secrets GitHub nào.
   - gh CLI bên host: token của cả hungnguyen-phi lẫn phihung13 đã hết hạn → `gh auth login` mới push được.
   - ⚠ Bên host ĐANG chạy sẵn container `postiz` bản OFFICIAL ở đúng cổng 4007
     (compose C:\va-apps\docker-compose.postiz.yml, volumes postiz_postiz-uploads / postiz_postiz-config,
     kèm postiz-postgres + postiz-redis). Phải chốt: thay hẳn hay chạy song song cổng khác.
     KHÔNG tự tắt/xoá container đang chạy — hỏi trước.
6) Ghi lại toàn bộ vào docs/MIGRATION-TO-HOST.md trong repo: việc đã xong, việc còn lại,
   câu hỏi đang chờ chốt (kèm lý do chặn + ai chốt + ngày), nhật ký.
   Quy tắc: nói trong chat mà không ghi vào file = mất khi hết phiên.

== CÁCH LÀM ==
- Chạy lệnh bên host qua SSH:
  ssh machineB "powershell -NoProfile -Command \"cd D:\media-hub; <lệnh>\""
- Sửa file bên host: scp file về máy này → sửa → scp trả lại → kiểm bằng `git diff --stat` bên host.
- Kiểm tra code: chạy `npx tsc --noEmit -p apps/frontend/tsconfig.json` BÊN HOST, không chạy ở máy này.

== ĐOẠN CHAT TIẾP THEO (khi đã sang host) ==
Mở cmd tại D:\media-hub → gõ `claude` → dán:
  "Đọc docs/MIGRATION-TO-HOST.md rồi làm tiếp checklist trong đó. Việc đang dở:
   apps/frontend/src/components/media/media.component.tsx có thay đổi chưa commit (nút sửa
   ảnh ngay trong màn tạo bài viết, tsc đã pass) — chạy app thử rồi commit.
   Trước khi làm gì đụng container đang chạy thì hỏi tôi."
```

---

## B. Bản trống để dùng cho app khác

```
Hãy dời app "<TÊN APP>" sang máy host rồi làm việc tiếp ở đó. Máy hiện tại chỉ dùng để lấy
dữ liệu, KHÔNG build/chạy gì trên máy này nữa.

== MÁY ĐÍCH ==
- Host: <TÊN MÁY>, IP <IP TAILSCALE>
- SSH: ssh <ALIAS>   (username đăng nhập: <USER> — kiểm bằng `whoami` bên host, đừng đoán
  theo tên thư mục C:\Users\...)
- Thư mục app bên host: <ĐƯỜNG DẪN MỚI>
- Bên host có sẵn: <node/pnpm/docker/claude ...>; công cụ nào không nằm trong PATH của SSH
  thì ghi rõ đường dẫn tuyệt đối.

== NGUỒN ==
- Repo: <URL>  (public/private?)   - Bản làm việc ở máy cũ: <ĐƯỜNG DẪN CŨ>
- Các folder trùng tên/bản cũ dễ nhầm: <LIỆT KÊ> → luôn `git remote -v` trước khi sửa code.

== VIỆC CẦN LÀM ==
1) Clone + `<lệnh cài deps>` bên host.
2) Mang thứ KHÔNG có trong git: .env, uploads/media, dump DB, thư mục config, nhánh chưa push.
3) Mang tri thức + lịch sử chat Claude:
   <.claude\projects\ TÊN-CŨ>  →  <.claude\projects\ TÊN-MỚI theo đường dẫn mới>
   kèm memory/, skills/, plugins/, settings.json. (.claude.json chứa token → lọc.)
4) Deploy + CI/CD: đọc <file deploy> và .github/workflows/, ghi rõ cổng, secrets, lệnh chạy,
   cách kiểm tra "chạy được".
5) Xung đột cổng / dịch vụ đang chạy sẵn bên host: liệt kê `docker ps` trước, KHÔNG tự tắt gì.
6) Ghi mọi thứ vào <docs/MIGRATION-*.md>: đã xong / còn lại / câu hỏi chờ chốt / nhật ký.

== ĐOẠN CHAT TIẾP THEO ==
Bên host: cd <ĐƯỜNG DẪN MỚI> → claude → "Đọc <file bàn giao> rồi làm tiếp checklist."
```

---

## C. Bẫy đã gặp thật + kinh nghiệm

| # | Bẫy | Dấu hiệu | Cách xử |
|---|---|---|---|
| 1 | **Username SSH ≠ tên thư mục profile** | `Permission denied (publickey,password,keyboard-interactive)` dù key đúng | Thử user khác; đúng ra là `claudia` trong khi profile là `C:\Users\Anti Gravity`. Xác nhận bằng `whoami` bên host |
| 2 | **Sửa nhầm cây code chết** | Folder trông giống hệt, có cả CLAUDE.md | `git remote -v` + `git log -1`; bản cũ ở đây không có commit riêng, source đứng im từ 2026-07-01 |
| 3 | **Tính năng đã có sẵn, viết lại là thừa** | Đã ngồi viết editor ảnh bằng canvas ~700 dòng, hoá ra repo thật đã dùng Filerobot | Đọc code repo THẬT trước khi viết; ở đây chỉ cần nối editor có sẵn vào composer |
| 4 | **git không có trong PATH của SSH non-interactive** | `'git' is not recognized` | `$env:PATH += ';C:\Program Files\Git\cmd'` hoặc gọi đường dẫn tuyệt đối |
| 5 | **Tên thư mục lịch sử chat gắn với đường dẫn** | Sang máy mới mở claude không thấy lịch sử | Đổi tên folder trong `.claude\projects` theo cwd mới (mọi ký tự lạ → `-`) |
| 6 | **Cổng bị dịch vụ khác chiếm bên host** | compose dựng lên là đụng | `docker ps` trước; ở đây Postiz bản official đã giữ 4007 |
| 7 | **pnpm -v nói 9 nhưng chạy bằng 10.6.1** | Log install ghi phiên bản khác | Do field `packageManager` trong package.json — đừng cài đè pnpm |
| 8 | **.env bị deny rule chặn đọc** | Claude không copy được | Chủ máy tự copy, hoặc mở quyền; đừng cố lách |
| 9 | **Build làm máy cũ hết RAM** | Tiến trình build nền bị kill giữa chừng | Build bên host; máy cũ chỉ code + chat |
| 10 | **Sửa file bên host bằng heredoc/backtick** | Nội dung markdown có dấu \` bị shell chạy như lệnh | scp về → sửa bằng script với heredoc `<<'PY'` (có nháy) → scp trả lại → `git diff --stat` kiểm |
| 11 | **Việc chưa push nằm rải rác** | Bỏ máy cũ là mất | Trước khi bỏ máy: quét mọi repo `git status` + `rev-list --left-right @{u}...HEAD` cho mọi nhánh |

**Kinh nghiệm rút ra:** thứ tự đúng là — (1) xác minh đang đứng đúng cây code, (2) cứu việc chưa push,
(3) mang thứ không nằm trong git, (4) mang tri thức + lịch sử chat, (5) mới tới build/deploy,
(6) ghi hết vào file bàn giao trong repo, (7) chỉ bỏ máy cũ sau khi bên mới chạy đúng và dữ liệu khớp.
