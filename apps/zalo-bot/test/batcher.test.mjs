// test/batcher.test.mjs — kiểm tra logic debounce với timer giả (xác định, không chờ thật).
// Chạy: node test/batcher.test.mjs
import assert from "node:assert";
import { Batcher, MemoryStore } from "../src/batcher.mjs";

let pass = 0;
const ok = (n) => { console.log(`✅ ${n}`); pass++; };

// Đồng hồ giả: lưu callback theo id, fire thủ công.
function fakeClock() {
  let seq = 1; const t = new Map();
  return {
    setTimeout: (fn) => { const id = seq++; t.set(id, fn); return id; },
    clearTimeout: (id) => { t.delete(id); },
    fire: async (id) => { const fn = t.get(id); t.delete(id); if (fn) await fn(); },
    size: () => t.size,
  };
}

const route = { debounceMs: 1000, maxWaitMs: 5000 };
const getRoute = () => route;
const mediaEv = (tid, i) => ({ threadId: tid, kind: "image", mediaUrl: `u${i}`, caption: "", senderId: "s1", ts: i });

function makeBatcher(clock, closed) {
  return new Batcher({
    store: new MemoryStore(),
    onClose: async (b, reason) => closed.push({ n: b.items.length, reason, texts: b.texts.length }),
    getRoute,
    setTimeoutFn: clock.setTimeout, clearTimeoutFn: clock.clearTimeout,
  });
}

// 1) 3 ảnh -> im lặng -> chốt 1 lần, 3 media, reason silence
{
  const clock = fakeClock(); const closed = []; const b = makeBatcher(clock, closed);
  await b.add(mediaEv("g1", 1));
  await b.add(mediaEv("g1", 2));
  await b.add(mediaEv("g1", 3));
  const debounceId = b.timers.get("g1").debounce;
  await clock.fire(debounceId); // mô phỏng im lặng
  assert.deepEqual(closed, [{ n: 3, reason: "silence", texts: 0 }]);
  ok("3 ảnh + im lặng -> chốt 3 media (silence)");
}

// 2) ảnh + lệnh "xong" -> chốt NGAY (command)
{
  const clock = fakeClock(); const closed = []; const b = makeBatcher(clock, closed);
  await b.add(mediaEv("g2", 1));
  await b.add(mediaEv("g2", 2));
  await b.add({ threadId: "g2", kind: "command", text: "xong" });
  assert.deepEqual(closed, [{ n: 2, reason: "command", texts: 0 }]);
  assert.equal(clock.size(), 0, "đã dọn sạch timer sau khi chốt");
  ok("ảnh + 'xong' -> chốt ngay (command), timer dọn sạch");
}

// 3) chạm trần maxWait -> chốt (maxwait)
{
  const clock = fakeClock(); const closed = []; const b = makeBatcher(clock, closed);
  await b.add(mediaEv("g3", 1));
  const maxId = b.timers.get("g3").maxwait;
  await clock.fire(maxId);
  assert.deepEqual(closed, [{ n: 1, reason: "maxwait", texts: 0 }]);
  ok("chạm trần -> chốt (maxwait)");
}

// 4) text TRƯỚC media được GIỮ làm tư liệu; text sau cũng gom -> cả hai vào caption
{
  const clock = fakeClock(); const closed = []; const b = makeBatcher(clock, closed);
  await b.add({ threadId: "g4", kind: "text", text: "caption trước khi có ảnh" }); // giữ làm tư liệu
  await b.add(mediaEv("g4", 1));
  await b.add({ threadId: "g4", kind: "text", text: "các bé học vẽ" });            // gom thêm
  await clock.fire(b.timers.get("g4").debounce);
  assert.deepEqual(closed, [{ n: 1, reason: "silence", texts: 2 }]);
  ok("text trước + sau media -> đều gom làm tư liệu caption");
}

// 4b) chữ trước -> ảnh tới: huỷ hạn chờ-ảnh, bắt đầu trần phiên, giữ chữ
{
  const clock = fakeClock(); const closed = []; const b = makeBatcher(clock, closed);
  await b.add({ threadId: "g4b", kind: "text", text: "chủ đề hôm nay" });
  assert.ok(b.timers.get("g4b").preexpiry != null, "chữ đầu -> đặt hạn chờ-ảnh");
  await b.add(mediaEv("g4b", 1));
  assert.equal(b.timers.get("g4b").preexpiry, null, "ảnh tới -> huỷ hạn chờ-ảnh");
  assert.ok(b.timers.get("g4b").maxwait != null, "ảnh tới -> bắt đầu trần phiên");
  await clock.fire(b.timers.get("g4b").debounce);
  assert.deepEqual(closed, [{ n: 1, reason: "silence", texts: 1 }]);
  ok("chữ trước + ảnh tới -> mở phiên, giữ chữ, huỷ hạn chờ-ảnh");
}

// 4c) CHỈ có chữ, hết hạn 1h không ảnh -> bỏ pre-buffer (onDiscard), không đăng
{
  const clock = fakeClock(); const closed = []; const discarded = [];
  const b = new Batcher({ store: new MemoryStore(), onClose: async (bb, r) => closed.push(r), getRoute,
    setTimeoutFn: clock.setTimeout, clearTimeoutFn: clock.clearTimeout, onDiscard: (tid) => discarded.push(tid) });
  await b.add({ threadId: "g4c", kind: "text", text: "chỉ chat, chưa gửi ảnh" });
  const pre = b.timers.get("g4c").preexpiry;
  assert.ok(pre != null, "có đặt hạn chờ-ảnh");
  await clock.fire(pre);
  assert.equal(closed.length, 0, "không đăng gì");
  assert.deepEqual(discarded, ["g4c"]);
  assert.equal(clock.size(), 0, "dọn sạch timer");
  ok("chỉ có chữ + hết 1h không ảnh -> bỏ pre-buffer (onDiscard)");
}

// 5) chỉ có lệnh, không media -> không đăng
{
  const clock = fakeClock(); const closed = []; const b = makeBatcher(clock, closed);
  await b.add({ threadId: "g5", kind: "command", text: "đăng" });
  assert.equal(closed.length, 0);
  ok("lệnh khi chưa có media -> không đăng");
}

// 6) nhóm chưa cấu hình -> bỏ qua
{
  const clock = fakeClock(); const closed = [];
  const b = new Batcher({ store: new MemoryStore(), onClose: async () => closed.push(1), getRoute: () => undefined, setTimeoutFn: clock.setTimeout, clearTimeoutFn: clock.clearTimeout });
  await b.add(mediaEv("unknown", 1));
  assert.equal(closed.length, 0);
  assert.equal(clock.size(), 0);
  ok("nhóm chưa cấu hình -> bỏ qua, không tạo timer");
}

console.log(`\n🎉 PASS ${pass}/${pass} test.`);
