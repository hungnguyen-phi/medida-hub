// test/format.test.mjs — kiểm chuẩn hoá ảnh (sharp) + video (ffmpeg thật).
// Chạy: node test/format.test.mjs
import assert from "node:assert";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { formatImage, formatVideo, buildVideoFilter, runFfmpeg, PRESETS } from "../src/format.mjs";

let pass = 0;
const ok = (n) => { console.log(`✅ ${n}`); pass++; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fmt-"));

// ảnh chân dung 400x900 (đậm) -> chuẩn hoá
async function makePortrait() {
  return sharp({ create: { width: 400, height: 900, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toBuffer();
}

// --- formatImage: square giữ đúng 1080x1080, không méo ---
{
  const src = await makePortrait();
  for (const mode of ["blur", "pad", "cover"]) {
    const out = await formatImage(src, { preset: "square", mode });
    const m = await sharp(out).metadata();
    assert.equal(m.width, 1080, `width ${mode}`);
    assert.equal(m.height, 1080, `height ${mode}`);
  }
  ok("formatImage square -> 1080x1080 (blur/pad/cover)");
}

// --- native: GIỮ tỉ lệ, cạnh dài cap 2048, không phóng to ---
{
  // ảnh 3000x1000 -> native -> 2048x683 (giữ tỉ lệ 3:1)
  const wide = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 10, g: 10, b: 10 } } }).jpeg().toBuffer();
  const out = await formatImage(wide, { mode: "native" });
  const m = await sharp(out).metadata();
  assert.equal(m.width, 2048, "cạnh dài cap 2048");
  assert.equal(m.height, 683, "giữ tỉ lệ 3:1");
  // ảnh nhỏ 400x900 -> KHÔNG phóng to
  const small = await formatImage(await makePortrait(), { mode: "native" });
  const ms = await sharp(small).metadata();
  assert.equal(ms.width, 400);
  assert.equal(ms.height, 900);
  ok("native: cap 2048 giữ tỉ lệ; ảnh nhỏ không phóng to");
}

// --- preset landscape ---
{
  const out = await formatImage(await makePortrait(), { preset: "landscape", mode: "pad" });
  const m = await sharp(out).metadata();
  assert.equal(m.width, PRESETS.landscape.width);
  assert.equal(m.height, PRESETS.landscape.height);
  ok("formatImage landscape -> 1080x566");
}

// --- filter string ---
{
  assert.ok(buildVideoFilter(1080, 1080, "pad").includes("pad=1080:1080"));
  assert.ok(buildVideoFilter(1080, 1080, "blur").includes("overlay=(W-w)/2:(H-h)/2"));
  ok("buildVideoFilter: pad có pad=, blur có overlay");
}

// --- ffmpeg THẬT: tạo clip testsrc 320x240 -> chuẩn hoá square -> ffprobe 1080x1080 ---
function ffprobeSize(file) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file]);
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", reject);
    p.on("close", () => resolve(out.trim()));
  });
}
{
  const srcVid = path.join(tmp, "src.mp4");
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2", "-pix_fmt", "yuv420p", srcVid]);
  const outVid = path.join(tmp, "out.mp4");
  await formatVideo(srcVid, outVid, { preset: "square", mode: "blur", maxDurationSec: 2 });
  assert.ok(fs.existsSync(outVid) && fs.statSync(outVid).size > 0, "có file video ra");
  const size = await ffprobeSize(outVid);
  assert.equal(size, "1080,1080", `video ra ${size}`);
  ok("formatVideo (ffmpeg thật) -> mp4 1080x1080");
}

// --- ffmpeg THẬT native: clip 3000x1000 -> giữ tỉ lệ, cap 1080 -> 1080x360 (chẵn) ---
{
  const srcVid = path.join(tmp, "src2.mp4");
  await runFfmpeg(["-y", "-f", "lavfi", "-i", "testsrc=size=3000x1000:rate=15:duration=1", "-pix_fmt", "yuv420p", srcVid]);
  const outVid = path.join(tmp, "out2.mp4");
  await formatVideo(srcVid, outVid, { mode: "native" });
  const size = await ffprobeSize(outVid);
  assert.equal(size, "1080,360", `video native ra ${size}`);
  ok("formatVideo native (ffmpeg thật) -> giữ tỉ lệ 1080x360");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n🎉 PASS ${pass}/${pass} test.`);
