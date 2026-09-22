// src/facebook.mjs — đăng lên Facebook Page qua Graph API.
// Album nhiều ảnh = 1 bài: upload từng ảnh (unpublished) -> tạo feed post gắn các ảnh + caption.
// Video: đăng riêng từng cái (Graph API không gộp ảnh+video 1 bài).
import fs from "node:fs";
import path from "node:path";

const GRAPH = (v) => `https://graph.facebook.com/${v || process.env.FB_GRAPH_VERSION || "v21.0"}`;

async function fbFetch(url, body) {
  const res = await fetch(url, { method: "POST", body });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (!res.ok || json.error) {
    const msg = json.error ? `${json.error.message} (code ${json.error.code})` : `HTTP ${res.status}`;
    throw new Error(`Graph API lỗi: ${msg}`);
  }
  return json;
}

/** Upload 1 ảnh ở trạng thái CHƯA đăng -> trả photo id. caption = chú thích riêng cho ảnh đó. */
export async function uploadUnpublishedPhoto({ pageId, token, filePath, version, caption }) {
  const form = new FormData();
  form.append("published", "false");
  form.append("access_token", token);
  if (caption) form.append("caption", caption);
  form.append("source", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const j = await fbFetch(`${GRAPH(version)}/${pageId}/photos`, form);
  return j.id;
}

/**
 * Đăng 1 bài: caption + nhiều ảnh (album). Trả {postId, url}.
 */
export async function postPhotoAlbum({ pageId, token, caption, imagePaths, imageCaptions = [], version, published = true }) {
  const ids = [];
  for (let i = 0; i < imagePaths.length; i++) {
    ids.push(await uploadUnpublishedPhoto({ pageId, token, filePath: imagePaths[i], caption: imageCaptions[i], version }));
  }

  const params = new URLSearchParams();
  if (caption) params.set("message", caption);
  ids.forEach((id, i) => params.set(`attached_media[${i}]`, JSON.stringify({ media_fbid: id })));
  if (published === false) params.set("published", "false"); // bản nháp -> chỉ thấy trong Publishing Tools
  params.set("access_token", token);

  const j = await fbFetch(`${GRAPH(version)}/${pageId}/feed`, params);
  return { postId: j.id, url: `https://www.facebook.com/${j.id}` };
}

/** Đăng 1 video kèm caption. published=false -> nháp (chưa công khai). Trả {videoId, url}. */
export async function postVideo({ pageId, token, caption, filePath, version, published = true }) {
  const form = new FormData();
  form.append("access_token", token);
  if (caption) form.append("description", caption);
  if (published === false) form.append("published", "false");
  form.append("source", new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const j = await fbFetch(`${GRAPH(version)}/${pageId}/videos`, form);
  return { videoId: j.id, url: `https://www.facebook.com/${j.id}` };
}

/**
 * Đăng cả batch lên Page: ảnh thành 1 album, mỗi video 1 bài riêng.
 * @returns {Promise<{links:string[]}>}
 */
export async function postToPage({ pageId, token, caption, imagePaths = [], imageCaptions = [], videoPaths = [], videoCaptions = [], version, published = true, log = () => {} }) {
  if (!pageId || !token) throw new Error("thiếu pageId hoặc token Facebook");
  const links = [];
  if (imagePaths.length) {
    const r = await postPhotoAlbum({ pageId, token, caption, imagePaths, imageCaptions, version, published });
    links.push(r.url);
    log(`đăng album ${imagePaths.length} ảnh (${published === false ? "nháp" : "công khai"}): ${r.url}`);
  }
  for (let i = 0; i < videoPaths.length; i++) {
    const r = await postVideo({ pageId, token, caption: videoCaptions[i] || caption, filePath: videoPaths[i], version, published });
    links.push(r.url);
    log(`đăng video (${published === false ? "nháp" : "công khai"}): ${r.url}`);
  }
  return { links };
}

/** Lấy id bài từ link facebook.com/{id} (dạng {pageId}_{postId} hoặc videoId). */
export function postIdFromLink(link) {
  const m = String(link || "").match(/facebook\.com\/([0-9_]+)/);
  return m ? m[1] : "";
}

/** Công khai 1 bài đang ở trạng thái nháp (unpublished -> published). */
export async function publishPost({ postId, token, version }) {
  const body = new URLSearchParams();
  body.set("is_published", "true");
  body.set("access_token", token);
  return fbFetch(`${GRAPH(version)}/${postId}`, body);
}

/** Sửa nội dung (message) của 1 bài đã đăng. */
export async function editPost({ postId, token, message, version }) {
  const body = new URLSearchParams();
  body.set("message", message || "");
  body.set("access_token", token);
  return fbFetch(`${GRAPH(version)}/${postId}`, body);
}

/** Xoá 1 bài đã đăng. */
export async function deletePost({ postId, token, version }) {
  const res = await fetch(`${GRAPH(version)}/${postId}?access_token=${encodeURIComponent(token)}`, { method: "DELETE" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(`Graph API lỗi: ${j.error ? j.error.message : res.status}`);
  return j;
}

/** Kiểm tra token + lấy tên Page (để xác nhận cấu hình đúng). */
export async function verifyPage({ pageId, token, version }) {
  const res = await fetch(`${GRAPH(version)}/${pageId}?fields=name,id&access_token=${encodeURIComponent(token)}`);
  const j = await res.json();
  if (j.error) throw new Error(`token/pageId sai: ${j.error.message}`);
  return j; // {name, id}
}
