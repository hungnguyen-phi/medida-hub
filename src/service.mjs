// src/service.mjs — SERVICE: zca-js listener -> extract -> batcher -> chuẩn bị bài -> HÀNG CHỜ DUYỆT
// (hoặc tự đăng) + WEB DASHBOARD. Chạy: node --env-file=.env src/service.mjs
import fs from "node:fs";
import path from "node:path";
import { Zalo, ThreadType } from "zca-js";
import qrcode from "qrcode-terminal";
import { extractEvent } from "./extract.mjs";
import { Batcher, MemoryStore } from "./batcher.mjs";
import { loadConfig, routeForThread } from "./config.mjs";
import { processBatch } from "./pipeline.mjs";
import { assembleCaption } from "./caption.mjs";
import { publishFacebookDraft, publishGbpDraft } from "./publish.mjs";
import { startWeb } from "./web.mjs";
import { pushToPostiz } from "./postiz.mjs";
import * as store from "./store.mjs";
import * as live from "./live.mjs";
import { CRED_FILE, QR_FILE, dataPath, loadTokensIntoEnv } from "./paths.mjs";

loadTokensIntoEnv(); // nạp token Trang FB đã lưu (data/tokens.json) vào process.env trước khi chạy
// (Không seed routes — app khởi tạo TRỐNG; người dùng tự cấu hình qua dashboard.)

// Log ra file + màn hình + dashboard
const _logStream = fs.createWriteStream(dataPath("service.log"), { flags: "a" });
const _origLog = console.log.bind(console);
const _origErr = console.error.bind(console);
console.log = (...a) => { _origLog(...a); try { _logStream.write(a.join(" ") + "\n"); } catch {} };
console.error = (...a) => { _origErr(...a); try { _logStream.write("[ERR] " + a.join(" ") + "\n"); } catch {} };
process.on("uncaughtException", (e) => { console.error("💥 uncaughtException:", e?.stack || e); setTimeout(() => process.exit(1), 300); });
process.on("unhandledRejection", (e) => { console.error("💥 unhandledRejection:", e?.message || e); });

async function login() {
  const zalo = new Zalo({ selfListen: true });
  if (fs.existsSync(CRED_FILE)) {
    try {
      const api = await zalo.login(JSON.parse(fs.readFileSync(CRED_FILE, "utf8")));
      console.log("✅ Đăng nhập lại bằng credentials đã lưu.");
      return api;
    } catch (e) { console.log("⚠️ Creds cũ hỏng:", e.message, "→ quét QR."); }
  }
  console.log("📲 Quét QR (mở qr.png / dashboard tab Cài đặt) bằng tài khoản đã ở trong nhóm:");
  return zalo.loginQR({ qrPath: QR_FILE }, (ev) => {
    if (ev?.type === 0 && ev.data?.code) { qrcode.generate(ev.data.code, { small: true }); try { ev.actions?.saveToFile?.(QR_FILE); } catch {} }
    if (ev?.type === 4 && ev.data) fs.writeFileSync(CRED_FILE, JSON.stringify(ev.data, null, 2));
  });
}

async function main() {
  let cfg = loadConfig();
  const reloadConfig = () => { cfg = loadConfig(); console.log("  [cfg] đã nạp lại routes:", [...cfg.byThread.keys()].join(", ")); };
  const getRoute = (tid) => { const r = routeForThread(cfg, tid); return r && r.enabled !== false ? r : undefined; };

  const status = { zaloConnected: false, relogging: false, ownId: null };
  let currentApi = null;
  const threadTypeOf = new Map();

  const batcher = new Batcher({
    store: new MemoryStore(),
    getRoute,
    log: (m) => console.log("  [batcher]", m),
    preExpiryMs: Number(process.env.PRE_EXPIRY_MS || 3600000), // chỉ-có-chữ, 1h không ảnh -> bỏ
    onDiscard: (tid) => live.clear(tid), // xoá phiên "đang ghi nhận" trên màn Lắng nghe

    onClose: async (batch, reason) => {
      const route = getRoute(batch.threadId);
      if (!route) return;
      live.processing(batch.threadId, "Bắt đầu xử lý");
      try {
        // CHUẨN BỊ bài (gom -> lọc -> AI chọn -> format -> caption). KHÔNG đăng ở đây.
        const res = await processBatch(batch, reason, {
          log: (m) => console.log("  [pipeline]", m), perItemCaption: true,
          guide: route.writeGuide || route.styleSample || "",
          autoHashtags: route.autoHashtags !== false,
          curate: route.curateImages !== false, // TẮT ở nhóm này -> giữ nguyên mọi ảnh, không lọc

          onStage: (stage, extra) => live.processing(batch.threadId, stage, extra),
        });
        if (!res.savedImages.length && !res.savedVideos.length) { live.done(batch.threadId, null); return; }
        // Ảnh AN TOÀN (không bị lọc trùng/mờ/tối, không bị AI chặn) — LUÔN dùng
        // mảng này cho mọi đường đăng CÔNG KHAI cũ (Facebook/GBP tự đăng thẳng,
        // không qua Media Hub). Ảnh bị ẩn (imageHidden[i]=true) CHỈ được đẩy
        // sang Media Hub kèm cờ hidden để người duyệt tự xem lại — không bao
        // giờ lọt vào 2 luồng tự-đăng cũ này.
        const imageHidden = res.imageHidden || res.savedImages.map(() => false);
        const publicSavedImages = res.savedImages.filter((_, i) => !imageHidden[i]);
        const publicImageCaptions = (res.imageCaptions || []).filter((_, i) => !imageHidden[i]);
        const gbpIds = route.gbpLocationIds || (route.gbpLocationId ? [route.gbpLocationId] : []);
        const gbpForThisPost = gbpIds.length > 0 && publicSavedImages.length > 0; // GBP cần ẢNH (không nhận video)
        // Facebook chỉ còn đi qua kênh Media Hub (bản nháp chờ duyệt trên Lịch).
        // Route nào CÒN fanpageId trong file cũ thì giữ luồng duyệt FB như trước.
        const hasFb = !!(route.fanpageId && String(route.fanpageId).trim());
        const draft = {
          id: path.basename(res.dir), threadId: batch.threadId, routeLabel: route.label,
          fanpageId: route.fanpageId, fanpageTokenEnv: route.fanpageTokenEnv,
          gbpLocationIds: gbpIds, gbpLocationId: gbpIds[0] || "",
          // savedImages/imageCaptions ở ĐÂY là bản CÔNG KHAI (đã lọc ẩn) — publish.mjs
          // (đăng Facebook/GBP thẳng, kiểu cũ) đọc thẳng 2 field này nên PHẢI sạch.
          dir: res.dir, savedImages: publicSavedImages, savedVideos: res.savedVideos,
          imageUrls: publicSavedImages.map((p) => "/output/" + path.relative(dataPath("output"), p).replace(/\\/g, "/")),
          videoUrls: (res.savedVideos || []).map((p) => "/output/" + path.relative(dataPath("output"), p).replace(/\\/g, "/")),
          imageCaptions: publicImageCaptions, videoCaptions: res.videoCaptions,
          // Bản ĐẦY ĐỦ (kèm ảnh ẩn) — CHỈ dùng để đẩy sang Media Hub (pushToPostiz
          // bên dưới), Hub tự hiển thị ảnh ẩn cho người duyệt xem lại/bấm hiện.
          allSavedImages: res.savedImages, allImageCaptions: res.imageCaptions || [],
          imageHidden, imageHiddenReasons: res.imageHiddenReasons || [],
          comment: route.comment || "", published: route.published,
          captionFooter: (route.captionFooter || "").trim(), // lưu để sau đổi chân bài thì cập nhật được
          hashtags: res.hashtags || "",                       // 5 hashtag AI -> nằm DƯỚI CÙNG (sau chân bài)
          // Thứ tự: thân bài -> chân bài (hotline/địa chỉ) -> hashtag
          caption: assembleCaption(res.caption, route.captionFooter, res.hashtags),
          droppedCount: res.droppedCount, createdAt: Date.now(), reason,
          approvals: {
            ...(hasFb ? { facebook: { status: "pending" } } : {}),
            ...(gbpForThisPost ? { gbp: { status: "pending" } } : {}),
          },
        };
        const approvals = { ...draft.approvals };
        let published = draft.published;
        let links = [];
        let autoPosted = false;

        if (route.facebookAutoPublish) {
          try {
            const r = await publishFacebookDraft(draft, route, { published: true, comment: route.comment, log: (m) => console.log("  [fb]", m) });
            links = r.links || [];
            published = true;
            approvals.facebook = { status: "posted", published: true, links, at: Date.now(), auto: true };
            autoPosted = true;
            store.pushLog(`FACEBOOK TỰ ĐĂNG CÔNG KHAI: ${route.label} → ${links.join(" ")}`);
          } catch (e) {
            console.error("💥 tự đăng Facebook lỗi:", e?.message || e);
            store.pushLog("Tự đăng Facebook lỗi: " + (e?.message || e));
          }
        }

        if (gbpForThisPost && route.gbpAutoPublish) {
          try {
            const r = await publishGbpDraft(draft, route, { log: (m) => console.log("  [gbp]", m) });
            approvals.gbp = { status: "posted", at: Date.now(), links: r.links || [], count: gbpIds.length, auto: true };
            autoPosted = true;
            store.pushLog(`GOOGLE BUSINESS TỰ ĐĂNG (${gbpIds.length} business): ${route.label}`);
          } catch (e) {
            console.error("💥 tự đăng GBP lỗi:", e?.message || e);
            store.pushLog("Tự đăng Google Business lỗi: " + (e?.message || e));
          }
        }

        const channels = [...(hasFb ? ["facebook"] : []), ...(gbpForThisPost ? ["gbp"] : [])];
        const needsReview = channels.some((ch) => approvals[ch]?.status !== "posted");
        const finalDraft = { ...draft, approvals, published, links };
        // Cầu nối Media Hub: đẩy bản nháp sang Social Hub (nếu bật). Chạy nền.
        // Đánh dấu pushedToHub khi thành công → panel Zalo KHÔNG hiện nút "Đẩy
        // sang Media Hub" lần nữa (tránh nhân đôi bài chờ duyệt).
        if (process.env.POSTIZ_ENABLED === "true") {
          // Bản đẩy Hub KHÔNG kèm chân bài của bot — Media Hub tự chèn chân bài
          // của kênh (cài trong Lịch) dưới caption, trên hashtag. Tránh trùng 2 chân bài.
          pushToPostiz({ caption: assembleCaption(res.caption, "", res.hashtags), imagePaths: draft.allSavedImages || [], videoPaths: draft.savedVideos || [], imageCaptions: draft.allImageCaptions || [], videoCaptions: draft.videoCaptions || [], imageHidden: draft.imageHidden || [], imageHiddenReasons: draft.imageHiddenReasons || [], groupName: route.label, integrationIds: route.postizIntegrationIds || [], integrationId: route.postizIntegrationId || '' })
            .then((r) => {
              if (r?.ok) { try { store.updatePending(draft.id, { pushedToHub: true, ...(r.postId ? { hubPostId: r.postId } : {}) }); } catch {} store.pushLog(`Đã đẩy bản nháp "${route.label}" sang Media Hub (${r.media} media) — chờ duyệt trên Lịch.`); }
              else if (r && !r.skipped) {
                store.pushLog(`Đẩy Media Hub lỗi: ${r.error || r.status}`);
                // Route thuần Media Hub mà đẩy lỗi → giữ thẻ trong hàng chờ của bot
                // làm lưới an toàn (ảnh không bị mất, bấm "Đẩy sang Media Hub" lại được).
                if (!needsReview && !autoPosted) { try { store.addPending({ ...finalDraft, hubError: String(r.error || r.status) }); live.done(batch.threadId, draft.id); } catch {} }
              }
            })
            .catch((e) => {
              store.pushLog(`Đẩy Media Hub lỗi: ${e.message}`);
              if (!needsReview && !autoPosted) { try { store.addPending({ ...finalDraft, hubError: e.message }); live.done(batch.threadId, draft.id); } catch {} }
            });
        }
        if (autoPosted) store.addPosted({ ...finalDraft, postedAt: Date.now(), partial: needsReview });
        if (needsReview) {
          store.addPending(finalDraft);
          live.done(batch.threadId, draft.id);
          store.pushLog(`Bài mới CHỜ DUYỆT: ${route.label} (${res.savedImages.length} ảnh)`);
          console.log(`  [pipeline] -> HÀNG CHỜ DUYỆT (còn kênh cần duyệt)`);
        } else {
          live.done(batch.threadId, null);
          if (!autoPosted) {
            if (process.env.POSTIZ_ENABLED === "true" && (route.postizIntegrationId || process.env.POSTIZ_INTEGRATION_ID)) {
              store.pushLog(`Đã xử lý "${route.label}" — bản nháp chuyển sang Media Hub, duyệt trên Lịch.`);
              console.log(`  [pipeline] -> BẢN NHÁP MEDIA HUB (duyệt trên Lịch)`);
            } else {
              store.pushLog(`Bài đã xử lý nhưng không có kênh tự đăng: ${route.label}`);
            }
          }
        }
      } catch (e) { console.error("💥 xử lý batch lỗi:", e?.message || e); store.pushLog("Xử lý batch lỗi: " + (e?.message || e)); }
    },
  });

  // Gắn toàn bộ listener cho 1 phiên api (dùng lại được khi đổi tài khoản)
  function attachListeners(api) {
    api.listener.on("message", async (m) => {
      try {
        const ev = extractEvent(m);
        if (ev.threadId) threadTypeOf.set(ev.threadId, m.type);
        if (store.getSettings().paused) return; // tạm dừng
        if (["image", "video", "text", "command"].includes(ev.kind)) {
          const rt = getRoute(ev.threadId);
          if (rt) {
            console.log(`📥 ${ev.kind} [${ev.msgType}] từ "${ev.senderName}" (nhóm ${ev.threadId})`);
            if (ev.kind !== "command") live.event(ev.threadId, rt.label, ev, rt);
          }
          await batcher.add(ev);
        } else if (getRoute(ev.threadId)) {
          console.log(`⏭️  bỏ qua tin hệ thống [${ev.msgType}] trong nhóm ${ev.threadId}`);
        }
      } catch (e) { console.error("xử lý message lỗi:", e.message); }
    });
    api.listener.on("connected", () => { status.zaloConnected = true; try { fs.rmSync(QR_FILE, { force: true }); } catch {} console.log("🔌 Listener ĐÃ KẾT NỐI."); });
    api.listener.on("disconnected", (code, reason) => { status.zaloConnected = false; console.log(`🔌 Mất kết nối (code ${code}) — tự thử lại... ${reason || ""}`); });
    api.listener.on("error", (e) => console.error("⚠️ listener error:", e?.message || e));
    api.listener.on("closed", (code, reason) => {
      status.zaloConnected = false;
      if (status.relogging) { console.log("🔌 Listener cũ đã đóng (đang đổi tài khoản — KHÔNG thoát)."); return; }
      console.error(`🔌 Listener ĐÓNG (code ${code} ${reason || ""}) → thoát để khởi động lại.`);
      setTimeout(() => process.exit(1), 500);
    });
    api.listener.start();
  }

  async function setApi(api) {
    currentApi = api;
    try { const oid = await api.getOwnId?.(); if (oid) status.ownId = String(oid); } catch {}
    attachListeners(api);
  }

  // Đổi tài khoản Zalo NGAY trong tiến trình (không khởi động lại service)
  async function reloginZalo() {
    if (status.relogging) return { already: true };
    status.relogging = true; status.zaloConnected = false; status.ownId = null;
    try { currentApi?.listener?.stop?.(); } catch {}
    try { fs.rmSync(CRED_FILE, { force: true }); } catch {}
    try { fs.rmSync(QR_FILE, { force: true }); } catch {}
    store.pushLog("Đổi tài khoản Zalo: dừng phiên cũ, chờ quét QR (không khởi động lại).");
    console.log("♻️  Đổi tài khoản: dừng listener cũ, chờ quét QR mới...");
    try {
      const zalo = new Zalo({ selfListen: true });
      const api = await zalo.loginQR({ qrPath: QR_FILE }, (ev) => {
        if (ev?.type === 0 && ev.data?.code) { qrcode.generate(ev.data.code, { small: true }); try { ev.actions?.saveToFile?.(QR_FILE); } catch {} }
        if (ev?.type === 4 && ev.data) fs.writeFileSync(CRED_FILE, JSON.stringify(ev.data, null, 2));
      });
      await setApi(api);
      store.pushLog("Đã đăng nhập Zalo tài khoản mới.");
      console.log("✅ Đăng nhập Zalo mới xong.");
    } catch (e) {
      console.error("đổi tài khoản lỗi:", e?.message || e);
      store.pushLog("Đổi tài khoản Zalo lỗi: " + (e?.message || e));
    } finally { status.relogging = false; }
  }

  async function reconnectZalo() {
    if (status.relogging) return { already: true };
    status.relogging = true; status.zaloConnected = false; status.ownId = null;
    try { currentApi?.listener?.stop?.(); } catch {}
    try { fs.rmSync(QR_FILE, { force: true }); } catch {}
    store.pushLog("Kết nối lại Zalo: thử dùng phiên đã lưu, nếu hỏng sẽ hiện QR.");
    console.log("♻️  Kết nối lại Zalo: thử phiên đã lưu...");
    try {
      const api = await login();
      await setApi(api);
      store.pushLog("Đã kết nối lại Zalo.");
      console.log("✅ Kết nối lại Zalo xong.");
    } catch (e) {
      console.error("kết nối lại Zalo lỗi:", e?.message || e);
      store.pushLog("Kết nối lại Zalo lỗi: " + (e?.message || e));
    } finally { status.relogging = false; }
  }

  startWeb({ status, reloadConfig, getZalo: () => currentApi, relogin: reloginZalo, reconnect: reconnectZalo, getLive: () => live.snapshot(),
    closeNow: (tid) => batcher.close(String(tid), "manual") }); // web dashboard

  // ===== BỘ HẸN GIỜ: mỗi 30s, đăng các bài đã tới giờ hẹn =====
  setInterval(async () => {
    const now = Date.now();
    const due = store.listPending().filter((d) => d.scheduledAt && d.scheduledAt <= now && !d._publishing);
    for (const d of due) {
      store.updatePending(d.id, { _publishing: true });
      const route = getRoute(d.threadId) || { fanpageId: d.fanpageId, fanpageToken: process.env[d.fanpageTokenEnv], comment: d.comment, gbpLocationIds: d.gbpLocationIds, captionFooter: d.captionFooter };
      if (!route.fanpageToken) { store.updatePending(d.id, { _publishing: false }); store.pushLog(`Hẹn giờ: "${d.routeLabel}" chưa có token Facebook — bỏ qua, sẽ thử lại.`); continue; }
      try {
        const published = d.scheduledPublished !== false;
        const approvals = { ...(d.approvals || {}) };
        const r = await publishFacebookDraft(d, route, { published, comment: route.comment, log: (m) => console.log("  [hẹn giờ]", m) });
        const links = r.links || [];
        approvals.facebook = { status: "posted", published, links, at: Date.now(), auto: true };
        const gbpIds = (route.gbpLocationIds && route.gbpLocationIds.length) ? route.gbpLocationIds : (route.gbpLocationId ? [route.gbpLocationId] : []);
        if (gbpIds.length && (d.savedImages || []).length) {
          try { await publishGbpDraft(d, route, { log: (m) => console.log("  [hẹn giờ gbp]", m) }); approvals.gbp = { status: "posted", at: Date.now(), auto: true, count: gbpIds.length }; }
          catch (e) { store.pushLog("Hẹn giờ GBP lỗi: " + e.message); }
        }
        store.removePending(d.id);
        store.addPosted({ ...d, approvals, scheduledAt: null, _publishing: undefined, postedAt: Date.now(), published, links, partial: false });
        store.pushLog(`✅ ĐĂNG THEO LỊCH ${published ? "công khai" : "nháp"}: ${d.routeLabel} → ${links.join(" ")}`);
      } catch (e) {
        store.updatePending(d.id, { _publishing: false });
        store.pushLog(`Đăng theo lịch lỗi (${d.routeLabel}): ${e?.message || e} — giữ lại, sẽ thử lại.`);
      }
    }
  }, 30000);

  console.log(`📋 ${cfg.byThread.size} route. Theo dõi:`, [...cfg.byThread.keys()]);

  if (process.env.WEB_ONLY === "1") {
    console.log("\n🌐 WEB_ONLY=1: chỉ mở dashboard, không kết nối Zalo listener.");
    return;
  }

  // Đăng nhập Zalo CHẠY NỀN, KHÔNG await ở main:
  // QR hết hạn / quét lỗi -> chỉ thử lại, KHÔNG làm sập dashboard (web đã chạy ở trên).
  (async function ensureZaloLogin() {
    while (!currentApi) {
      try {
        const api = await login();
        await setApi(api);
      } catch (e) {
        status.zaloConnected = false;
        console.error("⚠️ Đăng nhập Zalo chưa xong:", e?.message || e, "— tạo QR mới (dashboard vẫn chạy bình thường).");
        store.pushLog("Chờ quét QR Zalo (QR cũ hết hạn) — vào tab Cài đặt để quét.");
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  })();

  console.log("\n🟢 SERVICE 24/7 đang chạy. Mở dashboard ở http://localhost:" + (process.env.WEB_PORT || 8088));
  console.log("   Chưa đăng nhập Zalo? Vào dashboard tab Cài đặt để quét QR (web không bị gián đoạn).\n");
}

main().catch((e) => { console.error("💥 Service chết:", e); process.exit(1); });
