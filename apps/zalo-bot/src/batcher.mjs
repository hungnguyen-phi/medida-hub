// src/batcher.mjs — Gom media theo nhóm với debounce có state.
// Chốt batch khi: (a) im lặng debounceMs, (b) lệnh "xong"/"đăng", (c) chạm trần maxWaitMs.
//
// Kho trạng thái qua interface Store (async) -> giờ dùng MemoryStore, sau cắm Redis
// chỉ cần class có get/set/delete cùng chữ ký. Timer tiêm được để test.

export class MemoryStore {
  constructor() { this.map = new Map(); }
  async get(threadId) { return this.map.get(threadId); }
  async set(threadId, batch) { this.map.set(threadId, batch); }
  async delete(threadId) { this.map.delete(threadId); }
}

export class Batcher {
  /**
   * @param {object} o
   * @param {object} o.store      - MemoryStore | RedisStore (async get/set/delete)
   * @param {(batch:object, reason:string)=>Promise<void>} o.onClose - gọi khi chốt batch (có media)
   * @param {(threadId:string)=>object|undefined} o.getRoute - lấy route (debounceMs/maxWaitMs)
   */
  constructor({ store, onClose, getRoute, now = Date.now, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, log = () => {}, preExpiryMs = 3600000, onDiscard = () => {} }) {
    this.store = store;
    this.onClose = onClose;
    this.getRoute = getRoute;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.log = log;
    this.preExpiryMs = preExpiryMs; // chỉ có chữ, không ảnh trong khoảng này -> bỏ (mặc định 1 giờ)
    this.onDiscard = onDiscard; // báo khi bỏ pre-buffer chỉ-có-chữ (để live xoá phiên)
    this.timers = new Map(); // threadId -> { debounce, maxwait, preexpiry }
  }

  /** Nạp 1 NormalizedEvent vào batcher. */
  async add(event) {
    const tid = event.threadId;
    const route = this.getRoute(tid);
    if (!route) { this.log(`bỏ qua nhóm chưa cấu hình: ${tid}`); return; }

    if (event.kind === "command") {
      // chốt ngay nếu đang có ảnh; chỉ-có-chữ thì bỏ qua lệnh
      const b = await this.store.get(tid);
      if (b && b.items.length) return this.close(tid, "command");
      this.log(`lệnh "${event.text}" nhưng chưa có ảnh -> bỏ qua`);
      return;
    }

    if (event.kind === "image" || event.kind === "video") {
      const b = await this._getOrCreate(tid, route); // có thể đã có pre-buffer chữ -> giữ nguyên texts làm tư liệu
      b.items.push({
        kind: event.kind, url: event.mediaUrl, posterUrl: event.posterUrl,
        caption: event.caption || "", senderId: event.senderId, ts: event.ts, meta: event.mediaMeta,
      });
      await this.store.set(tid, b);
      this._clearPreExpiry(tid);     // đã có ảnh -> huỷ hạn "chờ ảnh"
      this._armMaxWait(tid, route);  // bắt đầu trần phiên đăng TỪ ảnh đầu tiên
      this._armDebounce(tid, route);
      this.log(`+${event.kind} (nhóm ${tid}, tổng ${b.items.length})`);
      return;
    }

    if (event.kind === "text") {
      // VẪN ĐỌC chữ (caption gửi trước / chủ đề chat) làm tư liệu — nhưng KHÔNG mở phiên đăng nếu chưa có ảnh.
      const b = await this._getOrCreate(tid, route);
      if (event.text) {
        b.texts.push({ text: event.text, senderId: event.senderId, ts: event.ts });
        if (b.texts.length > 80) b.texts = b.texts.slice(-80); // giới hạn bộ nhớ
      }
      await this.store.set(tid, b);
      if (b.items.length) this._armDebounce(tid, route); // đã có ảnh -> coi như còn gõ caption, gia hạn chốt
      else this._armPreExpiry(tid);                       // chưa có ảnh -> đặt hạn 1h chờ ảnh (1 lần)
    }
  }

  async _getOrCreate(tid, route) {
    let b = await this.store.get(tid);
    if (!b) {
      b = { threadId: tid, items: [], texts: [], startedAt: this.now() };
      await this.store.set(tid, b);
      // KHÔNG đặt maxWait ở đây: phiên đăng (và trần thời gian) chỉ bắt đầu khi có ảnh đầu tiên.
    }
    return b;
  }

  _slot(tid) {
    let s = this.timers.get(tid);
    if (!s) { s = { debounce: null, maxwait: null, preexpiry: null }; this.timers.set(tid, s); }
    return s;
  }

  _armPreExpiry(tid) {
    const s = this._slot(tid);
    if (s.preexpiry != null) return; // đặt 1 lần từ tin chữ đầu tiên
    s.preexpiry = this.setTimeoutFn(() => { this._discard(tid).catch((e) => this.log(`discard err: ${e.message}`)); }, this.preExpiryMs);
  }

  _clearPreExpiry(tid) {
    const s = this.timers.get(tid);
    if (s && s.preexpiry != null) { this.clearTimeoutFn(s.preexpiry); s.preexpiry = null; }
  }

  /** Bỏ pre-buffer chỉ-có-chữ (hết 1h không thấy ảnh). */
  async _discard(tid) {
    const b = await this.store.get(tid);
    this._clearTimers(tid);
    if (!b) return;
    await this.store.delete(tid);
    this.log(`bỏ pre-buffer ${tid}: chỉ có chữ, 1h không có ảnh`);
    try { this.onDiscard(tid); } catch {}
  }

  _armDebounce(tid, route) {
    const s = this._slot(tid);
    if (s.debounce != null) this.clearTimeoutFn(s.debounce);
    s.debounce = this.setTimeoutFn(() => { this.close(tid, "silence").catch((e) => this.log(`close err: ${e.message}`)); }, route.debounceMs);
  }

  _armMaxWait(tid, route) {
    const s = this._slot(tid);
    if (s.maxwait != null) return; // đã đặt
    s.maxwait = this.setTimeoutFn(() => { this.close(tid, "maxwait").catch((e) => this.log(`close err: ${e.message}`)); }, route.maxWaitMs);
  }

  _clearTimers(tid) {
    const s = this.timers.get(tid);
    if (!s) return;
    if (s.debounce != null) this.clearTimeoutFn(s.debounce);
    if (s.maxwait != null) this.clearTimeoutFn(s.maxwait);
    if (s.preexpiry != null) this.clearTimeoutFn(s.preexpiry);
    this.timers.delete(tid);
  }

  /** Chốt batch: dọn timer, xóa state, gọi onClose nếu có media. Idempotent. */
  async close(tid, reason) {
    const b = await this.store.get(tid);
    this._clearTimers(tid);
    if (!b) return; // đã chốt rồi
    await this.store.delete(tid);
    if (!b.items.length) { this.log(`batch ${tid} rỗng -> bỏ (${reason})`); return; }
    this.log(`CHỐT batch ${tid}: ${b.items.length} media (${reason})`);
    try {
      await this.onClose(b, reason);
    } catch (e) {
      // 1 batch lỗi KHÔNG được làm sập service
      this.log(`onClose lỗi cho ${tid}: ${e.stack || e.message}`);
    }
  }
}
