// recover.mjs — cứu ảnh đã gửi TRƯỚC khi service bật (zca-js không buffer).
// Kéo lịch sử nhóm -> lọc ảnh gần nhất -> đăng nháp lên page tương ứng. KHÔNG reply Zalo.
// Chạy khi service ĐANG TẮT (từ thư mục gốc dự án). Ví dụ: node --env-file=.env scripts/recover.mjs 204024737146120985
import { Zalo } from "zca-js";
import fs from "node:fs";
import { extractEvent } from "../src/extract.mjs";
import { processBatch } from "../src/pipeline.mjs";
import { postToPage } from "../src/facebook.mjs";
import { loadConfig, routeForThread } from "../src/config.mjs";

const GROUP = process.argv[2];
if (!GROUP) { console.log("Cần truyền threadId nhóm Zalo: node scripts/recover.mjs <threadId>"); process.exit(1); }
const WINDOW_MS = Number(process.env.RECOVER_WINDOW_MIN || 60) * 60 * 1000;
const COUNT = Number(process.env.RECOVER_COUNT || 50);

const cfg = loadConfig();
const route = routeForThread(cfg, GROUP);
if (!route) { console.log("Nhóm chưa cấu hình trong routes.json:", GROUP); process.exit(1); }

const zalo = new Zalo({ selfListen: true });
const api = await zalo.login(JSON.parse(fs.readFileSync("zalo-creds.json", "utf8")));

const hist = await api.getGroupChatHistory(GROUP, COUNT);
const evs = (hist.groupMsgs || []).map(extractEvent);
const media = evs.filter((e) => (e.kind === "image" || e.kind === "video") && e.ts);
const texts = evs.filter((e) => e.kind === "text" && e.ts);

if (!media.length) { console.log(`Không thấy ảnh/video nào trong ${COUNT} tin gần nhất của nhóm ${GROUP}.`); process.exit(0); }

const maxTs = Math.max(...media.map((m) => m.ts));
const recent = media.filter((m) => m.ts >= maxTs - WINDOW_MS).sort((a, b) => a.ts - b.ts);
const recentTexts = texts.filter((t) => t.ts >= maxTs - WINDOW_MS);

console.log(`Lịch sử: ${media.length} media tổng; LẤY ${recent.length} cái trong ${WINDOW_MS / 60000} phút gần nhất.`);
console.log("Thời gian:", recent.map((m) => `${m.kind}@${new Date(m.ts).toLocaleString("vi-VN")}`).join(" | "));
console.log("Ghi chú kèm:", recentTexts.map((t) => t.text).join(" / ") || "(không)");

const batch = {
  threadId: GROUP,
  startedAt: recent[0].ts,
  items: recent.map((m) => ({ kind: m.kind, url: m.mediaUrl, posterUrl: m.posterUrl, caption: m.caption, ts: m.ts })),
  texts: recentTexts.map((t) => ({ text: t.text })),
};

const res = await processBatch(batch, "recover", {
  log: (m) => console.log("  [pipeline]", m),
  post: ({ caption, imagePaths, videoPaths }) =>
    postToPage({ pageId: route.fanpageId, token: route.fanpageToken, caption, imagePaths, videoPaths, published: route.published, log: (m) => console.log("  [fb]", m) }),
});

console.log("\n=== KẾT QUẢ ===");
console.log(JSON.stringify({ giữ: res.savedImages.length, video: res.savedVideos.length, bỏ: res.droppedCount, captionSource: res.captionSource, links: res.fbLinks }));
console.log("CAPTION:\n" + res.caption);
process.exit(0);
