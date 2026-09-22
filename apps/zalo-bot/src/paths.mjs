// src/paths.mjs — gom mọi đường dẫn GHI-runtime về 1 thư mục cấu hình được (DATA_DIR).
// Local: DATA_DIR mặc định "." -> y hệt như cũ. Container (Coolify): đặt DATA_DIR=/app/data
// rồi mount volume vào đó -> dữ liệu sống sót qua mọi redeploy.
import path from "node:path";
import fs from "node:fs";

export const DATA_DIR = process.env.DATA_DIR || ".";
export const dataPath = (...p) => path.resolve(DATA_DIR, ...p);

// Đảm bảo thư mục ghi tồn tại
for (const d of ["data", "output"]) { try { fs.mkdirSync(dataPath(d), { recursive: true }); } catch {} }

export const CRED_FILE = dataPath("zalo-creds.json");
export const QR_FILE = dataPath("qr.png");
const TOKENS_FILE = dataPath("data", "tokens.json");

/** Nạp token Trang Facebook (đã lưu) vào process.env lúc khởi động — tokens.json là nguồn MỚI NHẤT. */
export function loadTokensIntoEnv() {
  try {
    const m = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
    for (const [k, v] of Object.entries(m)) if (v) process.env[k] = v; // ghi đè: file token là bản mới nhất
    return m;
  } catch { return {}; }
}

/** Lưu 1 token vào tokens.json (trên volume) + áp vào process.env ngay. Thay cho việc ghi .env. */
export function saveToken(name, value) {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); } catch {}
  m[name] = value;
  try { fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true }); fs.writeFileSync(TOKENS_FILE, JSON.stringify(m, null, 2), { encoding: "utf8" }); } catch {}
  process.env[name] = value;
}

/** Xoá hẳn 1 token khỏi tokens.json + process.env (đưa về trống). */
export function removeToken(name) {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8")); } catch {}
  delete m[name];
  try { fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true }); fs.writeFileSync(TOKENS_FILE, JSON.stringify(m, null, 2), { encoding: "utf8" }); } catch {}
  delete process.env[name];
}
