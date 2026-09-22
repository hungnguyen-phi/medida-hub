// src/format.mjs — "phomat" media về đúng khung Facebook.
// Ảnh: sharp (nhanh, không chặn). Video: ffmpeg qua spawn async (KHÔNG execFileSync).
// Mặc định fit TRỌN ảnh + nền mờ (không crop -> không cắt mặt trẻ em).
import sharp from "sharp";
import { spawn } from "node:child_process";

// Preset khung phổ biến cho Facebook.
export const PRESETS = {
  square: { width: 1080, height: 1080 },     // an toàn, đồng đều trong album
  portrait: { width: 1080, height: 1350 },   // 4:5 — chiếm nhiều feed nhất
  landscape: { width: 1080, height: 566 },    // 1.91:1
  reel: { width: 1080, height: 1920 },        // 9:16 dọc (Reels/Story)
};

export const DEFAULT_PRESET = "square";
export const DEFAULT_MODE = "native"; // giữ nguyên tỉ lệ, chỉ chuẩn hoá chất lượng FB
export const FB_MAX_EDGE = 2048;       // cạnh dài tối đa Facebook giữ nét (ảnh)
export const FB_MAX_EDGE_VIDEO = 1080; // cạnh dài tối đa cho video (1080 đủ nét, FB nén lại; nhẹ hơn nhiều so 1920)

function dims(preset) {
  const p = typeof preset === "string" ? PRESETS[preset] : preset;
  if (!p || !p.width || !p.height) throw new Error(`preset không hợp lệ: ${JSON.stringify(preset)}`);
  return p;
}

/**
 * Chuẩn hoá 1 ẢNH về khung đích.
 * @param {Buffer|string} input
 * @param {object} o  { preset, mode: "blur"|"pad"|"cover", bg, quality }
 * @returns {Promise<Buffer>} JPEG
 */
export async function formatImage(input, o = {}) {
  const mode = o.mode || DEFAULT_MODE;
  const quality = o.quality || 88;

  // native: GIỮ NGUYÊN tỉ lệ ảnh, chỉ thu nhỏ nếu cạnh dài > maxEdge (không phóng to, không cắt).
  if (mode === "native") {
    const maxEdge = o.maxEdge || FB_MAX_EDGE;
    return sharp(input).rotate().resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  }

  const { width, height } = dims(o.preset || DEFAULT_PRESET);
  if (mode === "cover") {
    // Lấp đầy khung, cắt mép (position:attention cố giữ vùng nổi bật)
    return sharp(input).rotate().resize(width, height, { fit: "cover", position: "attention" }).jpeg({ quality }).toBuffer();
  }

  // contain: ảnh nằm trọn, phần thừa lấp bằng nền
  const fg = await sharp(input).rotate().resize(width, height, { fit: "inside", withoutEnlargement: false }).toBuffer();
  let background;
  if (mode === "pad") {
    background = await sharp({ create: { width, height, channels: 3, background: o.bg || "#ffffff" } }).jpeg().toBuffer();
  } else {
    // blur: chính ảnh đó phóng to + làm mờ làm nền
    background = await sharp(input).rotate().resize(width, height, { fit: "cover" }).blur(40).modulate({ brightness: 0.92 }).toBuffer();
  }
  return sharp(background).composite([{ input: fg, gravity: "center" }]).jpeg({ quality }).toBuffer();
}

/** Lấy thời lượng video (giây) bằng ffprobe. */
export function probeDuration(inputPath) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inputPath]);
    let out = "";
    p.stdout.on("data", (d) => { out += d; });
    p.on("error", () => resolve(0));
    p.on("close", () => resolve(parseFloat(out.trim()) || 0));
  });
}

/**
 * Trích `count` khung hình rải đều từ video -> mảng Buffer JPEG (để cho AI "xem" video).
 * @returns {Promise<Buffer[]>}
 */
export async function extractFrames(inputPath, { count, size = 512, perSeconds = 0, min = 2, max = 30 } = {}) {
  const dur = await probeDuration(inputPath);
  const buffers = [];
  // perSeconds > 0: số khung theo thời lượng (vd 10s/khung -> video 1 phút = 6 khung, 2 phút = 12 khung)
  const n = perSeconds > 0
    ? Math.min(max, Math.max(min, Math.round(dur / perSeconds)))
    : Math.max(1, count || 4);
  for (let i = 0; i < n; i++) {
    // lấy khung ở giữa mỗi khoảng -> tránh khung đầu/cuối đen
    const t = dur > 0 ? (dur * (i + 0.5)) / n : 0;
    const chunks = [];
    await new Promise((resolve, reject) => {
      const args = ["-ss", t.toFixed(2), "-i", inputPath, "-frames:v", "1", "-vf", `scale=${size}:${size}:force_original_aspect_ratio=decrease`, "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"];
      const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
      p.stdout.on("data", (d) => chunks.push(d));
      p.on("error", reject);
      p.on("close", () => resolve());
    });
    if (chunks.length) buffers.push(Buffer.concat(chunks));
  }
  return buffers;
}

/** Chạy ffmpeg qua spawn (async). Reject nếu exit code != 0. */
export function runFfmpeg(args, { log = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("error", (e) => reject(new Error(`không chạy được ffmpeg: ${e.message}`)));
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-600)}`));
    });
    log(`ffmpeg ${args.join(" ")}`);
  });
}

/** Dựng filter video: fit trọn + nền (blur ảnh chính / màu pad). */
export function buildVideoFilter(width, height, mode = "blur", bg = "black") {
  if (mode === "pad") {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${bg},setsar=1`;
  }
  // blur: tách 2 luồng — nền phóng to+mờ, tiền cảnh fit trọn, chồng giữa
  return (
    `[0:v]split=2[bg][fg];` +
    `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=20:2[bgb];` +
    `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgs];` +
    `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,setsar=1`
  );
}

/**
 * Chuẩn hoá 1 VIDEO về khung đích, xuất mp4 (h264/aac, faststart).
 * @param {string} inputPath
 * @param {string} outPath
 * @param {object} o { preset, mode, bg, fps, crf, maxDurationSec }
 * @returns {Promise<string>} outPath
 */
export async function formatVideo(inputPath, outPath, o = {}) {
  const mode = o.mode || DEFAULT_MODE;
  let filterFlag;
  if (mode === "native") {
    // giữ tỉ lệ, cạnh dài <= maxEdge, ép kích thước chẵn (h264 yêu cầu)
    const maxEdge = o.maxEdge || FB_MAX_EDGE_VIDEO;
    const f = `scale=${maxEdge}:${maxEdge}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1`;
    filterFlag = ["-vf", f];
  } else {
    const { width, height } = dims(o.preset || DEFAULT_PRESET);
    const filter = buildVideoFilter(width, height, mode, o.bg || "black");
    filterFlag = mode === "pad" ? ["-vf", filter] : ["-filter_complex", filter];
  }

  const args = [
    "-y",
    ...(o.maxDurationSec ? ["-t", String(o.maxDurationSec)] : []),
    "-i", inputPath,
    ...filterFlag,
    "-r", String(o.fps || 30),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", String(o.crf || 27),
    // chặn bitrate đỉnh -> file không phình to (preview tải nhanh; FB vẫn nhận tốt)
    "-maxrate", o.maxrate || "2500k", "-bufsize", o.bufsize || "5000k",
    "-c:a", "aac", "-b:a", "128k",
    "-movflags", "+faststart",
    outPath,
  ];
  await runFfmpeg(args, { log: o.log });
  return outPath;
}
