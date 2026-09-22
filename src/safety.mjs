// src/safety.mjs — lưới an toàn CUỐI trước khi ảnh có thể lên fanpage trường học
// (có trẻ em). curate.mjs chỉ bắt lỗi KỸ THUẬT (mờ/tối/trùng) — không thấy được
// mặt bị che khuất hay nguy cơ lộ da thịt/riêng tư trẻ em. File này gọi Claude
// vision chấm TỪNG ảnh đã qua vòng lọc kỹ thuật; ảnh bị đánh dấu unsafe KHÔNG bị
// xoá — chỉ gắn cờ hidden để Media Hub vẫn hiển thị cho người duyệt xem lại và tự
// quyết định hiện/ẩn, tránh AI lỡ tay chặn nhầm ảnh còn dùng được.
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

export function hasApiKey() {
  return !!process.env.ANTHROPIC_API_KEY;
}

async function toThumb(input, size = 512) {
  return sharp(input).rotate().resize(size, size, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
}

const SCHEMA = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer" },
          unsafe: {
            type: "boolean",
            description:
              "true nếu ảnh có nguy cơ lộ da thịt/riêng tư của trẻ em, hoặc chất lượng quá kém để đăng công khai (mặt bị che khuất phần lớn, khung hình hỏng nặng)",
          },
          reason: { type: "string", description: "Lý do ngắn bằng tiếng Việt" },
        },
        required: ["index", "unsafe", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["results"],
  additionalProperties: false,
};

/**
 * Chấm AN TOÀN cho một loạt ảnh (đã qua lọc kỹ thuật ở curate.mjs).
 * @param {Array<{buffer?:Buffer, path?:string}>} images
 * @returns {Promise<Array<{index:number, unsafe:boolean, reason:string}>>}
 *   Mảng RỖNG nếu thiếu key/lỗi API/AI từ chối -> KHÔNG chặn ảnh nào (fail-open,
 *   để lỗi hạ tầng không âm thầm chặn hết ảnh của người dùng). Đây là lớp PHỤ,
 *   không thay thế người duyệt bài.
 */
export async function checkSafety(images, { log = () => {} } = {}) {
  if (!hasApiKey() || !Array.isArray(images) || !images.length) return [];
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
        `Đây là ${images.length} ảnh sẽ đăng CÔNG KHAI lên fanpage trường học (có trẻ em). ` +
        `Với MỖI ảnh, đánh dấu unsafe=true nếu: (a) có nguy cơ LỘ DA THỊT/RIÊNG TƯ của trẻ em ` +
        `(đang thay đồ, tắm, cởi trần không phù hợp, tư thế nhạy cảm...), hoặc (b) chất lượng quá ` +
        `kém để đăng công khai: mặt bị che khuất phần lớn (nón, tay, vật cản chắn gần hết mặt), ` +
        `khung hình hỏng nặng. KHÔNG đánh dấu unsafe chỉ vì ảnh hơi mờ nhẹ, góc chụp bình thường, ` +
        `hay trẻ mặc đồ bơi/đồ thể thao thông thường ở hồ bơi/sân trường — chỉ chặn khi THẬT SỰ ` +
        `có vấn đề nghiêm trọng. Trả về results cho ĐỦ ${images.length} ảnh theo đúng index 0..${images.length - 1}.`,
    });

    const client = new Anthropic();
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    });

    if (resp.stop_reason === "refusal") {
      log("checkSafety: AI từ chối -> không chặn ảnh nào");
      return [];
    }
    const text = resp.content.find((b) => b.type === "text")?.text;
    if (!text) return [];
    const parsed = JSON.parse(text);
    return Array.isArray(parsed.results) ? parsed.results : [];
  } catch (e) {
    log(`checkSafety lỗi (${e.message}) -> không chặn ảnh nào`);
    return [];
  }
}
