// test/curate.test.mjs — tạo ảnh giả xác định để kiểm chứng lọc: trùng / mờ / nét.
// Chạy: node test/curate.test.mjs
import assert from "node:assert";
import sharp from "sharp";
import { hamming, dHash } from "../src/imagequality.mjs";
import { curate } from "../src/curate.mjs";

let pass = 0;
const ok = (n) => { console.log(`✅ ${n}`); pass++; };

// tạo ảnh xám WxH từ hàm pixel -> PNG buffer
function rawGray(W, H, fn) {
  const b = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b[y * W + x] = fn(x, y) & 255;
  return sharp(b, { raw: { width: W, height: H, channels: 1 } }).png().toBuffer();
}

const N = 64;
const checker = await rawGray(N, N, (x, y) => ((x + y) % 2 ? 255 : 0)); // nét, pattern A
const stripes = await rawGray(N, N, (x) => (x % 2 ? 255 : 0));          // nét, pattern B (khác A)
const uniform = await rawGray(N, N, () => 128);                          // mờ (phẳng lì)
const dark = await rawGray(N, N, (x, y) => ((x + y) % 2 ? 16 : 0));      // tối thui

// --- hamming + dHash cơ bản ---
{
  assert.equal(hamming(0b1011n, 0b1001n), 1);
  const hA = await dHash(checker), hA2 = await dHash(checker), hB = await dHash(stripes);
  assert.equal(hamming(hA, hA2), 0, "ảnh giống nhau -> hash giống");
  assert.ok(hamming(hA, hB) > 0, "ảnh khác -> hash khác");
  ok("hamming + dHash hoạt động (giống=0, khác>0)");
}

// --- curate: trùng + mờ + tối ---
{
  const images = [
    { url: "checkerA", buffer: checker, ts: 1 },
    { url: "checkerA_dup", buffer: checker, ts: 2 }, // trùng checkerA
    { url: "uniform_blur", buffer: uniform, ts: 3 }, // mờ
    { url: "dark", buffer: dark, ts: 4 },            // tối
    { url: "stripesB", buffer: stripes, ts: 5 },     // nét, khác -> giữ
  ];
  const { kept, dropped } = await curate(images, { minSharpness: 50, minBrightness: 25 });

  const keptUrls = kept.map((k) => k.url).sort();
  // giữ: 1 đại diện của cụm checker + stripesB
  assert.equal(kept.length, 2, `giữ 2 ảnh, thực tế ${kept.length}`);
  assert.ok(keptUrls.includes("stripesB"));
  assert.ok(keptUrls.some((u) => u.startsWith("checker")));

  const reason = (u) => dropped.find((d) => d.url === u)?.reason;
  assert.equal(reason("checkerA_dup") || reason("checkerA"), "trung");
  assert.equal(reason("uniform_blur"), "mo");
  assert.equal(reason("dark"), "toi");
  ok("curate: bỏ trùng + mờ + tối, giữ 2 ảnh nét khác nhau");
}

// --- maxKeep: cắt còn N nét nhất ---
{
  const images = [
    { url: "a", buffer: checker, ts: 1 },
    { url: "b", buffer: stripes, ts: 2 },
  ];
  const { kept, dropped } = await curate(images, { maxKeep: 1 });
  assert.equal(kept.length, 1);
  assert.equal(dropped.filter((d) => d.reason === "vuot-gioi-han").length, 1);
  ok("maxKeep cắt còn 1 ảnh");
}

// --- pickBest (AI giả) chọn ảnh trong cụm thay cho "ảnh nét nhất" ---
{
  // 2 ảnh trùng (cùng buffer -> cùng cụm), AI chọn ảnh index 1
  const images = [
    { url: "anh_net_nhung_mat_le", buffer: checker, ts: 1 },
    { url: "anh_mat_dep", buffer: checker, ts: 2 },
  ];
  let calledWith = null;
  const fakePickBest = async (members) => { calledWith = members.length; return { index: 1, reason: "mắt mở đẹp hơn" }; };
  const { kept, dropped } = await curate(images, { pickBest: fakePickBest });
  assert.equal(calledWith, 2, "pickBest được gọi với cả cụm");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].url, "anh_mat_dep", "giữ đúng ảnh AI chọn, không phải ảnh nét nhất mặc định");
  assert.equal(kept[0].aiReason, "mắt mở đẹp hơn");
  assert.equal(dropped.find((d) => d.url === "anh_net_nhung_mat_le")?.reason, "trung");
  ok("pickBest (AI) chọn ảnh đẹp trong cụm; ảnh kia -> trùng");
}

// --- pickBest lỗi -> fallback ảnh nét nhất, không sập ---
{
  const images = [
    { url: "a", buffer: checker, ts: 1 },
    { url: "b", buffer: checker, ts: 2 },
  ];
  const brokenPickBest = async () => { throw new Error("API sập"); };
  const { kept } = await curate(images, { pickBest: brokenPickBest });
  assert.equal(kept.length, 1, "vẫn giữ 1 ảnh dù AI lỗi");
  ok("pickBest lỗi -> fallback, không sập");
}

console.log(`\n🎉 PASS ${pass}/${pass} test.`);
