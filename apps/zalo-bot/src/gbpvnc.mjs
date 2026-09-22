// src/gbpvnc.mjs — Màn hình ảo (Xvfb) + VNC (x11vnc) + noVNC (websockify)
// Cho phép đăng nhập Google Business TƯƠNG TÁC trên VPS không màn hình:
// trình duyệt headful render vào màn hình ảo -> x11vnc xuất ra VNC -> websockify phục vụ noVNC (web)
// -> dashboard nhúng iframe để người dùng tự thao tác đăng nhập Google.
import { spawn } from "node:child_process";
import fs from "node:fs";

export const VNC_DISPLAY = ":99";
export const VNC_PORT = 5900;
export const NOVNC_PORT = 6080;
const NOVNC_WEB = ["/usr/share/novnc", "/usr/share/webapps/novnc"].find((p) => fs.existsSync(p)) || "/usr/share/novnc";

const procs = { xvfb: null, x11vnc: null, novnc: null };
let started = false;

const binPath = (cmd) => ["/usr/bin", "/usr/local/bin", "/bin"].map((d) => `${d}/${cmd}`).find((p) => fs.existsSync(p)) || cmd;
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function run(cmd, args) {
  const p = spawn(binPath(cmd), args, { stdio: "ignore" });
  p.on("error", (e) => console.error(`[vnc] ${cmd} lỗi:`, e.message));
  return p;
}

/** Đủ binary để chạy noVNC không? */
export function vncAvailable() {
  return ["Xvfb", "x11vnc", "websockify"].every((c) => fs.existsSync(binPath(c))) && fs.existsSync(NOVNC_WEB);
}

/** Khởi động màn hình ảo + VNC + noVNC. Idempotent. Sau khi gọi: process.env.DISPLAY trỏ vào màn hình ảo. */
export async function startVncStack() {
  if (started) return { display: VNC_DISPLAY, novncPort: NOVNC_PORT };
  console.log("[vnc] khởi động Xvfb + x11vnc + websockify…");
  procs.xvfb = run("Xvfb", [VNC_DISPLAY, "-screen", "0", "1360x820x24", "-nolisten", "tcp"]);
  await delay(1000);
  process.env.DISPLAY = VNC_DISPLAY; // để Playwright headful render vào màn hình ảo
  procs.x11vnc = run("x11vnc", ["-display", VNC_DISPLAY, "-nopw", "-forever", "-shared", "-rfbport", String(VNC_PORT), "-quiet", "-noxdamage", "-localhost"]);
  await delay(500);
  procs.novnc = run("websockify", ["--web", NOVNC_WEB, String(NOVNC_PORT), `localhost:${VNC_PORT}`]);
  await delay(500);
  started = true;
  return { display: VNC_DISPLAY, novncPort: NOVNC_PORT };
}

/** Dừng toàn bộ tiến trình VNC. */
export function stopVncStack() {
  for (const k of ["novnc", "x11vnc", "xvfb"]) {
    try { procs[k]?.kill("SIGKILL"); } catch {}
    procs[k] = null;
  }
  started = false;
  delete process.env.DISPLAY;
}

export const vncStarted = () => started;
