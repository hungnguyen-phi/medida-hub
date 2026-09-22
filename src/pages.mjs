// src/pages.mjs — metadata các Trang Facebook đã phát hiện (id, tên, tên biến token)
// để hiện dropdown ở dashboard. Token THẬT vẫn nằm trong .env theo envName.
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.mjs";

const FILE = process.env.PAGES_FILE || dataPath("data/pages.json");

export function loadPages() {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return {}; }
}

export function savePages(map) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(map, null, 2));
}

/** Tên biến .env an toàn từ tên Trang (bỏ dấu tiếng Việt). VD "Mầm Non Việt Anh" -> FB_PAGE_TOKEN_MAM_NON_VIET_ANH */
export function envNameFor(name, fanpageId) {
  const slug = String(name || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase()
    .slice(0, 40);
  return "FB_PAGE_TOKEN_" + (slug || ("ID_" + fanpageId));
}
