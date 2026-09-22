---
target: public/index.html
total_score: 30
p0_count: 0
p1_count: 2
timestamp: 2026-06-25T04-10-13Z
slug: public-index-html
---
# Critique · public/index.html (Auto-Post Zalo → Facebook)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Không có loading khi tải tab / khi đăng bài (FB upload chậm) |
| 2 | Match System / Real World | 3 | Jargon dev (threadId, fanpageId, biến .env) rò vào tab Nhóm/Token |
| 3 | User Control and Freedom | 3 | Không undo sau khi đăng/bỏ bài (chỉ có confirm) |
| 4 | Consistency and Standards | 4 | Hệ token & component nhất quán toàn bộ |
| 5 | Error Prevention | 3 | Confirm + nêu Page đích tốt; chưa validate field cấu hình route |
| 6 | Recognition Rather Than Recall | 3 | Phải tự nhớ/dán threadId, fanpageId — chưa có bộ chọn nhóm |
| 7 | Flexibility and Efficiency | 2 | Không phím tắt, không duyệt hàng loạt khi hàng chờ dài |
| 8 | Aesthetic and Minimalist Design | 4 | Sạch, một giọng màu, empty state dạy việc |
| 9 | Error Recovery | 3 | Toast lỗi thoáng 2.6s, đẩy nguyên văn lỗi server |
| 10 | Help and Documentation | 2 | Khâu khó nhất (thiết lập đầu) ít hướng dẫn nhất |
| **Total** | | **30/40** | **Tốt** |

## Anti-Patterns Verdict — ĐẠT
Detector: 0 findings. Không AI slop: hệ token đặc trưng, một giọng màu primary, phẳng-mặc-định, đúng brand "Bàn trực ban điềm tĩnh". Không có browser overlay (môi trường thiếu công cụ trình duyệt).

## Overall Impression
Màn "Chờ duyệt" — tim của sản phẩm — được làm rất tốt: rõ, an tâm, ít bước. Điểm yếu nằm ở **khoảng cách giữa người dùng mục tiêu (quản trị không rành kỹ thuật) và các tab cấu hình (Nhóm→Page, Token) vốn mang ngôn ngữ lập trình viên**, cộng với thiếu phản hồi "đang xử lý" ở hành động chậm (đăng FB). Cơ hội lớn nhất: thu hẹp khoảng cách thiết lập đó.

## What's Working
- **Luồng duyệt bài**: 1 thẻ/bài, hành động rõ, confirm nêu Page đích → an tâm khi đăng công khai.
- **Phản hồi trạng thái thường trực**: chip chế độ, badge số chờ, chấm Zalo (aria-live), toast mọi thao tác.
- **Nhất quán thị giác & a11y nền tảng**: token, focus, nhãn, landmark, skip-link.

## Priority Issues

**[P1] Thiếu phản hồi "đang xử lý" ở hành động chậm** — Bấm "Đăng công khai": thẻ bị khoá nhưng không có "Đang đăng…"; FB upload nhiều ảnh mất vài giây, người dùng không chắc đang chạy hay treo. Fix: nút/thẻ hiện trạng thái "Đang đăng…" + spinner inline; toast chỉ là xác nhận cuối. → /impeccable harden

**[P1] Jargon lập trình viên ở tab Nhóm→Page và Token** — "threadId", "fanpageId", "Tên biến token (.env)", "Dán User Token từ Graph API Explorer" xa lạ với cô quản trị trường mầm non. Fix: nhãn thân thiện + hướng dẫn từng bước inline; lý tưởng là bộ chọn nhóm Zalo (đã có list-groups.mjs ở backend) thay vì dán ID tay. → /impeccable clarify (nhãn/help) + /impeccable onboard hoặc shape (bộ chọn)

**[P2] Khâu thiết lập đầu ít hướng dẫn nhất** — Việc khó nhất (nối nhóm↔page, lấy token) lại thiếu onboarding/empty-state dẫn dắt. Người mới sẽ phải gọi người đã cài hộ. Fix: empty state ở tab Nhóm/Token khi chưa cấu hình, dẫn 3 bước. → /impeccable onboard

**[P2] Lỗi ở hành động rủi ro cao chỉ hiện thoáng qua** — Đăng thất bại → toast lỗi (nguyên văn server, có thể tiếng Anh) biến mất sau 2.6s; người dùng có thể bỏ lỡ "đã đăng hay chưa". Fix: lỗi khi đăng/bỏ giữ lại cho tới khi đóng, diễn đạt tiếng Việt dễ hiểu. → /impeccable clarify + harden

**[P2] Không duyệt hàng loạt / phím tắt khi hàng chờ dài** — Mỗi bài một lượt confirm; 10 bài = 10 lần. Cho công cụ "dọn hàng chờ" thì duyệt nhanh nhiều bài từ cùng một nhóm sẽ đỡ mệt. Fix: chọn nhiều + duyệt loạt, hoặc phím tắt. → /impeccable shape

## Persona Red Flags

**Cô Hương (quản trị trường mầm non, không rành kỹ thuật — persona dự án)**: Tab Nhóm→Page và Token khiến cô bối rối — "threadId", "biến token .env", "Graph API Explorer" là tiếng nước ngoài với cô. Cô làm tốt việc duyệt bài hằng ngày nhưng **không tự thiết lập được lần đầu**; mất token là phải cầu cứu.

**Sam (phụ thuộc trợ năng)**: Nền tảng tốt — nhãn gắn đúng, focus, alt, tương phản AA, skip-link, landmark, aria-live. Cờ nhỏ: toast tự ẩn 2.6s — đọc màn hình announce một lần nhưng phần nhìn biến mất nhanh; lỗi quan trọng nên giữ lâu hơn / có thể đóng tay.

**Casey (mobile, hay bị ngắt quãng)**: Vùng chạm ≥44px, ảnh lazy, action trong tầm tay — tốt. Cờ: **sửa caption chưa "Lưu sửa" mà bị refresh/ngắt là mất** (không autosave bản nháp đang gõ).

## Minor Observations
- Hai nút đăng cạnh nhau ("Đăng công khai" xanh lá vs "Đăng nháp lên FB" ghost) — màu/độ đậm phân biệt ổn, nhưng người mới vẫn phải nghĩ chọn cái nào; nhãn nháp đã thêm chú thích "(chưa hiển thị công khai)" giúp ích.
- Cấu hình route lưu mà chưa validate (threadId rỗng/sai vẫn lưu) — dễ tạo route hỏng âm thầm.
- Caption edit không có dấu "chưa lưu" — không rõ đã "Lưu sửa" hay chưa trước khi rời.

## Questions to Consider
- Liệu việc thiết lập (nối nhóm↔page, token) có nên tách thành một luồng onboarding riêng, để màn chính chỉ còn việc duyệt bài?
- Có nên thay ô dán "threadId" bằng danh sách nhóm Zalo chọn được (list-groups.mjs đã có sẵn)?
- Khi hàng chờ đông, đâu là thao tác cô quản trị lặp nhiều nhất — và có thể rút còn một chạm?
