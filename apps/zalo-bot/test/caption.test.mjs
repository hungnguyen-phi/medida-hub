// test/caption.test.mjs — kiểm logic fallback + gộp text (không gọi API).
import assert from "node:assert";
import { combineTexts, fallbackCaption, writeCaption } from "../src/caption.mjs";

let pass = 0;
const ok = (n) => { console.log(`✅ ${n}`); pass++; };

// combineTexts: bỏ rỗng, bỏ trùng liền kề
{
  assert.equal(combineTexts([{ text: "các bé học vẽ" }, { text: " " }, { text: "các bé học vẽ" }, { text: "vui lắm" }]), "các bé học vẽ\nvui lắm");
  assert.equal(combineTexts([]), "");
  assert.equal(fallbackCaption([{ text: "abc" }]), "abc");
  ok("combineTexts/fallback: gộp đúng, bỏ rỗng+trùng");
}

// disableAI -> fallback dùng nguyên text, không sập
{
  const r = await writeCaption({ items: [{ kind: "image", buffer: Buffer.from("x") }], texts: [{ text: "hôm nay các bé đi dã ngoại" }] }, { disableAI: true });
  assert.equal(r.source, "fallback");
  assert.equal(r.caption, "hôm nay các bé đi dã ngoại");
  ok("disableAI -> fallback dùng nguyên ghi chú");
}

// không có ảnh -> fallback
{
  const r = await writeCaption({ items: [], texts: [{ text: "ghi chú" }] }, { disableAI: true });
  assert.equal(r.source, "fallback");
  ok("không có ảnh -> fallback");
}

console.log(`\n🎉 PASS ${pass}/${pass} test.`);
