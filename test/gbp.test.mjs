// test/gbp.test.mjs - Google Business local store/session helpers.
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let pass = 0;
const ok = (n) => { console.log(`ok ${n}`); pass++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gbp-"));
process.env.DATA_DIR = tmp;

const gbp = await import("../src/gbp.mjs?test=" + Date.now());

{
  const saved = gbp.saveGbpBusinesses([
    { id: " 123 ", name: "A" },
    { id: "123", name: "Duplicate" },
    { id: "", name: "Skip" },
    { id: "456", name: "B" },
  ]);
  assert.deepEqual(saved, [{ id: "123", name: "A" }, { id: "456", name: "B" }]);
  assert.deepEqual(gbp.loadGbpBusinesses(), saved);
  ok("save/load businesses trims, skips empty, dedupes");
}

{
  fs.mkdirSync(path.dirname(gbp.GBP_SESSION_FILE), { recursive: true });
  const expires = Math.floor(Date.now() / 1000) + 86400;
  fs.writeFileSync(gbp.GBP_SESSION_FILE, JSON.stringify({
    cookies: [{ domain: ".google.com", name: "SID", value: "x", expires }],
    origins: [],
  }));
  const info = gbp.inspectGbpSession();
  assert.equal(info.hasSession, true);
  assert.equal(info.expired, false);
  assert.ok(info.expiresAt >= expires * 1000);
  ok("inspect session estimates cookie expiry");
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`PASS ${pass}/${pass} test.`);
