---
target: public/index.html
total_score: 28
p0_count: 0
p1_count: 3
timestamp: 2026-06-25T12-33-38Z
slug: public-index-html
---
# Critique — public/index.html (Dashboard Zalo→FB)

State: sau vòng sửa đồng thuận #1 (modal trong-app, nút đăng công khai/nháp tách bạch, giới hạn ảnh +N, mobile hardening, bảng màu teal). Detector: 0. Browser automation: không có (review thủ công + detector).

## Design Health Score (Nielsen 10)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Spinner/toast/cardMsg/live tab tốt; thiếu tiến độ % khi upload nhiều ảnh |
| 2 | Match System / Real World | 3 | Tiếng Việt mộc; tab Token rò thuật ngữ FB tiếng Anh; "Page" vs "Trang" |
| 3 | User Control & Freedom | 3 | Modal có Huỷ/Esc; chưa hoàn tác được "đã duyệt" |
| 4 | Consistency & Standards | 2 | Ngôn ngữ icon chia đôi: emoji (🗑✅📷🎬) ở thân vs Lucide SVG ở khung; nhãn "Đã duyệt" vs nội dung "đã đăng" |
| 5 | Error Prevention | 3 | Đã có modal xác nhận + tách công khai/nháp + đăng xuất an toàn; CHƯA bỏ được 1 ảnh nhạy cảm trước khi đăng |
| 6 | Recognition Rather Than Recall | 3 | Nav có nhãn chữ; dropdown có tìm kiếm; Token bắt nhớ các bước FB |
| 7 | Flexibility & Efficiency | 2 | Không phím tắt, không duyệt hàng loạt, không bottom-nav cho ngón cái |
| 8 | Aesthetic & Minimalist | 3 | Đã gập nâng cao + giới hạn ảnh; còn emoji lẫn lộn + tường chữ Token |
| 9 | Error Recovery | 3 | Lỗi hiện inline tiếng Việt ("thử lại"), lỗi Graph được nêu rõ |
| 10 | Help & Documentation | 3 | field-help + steps + empty-state hướng dẫn tốt |
| **Total** | | **28/40** | **Good (cận Acceptable)** |

## Anti-Patterns Verdict
- **Detector**: 0 findings (sạch — màu trong DESIGN.md, tương phản AA, không slop CSS).
- **LLM**: Tell AI-slop rõ nhất còn lại = ngôn ngữ icon chia đôi (emoji màu theo OS lẫn với Lucide SVG đơn sắc), phá tông teal điềm tĩnh. Ngoài ra bảng màu teal + register product là cam kết, không slop.

## What's Working
1. Bảng màu teal "trực ban" cam kết, tương phản AA thật (đã đo), thoát xanh-SaaS.
2. Luồng duyệt giờ AN TOÀN: 2 nút "Đăng công khai" / "Lưu nháp" tách bạch + modal xác nhận đúng đích Trang — chặn lỡ đăng ảnh trẻ công khai.
3. Tiến trình trực quan: live tab, spinner, toast, trạng thái bài rõ ràng.

## Priority Issues
- **[P1] Ngôn ngữ icon chia đôi (emoji vs SVG)**. Why: phá nhất quán + là tell AI-slop. Fix: thay emoji trong nút/thân bằng cùng bộ Lucide SVG đơn sắc. Command: /impeccable polish.
- **[P1] Không bỏ được 1 ảnh xấu/nhạy cảm trước khi đăng**. Why: bot tự gom ảnh phụ huynh; lỗ hổng an toàn + đủ-chức-năng. Fix: nút ✕ trên từng ảnh trong vùng Sửa, gửi danh sách ảnh-giữ. Command: /impeccable harden.
- **[P1] Điều hướng dồn góc trên-trái (mobile)**. Why: ngoài tầm ngón cái, app dùng chủ yếu trên điện thoại. Fix: bottom tab bar cho 3 tab dùng nhiều, hoặc đưa nút menu sang phải. Command: /impeccable adapt.
- **[P2] Tab Token: tường thuật ngữ + ô dán token tận cuối**. Why: đối tượng không kỹ thuật. Fix: đưa ô dán token + nút lên đầu (sticky), gập 4 bước, tách phần "cho người hỗ trợ". Command: /impeccable clarify.
- **[P2] Nhãn lẫn lộn (Đã duyệt/đã đăng, Page/Trang) + thiếu duyệt hàng loạt**. Fix: thống nhất thuật ngữ; thêm chọn nhiều + duyệt N bài. Command: /impeccable clarify.

## Persona Red Flags
- **Casey (mobile một tay)**: nav top-left khó với; .combo-item ~38px (<44px) dễ chạm nhầm chọn sai nhóm; bù lại state lưu server-side, ảnh lazy-load.
- **Cô Hồng (GV mầm non, không rành công nghệ — project persona)**: tab Token jargon FB chặn đường; "Page" vs "Trang" gây ngờ; nhưng đăng công khai/nháp giờ đã rõ ràng nhờ 2 nút + modal.
- **Alex (power user)**: không phím tắt, không bulk approve, duyệt từng-bài-một khi tồn nhiều bài.
- **Sam (a11y)**: pill on/off có kèm chữ (không chỉ màu) — ổn; modal có focus + Esc + aria-live; emoji trong nút có thể đọc lạ trên screen reader.

## Minor Observations
- Bản nháp xem trước chưa hiển thị captionFooter (chân bài tự chèn) → "thấy một đằng, đăng một nẻo".
- .sw vẫn là checkbox HTML nhỏ; "Bật" và "Đăng công khai" sát nhau, nên tách + tô cảnh báo cho "Đăng công khai".
- Thiếu tiến độ khi upload album lớn (chỉ spinner chung).

## Questions to Consider
- Điều hướng có nên thành bottom-nav để hợp điện thoại một tay không?
- Có nên cho chọn ảnh bìa + sắp lại thứ tự ảnh, không chỉ xoá?
- Tab Token có nên gộp vào "Nhóm→Trang" để giảm còn ~5 tab?
