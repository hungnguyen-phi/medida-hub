// test/pipeline.test.mjs — xử lý 1 batch end-to-end (ảnh giả, tắt AI, không mạng).
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { processBatch } from "../src/pipeline.mjs";

let pass = 0;
const ok = (n) => { console.log(`✅ ${n}`); pass++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pipe-"));

const N = 64;
const raw = (fn) => { const b = Buffer.alloc(N * N); for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) b[y * N + x] = fn(x, y) & 255; return sharp(b, { raw: { width: N, height: N, channels: 1 } }).png().toBuffer(); };

{
  const checker = await raw((x, y) => ((x + y) % 2 ? 255 : 0));
  const stripes = await raw((x) => (x % 2 ? 255 : 0));
  const blur = await raw(() => 128); // mờ -> bị loại

  const batch = {
    threadId: "zgr-test",
    startedAt: 1782260000000,
    items: [
      { kind: "image", buffer: checker },
      { kind: "image", buffer: stripes },
      { kind: "image", buffer: blur },
    ],
    texts: [{ text: "các bé chơi ngoài sân hôm nay" }],
  };

  let replied = null;
  const res = await processBatch(batch, "command", {
    outputDir: tmp,
    disableAI: true, // không gọi Claude trong test
    reply: async (t) => { replied = t; },
    log: () => {},
  });

  assert.equal(res.savedImages.length, 2, "giữ 2 ảnh nét (loại ảnh mờ)");
  assert.equal(res.droppedCount, 1, "1 ảnh mờ bị bỏ");
  assert.equal(res.captionSource, "fallback");
  assert.equal(res.caption, "các bé chơi ngoài sân hôm nay");
  // file thật được lưu
  assert.ok(fs.existsSync(path.join(res.dir, "anh_01.jpg")));
  assert.ok(fs.existsSync(path.join(res.dir, "anh_02.jpg")));
  assert.ok(fs.existsSync(path.join(res.dir, "caption.txt")));
  // ảnh ra đúng 1080x1080? (native giữ tỉ lệ vuông vì nguồn vuông)
  const m = await sharp(path.join(res.dir, "anh_01.jpg")).metadata();
  assert.equal(m.width, 64); // native không phóng to ảnh 64x64
  // reply có nội dung
  assert.ok(replied && replied.includes("Đã xử lý") && replied.includes("các bé chơi ngoài sân"));
  ok("processBatch: lọc + format + lưu file + caption fallback + reply");
}

// curate:false -> GIỮ NGUYÊN mọi ảnh (kể cả ảnh mờ), không bỏ ảnh nào
{
  const checker = await raw((x, y) => ((x + y) % 2 ? 255 : 0));
  const stripes = await raw((x) => (x % 2 ? 255 : 0));
  const blur = await raw(() => 128); // ảnh mờ -> nếu lọc thì bị bỏ
  const res = await processBatch(
    { threadId: "no-curate", startedAt: 2, items: [
      { kind: "image", buffer: checker }, { kind: "image", buffer: stripes }, { kind: "image", buffer: blur },
    ], texts: [] },
    "command",
    { outputDir: tmp, disableAI: true, curate: false, reply: async () => {}, log: () => {} },
  );
  assert.equal(res.savedImages.length, 3, "curate:false giữ cả 3 ảnh (kể cả ảnh mờ)");
  assert.equal(res.droppedCount, 0, "curate:false không bỏ ảnh nào");
  ok("curate:false -> giữ nguyên mọi ảnh, không lọc");
}

// reply lỗi KHÔNG làm sập pipeline
{
  const img = await raw((x, y) => ((x + y) % 2 ? 255 : 0));
  const res = await processBatch(
    { threadId: "t2", startedAt: 1, items: [{ kind: "image", buffer: img }], texts: [] },
    "silence",
    { outputDir: tmp, disableAI: true, reply: async () => { throw new Error("mạng lỗi"); }, log: () => {} },
  );
  assert.equal(res.savedImages.length, 1, "vẫn xử lý xong dù reply lỗi");
  ok("reply lỗi -> không sập, batch vẫn hoàn tất");
}

// opts.post (đăng FB giả) -> link vào tin báo + trả fbLinks
{
  const img = await raw((x, y) => ((x + y) % 2 ? 255 : 0));
  let postedWith = null, replied = "";
  const res = await processBatch(
    { threadId: "t3", startedAt: 3, items: [{ kind: "image", buffer: img }], texts: [{ text: "ghi chú" }] },
    "command",
    {
      outputDir: tmp, disableAI: true,
      post: async (p) => { postedWith = p; return { links: ["https://facebook.com/123_456"] }; },
      reply: async (t) => { replied = t; },
      log: () => {},
    },
  );
  assert.equal(postedWith.imagePaths.length, 1, "post nhận đúng ảnh đã format");
  assert.deepEqual(res.fbLinks, ["https://facebook.com/123_456"]);
  assert.ok(replied.includes("Đã đăng") && replied.includes("facebook.com/123_456"));
  ok("opts.post -> đăng FB, link vào tin báo lại nhóm");
}

// post lỗi -> không sập, vẫn báo (kèm output)
{
  const img = await raw((x, y) => ((x + y) % 2 ? 255 : 0));
  const res = await processBatch(
    { threadId: "t4", startedAt: 4, items: [{ kind: "image", buffer: img }], texts: [] },
    "command",
    { outputDir: tmp, disableAI: true, post: async () => { throw new Error("token sai"); }, reply: async () => {}, log: () => {} },
  );
  assert.equal(res.fbLinks.length, 0);
  assert.equal(res.savedImages.length, 1, "vẫn xử lý xong dù đăng FB lỗi");
  ok("post lỗi -> không sập, batch vẫn hoàn tất");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n🎉 PASS ${pass}/${pass} test.`);
