// src/imagequality.mjs — đo "vân tay" + chất lượng ảnh bằng sharp (CPU thuần, không AI).
import sharp from "sharp";

/**
 * dHash 64-bit: thu nhỏ 9x8 xám, so sánh pixel kề nhau theo hàng -> 64 bit.
 * Ảnh giống nhau -> hash gần nhau (hamming nhỏ).
 * @returns {Promise<bigint>}
 */
export async function dHash(input) {
  const w = 9, h = 8;
  const buf = await sharp(input).grayscale().resize(w, h, { fit: "fill" }).raw().toBuffer();
  let v = 0n;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const bit = buf[y * w + x] < buf[y * w + x + 1] ? 1n : 0n;
      v = (v << 1n) | bit;
    }
  }
  return v;
}

/** Khoảng cách Hamming giữa 2 hash (số bit khác nhau). */
export function hamming(a, b) {
  let x = a ^ b, c = 0;
  while (x > 0n) { c += Number(x & 1n); x >>= 1n; }
  return c;
}

/**
 * Độ sáng trung bình (0..255) + độ nét (variance of Laplacian; cao = nét).
 * @returns {Promise<{brightness:number, sharpness:number}>}
 */
export async function brightnessSharpness(input, size = 128) {
  const { data, info } = await sharp(input).grayscale().resize(size, size, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;

  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const brightness = sum / data.length;

  // variance of Laplacian (Welford)
  let n = 0, mean = 0, m2 = 0;
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      const lap = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - W] - data[i + W];
      n++;
      const d = lap - mean;
      mean += d / n;
      m2 += d * (lap - mean);
    }
  }
  const sharpness = n > 1 ? m2 / (n - 1) : 0;
  return { brightness, sharpness };
}

/** Gói cả 3 metric cho 1 ảnh. */
export async function computeMetrics(input) {
  const [hash, bs] = await Promise.all([dHash(input), brightnessSharpness(input)]);
  return { hash, brightness: bs.brightness, sharpness: bs.sharpness };
}
