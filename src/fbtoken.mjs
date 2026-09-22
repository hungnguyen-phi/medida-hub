// src/fbtoken.mjs — quản lý token Facebook: đổi long-lived, lấy page token, kiểm tra hạn.
import fs from "node:fs";
import { saveToken } from "./paths.mjs";

const V = process.env.FB_GRAPH_VERSION || "v21.0";
const G = `https://graph.facebook.com/${V}`;

export async function exchangeLongLivedUser(shortToken, appId, appSecret) {
  const r = await (await fetch(`${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${encodeURIComponent(shortToken)}`)).json();
  if (!r.access_token) throw new Error(r.error?.message || "đổi long-lived thất bại");
  return r.access_token;
}

export async function derivePageToken(pageId, userToken) {
  const r = await (await fetch(`${G}/${pageId}?fields=access_token,name,id&access_token=${encodeURIComponent(userToken)}`)).json();
  if (!r.access_token) throw new Error(r.error?.message || "lấy page token thất bại");
  // Trả id SỐ chuẩn (Graph chấp nhận username/link ở path, nhưng id trả về luôn là số) -> khớp mapping route.
  return { token: r.access_token, name: r.name, id: r.id ? String(r.id) : String(pageId) };
}

/** Liệt kê mọi Trang user token quản lý (id, tên, page token). Token này vĩnh viễn nếu user token đã long-lived. */
export async function listUserPages(userToken) {
  const out = [];
  let url = `${G}/me/accounts?fields=id,name,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`;
  while (url) {
    const r = await (await fetch(url)).json();
    if (r.error) throw new Error(r.error.message);
    for (const p of r.data || []) out.push({ id: String(p.id), name: p.name, token: p.access_token });
    url = r.paging?.next || null;
  }
  return out;
}

export async function debugToken(token, appId, appSecret) {
  const r = await (await fetch(`${G}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${appId}|${appSecret}`)).json();
  return r.data || {};
}

/** Lưu 1 token Trang vào data/tokens.json (trên volume) + áp vào process.env ngay.
 *  Trước đây ghi .env; đổi sang file dữ liệu để sống sót khi deploy container (Coolify). */
export function setEnvVar(name, value) {
  saveToken(name, value);
}

/**
 * Từ 1 user token (ngắn hạn) -> đổi long-lived -> lấy page token VĨNH VIỄN cho từng page,
 * ghi vào .env theo map {pageId: ENV_NAME}. Trả mảng kết quả {pageId, name, expires_at}.
 */
export async function refreshPageTokens(shortUserToken, appId, appSecret, pageEnvMap) {
  const longUser = await exchangeLongLivedUser(shortUserToken, appId, appSecret);
  const out = [];
  for (const [pageId, envName] of Object.entries(pageEnvMap)) {
    const { token, name } = await derivePageToken(pageId, longUser);
    const dbg = await debugToken(token, appId, appSecret);
    setEnvVar(envName, token);
    out.push({ pageId, name, envName, expires_at: dbg.expires_at });
  }
  return out;
}
