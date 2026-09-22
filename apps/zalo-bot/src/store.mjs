// src/store.mjs — kho dữ liệu file-based cho dashboard: hàng chờ duyệt, lịch sử, cấu hình, log.
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.mjs";

const DIR = dataPath("data");
fs.mkdirSync(DIR, { recursive: true });
const f = (n) => path.join(DIR, n);
const read = (n, def) => { try { return JSON.parse(fs.readFileSync(f(n), "utf8")); } catch { return def; } };
const write = (n, o) => fs.writeFileSync(f(n), JSON.stringify(o, null, 2));

// ===== Hàng chờ duyệt (pending drafts) =====
export const listPending = () => read("pending.json", []);
export function addPending(d) { const a = listPending(); a.unshift(d); write("pending.json", a); return d; }
export const getPending = (id) => listPending().find((d) => d.id === id);
export function removePending(id) { write("pending.json", listPending().filter((d) => d.id !== id)); }
export function clearPending() { const a = listPending(); write("pending.json", []); return a; }
export function updatePending(id, patch) {
  const a = listPending(); const i = a.findIndex((d) => d.id === id);
  if (i >= 0) { a[i] = { ...a[i], ...patch }; write("pending.json", a); return a[i]; }
  return null;
}

// ===== Lịch sử đã đăng =====
export const listPosted = () => read("posted.json", []);
export function addPosted(d) {
  const a = listPosted();
  const i = a.findIndex((x) => x.id === d.id);
  if (i >= 0) a[i] = { ...a[i], ...d };
  else a.unshift(d);
  write("posted.json", a.slice(0, 500));
  return i >= 0 ? a[i] : d;
}
export const getPosted = (id) => listPosted().find((d) => d.id === id);
export function updatePosted(id, patch) { const a = listPosted(); const i = a.findIndex((d) => d.id === id); if (i >= 0) { a[i] = { ...a[i], ...patch }; write("posted.json", a); return a[i]; } return null; }
export function removePosted(id) { write("posted.json", listPosted().filter((d) => d.id !== id)); }

// ===== Cấu hình runtime (ngoài routes.json) =====
const DEFAULT_SETTINGS = { approval: true, paused: false };
export const getSettings = () => ({ ...DEFAULT_SETTINGS, ...read("settings.json", {}) });
export function setSettings(patch) { const next = { ...getSettings(), ...patch }; write("settings.json", next); return next; }

// ===== Log vòng (ring buffer) =====
export function pushLog(line) { const a = read("logs.json", []); a.push({ t: nowSafe(), line: String(line) }); write("logs.json", a.slice(-400)); }
export const getLogs = () => read("logs.json", []);

function nowSafe() { try { return Date.now(); } catch { return 0; } }
