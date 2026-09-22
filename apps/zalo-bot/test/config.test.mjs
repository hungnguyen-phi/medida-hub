// test/config.test.mjs - verify route config keeps optional publish targets like GBP.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, routeForThread } from "../src/config.mjs";

let pass = 0;
const ok = (n) => { console.log(`ok ${n}`); pass++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-"));
const file = path.join(tmp, "routes.json");

fs.writeFileSync(file, JSON.stringify({
  defaults: { debounceMs: 1234, maxWaitMs: 5678, published: false, facebookAutoPublish: false, gbpAutoPublish: false },
  routes: [{
    threadId: "g1",
    label: "Group 1",
    fanpageId: "p1",
    fanpageTokenEnv: "FB_PAGE_TOKEN_TEST",
    gbpLocationId: "9876543210",
    facebookAutoPublish: true,
    gbpAutoPublish: true,
    captionFooter: "footer",
    folder: "Chị Lan",
    styleSample: "huong dan cu",
  }],
}, null, 2));

{
  process.env.FB_PAGE_TOKEN_TEST = "page-token";
  const cfg = loadConfig(file);
  const r = routeForThread(cfg, "g1");
  assert.equal(r.gbpLocationId, "9876543210");
  assert.equal(r.fanpageToken, "page-token");
  assert.equal(r.debounceMs, 1234);
  assert.equal(r.maxWaitMs, 5678);
  assert.equal(r.facebookAutoPublish, true);
  assert.equal(r.gbpAutoPublish, true);
  assert.equal(r.folder, "Chị Lan");
  assert.equal(r.writeGuide, "huong dan cu"); // styleSample cũ -> writeGuide (tương thích ngược)
  assert.equal(r.autoHashtags, true);         // mặc định BẬT khi không khai báo
  ok("loadConfig preserves gbpLocationId and defaults");
}

// writeGuide MỚI ưu tiên hơn styleSample cũ; autoHashtags:false được tôn trọng
{
  const f2 = path.join(tmp, "routes2.json");
  fs.writeFileSync(f2, JSON.stringify({ routes: [{ threadId: "g2", fanpageId: "p2", writeGuide: "moi", styleSample: "cu", autoHashtags: false }] }));
  const r2 = routeForThread(loadConfig(f2), "g2");
  assert.equal(r2.writeGuide, "moi");
  assert.equal(r2.autoHashtags, false);
  ok("writeGuide ưu tiên hơn styleSample; autoHashtags:false giữ nguyên");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`PASS ${pass}/${pass} test.`);
