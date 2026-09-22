// list-groups.mjs — liệt kê các nhóm Zalo (id + tên) để điền routes.json.
// Chạy khi service ĐANG TẮT (tránh tranh phiên), từ thư mục gốc dự án: node scripts/list-groups.mjs
import { Zalo } from "zca-js";
import fs from "node:fs";

const zalo = new Zalo();
const creds = JSON.parse(fs.readFileSync("zalo-creds.json", "utf8"));
const api = await zalo.login(creds);

const all = await api.getAllGroups();
const ids = Object.keys(all.gridVerMap || {});
console.log(`Tổng ${ids.length} nhóm:\n`);
for (const id of ids) {
  try {
    const info = await api.getGroupInfo(id);
    const g = (info.gridInfoMap && info.gridInfoMap[id]) || {};
    console.log(`${id}  |  ${g.name || g.groupName || "(không tên)"}`);
  } catch (e) {
    console.log(`${id}  |  (lỗi đọc tên: ${e.message})`);
  }
}
process.exit(0);
