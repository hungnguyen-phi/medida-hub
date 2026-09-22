// gbp-login.mjs — Chạy 1 LẦN để đăng nhập Google và lưu session cho GBP poster.
// Dùng trên máy CÓ màn hình (laptop/máy bàn). VPS: chạy với VNC hoặc copy session từ máy local.
//
// Cách dùng (từ thư mục gốc dự án):
//   node --env-file=.env scripts/gbp-login.mjs
//
// Sau khi chạy: data/gbp-session.json được tạo.
// Copy file này lên VPS cùng với code nếu deploy.
import { loginGBP } from "../src/gbp.mjs";

loginGBP().catch((e) => { console.error("Lỗi:", e.message); process.exit(1); });
