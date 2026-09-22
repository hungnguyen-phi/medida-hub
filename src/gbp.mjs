// src/gbp.mjs — Đăng bài lên Google Business Profile qua Playwright (browser automation).
// Không cần API key — dùng session Google đã lưu (loginGBP() một lần, headful).
// VPS: headless=true hoạt động bình thường sau khi có session.
import fs from "node:fs";
import path from "node:path";
import { dataPath } from "./paths.mjs";
import { startVncStack, stopVncStack, vncAvailable } from "./gbpvnc.mjs";

export const GBP_SESSION_FILE = dataPath("data", "gbp-session.json");
export const GBP_BUSINESSES_FILE = dataPath("data", "gbp-businesses.json");
const TIMEOUT = 40_000;
let loginFlow = null;

/** Lazy-load playwright để service không crash nếu chưa cài. */
async function getChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    throw new Error("Playwright chưa được cài — chạy: npm install playwright && npx playwright install chromium --with-deps");
  }
}

export function loadGbpBusinesses() {
  try {
    const a = JSON.parse(fs.readFileSync(GBP_BUSINESSES_FILE, "utf8"));
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

export function saveGbpBusinesses(items = []) {
  const clean = items
    .map((x) => ({ id: String(x.id || "").trim(), name: String(x.name || "").trim() }))
    .filter((x) => x.id)
    .filter((x, i, a) => a.findIndex((y) => y.id === x.id) === i);
  fs.mkdirSync(path.dirname(GBP_BUSINESSES_FILE), { recursive: true });
  fs.writeFileSync(GBP_BUSINESSES_FILE, JSON.stringify(clean, null, 2));
  return clean;
}

export function inspectGbpSession({ sessionFile = GBP_SESSION_FILE } = {}) {
  if (!fs.existsSync(sessionFile)) return { hasSession: false, path: sessionFile, expiresAt: null, expired: null, updatedAt: null };
  let expiresAt = null;
  try {
    const st = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
    const exp = (st.cookies || [])
      .filter((c) => String(c.domain || "").includes("google") && Number(c.expires) > 0)
      .map((c) => Number(c.expires) * 1000);
    if (exp.length) expiresAt = Math.max(...exp);
  } catch {}
  let updatedAt = null;
  try { updatedAt = fs.statSync(sessionFile).mtimeMs; } catch {}
  return {
    hasSession: true,
    path: sessionFile,
    expiresAt,
    expired: expiresAt ? expiresAt < Date.now() : null,
    updatedAt,
  };
}

/** Lưu session (storageState JSON) lên volume — dùng khi đăng nhập ở MÁY LOCAL rồi tải lên VPS. */
export function importGbpSession(state, { sessionFile = GBP_SESSION_FILE } = {}) {
  let obj = state;
  if (typeof state === "string") { try { obj = JSON.parse(state); } catch { throw new Error("File không phải JSON hợp lệ."); } }
  if (!obj || (!Array.isArray(obj.cookies) && !Array.isArray(obj.origins))) {
    throw new Error("File session không hợp lệ (thiếu 'cookies'). Phải là file data/gbp-session.json tạo bởi `npm run gbp:login`.");
  }
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  fs.writeFileSync(sessionFile, JSON.stringify(obj), { encoding: "utf8" });
  return inspectGbpSession({ sessionFile });
}

export async function beginGBPLogin({ sessionFile = GBP_SESSION_FILE } = {}) {
  if (loginFlow) return { already: true, startedAt: loginFlow.startedAt, vnc: loginFlow.vnc };
  let vnc = false;
  // Trình duyệt CÓ giao diện cần màn hình. VPS Linux không màn hình -> dựng màn hình ảo + noVNC để xem/thao tác.
  if (process.platform === "linux" && !process.env.DISPLAY) {
    if (!vncAvailable()) {
      throw new Error("Máy chủ không có màn hình và image chưa có noVNC. Hãy Redeploy (Dockerfile đã thêm xvfb/x11vnc/novnc), hoặc đăng nhập ở máy local rồi tải session lên.");
    }
    await startVncStack();
    vnc = true;
  }
  const chromium = await getChromium();
  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox", "--disable-dev-shm-usage", "--start-maximized"] });
  const ctx = await browser.newContext(fs.existsSync(sessionFile) ? { storageState: sessionFile } : { viewport: null });
  const page = await ctx.newPage();
  await page.goto("https://accounts.google.com/signin/v2/identifier", { waitUntil: "domcontentloaded", timeout: TIMEOUT }).catch(async () => {
    await page.goto("https://myaccount.google.com/", { waitUntil: "domcontentloaded", timeout: TIMEOUT });
  });
  loginFlow = { browser, ctx, page, startedAt: Date.now(), sessionFile, vnc };
  return { ok: true, startedAt: loginFlow.startedAt, vnc };
}

export async function finishGBPLogin() {
  if (!loginFlow) throw new Error("Chưa mở phiên đăng nhập Google Business");
  const { browser, ctx, sessionFile, startedAt, vnc } = loginFlow;
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  await ctx.storageState({ path: sessionFile });
  await browser.close();
  if (vnc) stopVncStack();
  loginFlow = null;
  return { ok: true, startedAt, session: inspectGbpSession({ sessionFile }) };
}

export async function cancelGBPLogin() {
  if (!loginFlow) return { ok: true };
  const vnc = loginFlow.vnc;
  try { await loginFlow.browser.close(); } catch {}
  if (vnc) stopVncStack();
  loginFlow = null;
  return { ok: true };
}

export function gbpLoginStatus() {
  return loginFlow ? { active: true, startedAt: loginFlow.startedAt, vnc: !!loginFlow.vnc } : { active: false };
}

/**
 * Mở trình duyệt CÓ giao diện để đăng nhập Google 1 lần, lưu session.
 * Chạy từ máy có màn hình (hoặc VPS có VNC).
 * @param {object} o
 * @param {string} [o.sessionFile]
 */
export async function loginGBP({ sessionFile = GBP_SESSION_FILE } = {}) {
  const chromium = await getChromium();
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("https://accounts.google.com/signin/v2/identifier");
  console.log("\n📲 Đăng nhập Google trong cửa sổ trình duyệt vừa mở.");
  console.log("   Sau khi đăng nhập xong, quay lại đây nhấn ENTER để lưu session...\n");
  await new Promise((res) => {
    process.stdin.resume();
    process.stdin.once("data", () => { process.stdin.pause(); res(); });
  });
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  await ctx.storageState({ path: sessionFile });
  await browser.close();
  console.log("✅ Đã lưu session GBP:", sessionFile);
}

/**
 * Đăng 1 bài lên Google Business Profile.
 * @param {object} o
 * @param {string}   o.locationId   — ID địa điểm (số, lấy từ URL business.google.com)
 * @param {string}   o.text         — nội dung bài
 * @param {string[]} [o.imagePaths] — đường dẫn file ảnh (tối đa 10)
 * @param {string}   [o.sessionFile]
 * @param {function} [o.log]
 * @param {boolean}  [o.debug]      — lưu screenshot khi lỗi
 * @returns {Promise<{ok:boolean}>}
 */
export async function postToGBP({ locationId, text, imagePaths = [], sessionFile = GBP_SESSION_FILE, log = console.log, debug = true }) {
  if (!fs.existsSync(sessionFile)) {
    throw new Error("Chưa có session GBP — chạy: node gbp-login.mjs");
  }
  const chromium = await getChromium();
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({ storageState: sessionFile });
  const page = await ctx.newPage();

  const postFrame = () => page.frames().find((f) => /\/local\/business\/[^/]+\/promote\/updates/.test(f.url()));
  const waitPostFrame = async (ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const f = postFrame();
      if (f) return f;
      await page.waitForTimeout(250);
    }
    return null;
  };

  const fail = async (msg) => {
    if (debug) {
      const shot = dataPath("data", `gbp-error-${Date.now()}.png`);
      try { await page.screenshot({ path: shot, fullPage: true }); log(`GBP: screenshot lỗi → ${shot}`); } catch {}
    }
    await browser.close();
    throw new Error(msg);
  };

  try {
    // Vào trang đăng bài của địa điểm
    const postsUrl = `https://business.google.com/n/${locationId}/posts`;
    log(`GBP: mở ${postsUrl}`);
    await page.goto(postsUrl, { waitUntil: "domcontentloaded", timeout: TIMEOUT });
    await page.waitForTimeout(2000);

    // Kiểm tra session còn hiệu lực
    if (page.url().includes("accounts.google.com") || page.url().includes("signin")) {
      await fail("Session GBP hết hạn — chạy lại: node gbp-login.mjs");
    }

    // Google đôi khi tự mở composer trong iframe /local/business/.../promote/updates.
    // Khi iframe đã phủ lên trang, click nút "Add update" phía sau sẽ bị iframe chặn.
    let scope = await waitPostFrame(1500);
    if (!scope) {
      // Tìm nút "Thêm bài đăng" / "Add update" (tiếng Anh/Việt)
      const addSelectors = [
        'button:has-text("Thêm bài đăng")',
        'button:has-text("Add update")',
        'button:has-text("Tạo bài")',
        'a:has-text("Thêm bài đăng")',
        '[aria-label*="bài đăng" i]',
        '[aria-label*="post" i]',
      ];
      let addBtn = null;
      for (const sel of addSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 4000 })) { addBtn = el; break; }
        } catch {}
      }
      if (!addBtn) await fail("Không tìm thấy nút 'Thêm bài đăng' — UI GBP đã thay đổi hoặc sai locationId");

      try { await addBtn.click({ timeout: 10_000 }); }
      catch (e) {
        if (!String(e.message || "").includes("intercepts pointer events")) throw e;
        log("GBP: nút Add update bị iframe che, chuyển sang thao tác trong iframe");
      }
      log("GBP: bấm Thêm bài đăng");
      await page.waitForTimeout(1500);
      scope = await waitPostFrame(6000);
    }
    if (!scope) scope = page;

    // Chọn loại bài "Cập nhật" / "Update" (tab đầu tiên, thường là mặc định)
    async function clickFirstVisible(target, selectors, timeout = 1500, opts = {}) {
      for (const sel of selectors) {
        const el = target.locator(sel).first();
        if (await el.isVisible({ timeout }).catch(() => false)) {
          await el.click({ timeout: 10_000, ...opts });
          return sel;
        }
      }
      return "";
    }
    async function clickButtonByText(target, patterns) {
      return target.locator("button,[role=button]").evaluateAll((els, pats) => {
        const re = pats.map((p) => new RegExp(p, "i"));
        const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        const hit = els.find((el) => visible(el) && re.some((x) => x.test((el.innerText || el.textContent || el.getAttribute("aria-label") || "").trim())));
        if (!hit) return "";
        hit.click();
        return (hit.innerText || hit.textContent || hit.getAttribute("aria-label") || "").trim();
      }, patterns).catch(() => "");
    }
    async function chooseUpdateType(target) {
      return clickFirstVisible(target, [
        'button:has-text("Cập nhật")',
        'button:has-text("Thêm thông tin cập nhật")',
        'button:has-text("Add update")',
        'button:has-text("Update")',
        '[role="tab"]:has-text("Update")',
        '[role="menuitem"]:has-text("Update")',
        '[role="option"]:has-text("Update")',
        '[aria-label*="update" i]',
      ], 1200);
    }
    if (await chooseUpdateType(scope)) await page.waitForTimeout(800);

    // Điền nội dung bài
    const textSelectors = [
      '[role="textbox"]',
      'textarea[placeholder*="bài đăng" i]',
      'textarea[placeholder*="nội dung" i]',
      'textarea[placeholder*="update" i]',
      'textarea[placeholder*="description" i]',
      '[contenteditable="true"][aria-label*="description" i]',
      'div[contenteditable="true"]',
      'textarea',
    ];
    async function findTextField(target) {
      for (const sel of textSelectors) {
        const el = target.locator(sel).first();
        if (await el.isVisible({ timeout: 2500 }).catch(() => false)) return el;
      }
      return null;
    }
    let textField = await findTextField(scope);
    if (!textField) {
      const createSelectors = [
        'button:has-text("Add post")',
        'button:has-text("+ Add post")',
        '[role="button"]:has-text("Add post")',
        'button:has-text("Thêm bài đăng")',
        'button:has-text("+")',
        'button[aria-label*="Add" i]',
        'button[aria-label*="Create" i]',
        'button[aria-label*="Update" i]',
        'button[aria-label*="post" i]',
        '[role="button"][aria-label*="Add" i]',
        '[role="button"][aria-label*="Create" i]',
      ];
      let createBtn = null;
      for (const sel of createSelectors) {
        const el = scope.locator(sel).first();
        if (await el.isVisible({ timeout: 1500 }).catch(() => false)) { createBtn = el; break; }
      }
      if (createBtn) {
        await createBtn.click({ timeout: 10_000 });
        log("GBP: bấm nút tạo cập nhật (+)");
        await page.waitForTimeout(1500);
        scope = postFrame() || scope;
        if (await chooseUpdateType(scope)) {
          log("GBP: chọn loại bài Update");
          await page.waitForTimeout(1200);
        }
        textField = await findTextField(scope);
      } else {
        const clicked = await clickButtonByText(scope, ["^\\+?\\s*Add post$", "Add post", "Thêm bài đăng"]);
        if (clicked) {
          log(`GBP: bấm nút ${clicked}`);
          await page.waitForTimeout(1500);
          scope = postFrame() || scope;
          if (await chooseUpdateType(scope)) {
            log("GBP: chọn loại bài Update");
            await page.waitForTimeout(1200);
          }
          textField = await findTextField(scope);
        }
      }
    }
    if (!textField) await fail("Không tìm thấy ô nhập nội dung bài GBP");

    await textField.click();
    await textField.fill(text);
    log("GBP: điền nội dung xong");

    // Upload ảnh (nếu có)
    if (imagePaths.length > 0) {
      const imgs = imagePaths.slice(0, 10);
      let uploadOk = false;
      async function setFilesFromInput(target) {
        const fileInput = target.locator('input[type="file"]').first();
        if ((await fileInput.count()) > 0) {
          await fileInput.setInputFiles(imgs);
          return true;
        }
        return false;
      }
      async function waitUploadDone(target) {
        log(`GBP: upload ${imgs.length} ảnh...`);
        await page.waitForTimeout(5000);
        try {
          await target.waitForFunction(
            () => !document.querySelector('[aria-label*="uploading" i], [aria-label*="đang tải" i], [aria-label*="Đang tải" i]'),
            { timeout: 25_000 }
          );
        } catch {}
        log("GBP: ảnh upload xong");
      }
      // Tìm nút thêm ảnh
      const photoSelectors = [
        'button:has-text("Thêm ảnh")',
        'button:has-text("Add photos")',
        'button:has-text("Select images and videos")',
        'button:has-text("Select images")',
        'button:has-text("images and videos")',
        '[role="button"]:has-text("Select images and videos")',
        '[role="button"]:has-text("images and videos")',
        'button:has-text("Ảnh")',
        '[aria-label*="ảnh" i]',
        '[aria-label*="photo" i]',
        '[aria-label*="image" i]',
        '[aria-label*="video" i]',
      ];
      let photoBtn = null;
      for (const sel of photoSelectors) {
        const el = scope.locator(sel).first();
        if (await el.isVisible({ timeout: 3000 }).catch(() => false)) { photoBtn = el; break; }
      }
      if (await setFilesFromInput(scope)) {
        await waitUploadDone(scope);
        uploadOk = true;
      } else if (photoBtn) {
        const chooserPromise = page.waitForEvent("filechooser", { timeout: 5000 }).catch(() => null);
        await photoBtn.click();
        const chooser = await chooserPromise;
        if (chooser) {
          await chooser.setFiles(imgs);
          await waitUploadDone(scope);
          uploadOk = true;
        } else {
          await page.waitForTimeout(1000);
          if (await setFilesFromInput(scope)) {
            await waitUploadDone(scope);
            uploadOk = true;
          }
          else log("GBP: ⚠️ đã bấm nút ảnh nhưng không thấy file input/file chooser");
        }
      } else {
        log("GBP: ⚠️ không tìm thấy nút thêm ảnh, đăng không có ảnh");
      }
      if (!uploadOk) await fail("Không upload được ảnh GBP — đã dừng, không đăng bài chữ không ảnh");
    }

    // Bấm Đăng / Publish
    const publishSelectors = [
      'button:has-text("Đăng")',
      'button:has-text("Publish")',
      'button:has-text("Post")',
      '[aria-label="Đăng"]',
      '[aria-label="Publish"]',
    ];
    let pubBtn = null;
    for (const sel of publishSelectors) {
      const el = scope.locator(sel).last(); // .last() vì có thể có nhiều nút "Đăng"
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) { pubBtn = el; break; }
    }
    if (!pubBtn) await fail("Không tìm thấy nút Đăng — UI GBP đã thay đổi");

    await pubBtn.click();
    log("GBP: bấm Đăng...");
    await page.waitForTimeout(4000);

    log("✅ GBP: đăng bài xong");
    await browser.close();
    return { ok: true };

  } catch (e) {
    try { await browser.close(); } catch {}
    throw e;
  }
}
