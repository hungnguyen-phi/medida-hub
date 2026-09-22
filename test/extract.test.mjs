// test/extract.test.mjs — kiểm tra extract trên PAYLOAD THẬT đã probe được.
// Chạy: node test/extract.test.mjs
import assert from "node:assert";
import { extractEvent, isCloseCommand } from "../src/extract.mjs";

let pass = 0;
const ok = (name) => { console.log(`✅ ${name}`); pass++; };

// --- Payload thật: ảnh trong nhóm (chat.photo) ---
const photoMsg = {
  type: 1, threadId: "3116985445483190156", isSelf: true,
  data: {
    msgType: "chat.photo", uidFrom: "2230497694069659449", dName: "Phi Hùng",
    ts: "1782264050109", msgId: "x1",
    content: {
      title: "các bé học vẽ",
      href: "https://photo-stal-10.zdn.vn/no/jpg/abc/def.jpg",
      thumb: "https://photo-stal-10.zdn.vn/no/jpg/abc/def.jpg",
      params: JSON.stringify({ width: 1152, hd: "https://photo-stal-10.zdn.vn/HD/def.jpg", hdSize: 145149, height: 2048 }),
    },
  },
};
{
  const e = extractEvent(photoMsg);
  assert.equal(e.kind, "image");
  assert.equal(e.threadType, "group");
  assert.equal(e.threadId, "3116985445483190156");
  assert.equal(e.senderId, "2230497694069659449");
  assert.equal(e.caption, "các bé học vẽ");
  assert.equal(e.mediaUrl, "https://photo-stal-10.zdn.vn/HD/def.jpg"); // ưu tiên HD
  assert.equal(e.mediaMeta.width, 1152);
  ok("ảnh chat.photo → image, lấy URL HD + caption");
}

// --- Payload thật: video (chat.video.msg) ---
const videoMsg = {
  type: 1, threadId: "3116985445483190156", isSelf: true,
  data: {
    msgType: "chat.video.msg", uidFrom: "2230497694069659449", dName: "Phi Hùng",
    ts: "1782264061895", msgId: "x2",
    content: {
      title: "",
      href: "https://video-stal-38.dlmd.me/gr/abc/xyz",
      thumb: "https://photo-stal-24.zdn.vn/no/poster.jpg",
      params: JSON.stringify({ fileSize: 34860242, video_height: 1920, video_width: 1080, isHD: 1, duration: 131000 }),
    },
  },
};
{
  const e = extractEvent(videoMsg);
  assert.equal(e.kind, "video");
  assert.equal(e.mediaUrl, "https://video-stal-38.dlmd.me/gr/abc/xyz");
  assert.equal(e.posterUrl, "https://photo-stal-24.zdn.vn/no/poster.jpg");
  assert.equal(e.mediaMeta.duration, 131000);
  assert.equal(e.mediaMeta.size, 34860242);
  ok("video chat.video.msg → video, lấy URL + poster + duration");
}

// --- Payload thật: chữ (webchat) ---
const textMsg = {
  type: 1, threadId: "3116985445483190156", isSelf: true,
  data: { msgType: "webchat", uidFrom: "2230497694069659449", dName: "Phi Hùng", ts: "1782264065445", msgId: "x3", content: "các bé học vẽ hôm nay" },
};
{
  const e = extractEvent(textMsg);
  assert.equal(e.kind, "text");
  assert.equal(e.text, "các bé học vẽ hôm nay");
  ok("chữ webchat → text");
}

// --- Lệnh chốt "Xong" ---
{
  const e = extractEvent({ type: 1, threadId: "g", data: { msgType: "webchat", content: "Xong" } });
  assert.equal(e.kind, "command");
  ok('"Xong" → command');
  assert.equal(isCloseCommand("  ĐĂNG. "), true);
  assert.equal(isCloseCommand("đăng ký học"), false); // không nhầm
  ok("isCloseCommand: nhận 'ĐĂNG.', bỏ qua 'đăng ký học'");
}

// --- BUG: tin NHẮC LỊCH của Zalo (có ảnh minh hoạ) KHÔNG được nhận là ảnh ---
{
  const reminderMsg = {
    type: 1, threadId: "3116985445483190156", isSelf: false,
    data: {
      msgType: "chat.reminder", uidFrom: "0", dName: "Zalo",
      ts: "1782264070000", msgId: "x4",
      content: { title: "Nhắc lịch họp phụ huynh", href: "https://stc.zalo.vn/reminder/illustration.png", thumb: "https://stc.zalo.vn/reminder/illustration.png", params: "{}" },
    },
  };
  const e = extractEvent(reminderMsg);
  assert.notEqual(e.kind, "image", "tin nhắc lịch KHÔNG được là image");
  assert.equal(e.kind, "other");
  ok("nhắc lịch (chat.reminder, có href ảnh) → other (bỏ qua), không tạo bài");
}

// --- Ảnh thật nhưng href .png vẫn nhận đúng (đảm bảo không phá ảnh thường) ---
{
  const e = extractEvent({ type: 1, threadId: "g", data: { msgType: "chat.photo", content: { href: "https://photo-stal.zdn.vn/x.png", params: "{}" } } });
  assert.equal(e.kind, "image");
  ok("ảnh chat.photo (.png) vẫn → image");
}

console.log(`\n🎉 PASS ${pass}/${pass} test.`);
