// src/pipeline.mjs — xử lý 1 batch đã chốt: tải → lọc(AI) → format FB → caption(AI) → lưu + báo lại.
// reply được TIÊM vào (không phụ thuộc zca-js) -> test được. Lỗi 1 batch KHÔNG làm sập service.
import fs from "node:fs";
import path from "node:path";
import { downloadAll } from "./download.mjs";
import { curate } from "./curate.mjs";
import { pickBest } from "./pickbest.mjs";
import { checkSafety } from "./safety.mjs";
import { formatImage, formatVideo, extractFrames } from "./format.mjs";
import { writeCaption, captionImageSet, captionFromFrames, combineTexts, generateHashtags } from "./caption.mjs";
import { dataPath } from "./paths.mjs";

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");

/** Đảm bảo mỗi item có .buffer: cái nào có sẵn thì giữ, thiếu thì tải từ url. */
async function ensureBuffers(items, log) {
  const have = items.filter((i) => i.buffer);
  const need = items.filter((i) => !i.buffer && i.url);
  const dl = need.length ? await downloadAll(need, { log }) : [];
  return [...have, ...dl];
}

/**
 * @param {object} batch  { threadId, items:[{kind,url|buffer,...}], texts }
 * @param {string} reason
 * @param {object} opts { log, reply, outputDir, mode, maxKeep, disableAI }
 */
export async function processBatch(batch, reason, opts = {}) {
  const log = opts.log || (() => {});
  const onStage = opts.onStage || (() => {}); // báo tiến trình cho màn "Lắng nghe"
  const reply = opts.reply || (async () => {});
  const mode = opts.mode || "native";
  const stamp = sanitize(batch.startedAt || (batch.items[0] && batch.items[0].ts) || "batch");
  const dir = path.join(opts.outputDir || dataPath("output"), `${sanitize(batch.threadId)}_${stamp}`);
  fs.mkdirSync(dir, { recursive: true });

  const imageItems = batch.items.filter((i) => i.kind === "image");
  const videoItems = batch.items.filter((i) => i.kind === "video");

  // 1) tải (item đã có buffer thì khỏi tải)
  onStage("Đang tải ảnh/video về", { images: imageItems.length, videos: videoItems.length });
  const images = await ensureBuffers(imageItems, log);

  // 2) lọc: dedup + mờ/tối + AI chọn ảnh đẹp trong cụm trùng — có thể TẮT theo cấu hình nhóm
  let kept, dropped;
  if (opts.curate === false) {
    // Giữ NGUYÊN mọi ảnh gửi vào (không bỏ trùng/mờ/tối, không để AI chọn) — chỉ sắp theo thời gian gửi.
    onStage("Giữ tất cả ảnh (không lọc)", { received: images.length });
    kept = [...images].sort((a, b) => (a.ts || 0) - (b.ts || 0));
    dropped = [];
    onStage("Đã nhận ảnh", { kept: kept.length, dropped: 0 });
  } else {
    onStage("AI đang lọc ảnh (bỏ trùng/mờ/tối)", { received: images.length });
    const usePick = opts.disableAI ? null : (members) => pickBest(members, { log });
    ({ kept, dropped } = await curate(images, { pickBest: usePick, maxKeep: opts.maxKeep || Infinity }));
    onStage("Đã chọn ảnh", { kept: kept.length, dropped: dropped.length });
  }

  // 2b) LƯỚI AN TOÀN: chấm từng ảnh "kept" xem có che mặt/lộ da thịt trẻ em
  // không — curate.mjs chỉ bắt lỗi kỹ thuật (mờ/tối/trùng), không thấy được
  // việc này. Ảnh bị đánh dấu unsafe KHÔNG bị loại khỏi "kept" — chỉ tách sang
  // keptUnsafe để vẫn lưu + đẩy sang Hub như dropped (hidden=true), người
  // duyệt tự xem lại và bấm hiện nếu AI chặn nhầm.
  let keptSafe = kept;
  let keptUnsafe = [];
  if (opts.curate !== false && !opts.disableAI && kept.length) {
    onStage("AI đang kiểm tra an toàn ảnh", { checking: kept.length });
    const results = await checkSafety(kept, { log });
    if (results.length) {
      const unsafeIdx = new Set(
        results.filter((r) => r && r.unsafe).map((r) => r.index)
      );
      keptSafe = [];
      keptUnsafe = [];
      kept.forEach((im, i) => {
        if (unsafeIdx.has(i)) {
          const r = results.find((x) => x && x.index === i);
          keptUnsafe.push({ ...im, reason: r?.reason || "canh-bao-an-toan" });
        } else {
          keptSafe.push(im);
        }
      });
      if (keptUnsafe.length) {
        onStage("Đã chặn ảnh không an toàn", { blocked: keptUnsafe.length });
      }
    }
  }

  // 3) format TOÀN BỘ ảnh (an toàn + bị lọc/bị chặn) + lưu — ảnh bị lọc/chặn
  // KHÔNG bị xoá, chỉ đánh dấu hidden để Media Hub vẫn hiển thị cho người
  // duyệt xem lại (bấm mắt để hiện), phòng khi bộ lọc/AI nhầm một ảnh còn đẹp.
  const savedImages = [];
  const imageHidden = [];
  const imageHiddenReasons = [];
  let counter = 0;
  for (const im of keptSafe) {
    try {
      const out = await formatImage(im.buffer, { mode });
      const f = path.join(dir, `anh_${String(++counter).padStart(2, "0")}.jpg`);
      fs.writeFileSync(f, out);
      savedImages.push(f);
      imageHidden.push(false);
      imageHiddenReasons.push("");
    } catch (e) { log(`format ảnh lỗi, bỏ: ${e.message}`); }
  }
  const keptCount = savedImages.length;
  for (const im of [...keptUnsafe, ...dropped]) {
    try {
      const out = await formatImage(im.buffer, { mode });
      const f = path.join(dir, `anh_an_${String(++counter).padStart(2, "0")}.jpg`);
      fs.writeFileSync(f, out);
      savedImages.push(f);
      imageHidden.push(true);
      imageHiddenReasons.push(im.reason || "loc-tu-dong");
    } catch (e) { log(`format ảnh (ẩn) lỗi, bỏ hẳn: ${e.message}`); }
  }

  // 4) video: tải + format (skip cái lỗi, không sập)
  const savedVideos = [];
  const videos = await ensureBuffers(videoItems, log);
  for (let i = 0; i < videos.length; i++) {
    const raw = path.join(dir, `_raw_${i + 1}.mp4`);
    const outP = path.join(dir, `video_${String(i + 1).padStart(2, "0")}.mp4`);
    try {
      fs.writeFileSync(raw, videos[i].buffer);
      await formatVideo(raw, outP, { mode, log });
      savedVideos.push(outP);
    } catch (e) { log(`format video lỗi, bỏ: ${e.message}`); }
    finally { fs.rmSync(raw, { force: true }); }
  }

  // 5) caption tổng (message của bài): AI nhìn ảnh + đọc ghi chú; fallback nguyên text
  // Chỉ nhìn ảnh AN TOÀN (keptSafe) — ảnh bị chặn/lọc không được dùng để "kể
  // chuyện" cho caption, dù vẫn được lưu lại ở dạng ẩn.
  onStage("AI đang nghĩ nội dung bài đăng", { kept: keptSafe.length });
  const cap = await writeCaption(
    { items: keptSafe.map((k) => ({ kind: "image", buffer: k.buffer })), texts: batch.texts },
    { log, disableAI: opts.disableAI, guide: opts.guide },
  );
  fs.writeFileSync(path.join(dir, "caption.txt"), cap.caption || "");

  // 5a) hashtag (AI): 5 cái bám nội dung + định hướng Trang -> service ráp XUỐNG CUỐI (sau chân bài)
  let hashtags = "";
  if (opts.autoHashtags !== false && !opts.disableAI) {
    onStage("AI đang tạo hashtag", {});
    const noteForTags = combineTexts(batch.texts);
    hashtags = await generateHashtags([cap.caption, noteForTags].filter(Boolean).join("\n"), { guide: opts.guide, log });
  }

  // 5b) caption RIÊNG từng ảnh + từng video (video: trích khung hình cho AI "xem").
  // Chỉ caption phần AN TOÀN (savedImages[0..keptCount-1]) — ảnh ẩn phía sau
  // không cần caption riêng, độn "" cho khớp thứ tự với savedImages.
  const perItem = opts.perItemCaption !== false && !opts.disableAI;
  const noteText = combineTexts(batch.texts);
  // Caption CẢ BỘ trong 1 lần -> mỗi ảnh khác nhau, có mạch chuyện
  if (perItem && keptSafe.length) onStage("AI đang chú thích từng ảnh", { kept: keptCount });
  const imageCaptions = perItem
    ? [
        ...(await captionImageSet(keptSafe.map((k) => k.buffer), { log, note: noteText })),
        ...new Array(savedImages.length - keptCount).fill(""),
      ]
    : [];
  const videoCaptions = [];
  if (perItem && savedVideos.length) onStage("AI đang xem video", { videos: savedVideos.length });
  if (perItem) for (const vp of savedVideos) {
    // 1 khung/10s: video 1 phút -> 6 khung, 2 phút -> 12 khung (giới hạn 2..30 khung)
    try { videoCaptions.push(await captionFromFrames(await extractFrames(vp, { perSeconds: 10 }), { log })); }
    catch (e) { log(`caption video lỗi: ${e.message}`); videoCaptions.push(""); }
  }

  // 5c) IN BẢN NHÁP rõ ràng ra terminal + lưu file
  const preview = [];
  preview.push("📋 ========== BẢN NHÁP ==========");
  preview.push(`(nhóm ${batch.threadId} — ${reason})`);
  preview.push(`📝 Caption bài:\n${cap.caption}`);
  if (hashtags) preview.push(`#️⃣ Hashtag: ${hashtags}`);
  savedImages.forEach((f, i) =>
    preview.push(
      imageHidden[i]
        ? `🙈 Ảnh ${i + 1} (ẨN — ${imageHiddenReasons[i]}): không đăng, chờ người duyệt bấm hiện nếu cần`
        : `🖼️  Ảnh ${i + 1}: ${imageCaptions[i] || "(không có)"}`
    )
  );
  savedVideos.forEach((f, i) => preview.push(`🎬 Video ${i + 1}: ${videoCaptions[i] || "(không có)"}`));
  preview.push(`📁 File: ${dir}`);
  preview.push("================================");
  const previewText = preview.join("\n");
  log("\n" + previewText + "\n");
  fs.writeFileSync(path.join(dir, "ban-nhap.txt"), previewText);

  // 6) đăng Facebook (nếu được tiêm opts.post) — lỗi đăng KHÔNG làm sập batch.
  // Luồng NÀY không có khái niệm "ẩn" (đăng thẳng, không qua Media Hub duyệt)
  // -> CHỈ dùng phần ẢN TOÀN (savedImages[0..keptCount-1]), không bao giờ đăng
  // ảnh đã bị lọc/chặn dù đã lưu lại ở dạng ẩn.
  const publicImages = savedImages.slice(0, keptCount);
  const publicImageCaptions = imageCaptions.slice(0, keptCount);
  let fbLinks = [];
  if (opts.post && (publicImages.length || savedVideos.length)) {
    try {
      const r = await opts.post({ caption: cap.caption, imagePaths: publicImages, imageCaptions: publicImageCaptions, videoPaths: savedVideos, videoCaptions });
      fbLinks = (r && r.links) || [];
    } catch (e) { log(`đăng FB lỗi: ${e.message}`); }
  }

  // 7) tóm tắt + báo lại nhóm
  const hiddenCount = keptUnsafe.length + dropped.length;
  const summary =
    `✅ Đã xử lý xong (${reason}): ${keptCount} ảnh` +
    (savedVideos.length ? ` + ${savedVideos.length} video` : "") +
    (hiddenCount ? ` — ẩn ${hiddenCount} ảnh trùng/xấu/không an toàn (vẫn xem được trong Media Hub)` : "") +
    (fbLinks.length ? `\n🔗 Đã đăng: ${fbLinks.join(" , ")}` : "") +
    `\n📝 Caption (${cap.source}):\n${cap.caption}` +
    (fbLinks.length ? "" : `\n📁 ${dir}`);
  log(summary);
  try { await reply(summary); } catch (e) { log(`reply lỗi: ${e.message}`); }

  onStage("Đã tạo bản nháp", { kept: keptCount, videos: savedVideos.length, dropped: hiddenCount, caption: cap.caption });

  return {
    dir,
    savedImages,
    savedVideos,
    imageCaptions,
    videoCaptions,
    imageHidden,
    imageHiddenReasons,
    caption: cap.caption,
    captionSource: cap.source,
    hashtags,
    droppedCount: hiddenCount,
    fbLinks,
    reason,
  };
}
