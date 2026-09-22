// src/live.mjs — theo dõi trạng thái "đang lắng nghe" theo từng nhóm cho màn Lắng nghe.
// In-memory: service ghi (event/processing/done), web đọc qua snapshot().

const T = new Map(); // threadId -> state

function nowSafe() { try { return Date.now(); } catch { return 0; } }

function ensure(threadId, label) {
  let s = T.get(threadId);
  if (!s) {
    s = { threadId: String(threadId), label: label || String(threadId), phase: "idle",
      counts: { image: 0, video: 0, text: 0 }, events: [], startedAt: 0, mediaStartedAt: 0, lastEventAt: 0,
      debounceMs: 0, maxWaitMs: 0, proc: null, doneAt: 0 };
    T.set(String(threadId), s);
  }
  if (label) s.label = label;
  return s;
}

/** Một sự kiện vừa nhận trong nhóm (ảnh/video/text). */
export function event(threadId, label, ev, route) {
  const isMedia = ev.kind === "image" || ev.kind === "video";
  const s = ensure(threadId, label);
  const now = nowSafe();
  // Bắt đầu ghi nhận mới khi đang rảnh (idle/xong)
  const fresh = (s.phase !== "listening" && s.phase !== "prelisten") || !s.startedAt;
  if (fresh) {
    s.startedAt = now; s.mediaStartedAt = 0; s.counts = { image: 0, video: 0, text: 0 }; s.events = []; s.proc = null; s.doneAt = 0;
  }
  // CHỈ ảnh/video mới "mở phiên đăng" (listening + đếm giờ). Chữ trơ -> "prelisten": vẫn ghi nhận làm tư liệu, không đếm.
  if (isMedia) { s.phase = "listening"; if (!s.mediaStartedAt) s.mediaStartedAt = now; }
  else if (s.phase !== "listening") s.phase = "prelisten";
  s.lastEventAt = now;
  s.debounceMs = route?.debounceMs || 0;
  s.maxWaitMs = route?.maxWaitMs || 0;
  if (ev.kind === "image") s.counts.image++;
  else if (ev.kind === "video") s.counts.video++;
  else if (ev.kind === "text") s.counts.text++;
  s.events.unshift({ t: now, kind: ev.kind, who: ev.senderName || "", text: String(ev.text || ev.caption || "").slice(0, 140) });
  s.events = s.events.slice(0, 25);
}

/** Đang xử lý batch (sau khi chốt): báo giai đoạn + số liệu. */
export function processing(threadId, stage, extra) {
  const s = ensure(threadId);
  s.phase = "processing";
  s.proc = { ...(s.proc || {}), stage, ...(extra || {}), at: nowSafe() };
}

/** Xong: đã tạo bản nháp (id để link tới Chờ duyệt). */
export function done(threadId, draftId) {
  const s = ensure(threadId);
  s.phase = "done"; s.doneAt = nowSafe();
  if (s.proc) s.proc.draftId = draftId; else s.proc = { draftId, at: nowSafe() };
}

/** Xoá hẳn trạng thái 1 nhóm (vd batcher bỏ pre-buffer chỉ-có-chữ). */
export function clear(threadId) { T.delete(String(threadId)); }

export function snapshot() {
  const now = nowSafe();
  const PRE_TTL = 3600000; // an toàn: bỏ "đang ghi nhận" (chỉ chữ) quá cũ
  return [...T.values()]
    .filter((s) => !(s.phase === "prelisten" && now - (s.lastEventAt || 0) > PRE_TTL))
    .sort((a, b) => (b.lastEventAt || b.doneAt || 0) - (a.lastEventAt || a.doneAt || 0));
}
