// src/curate.mjs — lọc ảnh: bỏ hỏng kỹ thuật (mờ/tối/cháy) + gom trùng giữ ảnh nét nhất.
// Không AI. (Phần "AI chọn đẹp" sẽ là tầng tùy chọn riêng, gắn sau.)
import { computeMetrics, hamming } from "./imagequality.mjs";

export const DEFAULT_OPTS = {
  dupDistance: 10,    // hamming <= -> coi là trùng/gần trùng (chụp liên thanh)
  minSharpness: 50,   // dưới -> mờ nhòe
  minBrightness: 25,  // dưới -> tối thui
  maxBrightness: 245, // trên -> cháy sáng
  maxKeep: Infinity,  // trần số ảnh giữ lại
  pickBest: null,     // (async fn) chọn ảnh đẹp nhất trong cụm; null -> dùng ảnh nét nhất
};

/**
 * @param {Array<{buffer?:Buffer, path?:string, url?:string, ts?:number}>} images
 * @returns {Promise<{kept:Array, dropped:Array}>} dropped có .reason
 */
export async function curate(images, opts = {}) {
  const o = { ...DEFAULT_OPTS, ...opts };
  const dropped = [];

  // 1) tính metric (lỗi đọc -> loại, không làm sập)
  const withM = [];
  for (const img of images) {
    try {
      const m = await computeMetrics(img.buffer ?? img.path ?? img.url);
      withM.push({ ...img, ...m });
    } catch (e) {
      dropped.push({ ...img, reason: "loi-doc-anh", error: e.message });
    }
  }

  // 2) loại hỏng kỹ thuật
  const candidates = [];
  for (const im of withM) {
    if (im.brightness < o.minBrightness) { dropped.push({ ...im, reason: "toi" }); continue; }
    if (im.brightness > o.maxBrightness) { dropped.push({ ...im, reason: "chay-sang" }); continue; }
    if (im.sharpness < o.minSharpness) { dropped.push({ ...im, reason: "mo" }); continue; }
    candidates.push(im);
  }

  // 3) gom cụm trùng (greedy theo hamming), giữ ảnh nét nhất mỗi cụm
  const clusters = [];
  for (const im of candidates) {
    const c = clusters.find((cl) => hamming(im.hash, cl.repHash) <= o.dupDistance);
    if (c) c.members.push(im);
    else clusters.push({ repHash: im.hash, members: [im] });
  }
  let kept = [];
  for (const c of clusters) {
    c.members.sort((a, b) => b.sharpness - a.sharpness); // mặc định: nét nhất đầu
    let bestMember = c.members[0]; // tham chiếu gốc (để loại trừ chính xác)
    let aiReason;
    // Cụm có >=2 ảnh + có AI -> để AI chọn ảnh đẹp nhất (mắt mở/không lé...)
    if (o.pickBest && c.members.length >= 2) {
      try {
        const r = await o.pickBest(c.members);
        if (r && c.members[r.index]) { bestMember = c.members[r.index]; aiReason = r.reason; }
      } catch { /* lỗi AI -> giữ ảnh nét nhất */ }
    }
    kept.push(aiReason ? { ...bestMember, aiReason } : bestMember);
    for (const m of c.members) {
      if (m === bestMember) continue;
      dropped.push({ ...m, reason: "trung", keptInstead: bestMember.url || bestMember.path });
    }
  }

  // 4) trần số lượng: giữ ảnh nét nhất
  if (kept.length > o.maxKeep) {
    kept.sort((a, b) => b.sharpness - a.sharpness);
    for (const m of kept.slice(o.maxKeep)) dropped.push({ ...m, reason: "vuot-gioi-han" });
    kept = kept.slice(0, o.maxKeep);
  }

  // giữ thứ tự thời gian gửi cho tự nhiên
  kept.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return { kept, dropped };
}
