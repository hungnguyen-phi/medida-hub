// Chân bài cố định (postFooter) theo kênh — KIẾN TRÚC MỚI (2026-07-18):
// content trong DB luôn SẠCH, KHÔNG bao giờ nướng footer vào lúc lưu/tạo bài.
// Footer chỉ được ghép Ở GIÂY ĐĂNG THẬT (orchestrator postSocial), trên text đã
// qua stripHtmlValidation. Composer/preview hiển thị footer ở KHUNG RIÊNG.
// → Không còn gì để so khớp khi lưu → hết vĩnh viễn lỗi nhân bản chân bài.
//
// Vị trí chèn: DƯỚI caption, TRÊN cụm hashtag cuối bài (giữ hashtag ở đáy).
// Chốt norm chỉ còn vai trò lưới an toàn cho BÀI CŨ đã lỡ nướng footer vào
// content từ trước: nhận ra footer sẵn có ở mọi biến thể (HTML <p>, &amp;,
// khoảng trắng lệch) thì không ghép nữa — tránh đăng 2 chân.
export const applyPostFooter = (content: string, footer: string): string => {
  const body = content || '';
  const footerBlock = (footer || '').trim();
  if (!footerBlock) {
    return body;
  }

  // Thẻ HTML phải thay bằng KHOẢNG TRẮNG (không xoá trắng): '<p>A</p><p>B</p>'
  // → 'A B' khớp với 'A\nB' của footer gốc; xoá trắng sẽ thành 'AB' → so trượt.
  const norm = (s: string) =>
    s
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  if (norm(body).includes(norm(footerBlock))) {
    return body;
  }

  // Cụm hashtag cuối bài không nhất thiết đứng RIÊNG DÒNG — AI thường nối
  // thẳng vào cuối câu cuối cùng ("...một ngày thật vui #a #b"). Bắt dải
  // "#tag" liên tiếp SÁT CUỐI chuỗi (được ngăn cách bởi khoảng trắng bất kỳ,
  // kể cả xuống dòng) thay vì đòi hỏi cả dòng chỉ toàn hashtag — nếu không,
  // dòng có hashtag nối đuôi sẽ bị coi là caption thường và chân bài bị chèn
  // SAU nó (hashtag trồi lên trên chân bài, đúng lỗi user báo).
  const trailingHashtags = body.match(/(?:\s*#[^\s#]+)+\s*$/);
  const head = trailingHashtags
    ? body.slice(0, trailingHashtags.index).replace(/\s+$/, '')
    : body.trim();
  const tail = trailingHashtags ? trailingHashtags[0].trim() : '';

  if (tail) {
    return `${head}\n\n${footerBlock}\n\n${tail}`;
  }
  return head ? `${head}\n\n${footerBlock}` : footerBlock;
};
