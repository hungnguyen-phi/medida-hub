// src/pickbest.mjs — tầng AI: trong 1 cụm ảnh gần-trùng, để Claude vision chọn ảnh ĐẸP nhất
// (mắt mở, không nhắm/lé, biểu cảm tươi). Dùng claude-sonnet-4-6 (vision).
// An toàn: thiếu key / lỗi API / từ chối -> trả null để tầng trên fallback về "ảnh nét nhất".
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export function hasApiKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** Thu nhỏ + xoay đúng chiều + nén JPEG để giảm token/chi phí vision. */
async function toThumb(input, size = 512) {
  return sharp(input).rotate().resize(size, size, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
}

const SCHEMA = {
  type: "object",
  properties: {
    best_index: { type: "integer", description: "Chỉ số (0-based) của ảnh đẹp nhất" },
    reason: { type: "string", description: "Lý do ngắn bằng tiếng Việt" },
  },
  required: ["best_index", "reason"],
  additionalProperties: false,
};

/**
 * Chọn ảnh đẹp nhất trong 1 cụm gần-trùng.
 * @param {Array<{buffer?:Buffer, path?:string}>} images  (>=2)
 * @returns {Promise<{index:number, reason:string}|null>}  null nếu nên fallback
 */
export async function pickBest(images, { log = () => {} } = {}) {
  if (!hasApiKey() || !Array.isArray(images) || images.length < 2) return null;
  try {
    const thumbs = await Promise.all(images.map((im) => toThumb(im.buffer ?? im.path)));
    const content = [];
    thumbs.forEach((t, i) => {
      content.push({ type: "text", text: `Ảnh ${i}:` });
      content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: t.toString("base64") } });
    });
    content.push({
      type: "text",
      text:
        `Đây là ${images.length} ảnh chụp gần như cùng khoảnh khắc (cùng người/cùng dáng). ` +
        `Chọn 1 ảnh ĐẸP NHẤT để đăng lên fanpage: ưu tiên mắt mở (không nhắm, không lé), ` +
        `mặt rõ không nhòe, biểu cảm tươi tự nhiên, bố cục tốt. ` +
        `Trả về best_index (0..${images.length - 1}) và lý do ngắn gọn tiếng Việt.`,
    });

    const client = new Anthropic();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    });

    if (resp.stop_reason === "refusal") { log("pickBest: AI từ chối -> fallback"); return null; }
    const text = resp.content.find((b) => b.type === "text")?.text;
    if (!text) return null;
    const parsed = JSON.parse(text);
    const idx = parsed.best_index;
    if (typeof idx !== "number" || idx < 0 || idx >= images.length) return null;
    return { index: idx, reason: String(parsed.reason || "") };
  } catch (e) {
    log(`pickBest lỗi (${e.message}) -> fallback ảnh nét nhất`);
    return null;
  }
}
