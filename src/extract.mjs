// src/extract.mjs — Module DUY NHẤT chứa giả định về hình dạng payload Zalo (zca-js).
// Đã khóa theo sự thật đo bằng probe (xem memory zca-js-facts). Khi Zalo/zca-js đổi
// shape, CHỈ sửa file này; phần còn lại của pipeline đứng yên.
//
// Vào: object Message của zca-js  ->  Ra: NormalizedEvent gọn, ổn định.

// Lệnh "chốt bài ngay". So khớp sau khi trim + lowercase + bỏ dấu câu cuối.
const CLOSE_COMMANDS = new Set(["xong", "đăng", "dang", "post", "lên", "len", "ok"]);

/** Parse content.params (chuỗi JSON) an toàn -> object, lỗi thì {}. */
function parseParams(params) {
  if (params && typeof params === "object") return params;
  if (typeof params === "string") {
    try { return JSON.parse(params); } catch { return {}; }
  }
  return {};
}

/** Nuốt mọi biến thể URL ảnh: ưu tiên bản HD trong params, rồi href, rồi thumb. */
function pickImageUrl(content, p) {
  return p.hd || content.href || content.thumb || undefined;
}

/** Chuẩn hóa text để dò lệnh. */
function normCmd(s) {
  return String(s || "").trim().toLowerCase().replace(/[.!…\s]+$/u, "");
}

export function isCloseCommand(text) {
  return CLOSE_COMMANDS.has(normCmd(text));
}

/**
 * Chuẩn hóa 1 message zca-js thành NormalizedEvent.
 * @param {object} m - message từ api.listener.on("message")
 * @returns {object} NormalizedEvent
 */
export function extractEvent(m) {
  const data = (m && m.data) || {};
  const msgType = data.msgType || "";
  const rawContent = data.content;
  const threadType = m && m.type === 1 ? "group" : "user"; // ThreadType.Group=1

  const base = {
    source: "zca",
    msgType,
    threadId: m && m.threadId != null ? String(m.threadId) : undefined,
    threadType,
    isSelf: !!(m && m.isSelf),
    senderId: data.uidFrom != null ? String(data.uidFrom) : undefined,
    senderName: data.dName,
    msgId: data.msgId,
    ts: data.ts != null ? Number(data.ts) : undefined,
    kind: "other",
    text: undefined,
    caption: undefined,
    mediaUrl: undefined,
    posterUrl: undefined,
    mediaMeta: undefined,
    raw: m,
  };

  // 1) Tin chữ: content là string (msgType "webchat" / "chat.text" ...)
  if (typeof rawContent === "string") {
    base.text = rawContent;
    base.kind = isCloseCommand(rawContent) ? "command" : "text";
    return base;
  }

  const content = rawContent && typeof rawContent === "object" ? rawContent : {};
  const p = parseParams(content.params);

  // 0) Bỏ qua TIN HỆ THỐNG của Zalo (nhắc lịch/sự kiện/việc cần làm/bình chọn/gợi ý...).
  //    Mấy tin này KHÔNG phải bài người dùng gửi, nhưng có ảnh minh hoạ nên dễ bị nhận nhầm.
  const mt = msgType.toLowerCase();
  if (["reminder", "todo", "event", "poll", "recommended", "sticker", "calendar", "schedule"].some((t) => mt.includes(t))) {
    return base; // kind "other" -> tầng trên bỏ qua
  }

  // 2) Ảnh — CHỈ nhận ẢNH THẬT (msgType chứa "photo", vd "chat.photo").
  //    KHÔNG đoán ảnh theo đuôi URL nữa: tin nhắc lịch của Zalo cũng có href ảnh minh hoạ
  //    -> trước đây bị tưởng là bài đăng. (xem bug: nhắc lịch ra bản nháp.)
  if (msgType.includes("photo")) {
    base.kind = "image";
    base.mediaUrl = pickImageUrl(content, p);
    base.caption = content.title || "";
    base.mediaMeta = { width: p.width, height: p.height, size: p.hdSize };
    return base;
  }

  // 3) Video
  if (msgType.includes("video")) {
    base.kind = "video";
    base.mediaUrl = content.href || undefined;     // URL video tải được
    base.posterUrl = content.thumb || undefined;   // ảnh poster
    base.caption = content.title || "";
    base.mediaMeta = {
      width: p.video_width,
      height: p.video_height,
      size: p.fileSize,
      duration: p.duration,
      isHD: p.isHD,
    };
    return base;
  }

  // 4) Loại khác (sticker, file, gif, link...) — giữ raw để xử lý/bỏ qua ở tầng trên
  return base;
}
