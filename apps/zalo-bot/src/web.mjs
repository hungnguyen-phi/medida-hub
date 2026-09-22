// src/web.mjs — Web dashboard: đăng nhập, duyệt & đăng bài, comment, route, token, log.
import express from "express";
import { ThreadType } from "zca-js";
import { createProxyMiddleware } from "http-proxy-middleware";
import { NOVNC_PORT, vncAvailable, vncStarted, startVncStack } from "./gbpvnc.mjs";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as store from "./store.mjs";
import { publishFacebookDraft, publishGbpDraft, gbpIdsOf } from "./publish.mjs";
import { publishPost, editPost, deletePost, postIdFromLink } from "./facebook.mjs";
import { exchangeLongLivedUser, listUserPages, debugToken, setEnvVar, derivePageToken } from "./fbtoken.mjs";
import { loadPages, savePages, envNameFor } from "./pages.mjs";
import { beginGBPLogin, cancelGBPLogin, finishGBPLogin, gbpLoginStatus, inspectGbpSession, loadGbpBusinesses, saveGbpBusinesses, importGbpSession } from "./gbp.mjs";
import { loadConfig, routeForThread } from "./config.mjs";
import { rewriteCaption, reapplyTail } from "./caption.mjs";
import { formatImage } from "./format.mjs";
import { dataPath, CRED_FILE, QR_FILE, saveToken, removeToken } from "./paths.mjs";
import { pushToPostiz, fetchHubFacebookPages } from "./postiz.mjs";

// Trang cấu hình cầu nối Postiz (Việt Anh Media Hub) — phục vụ tại GET /postiz
const POSTIZ_CONFIG_PAGE = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cấu hình Postiz</title><style>
body{font-family:'Segoe UI',system-ui,Arial,sans-serif;background:#eef2f7;color:#1a2433;margin:0;padding:24px}
.card{max-width:560px;margin:0 auto;background:#fff;border-radius:14px;box-shadow:0 6px 20px rgba(16,32,64,.08);padding:22px}
h1{font-size:19px;margin:0 0 4px}.sub{color:#6b7688;font-size:13px;margin:0 0 18px}
label{display:block;font-weight:600;font-size:13px;margin:14px 0 5px}
input,select{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d8e0ea;border-radius:9px;font-size:14px}
.row{display:flex;gap:10px;align-items:center;margin-top:16px;flex-wrap:wrap}
button{background:#1e6fd9;color:#fff;border:0;border-radius:9px;padding:11px 16px;font-weight:600;font-size:14px;cursor:pointer}
button.ghost{background:#fff;color:#1e6fd9;border:1px solid #cfe0f5}
.toggle{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px}
.msg{margin-top:14px;font-size:13px;padding:10px;border-radius:8px;display:none}
.msg.ok{background:#dcfce7;color:#15803d;display:block}.msg.err{background:#fee2e2;color:#b91c1c;display:block}
.hint{color:#6b7688;font-size:12px;margin-top:4px;font-weight:400}
</style></head><body><div class="card">
<h1>🔗 Kết nối Postiz — Việt Anh Media Hub</h1>
<p class="sub">Ảnh từ nhóm Zalo sẽ được đẩy sang Postiz thành bản nháp chờ duyệt.</p>
<div style="border:1px solid #e5ebf2;border-radius:11px;padding:14px;margin-bottom:14px;background:#f8fbff">
<b style="font-size:14px">🤖 Claude API key <span class="hint">(để AI viết caption cho ảnh Zalo)</span></b>
<input id="claudeKey" type="password" placeholder="sk-ant-..." style="margin-top:8px">
<div class="row"><button onclick="saveClaude()">Lưu key Claude</button><span id="claudeStat" class="hint"></span></div>
</div>
<label>Địa chỉ Postiz backend</label><input id="apiUrl" placeholder="http://localhost:3000">
<label>API key Postiz <span class="hint">(Postiz → Settings → Public API)</span></label><input id="key" type="password" placeholder="dán API key...">
<div class="row"><button class="ghost" onclick="loadChannels()">Lưu key & Tải danh sách kênh</button></div>
<label>Kênh đích trong Postiz</label><select id="integration"><option value="">— Bấm "Tải danh sách kênh" trước —</option></select>
<div class="row"><label class="toggle"><input type="checkbox" id="enabled"> Bật đẩy sang Postiz</label></div>
<div class="row"><button onclick="save()">Lưu cấu hình</button><button class="ghost" onclick="clearCfg()">Xoá</button></div>
<div id="msg" class="msg"></div></div><script>
var $=function(id){return document.getElementById(id)};
function show(t,ok){var m=$('msg');m.textContent=t;m.className='msg '+(ok?'ok':'err')}
async function jget(u){var r=await fetch(u,{credentials:'same-origin'});return r.json()}
async function jpost(u,b){var r=await fetch(u,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(b)});return r.json()}
async function load(){try{var s=await jget('/api/postiz/status');$('apiUrl').value=s.apiUrl||'http://localhost:3000';$('enabled').checked=!!s.enabled;if(s.hasKey)$('key').placeholder='đã lưu ('+s.masked+') — để trống nếu giữ nguyên';window._intid=s.integrationId||''}catch(e){}}
async function loadChannels(){var body={apiUrl:$('apiUrl').value};if($('key').value)body.key=$('key').value;await jpost('/api/postiz/config',body);var d=await jget('/api/postiz/integrations');var sel=$('integration');if(!d.ok){show(d.error||'Không tải được kênh',false);return}sel.innerHTML='';if(!d.integrations.length){sel.innerHTML='<option value="">(chưa có kênh — kết nối kênh trong Postiz trước)</option>';show('Kết nối OK nhưng Postiz chưa có kênh nào.',true);return}d.integrations.forEach(function(i){var o=document.createElement('option');o.value=i.id;o.textContent=(i.name||i.id)+' ['+(i.identifier||'')+']';if(i.id===window._intid)o.selected=true;sel.appendChild(o)});show('Đã tải '+d.integrations.length+' kênh. Chọn kênh rồi Lưu.',true)}
async function save(){var body={apiUrl:$('apiUrl').value,integrationId:$('integration').value,enabled:$('enabled').checked};if($('key').value)body.key=$('key').value;var r=await jpost('/api/postiz/config',body);if(r.ok)show('Đã lưu cấu hình Postiz.',true);else show(r.error||'Lỗi lưu',false)}
async function clearCfg(){await jpost('/api/postiz/config',{clear:true});show('Đã xoá cấu hình Postiz.',true);setTimeout(load,300)}
async function loadClaude(){try{var s=await jget('/api/claude/status');$('claudeStat').textContent=s.hasKey?('✓ đã lưu ('+s.masked+')'):'chưa có key';if(s.hasKey)$('claudeKey').placeholder='đã lưu ('+s.masked+') — để trống nếu giữ nguyên'}catch(e){}}
async function saveClaude(){var k=$('claudeKey').value.trim();if(!k){show('Nhập key Claude (sk-ant-...)',false);return}var r=await jpost('/api/claude/key',{key:k});if(r.ok){show('Đã lưu key Claude.',true);$('claudeKey').value='';loadClaude()}else show(r.error||'Lỗi lưu key Claude',false)}
load();loadClaude();
</script></body></html>`;

const ROUTES_FILE = process.env.ROUTES_FILE || "config/routes.json";
const PAGE_FILE = path.resolve("public/index.html");

/** Thay chân bài cũ ở đuôi caption bằng chân bài mới, GIỮ NGUYÊN hashtag (dưới cùng). */
function reapplyFooter(caption, oldFooter, newFooter, hashtags = "") {
  return reapplyTail(caption, oldFooter, hashtags, newFooter, hashtags);
}

function channelsFor(d, route = {}) {
  // GBP chỉ là 1 kênh nếu route có business VÀ bài có ẢNH (Google Business không nhận video).
  const hasImages = Array.isArray(d.savedImages) && d.savedImages.length > 0;
  const gbp = gbpIdsOf(d, route).length > 0 && hasImages;
  // Facebook chỉ là kênh của thẻ khi thẻ/route thật sự trỏ tới một fanpage
  // (đăng thẳng từ bot — luồng cũ), hoặc thẻ ĐÃ đăng FB rồi (giữ lịch sử).
  // Route thuần Media Hub: không có kênh FB ở bot — duyệt/đăng làm ở Calendar.
  const hasFbTarget = !!String(d.fanpageId || route.fanpageId || "").trim();
  const fbPosted = ((d.approvals || {}).facebook || {}).status === "posted";
  return [...(hasFbTarget || fbPosted ? ["facebook"] : []), ...(gbp ? ["gbp"] : [])];
}

function approvalsOf(d, route = {}) {
  const cur = d.approvals || {};
  const approvals = { ...cur };
  for (const ch of channelsFor(d, route)) {
    approvals[ch] = { status: "pending", ...(cur[ch] || {}) };
  }
  return approvals;
}

function isPendingDone(d, route = {}) {
  const approvals = approvalsOf(d, route);
  return channelsFor(d, route).every((ch) => {
    const approval = approvals[ch] || {};
    if (approval.status === "pending") return false;
    if (ch === "facebook" && approval.status === "posted" && approval.published === false) return false;
    return true;
  });
}

function completePendingIfDone(d, route = {}) {
  if (!isPendingDone(d, route)) return false;
  store.removePending(d.id);
  store.addPosted({ ...d, approvals: approvalsOf(d, route), postedAt: Date.now() });
  return true;
}

function rememberProcessedChannel(d, route = {}, patch = {}) {
  const merged = { ...d, ...(patch || {}) };
  const approvals = approvalsOf(merged, route);
  if (!channelsFor(merged, route).some((ch) => approvals[ch]?.status === "posted")) return;
  const existing = store.getPosted(merged.id) || {};
  store.addPosted({
    ...existing,
    ...merged,
    approvals,
    postedAt: existing.postedAt || Date.now(),
    partial: !isPendingDone({ ...merged, approvals }, route),
  });
}

/**
 * @param {object} ctx { status: {zaloConnected}, reloadConfig: ()=>void }
 */
export function startWeb(ctx = {}) {
  const app = express();
  app.use(express.json({ limit: "40mb" })); // 40mb: đủ cho vài ảnh base64 khi upload thêm trong lúc sửa bài

  const USER = process.env.DASHBOARD_USER || "admin";
  const PASS = process.env.DASHBOARD_PASS || "admin";
  // Từ chối chạy với mật khẩu dashboard mặc định/yếu — dashboard nắm token
  // Facebook + App Secret + phiên Zalo, không được để "admin".
  if (!process.env.DASHBOARD_PASS || PASS === "admin" || PASS.length < 8) {
    console.error("❌ DASHBOARD_PASS chưa đặt hoặc quá yếu — đặt mật khẩu mạnh (≥8 ký tự) trong D:\\Zalo bot group\\.env rồi khởi động lại.");
    process.exit(1);
  }
  // Phiên đăng nhập dashboard — lưu xuống file để KHÔNG bị đăng xuất khi service tự khởi động lại (đổi tài khoản Zalo).
  const SESS_FILE = dataPath("data/sessions.json");
  const sessions = new Set((() => { try { return JSON.parse(fs.readFileSync(SESS_FILE, "utf8")); } catch { return []; } })());
  const saveSessions = () => { try { fs.mkdirSync(path.dirname(SESS_FILE), { recursive: true }); fs.writeFileSync(SESS_FILE, JSON.stringify([...sessions])); } catch {} };

  const parseCookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=").map(decodeURIComponent)).filter((x) => x[0]));
  // Media Hub gọi API dashboard qua proxy /botapi kèm header x-hub-token.
  // Proxy CHỈ gắn token sau khi đã verify JWT đăng nhập của Hub, và token phải
  // KHỚP HUB_BOT_TOKEN (bí mật chung đặt trong .env cả 2 bên, ≥16 ký tự).
  // Không đặt HUB_BOT_TOKEN thì cơ chế này tắt hẳn (chỉ còn phiên dashboard).
  const HUB_TOKEN = String(process.env.HUB_BOT_TOKEN || "");
  const hubTokenOk = (req) => {
    if (HUB_TOKEN.length < 16) return false;
    const got = String(req.headers["x-hub-token"] || "");
    if (got.length !== HUB_TOKEN.length) return false;
    try { return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(HUB_TOKEN)); } catch { return false; }
  };
  const authed = (req) => sessions.has(parseCookies(req).sid) || hubTokenOk(req);
  const requireAuth = (req, res, next) => (authed(req) ? next() : res.status(401).json({ error: "Chưa đăng nhập" }));

  // ===== Auth =====
  app.post("/api/login", (req, res) => {
    const { user, pass } = req.body || {};
    if (user === USER && pass === PASS) {
      const sid = crypto.randomBytes(24).toString("hex");
      sessions.add(sid); saveSessions();
      res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
      return res.json({ ok: true });
    }
    res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
  });
  app.post("/api/logout", (req, res) => { sessions.delete(parseCookies(req).sid); saveSessions(); res.json({ ok: true }); });
  app.get("/api/me", (req, res) => (authed(req) ? res.json({ ok: true, user: USER }) : res.status(401).json({ error: "no" })));

  // Ảnh draft (bảo vệ bằng auth)
  app.use("/output", requireAuth, express.static(dataPath("output")));

  // Vé VNC một lần: Hub gọi /api/gbp/vnc-ticket (auth qua x-hub-token) để lấy
  // ticket, rồi nhúng iframe /botvnc/vnc/vnc.html?ticket=... Lần request đầu có
  // ticket hợp lệ -> cấp phiên sid (cookie) -> các file con + WebSocket sau đó
  // đi qua cookie như phiên dashboard thường. Không cần header (iframe/WS
  // không gửi được x-hub-token).
  const vncTickets = new Map(); // ticket -> hết hạn (ms)
  const issueVncTicket = () => {
    const tk = crypto.randomBytes(24).toString("hex");
    vncTickets.set(tk, Date.now() + 5 * 60 * 1000); // 5 phút để mở
    return tk;
  };

  // noVNC: nhúng trình duyệt đăng nhập Google Business (auth-gated; WebSocket gate ở 'upgrade' bên dưới)
  // app.use("/vnc") đã tự cắt tiền tố /vnc khỏi req.url -> KHÔNG pathRewrite (kẻo cắt 2 lần -> /vnc.html thành .html).
  const vncProxy = createProxyMiddleware({ target: `http://127.0.0.1:${NOVNC_PORT}`, changeOrigin: true, ws: true });
  const vncAuth = (req, res, next) => {
    if (authed(req)) return next();
    // Ticket hợp lệ trên request đầu -> tạo phiên sid, đặt cookie, cho qua.
    const tk = new URL(req.url, "http://x").searchParams.get("ticket");
    if (tk && (vncTickets.get(tk) || 0) > Date.now()) {
      vncTickets.delete(tk);
      const sid = crypto.randomBytes(24).toString("hex");
      sessions.add(sid); saveSessions();
      res.setHeader("Set-Cookie", `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
      return next();
    }
    return res.status(401).json({ error: "Chưa đăng nhập" });
  };
  app.use("/vnc", vncAuth, vncProxy);

  // ===== Trạng thái =====
  app.get("/api/status", requireAuth, (req, res) => {
    const cfg = loadConfig();
    res.json({
      zaloConnected: !!(ctx.status && ctx.status.zaloConnected),
      zaloRelogging: !!(ctx.status && ctx.status.relogging),
      settings: store.getSettings(),
      pendingCount: store.listPending().length,
      routes: [...cfg.byThread.values()].map((r) => ({
        threadId: r.threadId, label: r.label, fanpageId: r.fanpageId, fanpageTokenEnv: r.fanpageTokenEnv,
        hasToken: !!r.fanpageToken, published: r.published, facebookAutoPublish: !!r.facebookAutoPublish,
        gbpAutoPublish: !!r.gbpAutoPublish, enabled: r.enabled, comment: r.comment,
        gbpLocationId: r.gbpLocationId, folder: r.folder || "",
      })),
    });
  });

  // ===== Hàng chờ duyệt =====
  app.get("/api/pending", requireAuth, (req, res) => {
    const cfg = loadConfig();
    res.json(store.listPending().map((d) => {
      const route = routeForThread(cfg, d.threadId) || {};
      return { ...d, gbpLocationId: d.gbpLocationId || route.gbpLocationId || "", approvals: approvalsOf(d, route) };
    }));
  });

  app.get("/api/posts", requireAuth, (req, res) => {
    const cfg = loadConfig();
    const pending = store.listPending();
    const pendingIds = new Set(pending.map((d) => d.id));
    const byId = new Map();

    for (const d of store.listPosted()) {
      const route = routeForThread(cfg, d.threadId) || {};
      const approvals = approvalsOf(d, route);
      byId.set(d.id, {
        ...d,
        gbpLocationId: d.gbpLocationId || route.gbpLocationId || "",
        approvals,
        queueStatus: "done",
        inPending: false,
        sortAt: d.postedAt || d.createdAt || 0,
      });
    }

    for (const d of pending) {
      const route = routeForThread(cfg, d.threadId) || {};
      const existing = byId.get(d.id) || {};
      const approvals = approvalsOf(d, route);
      byId.set(d.id, {
        ...existing,
        ...d,
        gbpLocationId: d.gbpLocationId || route.gbpLocationId || "",
        approvals,
        postedAt: existing.postedAt,
        partial: !!existing.id,
        queueStatus: "pending",
        inPending: true,
        sortAt: Math.max(d.createdAt || 0, existing.postedAt || 0),
      });
    }

    const posts = [...byId.values()].map((d) => {
      const route = routeForThread(cfg, d.threadId) || {};
      const approvals = approvalsOf(d, route);
      const channels = channelsFor(d, route);
      const needsFacebookPublic = approvals.facebook?.status === "posted" && approvals.facebook?.published === false;
      const pendingChannels = channels.filter((ch) => approvals[ch]?.status === "pending" || (ch === "facebook" && needsFacebookPublic));
      const postedChannels = channels.filter((ch) => approvals[ch]?.status === "posted" && !(ch === "facebook" && approvals[ch]?.published === false));
      return {
        ...d,
        approvals,
        channels,
        pendingChannels,
        postedChannels,
        needsFacebookPublic,
        inPending: pendingIds.has(d.id),
        queueStatus: pendingIds.has(d.id) || needsFacebookPublic ? "pending" : "done",
      };
    });

    // Tự dọn (quyết định user 13/07/2026): bài ĐÃ vào Media Hub và không còn
    // kênh nào chờ ở bot (không FB/GBP pending, cũng chưa đăng FB/GBP) thì XÓA
    // khỏi lịch sử — duyệt/sửa/đăng làm hết ở Calendar rồi, giữ thẻ chỉ gây rối.
    // Xóa cả thư mục ảnh local (media đã upload lên kho của Hub khi đẩy nháp).
    const keep = [];
    for (const p of posts) {
      const purgeable = p.pushedToHub && !p.pendingChannels.length && !p.postedChannels.length;
      if (!purgeable) { keep.push(p); continue; }
      try { if (p.dir) fs.rmSync(p.dir, { recursive: true, force: true }); } catch {}
      try { store.removePending(p.id); } catch {}
      try { store.removePosted(p.id); } catch {}
    }

    res.json(keep.sort((a, b) => (b.sortAt || b.postedAt || b.createdAt || 0) - (a.sortAt || a.postedAt || a.createdAt || 0)).slice(0, 160));
  });

  app.post("/api/pending/:id/save", requireAuth, async (req, res) => {
    const { caption, imageCaptions, removedIndexes, items } = req.body || {};
    const cur = store.getPending(req.params.id);
    if (!cur) return res.status(404).json({ error: "không thấy draft" });
    const patch = {};
    if (caption != null) patch.caption = caption;
    if (imageCaptions && !Array.isArray(items)) patch.imageCaptions = imageCaptions;
    try {
      // MÔ HÌNH MỚI: items = danh sách ảnh theo THỨ TỰ hiển thị (gộp sắp xếp + thêm ảnh + bỏ ảnh).
      if (Array.isArray(items)) {
        const newSaved = [], newUrls = [], newCaps = [];
        for (const it of items) {
          if (it && it.origIndex != null && cur.savedImages && cur.savedImages[it.origIndex]) {
            newSaved.push(cur.savedImages[it.origIndex]);
            newUrls.push(cur.imageUrls[it.origIndex]);
            newCaps.push(String(it.caption || ""));
          } else if (it && it.newImage) {
            const buf = Buffer.from(String(it.newImage).replace(/^data:[^,]+,/, ""), "base64");
            const outBuf = await formatImage(buf, { mode: "native" });
            fs.mkdirSync(cur.dir, { recursive: true });
            const fpath = path.join(cur.dir, `added_${Date.now()}_${newSaved.length}.jpg`);
            fs.writeFileSync(fpath, outBuf);
            newSaved.push(fpath);
            newUrls.push("/output/" + path.relative(dataPath("output"), fpath).replace(/\\/g, "/"));
            newCaps.push(String(it.caption || ""));
          }
        }
        if (!newSaved.length && !(cur.savedVideos && cur.savedVideos.length)) return res.status(400).json({ error: "Bài phải còn ít nhất 1 ảnh hoặc video" });
        for (const p of (cur.savedImages || [])) if (!newSaved.includes(p)) { try { fs.rmSync(p, { force: true }); } catch {} }
        patch.savedImages = newSaved; patch.imageUrls = newUrls; patch.imageCaptions = newCaps;
        store.pushLog(`Cập nhật ảnh bài ${cur.routeLabel || cur.id}: ${newSaved.length} ảnh (sắp xếp/thêm/bỏ)`);
      } else if (Array.isArray(removedIndexes) && removedIndexes.length && Array.isArray(cur.savedImages)) {
        const drop = new Set(removedIndexes.map(Number));
        const keep = (arr) => (Array.isArray(arr) ? arr.filter((_, i) => !drop.has(i)) : arr);
        const keptImgs = keep(cur.savedImages);
        if (keptImgs.length || (cur.savedVideos && cur.savedVideos.length)) {
          patch.savedImages = keptImgs;
          patch.imageUrls = keep(cur.imageUrls);
          patch.imageCaptions = keep(patch.imageCaptions || cur.imageCaptions);
          for (const i of drop) { const p = cur.savedImages[i]; if (p) try { fs.rmSync(p, { force: true }); } catch {} }
          store.pushLog(`Bỏ ${drop.size} ảnh khỏi bài: ${cur.routeLabel || cur.id}`);
        }
      }
      const d = store.updatePending(req.params.id, patch);
      res.json(d);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // AI viết lại caption cho hấp dẫn hơn (không tự lưu — trả về để xem trước rồi bấm Lưu sửa)
  app.post("/api/pending/:id/rewrite", requireAuth, async (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: "không thấy draft" });
    const cur = (req.body?.caption != null ? req.body.caption : d.caption) || "";
    if (!cur.trim()) return res.status(400).json({ error: "Bài chưa có nội dung để viết lại" });
    const route = routeForThread(loadConfig(), d.threadId) || {};
    try {
      const out = await rewriteCaption(cur, { guide: route.writeGuide || route.styleSample || "", log: store.pushLog });
      if (!out) return res.status(400).json({ error: "AI chưa viết lại được — kiểm tra API key Claude ở tab Cài đặt." });
      store.pushLog(`AI viết lại caption: ${d.routeLabel || d.id}`);
      res.json({ ok: true, caption: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Tải lại chân bài: áp chân bài MỚI NHẤT của route vào caption (dùng khi đã đổi footer ở Nhóm→Trang).
  app.post("/api/pending/:id/reload-footer", requireAuth, (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: "không thấy draft" });
    const route = routeForThread(loadConfig(), d.threadId) || {};
    const nf = String(route.captionFooter || "").trim();
    const next = store.updatePending(d.id, { caption: reapplyFooter(d.caption, d.captionFooter, nf, d.hashtags || ""), captionFooter: nf });
    store.pushLog(`Tải lại chân bài: ${d.routeLabel || d.id}`);
    res.json(next);
  });

  // Hẹn giờ đăng (thay vì đăng ngay). Bộ hẹn giờ trong service.mjs sẽ tự đăng khi tới giờ.
  app.post("/api/pending/:id/schedule", requireAuth, (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: "không thấy draft" });
    const at = Number(req.body?.at);
    if (!at || at < Date.now() - 60000) return res.status(400).json({ error: "Thời gian hẹn phải ở tương lai" });
    const route = routeForThread(loadConfig(), d.threadId) || {};
    if (!route.fanpageToken) return res.status(400).json({ error: "Trang chưa có token (vào tab Token cấp trước)" });
    const next = store.updatePending(d.id, { scheduledAt: at, scheduledPublished: req.body?.published !== false, _publishing: false });
    store.pushLog(`Hẹn giờ đăng ${new Date(at).toLocaleString("vi-VN")}: ${d.routeLabel}`);
    res.json(next);
  });
  app.post("/api/pending/:id/unschedule", requireAuth, (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: "không thấy draft" });
    const next = store.updatePending(d.id, { scheduledAt: null, _publishing: false });
    store.pushLog(`Hủy lịch đăng: ${d.routeLabel || d.id}`);
    res.json(next);
  });

  app.post("/api/pending/:id/approve", requireAuth, async (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: "không thấy draft" });
    const published = req.body?.published !== false;
    const cfg = loadConfig();
    const route = routeForThread(cfg, d.threadId) || { fanpageId: d.fanpageId, fanpageToken: process.env[d.fanpageTokenEnv], comment: "" };
    if (!route.fanpageToken) return res.status(400).json({ error: "Page chưa có token (vào tab Token để cấp)" });
    try {
      const r = await publishFacebookDraft(d, route, { published, comment: route.comment, log: store.pushLog });
      const approvals = approvalsOf(d, route);
      approvals.facebook = { status: "posted", published, links: r.links, at: Date.now() };
      const next = store.updatePending(d.id, { approvals, published, links: r.links });
      rememberProcessedChannel(next || { ...d, approvals, published, links: r.links }, route, { approvals, published, links: r.links });
      const done = completePendingIfDone(next || { ...d, approvals, published, links: r.links }, route);
      store.pushLog(`FACEBOOK ĐÃ ${published ? "ĐĂNG CÔNG KHAI" : "LƯU NHÁP"}: ${d.routeLabel} → ${r.links.join(" ")}`);
      res.json({ ok: true, target: "facebook", done, links: r.links });
    } catch (e) { store.pushLog("Đăng lỗi: " + e.message); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/pending/:id/approve/gbp", requireAuth, async (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: "không thấy draft" });
    const cfg = loadConfig();
    const route = routeForThread(cfg, d.threadId) || {};
    const ids = gbpIdsOf(d, route);
    if (!ids.length) return res.status(400).json({ error: "Nhóm này chưa chọn Google Business nào" });
    try {
      const r = await publishGbpDraft({ ...d, gbpLocationIds: ids }, { ...route, gbpLocationIds: ids }, { log: store.pushLog });
      const approvals = approvalsOf(d, route);
      approvals.gbp = { status: "posted", at: Date.now(), links: r.links || [], count: ids.length, skipped: !!r.skipped };
      const next = store.updatePending(d.id, { approvals });
      rememberProcessedChannel(next || { ...d, approvals }, route, { approvals });
      const done = completePendingIfDone(next || { ...d, approvals }, route);
      store.pushLog(`GOOGLE BUSINESS ĐÃ ĐĂNG: ${d.routeLabel || d.id}`);
      res.json({ ok: true, target: "gbp", done });
    } catch (e) { store.pushLog("Google Business đăng lỗi: " + e.message); res.status(500).json({ error: e.message }); }
  });

  app.post("/api/pending/:id/reject/:target", requireAuth, (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: "không thấy draft" });
    const target = req.params.target === "gbp" ? "gbp" : "facebook";
    const cfg = loadConfig();
    const route = routeForThread(cfg, d.threadId) || {};
    const approvals = approvalsOf(d, route);
    if (!approvals[target]) return res.status(400).json({ error: "Kênh này không có trong bài chờ duyệt" });
    approvals[target] = { ...approvals[target], status: "rejected", at: Date.now() };
    const next = store.updatePending(d.id, { approvals });
    const done = completePendingIfDone(next || { ...d, approvals }, route);
    store.pushLog(`Đã bỏ kênh ${target === "gbp" ? "Google Business" : "Facebook"}: ${d.routeLabel || d.id}`);
    res.json({ ok: true, target, done });
  });

  app.post("/api/pending/:id/reject", requireAuth, (req, res) => {
    const d = store.getPending(req.params.id);
    if (d) { try { fs.rmSync(d.dir, { recursive: true, force: true }); } catch {} store.removePending(d.id); store.pushLog("Đã bỏ draft: " + (d.routeLabel || d.id)); }
    res.json({ ok: true });
  });

  // Xóa TAY 1 thẻ khỏi lịch sử "Bài viết" (nút 🗑 trên trang Zalo của Hub) — dù
  // đang chờ, đã đăng, hay đã vào Media Hub (bài "Đã vào Media Hub" đáng lẽ tự
  // rời, nhưng user cần xóa chủ động). Gỡ khỏi cả 2 store + xóa thư mục ảnh local.
  app.post("/api/posts/:id/delete", requireAuth, (req, res) => {
    const id = req.params.id;
    const d = store.getPending(id) || store.getPosted(id) || null;
    try { if (d && d.dir) fs.rmSync(d.dir, { recursive: true, force: true }); } catch {}
    try { store.removePending(id); } catch {}
    try { store.removePosted(id); } catch {}
    store.pushLog("Đã xóa bài khỏi lịch sử: " + ((d && (d.routeLabel || d.id)) || id));
    res.json({ ok: true });
  });

  // ===== Lịch sử =====
  app.get("/api/posted", requireAuth, (req, res) => {
    const cfg = loadConfig();
    const posted = store.listPosted();
    const seen = new Set(posted.map((d) => d.id));
    const partials = store.listPending()
      .map((d) => {
        const route = routeForThread(cfg, d.threadId) || {};
        const approvals = approvalsOf(d, route);
        const hasPosted = channelsFor(d, route).some((ch) => approvals[ch]?.status === "posted");
        if (!hasPosted || seen.has(d.id)) return null;
        const at = Math.max(...Object.values(approvals).map((x) => x?.at || 0), d.createdAt || 0);
        return { ...d, approvals, postedAt: at || Date.now(), partial: true };
      })
      .filter(Boolean);
    res.json([...partials, ...posted].sort((a, b) => (b.postedAt || 0) - (a.postedAt || 0)).slice(0, 100));
  });

  // Token cho 1 bài đã đăng (theo biến .env hoặc theo fanpageId trong pages store)
  const tokenForPosted = (item) => {
    if (item.fanpageTokenEnv && process.env[item.fanpageTokenEnv]) return process.env[item.fanpageTokenEnv];
    const meta = loadPages()[item.fanpageId];
    if (meta && meta.envName && process.env[meta.envName]) return process.env[meta.envName];
    return null;
  };
  const facebookLinksOf = (item) => [...new Set([
    ...((item.approvals && item.approvals.facebook && item.approvals.facebook.links) || []),
    ...(item.links || []),
  ].filter(Boolean))];
  const postIdsOf = (item) => facebookLinksOf(item).map(postIdFromLink).filter(Boolean);
  const hasPostedChannelExcept = (approvals, target) => Object.entries(approvals || {})
    .some(([ch, approval]) => ch !== target && approval && approval.status === "posted");
  const syncPostedChannelRemoval = (item, target, approvalPatch) => {
    const cfg = loadConfig();
    const pending = store.getPending(item.id);
    const route = routeForThread(cfg, item.threadId) || {};
    const baseApprovals = approvalsOf(pending || item, route);
    const approvals = { ...baseApprovals, [target]: { ...(baseApprovals[target] || {}), ...approvalPatch } };
    const patch = { approvals };
    if (target === "facebook") {
      patch.links = [];
      patch.published = false;
    }
    if (pending) {
      const next = store.updatePending(item.id, patch);
      completePendingIfDone(next || { ...pending, ...patch }, route);
    }
    const stillPosted = store.getPosted(item.id);
    if (stillPosted) {
      const hasPending = !!store.getPending(item.id);
      if (hasPostedChannelExcept(approvals, target)) {
        store.updatePosted(item.id, { ...patch, partial: hasPending });
      } else {
        store.removePosted(item.id);
      }
    }
  };

  // Đăng THẬT (công khai) một bài đang nháp
  app.post("/api/posted/:id/publish", requireAuth, async (req, res) => {
    const item = store.getPosted(req.params.id);
    if (!item) return res.status(404).json({ error: "không thấy bài" });
    const token = tokenForPosted(item);
    if (!token) return res.status(400).json({ error: "Trang chưa có token (vào tab Token cấp lại)" });
    try {
      const ids = postIdsOf(item);
      if (!ids.length) return res.status(400).json({ error: "bài không có link để đăng" });
      for (const pid of ids) await publishPost({ postId: pid, token });
      const approvals = item.approvals || {};
      const facebook = { ...(approvals.facebook || {}), status: "posted", published: true, at: Date.now() };
      store.updatePosted(item.id, { published: true, approvals: { ...approvals, facebook }, partial: false });
      store.pushLog(`Đăng CÔNG KHAI (từ nháp): ${item.routeLabel}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Xoá riêng nháp/bài Facebook, nhưng giữ Google Business hoặc các kênh còn lại.
  app.post("/api/posted/:id/delete/facebook", requireAuth, async (req, res) => {
    const item = store.getPosted(req.params.id);
    if (!item) return res.status(404).json({ error: "không thấy bài" });
    const ids = postIdsOf(item);
    const token = tokenForPosted(item);
    if (ids.length && !token) return res.status(400).json({ error: "Trang chưa có token để xoá Facebook" });
    try {
      for (const pid of ids) {
        try { await deletePost({ postId: pid, token }); }
        catch (e) { store.pushLog(`Xoá FB lỗi (${pid}): ${e.message}`); }
      }
      syncPostedChannelRemoval(item, "facebook", {
        status: "rejected",
        published: false,
        deleted: true,
        links: [],
        at: Date.now(),
      });
      store.pushLog(`Đã xoá Facebook: ${item.routeLabel || item.id}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Bỏ một kênh đã xử lý khỏi dashboard. Không xoá bài thật trên nền tảng ngoài.
  app.post("/api/posted/:id/remove/:target", requireAuth, (req, res) => {
    const item = store.getPosted(req.params.id);
    if (!item) return res.status(404).json({ error: "không thấy bài" });
    const target = req.params.target === "gbp" ? "gbp" : "facebook";
    syncPostedChannelRemoval(item, target, {
      status: "rejected",
      removed: true,
      links: [],
      at: Date.now(),
    });
    store.pushLog(`Đã bỏ kênh ${target === "gbp" ? "Google Business" : "Facebook"} khỏi danh sách: ${item.routeLabel || item.id}`);
    res.json({ ok: true });
  });

  // Sửa nội dung bài đã đăng (cập nhật lên Facebook)
  app.post("/api/posted/:id/edit", requireAuth, async (req, res) => {
    const item = store.getPosted(req.params.id);
    if (!item) return res.status(404).json({ error: "không thấy bài" });
    const token = tokenForPosted(item);
    if (!token) return res.status(400).json({ error: "Trang chưa có token" });
    const message = (req.body && req.body.caption) || "";
    try {
      const pid = postIdsOf(item)[0];
      if (!pid) return res.status(400).json({ error: "bài không có link" });
      await editPost({ postId: pid, token, message });
      store.updatePosted(item.id, { caption: message });
      store.pushLog(`Sửa bài đã đăng: ${item.routeLabel}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Xoá bài đã đăng (khỏi Facebook + danh sách)
  app.post("/api/posted/:id/delete", requireAuth, async (req, res) => {
    const item = store.getPosted(req.params.id);
    if (!item) return res.status(404).json({ error: "không thấy bài" });
    const token = tokenForPosted(item);
    try {
      if (token) for (const pid of postIdsOf(item)) { try { await deletePost({ postId: pid, token }); } catch (e) { store.pushLog(`Xoá FB lỗi (${pid}): ${e.message}`); } }
      store.removePosted(item.id);
      store.pushLog(`Đã xoá bài: ${item.routeLabel}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/posted/:id/remove", requireAuth, (req, res) => {
    const item = store.getPosted(req.params.id);
    if (!item) return res.status(404).json({ error: "không thấy bài" });
    store.removePosted(item.id);
    store.pushLog(`Đã xoá khỏi danh sách đã xử lý: ${item.routeLabel || item.id}`);
    res.json({ ok: true });
  });

  // Tải lại chân bài cho bài ĐÃ ĐĂNG (cập nhật caption đã lưu — KHÔNG sửa bài trên Facebook).
  app.post("/api/posted/:id/reload-footer", requireAuth, (req, res) => {
    const item = store.getPosted(req.params.id);
    if (!item) return res.status(404).json({ error: "không thấy bài" });
    const route = routeForThread(loadConfig(), item.threadId) || {};
    const nf = String(route.captionFooter || "").trim();
    const next = store.updatePosted(item.id, { caption: reapplyFooter(item.caption, item.captionFooter, nf, item.hashtags || ""), captionFooter: nf });
    store.pushLog(`Tải lại chân bài (bài đã đăng): ${item.routeLabel || item.id}`);
    res.json(next || item);
  });

  // Đăng nháp lại: tạo BẢN NHÁP MỚI từ bài đã đăng (footer mới nhất) -> vào hàng chờ duyệt để đăng lại.
  app.post("/api/posted/:id/redraft", requireAuth, (req, res) => {
    const item = store.getPosted(req.params.id);
    if (!item) return res.status(404).json({ error: "không thấy bài" });
    if (!(item.savedImages?.length) && !(item.savedVideos?.length)) return res.status(400).json({ error: "Bài không còn ảnh/video để đăng lại" });
    const route = routeForThread(loadConfig(), item.threadId) || {};
    const nf = String(route.captionFooter || "").trim();
    const newId = `${item.id}_v${Date.now()}`;
    const draft = {
      ...item, id: newId,
      caption: reapplyFooter(item.caption, item.captionFooter, nf, item.hashtags || ""), captionFooter: nf,
      published: route.published, createdAt: Date.now(),
      links: undefined, postedAt: undefined, partial: undefined,
      approvals: { facebook: { status: "pending" }, ...(gbpIdsOf(item, route).length && item.savedImages?.length ? { gbp: { status: "pending" } } : {}) },
    };
    store.addPending(draft);
    store.pushLog(`Đăng nháp lại: ${item.routeLabel || item.id} → bản nháp mới chờ duyệt`);
    res.json({ ok: true, id: newId });
  });

  // ===== Cấu hình route =====
  // Đọc routes.json AN TOÀN: volume mới (container lần đầu) chưa có file →
  // trả cấu hình rỗng thay vì ném ENOENT (lỗi từng làm "+ Nghe nhóm" chết).
  const readRoutesRaw = () => {
    try { return JSON.parse(fs.readFileSync(ROUTES_FILE, "utf8")); }
    catch { return { defaults: {}, routes: [] }; }
  };
  app.get("/api/routes", requireAuth, (req, res) => res.json(readRoutesRaw()));
  app.post("/api/routes", requireAuth, (req, res) => {
    try {
      const data = req.body;
      if (!data || !Array.isArray(data.routes)) return res.status(400).json({ error: "định dạng sai" });
      fs.writeFileSync(ROUTES_FILE, JSON.stringify(data, null, 2));
      ctx.reloadConfig && ctx.reloadConfig();
      // Đổi chân bài -> tự cập nhật vào các bài CHỜ DUYỆT của nhóm đó (chưa duyệt thì auto theo).
      let updated = 0;
      for (const r of data.routes) {
        const nf = String(r.captionFooter || "").trim();
        for (const d of store.listPending()) {
          if (String(d.threadId) === String(r.threadId) && (d.captionFooter || "") !== nf) {
            store.updatePending(d.id, { caption: reapplyFooter(d.caption, d.captionFooter, nf, d.hashtags || ""), captionFooter: nf });
            updated++;
          }
        }
      }
      store.pushLog(`Đã cập nhật routes.json${updated ? ` (+ cập nhật chân bài ${updated} bài chờ duyệt)` : ""}`);
      res.json({ ok: true, footerUpdated: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== Danh sách nhóm Zalo (cho bộ chọn ở tab Nhóm → Page) =====
  const GROUPS_FILE = dataPath("data/groups.json");
  // Cache danh sách nhóm GẮN theo tài khoản Zalo (_groupsOwnId). Đổi nick → ownId
  // khác → cache cũ bị coi là "của tài khoản khác" và bỏ đi (không hiện nhóm cũ).
  let _groupsCache = null, _groupsAt = 0, _groupsRefreshing = false, _groupsPromise = null, _groupsOwnId = null;
  try { const j = JSON.parse(fs.readFileSync(GROUPS_FILE, "utf8")); _groupsCache = j.groups; _groupsAt = j.at || 0; _groupsOwnId = j.ownId || null; } catch {}
  const curOwnId = () => (ctx.status && ctx.status.ownId != null ? String(ctx.status.ownId) : null);
  // Cache thuộc tài khoản KHÁC tài khoản đang đăng nhập? (đã biết cả 2 id và lệch nhau)
  const cacheIsOtherAccount = () => {
    const cur = curOwnId();
    return !!(cur && _groupsOwnId && cur !== String(_groupsOwnId));
  };
  // Xóa sạch cache nhóm (bộ nhớ + file) — dùng khi logout / đổi tài khoản.
  const clearGroupsCache = () => {
    _groupsCache = null; _groupsAt = 0; _groupsOwnId = null;
    try { fs.rmSync(GROUPS_FILE, { force: true }); } catch {}
  };
  async function refreshGroups(zalo) {
    const all = await zalo.getAllGroups();
    const ids = Object.keys(all.gridVerMap || {});
    const groups = [];
    const CONC = 10; // lấy tên song song theo lô để nhanh, không spam Zalo
    for (let i = 0; i < ids.length; i += CONC) {
      const infos = await Promise.all(ids.slice(i, i + CONC).map(async (id) => {
        try { const info = await zalo.getGroupInfo(id); const g = (info.gridInfoMap && info.gridInfoMap[id]) || {}; return { threadId: id, name: g.name || g.groupName || "(không tên)" }; }
        catch { return { threadId: id, name: "(không đọc được tên)" }; }
      }));
      groups.push(...infos);
    }
    groups.sort((a, b) => a.name.localeCompare(b.name, "vi"));
    _groupsCache = groups; _groupsAt = Date.now(); _groupsOwnId = curOwnId();
    try { fs.mkdirSync(path.dirname(GROUPS_FILE), { recursive: true }); fs.writeFileSync(GROUPS_FILE, JSON.stringify({ at: _groupsAt, ownId: _groupsOwnId, groups })); } catch {}
    return groups;
  }
  // Lọc theo allowlist (chỉ hiện nhóm đã chọn). Nhóm đã cấu hình route LUÔN hiện.
  const filterGroups = (list) => {
    const s = store.getSettings();
    const allow = Array.isArray(s.groupAllowlist) ? s.groupAllowlist.map(String).filter(Boolean) : [];
    if (!allow.length) return list || [];
    const keep = new Set([...allow, ...[...loadConfig().byThread.keys()].map(String)]);
    return (list || []).filter((g) => keep.has(String(g.threadId)));
  };
  app.get("/api/zalo/groups", requireAuth, async (req, res) => {
    const zalo = ctx.getZalo && ctx.getZalo();
    if (cacheIsOtherAccount()) clearGroupsCache(); // đổi nick → bỏ cache tài khoản cũ
    const force = req.query.force === '1' || req.query.force === 'true';
    const fresh = _groupsCache && Date.now() - _groupsAt < 300000; // 5 phút
    if (_groupsCache && !force) {
      res.json(filterGroups(_groupsCache)); // trả NGAY (kể cả hơi cũ)
      if (!fresh && zalo && !_groupsRefreshing) { _groupsRefreshing = true; refreshGroups(zalo).catch(() => {}).finally(() => { _groupsRefreshing = false; }); }
      return;
    }
    if (!zalo) return res.status(503).json({ error: "Zalo chưa kết nối — không lấy được danh sách nhóm" });
    try {
      if (!_groupsPromise) _groupsPromise = refreshGroups(zalo).finally(() => { _groupsPromise = null; });
      res.json(filterGroups(await _groupsPromise));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Xem TẤT CẢ nhóm (kể cả nhóm riêng) — KHÓA bằng mật khẩu dashboard. LẤY MỚI (thấy nhóm vừa tạo).
  // requireAuth (JWT Hub) đã đủ bảo vệ — bỏ lớp mật khẩu dashboard thừa để
  // "Xem mã tất cả nhóm" bấm là chạy, không phải nhập mật khẩu nữa.
  app.post("/api/zalo/groups/reveal", requireAuth, async (req, res) => {
    const zalo = ctx.getZalo && ctx.getZalo();
    if (!zalo) return res.status(503).json({ error: "Zalo chưa kết nối" });
    try {
      const list = await refreshGroups(zalo); // luôn lấy mới -> nhóm vừa tạo hiện ra
      res.json(list);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ===== Tài khoản Zalo (đăng nhập/đăng xuất/QR/đổi tài khoản) =====
  app.get("/api/zalo/status", requireAuth, (req, res) => {
    res.json({
      connected: !!(ctx.status && ctx.status.zaloConnected),
      relogging: !!(ctx.status && ctx.status.relogging),
      ownId: (ctx.status && ctx.status.ownId) || null,
      hasCreds: fs.existsSync(CRED_FILE),
      qr: fs.existsSync(QR_FILE),
    });
  });
  app.get("/api/zalo/qr", requireAuth, (req, res) => {
    const p = QR_FILE;
    if (!fs.existsSync(p)) return res.status(404).end();
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(p);
  });
  app.post("/api/zalo/reconnect", requireAuth, (req, res) => {
    _groupsCache = null; _groupsAt = 0;
    if (ctx.reconnect) {
      ctx.reconnect().catch(() => {});
      store.pushLog("Yêu cầu kết nối lại Zalo từ dashboard.");
      return res.json({ ok: true, reconnecting: true });
    }
    res.status(501).json({ error: "Service này chưa hỗ trợ kết nối lại trong tiến trình" });
  });
  // Xoá phiên Zalo hiện tại -> service tự khởi động lại (start.bat) -> hiện QR mới để quét tài khoản khác.
  app.post("/api/zalo/logout", requireAuth, (req, res) => {
    const wipe = !!(req.body && req.body.wipe);
    try { fs.rmSync(GROUPS_FILE, { force: true }); } catch {}
    _groupsCache = null; _groupsAt = 0;
    if (wipe) {
      // Xoá dữ liệu GẮN với tài khoản Zalo cũ: cấu hình Nhóm→Page + bài chờ duyệt. GIỮ token Facebook.
      try { for (const d of store.clearPending()) { try { if (d.dir) fs.rmSync(d.dir, { recursive: true, force: true }); } catch {} } } catch {}
      try { const cur = JSON.parse(fs.readFileSync(ROUTES_FILE, "utf8")); fs.writeFileSync(ROUTES_FILE, JSON.stringify({ ...cur, routes: [] }, null, 2)); } catch {}
      ctx.reloadConfig && ctx.reloadConfig();
      store.pushLog("Đã xoá cấu hình Nhóm→Page và bài chờ của tài khoản cũ (giữ token Facebook).");
    }
    if (ctx.relogin) { // Đổi phiên NGAY trong tiến trình — KHÔNG khởi động lại
      ctx.relogin().catch(() => {});
      store.pushLog("Đăng xuất Zalo — chờ quét QR (không khởi động lại).");
      return res.json({ ok: true, relogin: true, wiped: wipe });
    }
    // Fallback (service đời cũ): xoá phiên + để start.bat khởi động lại
    try { fs.rmSync(CRED_FILE, { force: true }); } catch {}
    try { fs.rmSync(QR_FILE, { force: true }); } catch {}
    store.pushLog("Đăng xuất Zalo — khởi động lại để quét QR tài khoản mới.");
    res.json({ ok: true, restarting: true });
    setTimeout(() => process.exit(0), 700);
  });

  // ===== Lắng nghe (live) — trạng thái nhận tin & xử lý theo nhóm =====
  app.get("/api/live", requireAuth, (req, res) => {
    const liveArr = ctx.getLive ? ctx.getLive() : [];
    const byThread = {};
    for (const s of liveArr) byThread[s.threadId] = s;
    const cfg = loadConfig();
    const threads = [];
    for (const r of cfg.byThread.values()) {
      if (r.enabled === false) continue;
      const s = byThread[String(r.threadId)];
      // Luôn lấy thời gian theo CẤU HÌNH hiện tại (loadConfig đọc routes.json mới), không dùng giá trị đã chụp lúc bắt đầu phiên
      if (s) {
        let st = { ...s, label: r.label, debounceMs: r.debounceMs, maxWaitMs: r.maxWaitMs };
        // Bản nháp đã được xử lý (duyệt/xóa/từ chối -> rời hàng chờ) => không hiện "Đã tạo bản nháp" nữa, về chờ ảnh.
        if (st.phase === "done" && st.proc && st.proc.draftId && !store.getPending(st.proc.draftId)) st = { ...st, phase: "idle", proc: null, doneAt: 0 };
        threads.push(st);
      }
      else threads.push({ threadId: String(r.threadId), label: r.label, phase: "idle", counts: { image: 0, video: 0, text: 0 }, events: [], startedAt: 0, lastEventAt: 0, debounceMs: r.debounceMs, maxWaitMs: r.maxWaitMs, proc: null, doneAt: 0 });
    }
    res.json({ connected: !!(ctx.status && ctx.status.zaloConnected), serverNow: Date.now(), threads });
  });

  // Chốt phiên gom NGAY (thay vì chờ hết im lặng) -> xử lý & đưa vào Chờ duyệt
  app.post("/api/live/close", requireAuth, (req, res) => {
    const threadId = req.body && req.body.threadId;
    if (!threadId) return res.status(400).json({ error: "thiếu threadId" });
    if (!ctx.closeNow) return res.status(400).json({ error: "không hỗ trợ chốt phiên" });
    Promise.resolve(ctx.closeNow(String(threadId))).catch(() => {}); // chạy nền; màn Lắng nghe tự cập nhật
    store.pushLog("Chốt phiên thủ công cho nhóm " + threadId);
    res.json({ ok: true });
  });

  // ===== Settings =====
  app.post("/api/settings", requireAuth, (req, res) => {
    const s = store.setSettings(req.body || {});
    store.pushLog(`Cài đặt: duyệt=${s.approval} tạm dừng=${s.paused}`);
    res.json(s);
  });

  // CORS cho panel Zalo nhúng/goi truc tiep tu giao dien Postiz (localhost:4200).
  // Chi ap cho /api/postiz/* va /api/claude/* (cac API cau hinh cau noi).
  // CHỈ whitelist origin của Media Hub — KHÔNG phản chiếu mọi origin, nếu không
  // web độc hại bất kỳ đọc được groups/logs/QR và ghi được routes qua trình duyệt.
  const HUB_ORIGINS = new Set([
    "http://localhost:4200",
    "http://127.0.0.1:4200",
  ]);
  // Media Hub mở từ điện thoại/tablet trong LAN có origin http://<IP-private>:4200
  const HUB_LAN_RE = /^https?:\/\/(10\.[0-9.]+|192\.168\.[0-9.]+|172\.(1[6-9]|2[0-9]|3[01])\.[0-9.]+):4200$/i;
  const isHubOrigin = (o) => !!o && (HUB_ORIGINS.has(o) || HUB_LAN_RE.test(o));
  const zaloPanelCors = (req, res, next) => {
    const origin = req.headers.origin;
    if (isHubOrigin(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "content-type");
    }
    res.setHeader("Vary", "Origin");
    if (req.method === "OPTIONS") return res.status(204).end();
    next();
  };
  app.use(["/api/postiz", "/api/claude"], zaloPanelCors);
  // Bind ra ngoài 127.0.0.1 (Docker/compose): nhóm /api/postiz|/api/claude mất
  // lớp bảo vệ "chỉ localhost" → bắt buộc auth (phiên dashboard / HUB_BOT_TOKEN).
  if ((process.env.WEB_HOST || "127.0.0.1") !== "127.0.0.1") {
    app.use(["/api/postiz", "/api/claude"], requireAuth);
  }

  // ===== Claude API Key =====
  app.get("/api/claude/status", (req, res) => {
    const key = process.env.ANTHROPIC_API_KEY || "";
    res.json({ hasKey: !!key, masked: key ? key.slice(0, 14) + "…" : "", model: process.env.CLAUDE_MODEL || "claude-sonnet-4-6" });
  });

  app.post("/api/claude/key", (req, res) => {
    const { key, model, clear } = req.body || {};
    if (clear) { removeToken("ANTHROPIC_API_KEY"); store.pushLog("Đã xoá API key Claude (về trống)."); return res.json({ ok: true, cleared: true }); }
    if (key) {
      if (!String(key).startsWith("sk-ant-")) return res.status(400).json({ error: "Key không hợp lệ (phải bắt đầu bằng sk-ant-)" });
      saveToken("ANTHROPIC_API_KEY", String(key).trim());
    }
    if (model) saveToken("CLAUDE_MODEL", String(model).trim());
    res.json({ ok: true });
  });

  app.get("/api/claude/test", async (req, res) => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return res.status(400).json({ ok: false, error: "Chưa có API key" });
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic({ apiKey: key });
      const msg = await client.messages.create({
        model: process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 8,
        messages: [{ role: "user", content: "ping" }],
      });
      res.json({ ok: true, model: msg.model });
    } catch (e) { res.json({ ok: false, error: e.message }); }
  });

  // ===== Postiz (Việt Anh Media Hub) — cấu hình cầu nối =====
  app.get('/api/postiz/status', (req, res) => {
    const key = process.env.POSTIZ_API_KEY || '';
    res.json({
      enabled: process.env.POSTIZ_ENABLED === 'true',
      apiUrl: process.env.POSTIZ_API_URL || 'http://localhost:3000',
      hasKey: !!key,
      masked: key ? key.slice(0, 10) + '…' : '',
      integrationId: process.env.POSTIZ_INTEGRATION_ID || '',
      // Trạng thái đăng nhập Zalo (cho trang Zalo trong Postiz hiển thị):
      zaloConnected: !!(ctx.status && ctx.status.zaloConnected),
      zaloRelogging: !!(ctx.status && ctx.status.relogging),
    });
  });

  app.post('/api/postiz/config', (req, res) => {
    const { apiUrl, key, integrationId, enabled, clear } = req.body || {};
    if (clear) {
      removeToken('POSTIZ_API_KEY');
      removeToken('POSTIZ_INTEGRATION_ID');
      saveToken('POSTIZ_ENABLED', 'false');
      store.pushLog('Đã xoá cấu hình Postiz.');
      return res.json({ ok: true, cleared: true });
    }
    if (apiUrl != null) saveToken('POSTIZ_API_URL', String(apiUrl).trim() || 'http://localhost:3000');
    if (key) saveToken('POSTIZ_API_KEY', String(key).trim());
    if (integrationId != null) saveToken('POSTIZ_INTEGRATION_ID', String(integrationId).trim());
    if (enabled != null) saveToken('POSTIZ_ENABLED', enabled ? 'true' : 'false');
    store.pushLog('Đã lưu cấu hình Postiz.');
    res.json({ ok: true });
  });

  app.get('/api/postiz/integrations', async (req, res) => {
    const base = (process.env.POSTIZ_API_URL || 'http://localhost:3000').replace(/\/$/, '');
    const key = process.env.POSTIZ_API_KEY;
    if (!key) return res.status(400).json({ ok: false, error: 'Chưa lưu API key Postiz' });
    try {
      const r = await fetch(base + '/public/v1/integrations', { headers: { Authorization: key } });
      const t = await r.text();
      if (!r.ok) return res.status(400).json({ ok: false, error: 'Postiz ' + r.status + ': ' + t.slice(0, 200) });
      let list;
      try { list = JSON.parse(t); } catch { list = []; }
      list = Array.isArray(list) ? list : list.integrations || [];
      res.json({ ok: true, integrations: list.map((i) => ({ id: i.id, name: i.name, identifier: i.identifier || i.providerIdentifier })) });
    } catch (e) {
      res.status(400).json({ ok: false, error: e.message });
    }
  });

  // ===== API cho TRANG ZALO trong Việt Anh Media Hub (:4200) =====
  // Cùng prefix /api/postiz nên hưởng CORS ở trên; giữ nguyên mô hình không auth
  // của nhóm này (chỉ chạy localhost). Trang Zalo trong Media Hub dùng các API
  // này để thành trung tâm điều khiển: tổng quan, QR đăng nhập, nhóm nghe, log.

  // Tổng quan: trạng thái Zalo + nhóm đang nghe + hàng chờ của bot.
  app.get('/api/postiz/overview', (req, res) => {
    const cfg = loadConfig();
    const routes = [...cfg.byThread.values()].map((r) => ({
      threadId: String(r.threadId),
      label: r.label || '',
      enabled: r.enabled !== false,
      debounceMs: r.debounceMs,
      maxWaitMs: r.maxWaitMs,
      postizIntegrationId: r.postizIntegrationId || '',
    }));
    const settings = store.getSettings();
    res.json({
      zaloConnected: !!(ctx.status && ctx.status.zaloConnected),
      zaloRelogging: !!(ctx.status && ctx.status.relogging),
      ownId: (ctx.status && ctx.status.ownId) || null,
      hasQr: fs.existsSync(QR_FILE),
      paused: !!settings.paused,
      pendingCount: store.listPending().length,
      routes,
    });
  });

  // QR đăng nhập Zalo — để quét ngay trong Media Hub, khỏi mở dashboard bot.
  app.get('/api/postiz/qr', (req, res) => {
    if (!fs.existsSync(QR_FILE)) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(QR_FILE);
  });

  app.post('/api/postiz/zalo/reconnect', (req, res) => {
    clearGroupsCache();
    if (ctx.reconnect) {
      ctx.reconnect().catch(() => {});
      store.pushLog('Yêu cầu kết nối lại Zalo từ Media Hub.');
      return res.json({ ok: true, reconnecting: true });
    }
    res.status(501).json({ error: 'Service này chưa hỗ trợ kết nối lại trong tiến trình' });
  });

  // Media Hub GỬI tin nhắn văn bản (báo cáo/bản tin trang Phát hiện):
  //   POST /api/postiz/send { threadId, text, threadType? } — threadType:
  //   'user' = nhắn thẳng 1 người (bạn bè), mặc định 'group' (tương thích cũ).
  //   Auth qua x-hub-token như các route postiz khác.
  //
  // Zalo GIỚI HẠN độ dài mỗi tin (server trả "Nội dung quá dài" nếu vượt) →
  // CHIA bản tin thành nhiều phần ~2000 ký tự, cắt theo ranh giới đoạn/dòng cho
  // đẹp, gửi lần lượt và đánh số (1/N). Và "Tham số không hợp lệ" thường do SAI
  // loại thread (đặt group nhưng thực ra user, hoặc ngược lại) → tự thử loại kia.
  const ZALO_MSG_MAX = 2000;
  const splitForZalo = (text, max = ZALO_MSG_MAX) => {
    const parts = [];
    let buf = '';
    const flush = () => { if (buf) { parts.push(buf); buf = ''; } };
    const addChunk = (piece, sep) => {
      if (!piece) return;
      if ((buf ? buf.length + sep.length : 0) + piece.length > max) {
        flush();
        // phần lẻ vẫn dài hơn max → cắt cứng
        while (piece.length > max) { parts.push(piece.slice(0, max)); piece = piece.slice(max); }
        buf = piece;
      } else {
        buf = buf ? buf + sep + piece : piece;
      }
    };
    for (const para of String(text).split(/\n\n+/)) {
      if (para.length > max) {
        for (const line of para.split('\n')) addChunk(line, '\n');
      } else {
        addChunk(para, '\n\n');
      }
    }
    flush();
    return parts.length ? parts : [String(text).slice(0, max)];
  };
  const sendZaloText = async (zalo, threadId, text, isUser) => {
    let type = isUser ? ThreadType.User : ThreadType.Group;
    const parts = splitForZalo(text);
    for (let i = 0; i < parts.length; i++) {
      const msg = parts.length > 1 ? `(${i + 1}/${parts.length})\n${parts[i]}` : parts[i];
      try {
        await zalo.sendMessage({ msg }, threadId, type);
      } catch (e) {
        // Sai loại thread → đổi loại, thử lại, và NHỚ loại đúng cho các phần sau.
        if (/hợp lệ|invalid|param/i.test(String(e?.message || ''))) {
          type = type === ThreadType.User ? ThreadType.Group : ThreadType.User;
          await zalo.sendMessage({ msg }, threadId, type);
        } else {
          throw e;
        }
      }
      if (i < parts.length - 1) await new Promise((r) => setTimeout(r, 500));
    }
    return parts.length;
  };
  app.post('/api/postiz/send', async (req, res) => {
    const zalo = ctx.getZalo && ctx.getZalo();
    if (!zalo) return res.status(503).json({ error: 'Zalo chưa kết nối — không gửi được' });
    const threadId = String(req.body?.threadId || '').trim();
    const text = String(req.body?.text || '').trim();
    const isUser = String(req.body?.threadType || 'group') === 'user';
    if (!threadId || !text) return res.status(400).json({ error: 'Thiếu threadId hoặc text' });
    try {
      const n = await sendZaloText(zalo, threadId, text, isUser);
      store.pushLog(`Media Hub gửi báo cáo tới ${isUser ? 'người' : 'nhóm'} ${threadId} (${text.length} ký tự, ${n} phần).`);
      res.json({ ok: true, parts: n });
    } catch (e) {
      store.pushLog(`Gửi báo cáo tới ${threadId} LỖI: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // Danh sách nhóm Zalo (cache 5 phút, giống /api/zalo/groups).
  app.get('/api/postiz/groups', async (req, res) => {
    const zalo = ctx.getZalo && ctx.getZalo();
    if (cacheIsOtherAccount()) clearGroupsCache(); // đổi nick → bỏ cache tài khoản cũ
    const force = req.query.force === '1' || req.query.force === 'true';
    const fresh = _groupsCache && Date.now() - _groupsAt < 300000;
    if (_groupsCache && !force) {
      res.json(filterGroups(_groupsCache));
      if (!fresh && zalo && !_groupsRefreshing) { _groupsRefreshing = true; refreshGroups(zalo).catch(() => {}).finally(() => { _groupsRefreshing = false; }); }
      return;
    }
    if (!zalo) return res.status(503).json({ error: 'Zalo chưa kết nối — không lấy được danh sách nhóm' });
    try {
      if (!_groupsPromise) _groupsPromise = refreshGroups(zalo).finally(() => { _groupsPromise = null; });
      res.json(filterGroups(await _groupsPromise));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Danh bạ BẠN BÈ của tài khoản bot (cache 5 phút) — Media Hub chọn NGƯỜI
  // nhận bản tin (bên cạnh nhóm). Trả { friends: [{threadId, name, avatar}] }.
  let _friendsCache = null;
  let _friendsAt = 0;
  app.get('/api/postiz/contacts', async (req, res) => {
    const zalo = ctx.getZalo && ctx.getZalo();
    const force = req.query.force === '1' || req.query.force === 'true';
    if (_friendsCache && !force && Date.now() - _friendsAt < 300000) {
      return res.json(_friendsCache);
    }
    if (!zalo) return res.status(503).json({ error: 'Zalo chưa kết nối — không lấy được danh bạ' });
    try {
      const all = await zalo.getAllFriends();
      const list = (Array.isArray(all) ? all : [])
        .map((f) => ({
          threadId: String(f.userId || f.uid || ''),
          name: String(f.displayName || f.zaloName || f.username || 'Không tên').slice(0, 80),
          avatar: f.avatar || '',
        }))
        .filter((f) => f.threadId);
      _friendsCache = { friends: list };
      _friendsAt = Date.now();
      store.pushLog(`Media Hub tải danh bạ: ${list.length} bạn bè.`);
      res.json(_friendsCache);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Tra SĐT → người nhận (gửi cho người CHƯA kết bạn được — nhưng nhắn người
  // lạ dễ bị Zalo hạn chế, Media Hub đã cảnh báo ở UI).
  app.get('/api/postiz/find-user', async (req, res) => {
    const zalo = ctx.getZalo && ctx.getZalo();
    if (!zalo) return res.status(503).json({ error: 'Zalo chưa kết nối' });
    const phone = String(req.query.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'Thiếu phone' });
    try {
      const u = await zalo.findUser(phone);
      const uid = u && (u.uid || u.userId);
      if (!uid) return res.status(404).json({ error: 'Không tìm thấy người dùng với SĐT này' });
      res.json({
        threadId: String(uid),
        name: String(u.display_name || u.zalo_name || u.displayName || phone).slice(0, 80),
        avatar: u.avatar || '',
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Sửa route 1 nhóm từ Media Hub (kiểu PATCH — chỉ đổi field có gửi lên):
  //   { threadId, name?, enabled?, integrationId? }
  //   enabled: bật/tắt nghe; integrationId: kênh Media Hub RIÊNG ('' = kênh mặc định).
  // Chưa có route thì tạo tối thiểu (chỉ nghe → đẩy Media Hub; FB/GBP ở dashboard bot).
  app.post('/api/postiz/routes', (req, res) => {
    try {
      const { threadId, name, enabled, integrationId } = req.body || {};
      if (!threadId) return res.status(400).json({ error: 'thiếu threadId' });
      const data = readRoutesRaw();
      data.routes = Array.isArray(data.routes) ? data.routes : [];
      const found = data.routes.find((r) => String(r.threadId) === String(threadId));
      if (found) {
        if (enabled !== undefined) found.enabled = enabled !== false;
        if (integrationId !== undefined) found.postizIntegrationId = String(integrationId || '');
        if (name && !found.label) found.label = String(name);
      } else {
        data.routes.push({
          threadId: String(threadId),
          label: String(name || threadId),
          enabled: enabled !== false,
          ...(integrationId ? { postizIntegrationId: String(integrationId) } : {}),
          facebookAutoPublish: false,
          gbpAutoPublish: false,
        });
      }
      fs.writeFileSync(ROUTES_FILE, JSON.stringify(data, null, 2));
      ctx.reloadConfig && ctx.reloadConfig();
      const action = integrationId !== undefined
        ? `đổi kênh đích nhóm (${integrationId ? 'kênh riêng' : 'kênh mặc định'})`
        : `${enabled !== false ? 'bật' : 'tắt'} nghe nhóm`;
      store.pushLog(`Media Hub ${action}: ${name || threadId}`);
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Nhật ký gần đây (mới → cũ) cho trang Zalo trong Media Hub.
  app.get('/api/postiz/logs', (req, res) => res.json(store.getLogs().slice(-80).reverse()));

  // --- Hàng chờ của bot (duyệt đăng thẳng Facebook/GBP) ---
  app.get('/api/postiz/pending', (req, res) => {
    const cfg = loadConfig();
    res.json(store.listPending().map((d) => {
      const route = routeForThread(cfg, d.threadId) || {};
      return {
        id: d.id,
        routeLabel: d.routeLabel || route.label || '',
        caption: d.caption || '',
        imageCaptions: d.imageCaptions || [],
        createdAt: d.createdAt || 0,
        scheduledAt: d.scheduledAt || null,
        imageCount: (d.savedImages || []).length,
        videoCount: (d.savedVideos || []).length,
        approvals: approvalsOf(d, route),
        hasFbToken: !!route.fanpageToken,
        gbpCount: gbpIdsOf(d, route).length,
        pushedToHub: !!d.pushedToHub, // đã tự đẩy sang Media Hub → khỏi đẩy lại
      };
    }));
  });

  // Ảnh của bài trong hàng chờ (stream từ đĩa — /output cần login nên không dùng được từ Hub).
  app.get('/api/postiz/draft-image/:id/:idx', (req, res) => {
    const d = store.getPending(req.params.id);
    const f = d && (d.savedImages || [])[Number(req.params.idx)];
    if (!f || !fs.existsSync(f)) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(f);
  });

  app.post('/api/postiz/pending/:id/save', (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: 'không thấy bài' });
    const patch = {};
    if (req.body?.caption != null) patch.caption = String(req.body.caption);
    if (Array.isArray(req.body?.imageCaptions)) patch.imageCaptions = req.body.imageCaptions.map(String);
    const next = store.updatePending(d.id, patch);
    store.pushLog(`Media Hub sửa caption: ${d.routeLabel || d.id}`);
    res.json(next);
  });

  // AI viết lại caption (trả về xem trước, không tự lưu — giống /api/pending/:id/rewrite).
  app.post('/api/postiz/pending/:id/rewrite', async (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: 'không thấy bài' });
    const cur = (req.body?.caption != null ? req.body.caption : d.caption) || '';
    if (!cur.trim()) return res.status(400).json({ error: 'Bài chưa có nội dung để viết lại' });
    const route = routeForThread(loadConfig(), d.threadId) || {};
    try {
      const out = await rewriteCaption(cur, { guide: route.writeGuide || route.styleSample || '', log: store.pushLog });
      if (!out) return res.status(400).json({ error: 'AI chưa viết lại được — kiểm tra key Claude.' });
      store.pushLog(`Media Hub: AI viết lại caption ${d.routeLabel || d.id}`);
      res.json({ ok: true, caption: out });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Duyệt đăng thẳng Facebook (mirror /api/pending/:id/approve).
  app.post('/api/postiz/pending/:id/approve', async (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: 'không thấy bài' });
    const published = req.body?.published !== false;
    const cfg = loadConfig();
    const route = routeForThread(cfg, d.threadId) || { fanpageId: d.fanpageId, fanpageToken: process.env[d.fanpageTokenEnv], comment: '' };
    if (!route.fanpageToken) return res.status(400).json({ error: 'Page chưa có token (vào dashboard bot → tab Token cấp trước)' });
    try {
      const r = await publishFacebookDraft(d, route, { published, comment: route.comment, log: store.pushLog });
      const approvals = approvalsOf(d, route);
      approvals.facebook = { status: 'posted', published, links: r.links, at: Date.now() };
      const next = store.updatePending(d.id, { approvals, published, links: r.links });
      rememberProcessedChannel(next || { ...d, approvals, published, links: r.links }, route, { approvals, published, links: r.links });
      const done = completePendingIfDone(next || { ...d, approvals, published, links: r.links }, route);
      store.pushLog(`FACEBOOK ĐÃ ${published ? 'ĐĂNG CÔNG KHAI' : 'LƯU NHÁP'} (từ Media Hub): ${d.routeLabel} → ${r.links.join(' ')}`);
      res.json({ ok: true, done, links: r.links });
    } catch (e) { store.pushLog('Đăng lỗi: ' + e.message); res.status(500).json({ error: e.message }); }
  });

  // Từ chối/xoá bài khỏi hàng chờ của bot (xoá cả ảnh trên đĩa).
  app.post('/api/postiz/pending/:id/reject', (req, res) => {
    const d = store.getPending(req.params.id);
    if (d) { try { fs.rmSync(d.dir, { recursive: true, force: true }); } catch {} store.removePending(d.id); store.pushLog('Media Hub bỏ bài: ' + (d.routeLabel || d.id)); }
    res.json({ ok: true });
  });

  // Đẩy tay 1 bài trong hàng chờ sang Media Hub (bài cũ trước khi bật cầu nối).
  app.post('/api/postiz/pending/:id/push-hub', async (req, res) => {
    const d = store.getPending(req.params.id);
    if (!d) return res.status(404).json({ error: 'không thấy bài' });
    if (process.env.POSTIZ_ENABLED !== 'true') return res.status(400).json({ error: 'Cầu nối đang tắt — bật ở bước 3 trước' });
    try {
      const route = routeForThread(loadConfig(), d.threadId) || {};
      // Bỏ chân bài của bot khỏi bản đẩy Hub — Media Hub tự chèn chân bài của kênh
      // (cài trong Lịch) dưới caption, trên hashtag. Tránh trùng 2 chân bài.
      const hubCaption = reapplyFooter(d.caption, d.captionFooter || "", "", d.hashtags || "");
      const r = await pushToPostiz({ caption: hubCaption, imagePaths: d.savedImages || [], videoPaths: d.savedVideos || [], imageCaptions: d.imageCaptions || [], videoCaptions: d.videoCaptions || [], groupName: d.routeLabel || '', integrationIds: route.postizIntegrationIds || [], integrationId: route.postizIntegrationId || '' });
      if (r?.ok) {
        // Nhớ postId để Hub mở thẳng trình soạn bài (nút "Soạn & đăng ở Calendar").
        try { store.updatePending(d.id, { pushedToHub: true, ...(r.postId ? { hubPostId: r.postId } : {}) }); } catch {}
        store.pushLog(`Đẩy tay bài "${d.routeLabel}" sang Media Hub (${r.media} media).`);
        return res.json({ ok: true, media: r.media, postId: r.postId || null });
      }
      res.status(400).json({ error: r?.error || r?.skipped || 'không đẩy được' });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // --- Lắng nghe realtime theo nhóm (mirror /api/live, không auth như nhóm /api/postiz) ---
  app.get('/api/postiz/live', (req, res) => {
    const liveArr = ctx.getLive ? ctx.getLive() : [];
    const byThread = {};
    for (const s of liveArr) byThread[s.threadId] = s;
    const cfg = loadConfig();
    const threads = [];
    for (const r of cfg.byThread.values()) {
      if (r.enabled === false) continue;
      const s = byThread[String(r.threadId)];
      if (s) {
        let st = { ...s, label: r.label, debounceMs: r.debounceMs, maxWaitMs: r.maxWaitMs };
        if (st.phase === 'done' && st.proc && st.proc.draftId && !store.getPending(st.proc.draftId)) st = { ...st, phase: 'idle', proc: null, doneAt: 0 };
        threads.push(st);
      } else {
        threads.push({ threadId: String(r.threadId), label: r.label, phase: 'idle', counts: { image: 0, video: 0, text: 0 }, events: [], startedAt: 0, lastEventAt: 0, debounceMs: r.debounceMs, maxWaitMs: r.maxWaitMs, proc: null, doneAt: 0 });
      }
    }
    res.json({ connected: !!(ctx.status && ctx.status.zaloConnected), serverNow: Date.now(), threads });
  });

  app.post('/api/postiz/live/close', (req, res) => {
    const threadId = req.body && req.body.threadId;
    if (!threadId) return res.status(400).json({ error: 'thiếu threadId' });
    if (!ctx.closeNow) return res.status(400).json({ error: 'không hỗ trợ chốt phiên' });
    Promise.resolve(ctx.closeNow(String(threadId))).catch(() => {});
    store.pushLog('Media Hub chốt phiên gom cho nhóm ' + threadId);
    res.json({ ok: true });
  });

  // --- Cài đặt nhanh (tạm dừng bot) + đổi tài khoản Zalo ---
  app.post('/api/postiz/settings', (req, res) => {
    const s = store.setSettings(req.body || {});
    store.pushLog(`Media Hub đổi cài đặt: duyệt=${s.approval} tạm dừng=${s.paused}`);
    res.json(s);
  });

  app.post('/api/postiz/zalo/logout', (req, res) => {
    clearGroupsCache();
    if (ctx.relogin) {
      ctx.relogin().catch(() => {});
      store.pushLog('Media Hub: đăng xuất Zalo — chờ quét QR tài khoản mới.');
      return res.json({ ok: true, relogin: true });
    }
    res.status(501).json({ error: 'Service này chưa hỗ trợ đổi tài khoản trong tiến trình' });
  });

  app.get('/postiz', (req, res) => {
    // Cho phép nhúng trong giao diện Postiz (localhost:4200)
    res.removeHeader('X-Frame-Options');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' http://localhost:4200 http://127.0.0.1:4200");
    res.type('html').send(POSTIZ_CONFIG_PAGE);
  });

  // ===== Cấu hình ứng dụng Facebook (App ID + Secret) qua dashboard =====
  app.post("/api/fb/app", requireAuth, (req, res) => {
    const { appId, appSecret, clear } = req.body || {};
    if (clear) {
      removeToken("FB_APP_ID"); removeToken("FB_APP_SECRET");
      _pagesCache = null; store.pushLog("Đã xóa cấu hình App Facebook (về trống).");
      return res.json({ ok: true, cleared: true });
    }
    if (appId != null && String(appId).trim()) saveToken("FB_APP_ID", String(appId).trim());
    if (appSecret != null && String(appSecret).trim()) saveToken("FB_APP_SECRET", String(appSecret).trim());
    _pagesCache = null; store.pushLog("Đã lưu cấu hình App Facebook.");
    res.json({ ok: true });
  });

  // ===== Token & danh sách Trang =====
  const FBV = process.env.FB_GRAPH_VERSION || "v21.0";
  const G = `https://graph.facebook.com/${FBV}`;
  let _pagesCache = null, _pagesAt = 0;
  // Gộp MỌI Trang hệ thống đang giữ token: từ data/pages.json + routes + mọi biến FB_PAGE_TOKEN_* trong .env.
  // ĐỒNG BỘ Trang từ Media Hub (Add Channel): user kết nối Trang Facebook MỘT
  // lần ở Hub → bot tự nhận page token (tokens.json + env), đăng thẳng được.
  // Thay thế việc dán user token ở tab Token (tab đó giờ chỉ là fallback).
  async function syncPagesFromHub() {
    const hubPages = await fetchHubFacebookPages(); // [] nếu chưa có key/Hub tắt
    if (!hubPages.length) return 0;
    const pstore = loadPages();
    let changed = 0;
    for (const p of hubPages) {
      const fid = String(p.pageId);
      const envName = pstore[fid]?.envName || envNameFor(p.name || fid, fid);
      if (process.env[envName] !== p.token) { saveToken(envName, p.token); changed++; }
      // Hub tự refresh token định kỳ; mỗi lần đồng bộ bot lại nhận bản mới nhất
      // → hiển thị "Vĩnh viễn" nếu Hub không báo hạn.
      const expiresAt = p.expiresAt ? Math.floor(p.expiresAt / 1000) : 0;
      const cur = pstore[fid];
      if (!cur || cur.envName !== envName || cur.name !== (p.name || cur.name) || cur.expiresAt !== expiresAt) changed++;
      pstore[fid] = { name: p.name || cur?.name || "Trang " + fid, envName, expiresAt };
    }
    if (changed) { savePages(pstore); _pagesCache = null; }
    return hubPages.length;
  }
  // Đồng bộ 1 lần lúc khởi động (nền) — token sẵn sàng trước khi có bài cần đăng.
  syncPagesFromHub().then((n) => { if (n) store.pushLog(`Đồng bộ ${n} Trang Facebook từ Media Hub (Add Channel).`); }).catch(() => {});

  async function buildPagesList(force) {
    if (!force && _pagesCache && Date.now() - _pagesAt < 300000) return _pagesCache;
    try { await syncPagesFromHub(); } catch {}
    const pstore = loadPages();
    // NHANH: nếu store (data/pages.json) đã phủ hết token FB_PAGE_TOKEN_* trong .env -> dựng từ store, KHÔNG gọi Graph (hiện tức thì)
    const envKeys = Object.keys(process.env).filter((k) => /^FB_PAGE_TOKEN_/.test(k) && process.env[k]);
    const storeEnvs = new Set(Object.values(pstore).map((m) => m.envName));
    if (!force && Object.keys(pstore).length && envKeys.length && envKeys.every((k) => storeEnvs.has(k))) {
      const list = Object.entries(pstore)
        .map(([fid, m]) => ({ fanpageId: fid, name: m.name || ("Trang " + fid), envName: m.envName, hasToken: !!(m.envName && process.env[m.envName]), expiresAt: m.expiresAt }))
        .sort((a, b) => a.name.localeCompare(b.name, "vi"));
      _pagesCache = list; _pagesAt = Date.now();
      return list;
    }
    const appId = process.env.FB_APP_ID, secret = process.env.FB_APP_SECRET;
    const cfg = loadConfig();
    const map = {};
    for (const [fid, meta] of Object.entries(pstore))
      map[fid] = { fanpageId: fid, name: meta.name || null, envName: meta.envName, hasToken: !!(meta.envName && process.env[meta.envName]), expiresAt: meta.expiresAt };
    for (const r of cfg.byThread.values()) {
      if (!r.fanpageId || map[r.fanpageId]) continue;
      map[r.fanpageId] = { fanpageId: r.fanpageId, name: null, envName: r.fanpageTokenEnv, hasToken: !!r.fanpageToken };
    }
    // Quét mọi token Trang trong .env -> hỏi Graph /me để biết page id + tên (hiện đủ Trang dù chưa cấu hình route)
    for (const [k, v] of Object.entries(process.env)) {
      if (!/^FB_PAGE_TOKEN_/.test(k) || !v) continue;
      try {
        const me = await (await fetch(`${G}/me?fields=id,name&access_token=${encodeURIComponent(v)}`)).json();
        if (me.id) {
          const cur = map[me.id] || { fanpageId: String(me.id) };
          cur.fanpageId = String(me.id); cur.name = me.name || cur.name; cur.envName = cur.envName || k; cur.hasToken = true;
          map[me.id] = cur;
        }
      } catch {}
    }
    // Bổ sung tên + hạn token nếu còn thiếu
    for (const p of Object.values(map)) {
      const tok = p.envName && process.env[p.envName];
      if (tok) {
        if (!p.name) { try { const g = await (await fetch(`${G}/${p.fanpageId}?fields=name&access_token=${encodeURIComponent(tok)}`)).json(); if (g.name) p.name = g.name; } catch {} }
        if (p.expiresAt === undefined && appId && secret) { try { p.expiresAt = (await debugToken(tok, appId, secret)).expires_at ?? null; } catch {} }
      }
      if (!p.name) p.name = "Trang " + p.fanpageId;
    }
    // Lưu lại store (tên + hạn) để lần sau nhanh, và làm nguồn dropdown ổn định
    const newStore = {};
    for (const p of Object.values(map)) if (p.envName) newStore[p.fanpageId] = { name: p.name, envName: p.envName, expiresAt: p.expiresAt };
    savePages(newStore);
    _pagesCache = Object.values(map).sort((a, b) => a.name.localeCompare(b.name, "vi"));
    _pagesAt = Date.now();
    return _pagesCache;
  }

  app.get("/api/fb/pages", requireAuth, async (req, res) => {
    // ?force=1: bỏ cache 5 phút — dùng khi vừa kết nối Trang mới ở Add Channel.
    try { res.json(await buildPagesList(req.query.force === "1")); } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/token", requireAuth, async (req, res) => {
    let pages = [];
    try { pages = (await buildPagesList()).map((p) => ({ page: p.name, fanpageId: p.fanpageId, env: p.envName, hasToken: p.hasToken, expiresAt: p.expiresAt })); } catch {}
    res.json({ appId: process.env.FB_APP_ID || "", hasSecret: !!process.env.FB_APP_SECRET, pages });
  });

  // ===== Google Business Profile / Playwright session =====
  app.get("/api/gbp/status", requireAuth, (req, res) => {
    res.json({
      session: inspectGbpSession(),
      login: gbpLoginStatus(),
      businesses: loadGbpBusinesses(),
    });
  });
  app.post("/api/gbp/login/start", requireAuth, async (req, res) => {
    try {
      const r = await beginGBPLogin();
      store.pushLog("Google Business: đã mở trình duyệt để đăng nhập/cập nhật session.");
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/gbp/login/save", requireAuth, async (req, res) => {
    try {
      const r = await finishGBPLogin();
      store.pushLog("Google Business: đã lưu session Playwright.");
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/gbp/login/cancel", requireAuth, async (req, res) => {
    try {
      const r = await cancelGBPLogin();
      store.pushLog("Google Business: đã hủy phiên đăng nhập Playwright.");
      res.json(r);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  // Cấp vé để Hub nhúng màn hình ảo: khởi động Xvfb/x11vnc/noVNC (idempotent),
  // trả ticket một lần. Hub dựng iframe /botvnc/vnc/vnc.html?ticket=...
  app.post("/api/gbp/vnc-ticket", requireAuth, async (req, res) => {
    try {
      if (!vncAvailable()) {
        return res.status(400).json({ error: "Máy bot thiếu noVNC (Xvfb/x11vnc/websockify)." });
      }
      await startVncStack();
      res.json({ ok: true, ticket: issueVncTicket() });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Chẩn đoán noVNC: xem layout file thật trên VPS để sửa đúng đường dẫn iframe
  app.get("/api/gbp/vnc-debug", requireAuth, (req, res) => {
    const dirs = ["/usr/share/novnc", "/usr/share/webapps/novnc", "/usr/lib/novnc"];
    const out = { available: vncAvailable(), started: vncStarted(), novncPort: NOVNC_PORT, dirs: {} };
    for (const d of dirs) {
      try { out.dirs[d] = fs.readdirSync(d).slice(0, 50); } catch (e) { out.dirs[d] = "(không có)"; }
    }
    out.bins = { Xvfb: fs.existsSync("/usr/bin/Xvfb"), x11vnc: fs.existsSync("/usr/bin/x11vnc"), websockify: fs.existsSync("/usr/bin/websockify") };
    res.json(out);
  });

  // Tải session lên (đăng nhập Google ở máy local -> upload file data/gbp-session.json)
  app.post("/api/gbp/session/upload", requireAuth, (req, res) => {
    try {
      const session = importGbpSession(req.body?.session);
      store.pushLog("Google Business: đã tải session lên (từ máy local).");
      res.json({ ok: true, session });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });
  app.get("/api/gbp/businesses", requireAuth, (req, res) => res.json(loadGbpBusinesses()));
  app.post("/api/gbp/businesses", requireAuth, (req, res) => {
    try {
      const list = saveGbpBusinesses(req.body?.businesses || []);
      store.pushLog("Google Business: đã lưu " + list.length + " hồ sơ.");
      res.json({ ok: true, businesses: list });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Dán 1 user token -> phát hiện MỌI Trang user quản lý, cấp token vĩnh viễn, lưu vào .env + data/pages.json.
  app.post("/api/token/refresh", requireAuth, async (req, res) => {
    const { userToken } = req.body || {};
    const appId = process.env.FB_APP_ID, secret = process.env.FB_APP_SECRET;
    if (!userToken) return res.status(400).json({ error: "thiếu userToken" });
    if (!appId || !secret) return res.status(400).json({ error: "thiếu FB_APP_ID/FB_APP_SECRET trong .env" });
    try {
      // Đổi sang long-lived nếu được; nếu lỗi (vd đã là page token) thì dùng token gốc.
      let longUser = userToken;
      try { longUser = await exchangeLongLivedUser(userToken, appId, secret); } catch {}
      // Soi token để chẩn đoán: loại (USER/PAGE), quyền, app, còn hạn? (giữ NGUYÊN lỗi Facebook để hiện ra)
      let dbg = {}, dbgErr = null;
      try {
        const dj = await (await fetch(`${G}/debug_token?input_token=${encodeURIComponent(longUser)}&access_token=${encodeURIComponent(appId)}|${encodeURIComponent(secret)}`)).json();
        if (dj.error) dbgErr = dj.error.message; else dbg = dj.data || {};
      } catch (e) { dbgErr = e.message; }
      let pages = [], accountsErr = null;
      try { pages = await listUserPages(longUser); } catch (e) { accountsErr = e.message; }
      // Bổ sung cho trường hợp Business Manager (/me/accounts rỗng): lấy token TRỰC TIẾP theo ID Trang đã biết.
      const have = new Set(pages.map((p) => String(p.id)));
      // ID Trang người dùng tự nhập (tổng quát: thêm Trang MỚI chưa có trong routes).
      // Nhận ID số, username, hoặc link facebook.com/... -> tách phần định danh.
      const userRefs = String(req.body.pageRefs || "")
        .split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)
        .map((x) => { const m = x.match(/facebook\.com\/(?:profile\.php\?id=)?([^/?&#]+)/i); return m ? m[1] : x; })
        .filter(Boolean);
      const knownIds = new Set([
        ...userRefs,
        ...Object.keys(loadPages()),
        ...[...loadConfig().byThread.values()].map((r) => r.fanpageId).filter(Boolean).map(String),
      ]);
      for (const pid of knownIds) {
        if (have.has(String(pid))) continue;
        try { const { token, name, id } = await derivePageToken(pid, longUser); if (token) { const fid = id || String(pid); if (have.has(fid)) continue; pages.push({ id: fid, name: name || ("Trang " + fid), token }); have.add(fid); have.add(String(pid)); } } catch {}
      }
      // Fallback: nếu là PAGE token đơn lẻ -> nhận đúng 1 Trang đó.
      if (!pages.length && (dbg.type === "PAGE" || dbg.profile_id)) {
        try {
          const me = await (await fetch(`${G}/me?fields=id,name&access_token=${encodeURIComponent(longUser)}`)).json();
          if (me.id) pages = [{ id: String(me.id), name: me.name || ("Trang " + me.id), token: longUser }];
        } catch {}
      }
      if (!pages.length) {
        const scopes = dbg.scopes || [];
        const detail = `app token=${dbg.app_id || "?"} | app .env=${appId} | loại=${dbg.type || "?"} | quyền=${scopes.join(",") || "(trống)"}` +
          (dbgErr ? ` | debug: ${dbgErr}` : "") + (accountsErr ? ` | /me/accounts: ${accountsErr}` : "");
        if (dbg.is_valid === false) return res.status(400).json({ error: "Token không hợp lệ hoặc đã hết hạn — tạo token mới.", detail });
        if (dbg.app_id && String(dbg.app_id) !== String(appId))
          return res.status(400).json({ error: `Token được tạo cho ứng dụng KHÁC (app ${dbg.app_id}), không khớp app trong .env (${appId}). Ở Graph API Explorer, chọn đúng "Meta App" của bạn ở góc trên rồi Generate lại.`, detail });
        if (scopes.length && !scopes.includes("pages_show_list"))
          return res.status(400).json({ error: "Token thiếu quyền pages_show_list. Ở Graph API Explorer bấm Permissions thêm pages_show_list, pages_manage_posts, pages_read_engagement rồi Generate lại.", detail });
        if (accountsErr)
          return res.status(400).json({ error: "Facebook báo lỗi khi lấy danh sách Trang: " + accountsErr, detail });
        return res.status(400).json({ error: "Không thấy Trang nào. Trang nằm trong Business Manager nên user token không tự liệt kê được — hãy điền ID hoặc link các Trang cần đăng vào ô '2 · Các Trang cần đăng' rồi bấm lại.", detail });
      }
      const cfg = loadConfig();
      const existingEnv = {};
      for (const r of cfg.byThread.values()) if (r.fanpageId && r.fanpageTokenEnv) existingEnv[r.fanpageId] = r.fanpageTokenEnv;
      const pstore = loadPages();
      const result = [];
      for (const p of pages) {
        const envName = existingEnv[p.id] || pstore[p.id]?.envName || envNameFor(p.name, p.id);
        setEnvVar(envName, p.token);
        let expires_at = null;
        try { expires_at = (await debugToken(p.token, appId, secret)).expires_at ?? null; } catch {}
        pstore[p.id] = { name: p.name, envName, expiresAt: expires_at };
        result.push({ fanpageId: p.id, name: p.name, envName, expires_at });
      }
      savePages(pstore);
      _pagesCache = null;
      ctx.reloadConfig && ctx.reloadConfig();
      store.pushLog("Đã phát hiện & cấp token cho " + result.length + " Trang Facebook");
      res.json({ ok: true, result });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Xóa token 1 Trang (gỡ token + bỏ Trang khỏi danh sách)
  app.post("/api/token/delete", requireAuth, (req, res) => {
    const { fanpageId } = req.body || {};
    if (!fanpageId) return res.status(400).json({ error: "thiếu fanpageId" });
    const pstore = loadPages();
    const meta = pstore[fanpageId];
    const envName = meta?.envName || [...loadConfig().byThread.values()].find((r) => String(r.fanpageId) === String(fanpageId))?.fanpageTokenEnv;
    if (envName) removeToken(envName);
    delete pstore[fanpageId];
    savePages(pstore);
    _pagesCache = null;
    store.pushLog(`Đã xóa token Trang ${fanpageId}`);
    res.json({ ok: true });
  });

  // ===== Logs =====
  app.get("/api/logs", requireAuth, (req, res) => res.json(store.getLogs().slice(-200).reverse()));

  // ===== Trang dashboard =====
  // no-store: mỗi lần deploy dashboard mới -> trình duyệt lấy bản mới NGAY, khỏi phải hard-refresh.
  app.get("/", (req, res) => { res.set("Cache-Control", "no-store, must-revalidate"); res.sendFile(PAGE_FILE); });

  const PORT = Number(process.env.WEB_PORT || 8080);
  // Bind 127.0.0.1: chỉ tiến trình trên CHÍNH máy chủ (Media Hub proxy /botapi
  // đi qua 127.0.0.1) gọi được. Thiết bị LAN/tunnel KHÔNG gọi thẳng :8088 —
  // phải qua Media Hub (đã verify JWT). Đóng lỗ hổng /api/postiz/* không auth.
  // Docker: đặt WEB_HOST=0.0.0.0 để container Media Hub gọi qua mạng nội bộ
  // compose (KHÔNG publish cổng ra ngoài; auth bằng HUB_BOT_TOKEN).
  const HOST = process.env.WEB_HOST || '127.0.0.1';
  const server = app.listen(PORT, HOST, () => console.log(`🌐 Web dashboard: http://${HOST}:${PORT}`));
  // WebSocket noVNC: chỉ cho phiên đã đăng nhập dashboard (gate bằng cookie sid)
  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/vnc")) return;
    const sid = parseCookies(req).sid;
    if (!sessions.has(sid)) { try { socket.destroy(); } catch {} return; }
    vncProxy.upgrade(req, socket, head);
  });
  return app;
}
