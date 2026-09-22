// src/publish.mjs — đăng 1 draft đã duyệt lên Facebook + GBP + comment đầu (nếu có).
import { postToPage } from "./facebook.mjs";
import { postToGBP } from "./gbp.mjs";

const V = process.env.FB_GRAPH_VERSION || "v21.0";

/** Thêm comment vào 1 bài (chỉ chạy được trên bài ĐÃ công khai). */
export async function addComment(objectId, token, message) {
  const body = new URLSearchParams();
  body.set("message", message);
  body.set("access_token", token);
  const r = await (await fetch(`https://graph.facebook.com/${V}/${objectId}/comments`, { method: "POST", body })).json();
  if (r.error) throw new Error(r.error.message);
  return r.id;
}

/** Đăng phần Facebook của một draft đã duyệt. */
export async function publishFacebookDraft(draft, route, o = {}) {
  const log = o.log || (() => {});
  const published = o.published !== false; // duyệt xong mặc định đăng công khai
  const res = await postToPage({
    pageId: route.fanpageId, token: route.fanpageToken,
    caption: draft.caption,
    imagePaths: draft.savedImages || [], imageCaptions: draft.imageCaptions || [],
    videoPaths: draft.savedVideos || [], videoCaptions: draft.videoCaptions || [],
    published, log,
  });
  // Comment đầu chỉ áp khi bài đã công khai
  if (published && o.comment && res.links && res.links.length) {
    const postId = res.links[0].split("/").pop();
    try { await addComment(postId, route.fanpageToken, o.comment); log("đã thêm comment đầu"); }
    catch (e) { log("comment lỗi: " + e.message); }
  }
  return res;
}

/** Danh sách GBP location IDs của 1 draft/route (gộp mảng mới + ID cũ). */
export function gbpIdsOf(draft = {}, route = {}) {
  const a = (draft.gbpLocationIds && draft.gbpLocationIds.length) ? draft.gbpLocationIds
    : (route.gbpLocationIds && route.gbpLocationIds.length) ? route.gbpLocationIds
    : (draft.gbpLocationId || route.gbpLocationId) ? [draft.gbpLocationId || route.gbpLocationId] : [];
  return a.map(String).filter(Boolean);
}

/** Đăng phần Google Business Profile (NHIỀU business). Bỏ qua nếu bài chỉ có video (GBP không nhận video). */
export async function publishGbpDraft(draft, route, o = {}) {
  const log = o.log || (() => {});
  const ids = gbpIdsOf(draft, route);
  if (!ids.length) throw new Error("Route chưa có Google Business");
  const imagePaths = draft.savedImages || [];
  if (!imagePaths.length) { log("GBP bỏ qua: bài chỉ có video, Google Business không nhận video."); return { ok: true, skipped: true, links: [] }; }
  const text = (draft.caption || "").slice(0, 1500);
  for (const locationId of ids) {
    try { await postToGBP({ locationId, text, imagePaths, log }); log(`GBP đã đăng business ${locationId}`); }
    catch (e) { log(`GBP business ${locationId} lỗi: ${e.message}`); throw e; }
  }
  return { ok: true, links: [] };
}

/**
 * Đăng draft lên page của route, giữ tương thích cho chế độ tự đăng cũ:
 * Facebook chạy chính, GBP chạy nền nếu route có gbpLocationId.
 */
export async function publishDraft(draft, route, o = {}) {
  const log = o.log || (() => {});
  const res = await publishFacebookDraft(draft, route, o);
  // Đăng GBP song song (nếu route có business + bài có ảnh)
  if (gbpIdsOf(draft, route).length) {
    publishGbpDraft(draft, route, { log })
      .then(() => log("✅ GBP: đăng xong"))
      .catch((e) => log("⚠️ GBP lỗi (FB vẫn thành công): " + e.message));
  }
  return res;
}
