# Product

## Register

product

## Users

Người dùng chính là **quản trị viên trang (page admin) không rành kỹ thuật** — thường là người phụ trách truyền thông/mạng xã hội của các trường mầm non (ví dụ "Mầm Non Việt Anh", "Mầm non Nhân Lễ").

- **Bối cảnh:** Phụ huynh và giáo viên gửi ảnh hoạt động vào nhóm Zalo. Người quản trị cần duyệt nhanh những ảnh đó trước khi chúng lên trang Facebook công khai của trường — thường làm tranh thủ giữa các việc khác, đôi khi ngay trên điện thoại.
- **Việc cần làm (job to be done):** Xem bài bot đã gom sẵn (ảnh + caption tiếng Việt), chỉnh lại nếu cần, rồi bấm đăng công khai hoặc lưu nháp — một cách an tâm, không sợ bấm nhầm gửi nhầm.
- **Trình độ:** Không quen thuật ngữ kỹ thuật. Họ hiểu "nhóm Zalo", "trang Facebook", "duyệt bài" — nhưng không nên bắt họ hiểu "threadId", "token", "biến môi trường" trừ khi thật sự cần (và khi cần thì phải giải thích rõ ràng, từng bước).

## Product Purpose

Một công cụ tự động hoá đăng bài: bot lắng nghe các nhóm Zalo, gom ảnh do thành viên gửi trong một khoảng thời gian, lọc/chọn ảnh chất lượng, sinh caption tiếng Việt bằng AI, rồi đăng lên các trang Facebook tương ứng (bản nháp hoặc công khai).

Dashboard quản trị tồn tại để con người **kiểm soát điểm cuối**: duyệt nội dung trước khi công khai, ánh xạ nhóm Zalo ↔ trang Facebook, quản lý token, bật/tắt chế độ duyệt tay, và theo dõi nhật ký hoạt động.

**Thành công trông như thế nào:** Người quản trị mở dashboard, hiểu ngay còn bao nhiêu bài chờ duyệt, xử lý hàng chờ trong vài phút mà không phân vân, và không bao giờ vô tình đăng công khai thứ chưa muốn đăng. Công cụ "biến mất" vào trong công việc.

## Brand Personality

**Điềm tĩnh & đáng tin** — ba từ: *điềm tĩnh, đáng tin, rõ ràng*.

- **Giọng điệu:** Trầm tĩnh, chắc chắn, không phô trương. Câu chữ ngắn gọn, đời thường, thân thiện kiểu công việc — không sáo rỗng, không "vui nhộn" gượng ép.
- **Mục tiêu cảm xúc:** Khi mở lên, người dùng cảm thấy *an tâm và làm chủ*. Việc đăng một bài công khai phải có cảm giác an toàn, có kiểm soát, không vội vã. Nhìn vào là biết ngay cần làm gì tiếp theo.
- Mọi hành động không thể hoàn tác (đăng công khai, bỏ bài) phải được nói rõ ràng và xác nhận, để sự "đáng tin" là cảm giác có thật chứ không chỉ là vẻ ngoài.

## Anti-references

- **Không phải "SaaS slop" chung chung do AI sinh ra:** tránh hero gradient, accent tím, lưới thẻ giống hệt nhau lặp vô tận, số liệu phóng đại kiểu marketing. Giao diện phải cụ thể, bám sát công việc thật.
- **Không phải app mạng xã hội tiêu dùng:** đây là công cụ vận hành, không phải bảng tin (feed) để lướt cho vui. Đừng bắt chước Facebook/Instagram về thị giác lẫn tương tác.
- **Không phô trương hiệu ứng:** không chuyển động trang trí, không "choáng ngợp". Mọi chuyển động chỉ để phản hồi trạng thái.

## Design Principles

1. **An toàn trước, tốc độ sau.** Hành động không thể hoàn tác phải khó bấm nhầm và luôn được xác nhận rõ. Người dùng phải luôn biết bài sẽ đăng đi đâu, công khai hay nháp.
2. **Nói tiếng người, không nói tiếng máy.** Nhãn, thông báo, trạng thái dùng ngôn ngữ của người quản trị trường học, không phải của lập trình viên. Thuật ngữ kỹ thuật (token, threadId) chỉ xuất hiện khi bắt buộc và luôn kèm giải thích.
3. **Hàng chờ là trung tâm.** Màn hình "Chờ duyệt" là lý do tồn tại của dashboard. Mọi thứ khác là cấu hình phụ trợ; ưu tiên để việc duyệt bài nhanh, rõ, ít bước.
4. **Công cụ biến mất vào công việc.** Quen thuộc và nhất quán hơn là bất ngờ. Cùng một kiểu nút, cùng một bộ control, cùng một phong cách icon ở mọi màn hình.
5. **Dùng được mọi nơi, mọi người.** Hoạt động tốt trên điện thoại, đạt WCAG AA, đọc rõ với dấu tiếng Việt và chuỗi dài. Mặc định bao gồm, không bỏ ai lại.

## Accessibility & Inclusion

- **Mục tiêu WCAG 2.1 AA.** Chữ thân bài tương phản ≥ 4.5:1; chữ lớn ≥ 3:1. Không dùng xám nhạt "cho sang" làm khó đọc.
- **Tiếng Việt là ngôn ngữ chính.** Font và bố cục phải hiển thị đẹp dấu thanh (ă, â, ê, ô, ơ, ư, các dấu) và chịu được chuỗi dài hơn tiếng Anh mà không tràn/đứt chữ.
- **Trạng thái focus thật sự** trên mọi phần tử tương tác; thao tác được bằng bàn phím.
- **Tôn trọng `prefers-reduced-motion`:** mọi chuyển động đều có phương án thay thế (mờ dần hoặc tức thì).
- **Responsive cho điện thoại:** sidebar thu gọn, các nút và vùng chạm đủ lớn, dùng trọn vẹn được trên màn hình nhỏ.
