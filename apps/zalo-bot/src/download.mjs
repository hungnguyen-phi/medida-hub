// src/download.mjs — tải media từ URL Zalo (zdn.vn / dlmd.me) về Buffer.
// Lỗi 1 ảnh -> trả null cho ảnh đó, KHÔNG ném để pipeline bỏ qua item lỗi.

export async function downloadToBuffer(url, { timeoutMs = 30000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
}

/**
 * Tải nhiều item song song (giới hạn concurrency). Item lỗi -> bị bỏ (log).
 * @param {Array<{url:string}>} items
 * @returns {Promise<Array>} chỉ những item tải được, có thêm .buffer
 */
export async function downloadAll(items, { concurrency = 4, timeoutMs = 30000, log = () => {} } = {}) {
  const out = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      const it = items[idx];
      try {
        const buffer = await downloadToBuffer(it.url, { timeoutMs });
        out.push({ ...it, buffer, _order: idx });
      } catch (e) {
        log(`tải lỗi, bỏ qua: ${it.url} (${e.message})`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  out.sort((a, b) => a._order - b._order);
  return out;
}
