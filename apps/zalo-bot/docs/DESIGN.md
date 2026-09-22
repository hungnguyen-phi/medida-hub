---
name: Auto-Post · Zalo → Facebook
description: Bảng điều khiển duyệt & đăng bài cho quản trị trang trường mầm non — điềm tĩnh, đáng tin, rõ ràng.
colors:
  primary: "#0f7d8c"
  primary-deep: "#0a5e69"
  primary-tint: "#dff0f0"
  accent-amber: "#f5a524"
  success: "#1a9e54"
  success-deep: "#157a41"
  success-tint: "#e4f6ec"
  danger: "#d9412b"
  danger-deep: "#b3301f"
  danger-tint: "#fbeae7"
  danger-tint-2: "#f7dcd7"
  accent-ink: "#3a2a00"
  warn-bg: "#fff5e6"
  warn-border: "#f6dca5"
  warn-ink: "#9a6400"
  ink: "#18302e"
  ink-2: "#3a544f"
  ink-3: "#45554f"
  muted: "#5a6b67"
  label-ink: "#3a4b47"
  bg: "#eef3f2"
  surface: "#ffffff"
  surface-2: "#f1f6f5"
  border: "#e0e8e6"
  border-strong: "#c8d6d3"
  primary-glow: "#cfeceb"
  logo-2: "#2aa7b3"
  dot-idle: "#c4d2cf"
  empty-ink: "#bcccc8"
  shadow-veil: "rgba(0,0,0,.2)"
  scrim: "rgba(15,23,32,.46)"
typography:
  headline:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "normal"
  title:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  subtitle:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Be Vietnam Pro, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "0.04em"
  mono:
    fontFamily: "SF Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "10px"
  card: "12px"
  md: "14px"
  lg: "20px"
  full: "99px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "14px"
  lg: "18px"
  xl: "26px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
  button-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-danger:
    backgroundColor: "{colors.danger-tint}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "18px"
  pill-on:
    backgroundColor: "{colors.success-tint}"
    textColor: "{colors.success-deep}"
    rounded: "{rounded.full}"
    padding: "2px 9px"
  pill-off:
    backgroundColor: "{colors.danger-tint}"
    textColor: "{colors.danger-deep}"
    rounded: "{rounded.full}"
    padding: "2px 9px"
  chip:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.muted}"
    rounded: "{rounded.full}"
    padding: "4px 11px"
  nav-item-active:
    backgroundColor: "{colors.primary-tint}"
    textColor: "{colors.primary-deep}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
---

# Design System: Auto-Post · Zalo → Facebook

## 1. Overview

**Creative North Star: "Bàn trực ban điềm tĩnh" (The Calm Control Desk)**

Đây là bàn điều phối của một người trực: sáng sủa, gọn gàng, mọi nút trong tầm tay và không có báo động thừa. Người dùng — quản trị viên trang trường mầm non, không rành kỹ thuật — mở dashboard lên là thấy ngay còn bao nhiêu bài chờ, cần làm gì tiếp theo, và đăng một bài công khai là việc *an tâm, có kiểm soát*. Hệ thống thị giác phục vụ đúng một cảm giác: **điềm tĩnh, đáng tin, rõ ràng**.

Nền tảng là một mặt phẳng xanh-xám rất nhạt (`#eef3f2`) đỡ các tấm thẻ trắng nổi nhẹ — như giấy tờ xếp trên mặt bàn dưới ánh đèn dịu. Màu xanh dương `#0f7d8c` là giọng nói duy nhất của hành động và lựa chọn hiện hành; xanh lá cho việc đã đăng/đang chạy, đỏ cho hành động không thể hoàn tác, hổ phách cho cảnh báo nhẹ. Màu không bao giờ là trang trí — nó luôn *nói một điều gì đó về trạng thái*.

Hệ thống này **từ chối** thẩm mỹ "SaaS slop" do AI sinh ra: không hero gradient, không accent tím, không lưới thẻ giống hệt nhau lặp vô tận, không số liệu phóng đại kiểu marketing. Nó **cũng không** giả làm app mạng xã hội tiêu dùng — đây là công cụ vận hành, không phải bảng tin để lướt cho vui. Quen thuộc và nhất quán được ưu tiên hơn bất ngờ; công cụ "biến mất" vào trong công việc.

**Key Characteristics:**
- Phẳng-mặc-định: một bóng đổ mềm duy nhất, độ sâu đến từ tầng màu chứ không từ bóng đậm.
- Một giọng xanh dương: primary chỉ dùng cho hành động chính, mục đang chọn và chỉ báo trạng thái.
- Mật độ thoải mái, đọc rõ tiếng Việt có dấu, dùng tốt trên điện thoại.
- Bo góc dịu theo thang `sm 10 · card 12 · md 14 · lg 20 · full 99` (px), không nhọn, không bo tròn quá đà.
- Tiếng Việt đời thường trên mọi nhãn; thuật ngữ kỹ thuật chỉ xuất hiện khi bắt buộc.

## 2. Colors: Bảng màu Trực ban

Một bảng xanh-xám nhạt giữ cho mặt bàn yên tĩnh, để màu chức năng (xanh dương, xanh lá, đỏ, hổ phách) chỉ vang lên khi có chuyện cần nói.

### Primary
- **Mòng Két** (`#0f7d8c`): giọng nói của hành động và lựa chọn. Dùng cho nút chính ("Đăng nhập", "Lưu cấu hình"), mục điều hướng đang chọn (qua nền tint), viền focus của input, và logo. Đây là màu duy nhất được phép "lên tiếng".
- **Xanh Đậm** (`#0a5e69`): trạng thái hover của nút primary và chữ trên mục nav đang chọn. Sắc đậm hơn của chính Mòng Két, không phải một hue mới.
- **Xanh Tint** (`#eaf0fd`): nền của mục nav đang chọn và quầng focus-ring (`box-shadow 0 0 0 3px`). Đủ nhạt để chữ Xanh Đậm trên nó vẫn đọc tốt.

### Secondary
- **Hổ phách Cảnh báo** (`#f5a524`): chỉ dùng cho cảnh báo nhẹ và huy hiệu đếm — badge số bài chờ duyệt, chip "Tạm dừng". Không bao giờ dùng làm màu hành động.

### Tertiary
- **Xanh lá Hoàn tất** (`#1a9e54`) & **Xanh lá Đậm** (`#157a41`): trạng thái tích cực — nút "Đăng công khai", chấm Zalo đã kết nối (kèm quầng `rgba(26,158,84,.18)`), pill "có/bật". Tint nền `#e4f6ec` cho pill "on".
- **Đỏ Dứt khoát** (`#d9412b`) & **Đỏ Tint** (`#fbeae7`): hành động không thể hoàn tác và lỗi — nút "Bỏ bài", thông báo lỗi, chấm mất kết nối. Đỏ luôn đi với xác nhận.
- **Đỏ Đậm** (`#b3301f`): chữ đỏ trên nền Đỏ Tint khi cỡ nhỏ — pill "thiếu/tắt" (12px). Đạt ≈5.4:1 (WCAG AA); dùng thay `#d9412b` ở mọi chữ đỏ nhỏ trên nền tint. *(Nút "Bỏ bài" 14px-đậm vẫn dùng `#d9412b` vì là chữ lớn, ngưỡng 3:1.)*

### Neutral
- **Mực** (`#18302e`): chữ thân chính và tiêu đề. Nền của toast.
- **Mực Nhãn** (`#3a4659`): nhãn trường form (`<label>`), đậm hơn muted để đọc chắc.
- **Xám Phụ** (`#5a6b67`): chữ phụ, metadata, placeholder, tiêu đề cột bảng. Đạt ~4.8:1 trên nền `#eef3f2` (WCAG AA cho chữ nhỏ). *Đây là điểm sàn — không được nhạt hơn `#5a6b67`.*
- **Nền** (`#eef3f2`): mặt bàn, nền toàn trang.
- **Mặt Thẻ** (`#ffffff`) & **Mặt Phụ** (`#f7f9fc`): nền thẻ và nền thẻ lồng nhẹ / vùng input phụ.
- **Viền** (`#e3e8f0`): mọi đường kẻ, viền thẻ, gạch chia bảng.

### Named Rules
**Quy tắc Một Giọng Nói.** Mòng Két (`#0f7d8c`) chỉ dành cho hành động chính, mục đang chọn và viền focus. Nó không bao giờ là màu trang trí. Sự hiếm chính là điều khiến nó có sức nặng.

**Quy tắc Màu Có Nghĩa.** Mọi màu chức năng (xanh lá, đỏ, hổ phách) phải tương ứng một trạng thái thật. Nếu một mảng màu không nói lên trạng thái gì, nó sai — chuyển về neutral.

## 3. Typography

**Font Hiển thị & Thân bài:** Be Vietnam Pro (dự phòng `system-ui, sans-serif`)
**Font Mono:** SF Mono / `ui-monospace` (chỉ dùng cho dòng nhật ký)

**Character:** Một họ chữ duy nhất gánh toàn bộ — tiêu đề, nút, nhãn, thân bài, dữ liệu. Be Vietnam Pro là sans humanist Việt, dựng dấu thanh (ă, â, ê, ô, ơ, ư và các dấu) đẹp và rõ ở cỡ nhỏ — đúng tinh thần product UI: không cần cặp font hiển thị/thân bài, phân cấp đến từ cỡ và trọng lượng. Mono xuất hiện duy nhất ở dòng log, nơi căn cột thời gian quan trọng.

### Hierarchy
- **Headline** (700, 20px, lh 1.25): tiêu đề màn đăng nhập ("Đăng nhập"). Bậc lớn nhất, dùng tiết kiệm.
- **Title** (700, 17px, lh 1.3): tên thương hiệu và tiêu đề trang trên topbar ("Chờ duyệt", "Nhóm → Page").
- **Subtitle** (700, 15px, lh 1.4): tiêu đề trong thẻ (`card-head b`) — tên route, tên khối cấu hình.
- **Body** (400, 14px, lh 1.5): chữ thân chính, nội dung textarea, mô tả. Giới hạn ~65–75ch cho đoạn văn dài.
- **Label** (700, 13px, letter-spacing 0.04em, IN HOA): tiêu đề mục bên trong thẻ (`section-title`) và tiêu đề cột bảng (12px). Đây là *điểm nhịp* duy nhất được phép IN HOA giãn chữ.
- **Caption** (400, ~12px): metadata, thời gian, chú thích phụ — dùng màu Xám Phụ.
- **Mono** (400, 12.5px): dòng nhật ký, để thời gian và nội dung thẳng cột.

### Named Rules
**Quy tắc Một Họ Chữ.** Toàn bộ giao diện chạy trên Be Vietnam Pro. Không thêm font hiển thị, không cặp font "cho sang". Phân cấp = cỡ + trọng lượng, không phải font mới.

**Quy tắc IN HOA Có Chừng.** Chữ IN HOA giãn chữ chỉ dành cho nhãn mục và tiêu đề cột — những mốc định hướng nhỏ. Không IN HOA tiêu đề, nút hay câu văn.

## 4. Elevation

Hệ thống **phẳng-mặc-định**. Độ sâu đến từ tầng màu (nền `#eef3f2` → thẻ `#ffffff` → thẻ phụ `#f7f9fc`) và đường viền `#e3e8f0` mảnh, không phải từ bóng đậm. Chỉ một bóng đổ mềm duy nhất nâng thẻ lên khỏi mặt bàn; bóng nặng hơn dành riêng cho phần tử nổi tạm thời (toast, thẻ đăng nhập).

### Shadow Vocabulary
- **Bóng Thẻ** (`box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 4px 16px rgba(16,24,40,.06)`): bóng mặc định cho thẻ và thẻ đăng nhập. Khuếch tán, gần như vô hình — chỉ đủ tách thẻ khỏi nền.
- **Bóng Toast** (`box-shadow: 0 10px 30px rgba(0,0,0,.2)`): chỉ cho toast — phần tử nổi cao nhất, cần tách hẳn khỏi mặt phẳng.
- **Quầng Focus** (`box-shadow: 0 0 0 3px #eaf0fd`): vòng focus của input. Trên trạng thái tích cực dùng quầng xanh lá `0 0 0 3px rgba(26,158,84,.18)`.
- **Mờ nền Topbar** (`backdrop-filter: blur(8px)` trên `rgba(255,255,255,.7)`): topbar dính trên cùng, làm mờ nội dung cuộn phía dưới. Đây là *chức năng* (giữ ngữ cảnh khi cuộn), không phải glassmorphism trang trí.

### Named Rules
**Quy tắc Phẳng-Mặc-Định.** Bề mặt phẳng khi nghỉ. Độ sâu trước hết đến từ tầng màu và viền mảnh; bóng đổ chỉ là phương án cuối, và luôn mềm. Bóng đậm + blur nhỏ = giao diện kiểu 2014, cấm.

## 5. Components

Bộ component nghiêng về **vững & rõ ràng**: nút đặc, viền dứt khoát, trạng thái hover/focus thấy rõ. Mục tiêu là "bấm là chắc chắn" — hợp người không rành kỹ thuật, khó bấm nhầm.

### Buttons
- **Shape:** bo dịu (`border-radius: 10px`), padding `9px 15px`, trọng lượng 600, có gap cho icon. Nhấn xuống lún nhẹ 1px (`transform: translateY(1px)` khi `:active`).
- **Primary:** nền Mòng Két (`#0f7d8c`), chữ trắng. Hành động chính trên mỗi màn.
- **Success:** nền Xanh lá (`#1a9e54`), chữ trắng. Riêng cho "Đăng công khai".
- **Ghost:** nền trắng, chữ Mực, viền `1px #e3e8f0`. Hành động phụ ("Lưu sửa", "Đăng nháp"). Hover đổi nền `#f7f9fc` và viền đậm hơn.
- **Danger:** nền Đỏ Tint (`#fbeae7`), chữ Đỏ (`#d9412b`) — *không* phải nền đỏ đặc. Dành cho "Bỏ bài". Sự nhẹ nhàng có chủ đích: hành động phá hủy được nhìn thấy nhưng không hét lên.
- **Hover / Focus:** chuyển nền/viền/bóng trong `.18s`. Focus bàn phím luôn có viền rõ: `outline: 2px solid #0f7d8c; outline-offset: 2px`.

### Chips & Pills
- **Chip** (topbar): nền `#f7f9fc`, viền `1px #e3e8f0`, chữ Xám Phụ, bo tròn (`99px`). Biến thể `warn`: nền `#fff5e6`, viền `#f6dca5`, chữ `#9a6400` — cho chế độ "Tạm dừng".
- **Pill** (bảng): bo tròn, 12px/600. `on` = nền `#e4f6ec` chữ Xanh lá Đậm; `off` = nền Đỏ Tint chữ Đỏ Đậm (`#b3301f`, đạt AA). Đọc trạng thái token/route trong nháy mắt.
- **Badge** đếm (nav): nền Hổ phách `#f5a524`, chữ `#3a2a00`, bo tròn — số bài chờ duyệt.

### Cards / Containers
- **Corner Style:** bo dịu (`14px`); thẻ đăng nhập rộng tay hơn (`20px`).
- **Background:** trắng (`#ffffff`) trên nền bàn; thẻ cấu hình lồng dùng nền phụ (`#f7f9fc`).
- **Shadow Strategy:** Bóng Thẻ mềm (xem Elevation). Phẳng khi nghỉ.
- **Border:** `1px #e3e8f0` quanh mọi thẻ.
- **Internal Padding:** `18px`; khoảng cách giữa các thẻ `18px`.
- **Cấm thẻ lồng thẻ quá một bậc.** Thẻ cấu hình route lồng trong thẻ vùng là tối đa.

### Inputs / Fields
- **Style:** nền trắng, viền `1px #e3e8f0`, bo `10px`, padding `10px 12px`. Textarea `min-height: 96px`, `line-height: 1.6`, resize dọc.
- **Label:** đậm (600–700), 13px, màu Mực Nhãn (`#3a4659`), đặt phía trên trường.
- **Focus:** viền chuyển Mòng Két + Quầng Focus tint (`0 0 0 3px #eaf0fd`). Rõ ràng, không mơ hồ.
- **Placeholder:** màu Xám Phụ — phải đạt cùng ngưỡng tương phản như chữ thân, không nhạt hơn.

### Navigation
- **Sidebar** (248px, nền trắng, viền phải): các mục là nút full-width, bo `10px`, chữ 500. Hover nền `#f7f9fc`. **Đang chọn:** nền Xanh Tint (`#eaf0fd`), chữ Xanh Đậm (`#0a5e69`), icon Mòng Két.
- **Topbar** (cao 64px, dính trên): tiêu đề trang + chip trạng thái, nền mờ `blur(8px)`.
- **Mobile (≤760px):** sidebar trượt ra ngoài màn (`left:-260px`), nút menu hiện ở topbar mở/đóng bằng `.2s`. Vùng chạm đủ lớn.

### Trạng thái rỗng & Toast (Signature)
- **Empty state:** icon lớn màu `#c2ccdb` + câu *dạy giao diện* (vd: "Chưa có bài nào chờ duyệt. Khi có người gửi ảnh vào nhóm Zalo, bài sẽ tự hiện ở đây."). Không bao giờ chỉ ghi "Trống".
- **Toast:** góc dưới-phải, nền Mực (`#18302e`), chữ trắng, bo `12px`, Bóng Toast. Vào/ra bằng trượt + mờ `.25s`, tự ẩn sau ~2.6s. Phản hồi mọi hành động lưu/đăng/bỏ.

## 6. Do's and Don'ts

### Do:
- **Do** giữ Mòng Két (`#0f7d8c`) cho đúng hành động chính, mục đang chọn và viền focus — theo **Quy tắc Một Giọng Nói**.
- **Do** dùng một bóng đổ mềm duy nhất; tạo độ sâu bằng tầng màu `#eef3f2` → `#ffffff` → `#f7f9fc` và viền `1px #e3e8f0`.
- **Do** chạy mọi thứ trên Be Vietnam Pro; phân cấp bằng cỡ và trọng lượng (700/600/400), không thêm font.
- **Do** giữ chữ thân ở Mực (`#18302e`); chữ phụ không nhạt hơn Xám Phụ (`#5a6b67`) — kể cả placeholder. Tương phản thân bài ≥ 4.5:1.
- **Do** viết nhãn bằng tiếng Việt đời thường; chỉ lộ thuật ngữ (threadId, token, biến môi trường) khi bắt buộc và luôn kèm giải thích.
- **Do** xác nhận rõ mọi hành động không hoàn tác (đăng công khai, bỏ bài) và nói rõ bài sẽ đi đâu — công khai hay nháp.
- **Do** kiểm tra ở ≤760px: sidebar thu gọn, nút và vùng chạm đủ lớn, tiêu đề tiếng Việt dài không tràn.
- **Do** đặt viền focus rõ (`outline: 2px solid #0f7d8c`) trên mọi phần tử tương tác; thao tác được bằng bàn phím.

### Don't:
- **Don't** rơi vào "SaaS slop" kiểu AI: cấm hero gradient, accent tím, lưới thẻ giống hệt nhau lặp vô tận, mẫu "số to · nhãn nhỏ · gradient".
- **Don't** làm cho dashboard giống app mạng xã hội tiêu dùng (Facebook/Instagram). Đây là công cụ vận hành, không phải feed để lướt.
- **Don't** dùng chữ gradient (`background-clip: text`) hay glassmorphism trang trí. `backdrop-filter` chỉ dùng có chức năng (topbar dính).
- **Don't** dùng viền-sọc-cạnh (`border-left`/`border-right` > 1px làm dải màu) trên thẻ, callout hay alert.
- **Don't** dùng nền đỏ đặc cho nút "Bỏ bài" — giữ Đỏ Tint + chữ đỏ để hành động phá hủy thấy được mà không hét lên.
- **Don't** dùng xám nhạt hơn `#5a6b67` "cho sang"; đó là lý do lớn nhất khiến giao diện khó đọc.
- **Don't** thêm bóng đậm + blur nhỏ (cảm giác app 2014) hay chuyển động trang trí không nói lên trạng thái.
- **Don't** lồng thẻ trong thẻ quá một bậc, và đừng đổi kiểu một nút "Đăng" ở hai nơi khác nhau — nhất quán là một đức tính ở đây.
