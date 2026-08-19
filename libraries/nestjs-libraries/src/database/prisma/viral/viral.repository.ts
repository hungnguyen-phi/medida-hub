import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class ViralRepository {
  constructor(
    private _posts: PrismaRepository<'viralPost'>,
    private _sources: PrismaRepository<'viralSource'>,
    private _clones: PrismaRepository<'viralClone'>,
    private _products: PrismaRepository<'viralProduct'>,
    private _personas: PrismaRepository<'viralPersona'>,
    private _seen: PrismaRepository<'viralSeen'>,
    private _reports: PrismaRepository<'viralReport'>,
    private _topics: PrismaRepository<'viralTopic'>
  ) {}

  // URL chuẩn hoá để dedup — bỏ query + slash cuối + lowercase (như n8n).
  // Riêng Facebook/YouTube: GIỮ tham số định danh bài (story_fbid/fbid/id/v) —
  // permalink dạng query (permalink.php?story_fbid=...) mà cắt hết query thì
  // mọi bài cùng trang gộp về 1 URL → bài thứ 2 trở đi bị vứt nhầm vì "trùng".
  static normUrl(u?: string | null): string {
    const raw = String(u || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      let kept = '';
      if (
        /(^|\.)(facebook\.com|fb\.watch|fb\.com|youtube\.com|youtu\.be)$/.test(
          url.hostname.toLowerCase()
        )
      ) {
        kept = ['story_fbid', 'fbid', 'id', 'v']
          .map((k) => {
            const v = url.searchParams.get(k);
            return v ? `${k}=${v}` : '';
          })
          .filter(Boolean)
          .join('&');
      }
      return (
        (url.origin + url.pathname).replace(/\/$/, '').toLowerCase() +
        (kept ? '?' + kept : '')
      );
    } catch {
      // không phải URL tuyệt đối — giữ cách chuẩn hoá cũ
      return raw.replace(/\?.*$/, '').replace(/\/$/, '').toLowerCase();
    }
  }

  // Điều kiện WHERE theo tab: pending/approved (chưa xóa), archive (bỏ qua HOẶC
  // đã xóa mềm). Mặc định: các thẻ đang hoạt động (chưa xóa).
  private tabWhere(tab?: string): any {
    if (tab === 'archive') {
      return { OR: [{ status: 'skipped', deletedAt: null }, { deletedAt: { not: null } }] };
    }
    if (tab === 'pending' || tab === 'approved' || tab === 'skipped') {
      return { status: tab, deletedAt: null };
    }
    return { deletedAt: null }; // active/all
  }

  list(
    orgId: string,
    filter: { platform?: string; level?: string; sort?: string; status?: string }
  ) {
    const orderBy =
      filter.sort === 'new'
        ? [{ createdAt: 'desc' as const }]
        : filter.sort === 'score'
        ? [{ score: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }]
        : // mặc định: share cao nhất trước, null xuống cuối, rồi mới nhất
          [{ shares: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }];
    return this._posts.model.viralPost.findMany({
      where: {
        organizationId: orgId,
        ...this.tabWhere(filter.status),
        ...(filter.platform && filter.platform !== 'all'
          ? { platform: filter.platform }
          : {}),
        ...(filter.level && filter.level !== 'all'
          ? { level: filter.level }
          : {}),
      },
      orderBy,
      take: 300,
    });
  }

  // Đếm cho các tab: Chờ duyệt / Đã duyệt / Bài của mình / Sản phẩm / Lưu trữ.
  async statusCounts(orgId: string) {
    const [rows, deletedCount, mineCount, productCount] = await Promise.all([
      this._posts.model.viralPost.groupBy({
        by: ['status'],
        where: { organizationId: orgId, deletedAt: null },
        _count: { _all: true },
      }),
      this._posts.model.viralPost.count({
        where: { organizationId: orgId, deletedAt: { not: null } },
      }),
      this._clones.model.viralClone.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this._products.model.viralProduct.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
    ]);
    const by: Record<string, number> = { approved: 0, pending: 0, skipped: 0 };
    for (const r of rows) by[r.status] = r._count._all;
    return {
      pending: by.pending,
      approved: by.approved,
      // Lưu trữ = bỏ qua (chưa xóa) + đã xóa mềm
      archive: by.skipped + deletedCount,
      mine: mineCount,
      products: productCount,
    };
  }

  // ── Thao tác hàng loạt ────────────────────────────────────────────────────
  setStatusMany(orgId: string, ids: string[], status: string) {
    return this._posts.model.viralPost.updateMany({
      where: { id: { in: ids }, organizationId: orgId },
      data: { status, deletedAt: null }, // duyệt/bỏ qua kéo về active
    });
  }

  softDeleteMany(orgId: string, ids: string[]) {
    return this._posts.model.viralPost.updateMany({
      where: { id: { in: ids }, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  // Xóa cứng (khỏi DB) — dùng trong Lưu trữ.
  hardDelete(orgId: string, ids: string[]) {
    return this._posts.model.viralPost.deleteMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
  }

  // Xóa cứng TOÀN BỘ Lưu trữ (bỏ qua + đã xóa).
  async hardDeleteArchive(orgId: string) {
    // dọn cả CHỦ ĐỀ trong lưu trữ (bỏ qua + xóa mềm) — UI giờ duyệt theo content
    await this._topics.model.viralTopic.deleteMany({
      where: {
        organizationId: orgId,
        OR: [{ status: 'skipped', deletedAt: null }, { deletedAt: { not: null } }],
      },
    }).catch(() => null);
    return this._posts.model.viralPost.deleteMany({
      where: {
        organizationId: orgId,
        OR: [{ status: 'skipped', deletedAt: null }, { deletedAt: { not: null } }],
      },
    });
  }

  // Xóa CỨNG chủ đề: bài thành viên chuyển vào lưu trữ (xóa mềm, purge sau).
  async hardDeleteTopics(orgId: string, ids: string[]) {
    await this._posts.model.viralPost.updateMany({
      where: { organizationId: orgId, topicId: { in: ids } },
      data: { topicId: null, deletedAt: new Date() },
    });
    return this._topics.model.viralTopic.deleteMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
  }

  // Reaper (port cron 18h T2-4-6 n8n): bài CHỜ DUYỆT quá N ngày không ai đụng
  // → tự chuyển "bỏ qua" (vào Lưu trữ, 7 ngày sau purge) — tường không ứ đọng.
  expirePendingOlderThan(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    return this._posts.model.viralPost.updateMany({
      where: { status: 'pending', deletedAt: null, createdAt: { lt: cutoff } },
      data: { status: 'skipped' },
    });
  }

  // Tự dọn Lưu trữ cũ hơn N ngày (xóa cứng). Trả số bản ghi đã xóa.
  async purgeArchiveOlderThan(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    const r = await this._posts.model.viralPost.deleteMany({
      where: {
        OR: [
          { status: 'skipped', deletedAt: null, updatedAt: { lt: cutoff } },
          { deletedAt: { not: null, lt: cutoff } },
        ],
      },
    });
    // dọn cả clone đã xóa mềm cũ
    await this._clones.model.viralClone.deleteMany({
      where: { deletedAt: { not: null, lt: cutoff } },
    });
    // dọn cả chủ đề trong lưu trữ cũ (bỏ qua lâu / xóa mềm lâu)
    await this._topics.model.viralTopic.deleteMany({
      where: {
        OR: [
          { status: 'skipped', deletedAt: null, updatedAt: { lt: cutoff } },
          { deletedAt: { not: null, lt: cutoff } },
        ],
      },
    }).catch(() => null);
    return r.count;
  }

  getByIds(orgId: string, ids: string[]) {
    return this._posts.model.viralPost.findMany({
      where: { id: { in: ids }, organizationId: orgId },
    });
  }

  // ── Bài của mình (ViralClone) ─────────────────────────────────────────────
  createClone(orgId: string, data: any) {
    return this._clones.model.viralClone.create({
      data: {
        organizationId: orgId,
        sourceId: data.sourceId || null,
        topicId: data.topicId || null,
        title: String(data.title || 'Bài của mình').slice(0, 300),
        content: String(data.content || '').slice(0, 6000),
        persona: data.persona ? String(data.persona).slice(0, 30) : null,
        score: typeof data.score === 'number' ? data.score : null,
        sourceScore: typeof data.sourceScore === 'number' ? data.sourceScore : null,
        scoreDetail: data.scoreDetail ? String(data.scoreDetail).slice(0, 3000) : null,
        status: 'mine',
      },
    });
  }

  listClones(orgId: string) {
    return this._clones.model.viralClone.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 300,
    });
  }

  getClone(orgId: string, id: string) {
    return this._clones.model.viralClone.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  updateClone(id: string, data: any) {
    return this._clones.model.viralClone.update({ where: { id }, data });
  }

  hardDeleteClone(orgId: string, id: string) {
    return this._clones.model.viralClone.deleteMany({
      where: { id, organizationId: orgId },
    });
  }

  // ── Chân dung khách hàng (ViralPersona) ──────────────────────────────────
  listPersonas(orgId: string) {
    return this._personas.model.viralPersona.findMany({
      where: { organizationId: orgId },
      orderBy: { code: 'asc' },
    });
  }

  countPersonas(orgId: string) {
    return this._personas.model.viralPersona.count({
      where: { organizationId: orgId },
    });
  }

  createPersona(orgId: string, data: any) {
    return this._personas.model.viralPersona.create({
      data: {
        organizationId: orgId,
        code: String(data.code),
        label: String(data.label || data.code).slice(0, 300),
        capHoc: data.capHoc || null,
        khuVuc: data.khuVuc || null,
        statics: data.statics ? JSON.stringify(data.statics).slice(0, 2000) : null,
        moiQuanTam: data.moiQuanTam ? String(data.moiQuanTam).slice(0, 600) : null,
        tamLy: data.tamLy ? String(data.tamLy).slice(0, 600) : null,
        hanhVi: data.hanhVi ? String(data.hanhVi).slice(0, 600) : null,
        insights: data.insights ? String(data.insights).slice(0, 550) : null,
        dataPoints: Number(data.dataPoints) || 0,
      },
    });
  }

  // Cập nhật phần ĐỘNG sau enrichment (AI không đụng statics/label).
  updatePersonaDynamic(
    orgId: string,
    code: string,
    data: {
      moiQuanTam?: string;
      tamLy?: string;
      hanhVi?: string;
      insights?: string;
      addDataPoints?: number;
    }
  ) {
    return this._personas.model.viralPersona.updateMany({
      where: { organizationId: orgId, code },
      data: {
        ...(data.moiQuanTam ? { moiQuanTam: data.moiQuanTam.slice(0, 600) } : {}),
        ...(data.tamLy ? { tamLy: data.tamLy.slice(0, 600) } : {}),
        ...(data.hanhVi ? { hanhVi: data.hanhVi.slice(0, 600) } : {}),
        ...(data.insights ? { insights: data.insights.slice(0, 550) } : {}),
        ...(data.addDataPoints
          ? { dataPoints: { increment: data.addDataPoints } }
          : {}),
      },
    });
  }

  // Bài đã chấm trong N giờ qua — tín hiệu cho enrichment persona.
  scoredSince(orgId: string, hours: number) {
    return this._posts.model.viralPost.findMany({
      where: {
        organizationId: orgId,
        persona: { not: null },
        updatedAt: { gte: new Date(Date.now() - hours * 3600 * 1000) },
      },
      orderBy: { updatedAt: 'desc' },
      take: 120,
    });
  }

  // ── Sản phẩm sản xuất (ViralProduct) ─────────────────────────────────────
  createProduct(orgId: string, data: any) {
    return this._products.model.viralProduct.create({
      data: {
        organizationId: orgId,
        postId: data.postId || null,
        cloneId: data.cloneId || null,
        topicId: data.topicId || null,
        format: String(data.format),
        status: 'processing',
        topic: data.topic ? String(data.topic).slice(0, 300) : null,
      },
    });
  }

  // Gắn persona + điểm xuống các bài của một chủ đề (để enrichPersonas giữ tín
  // hiệu VOICE/TREND/WINNING dựa trên scoredSince).
  tagMemberPersona(orgId: string, topicId: string, persona: string, score: number) {
    return this._posts.model.viralPost.updateMany({
      where: { organizationId: orgId, topicId, deletedAt: null },
      data: { persona, score },
    });
  }

  listProducts(orgId: string) {
    return this._products.model.viralProduct.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  // Sản phẩm của một nhóm chủ đề (đủ trạng thái + lý do lỗi) — cho badge SX
  // trên thẻ content và khu "Sản xuất" trong modal chi tiết.
  productsOfTopics(orgId: string, topicIds: string[]) {
    if (!topicIds.length) return Promise.resolve([] as any[]);
    return this._products.model.viralProduct.findMany({
      where: { organizationId: orgId, topicId: { in: topicIds }, deletedAt: null },
      select: { id: true, topicId: true, format: true, status: true, error: true },
      orderBy: { createdAt: 'desc' },
      take: 400,
    });
  }

  // Chủ đề nào (trong danh sách) đã có sản phẩm — duyệt lại không sản xuất trùng.
  // Ứng viên feed podcast RSS — quét TOÀN instance (Hub 1 tổ chức; quyền chọn
  // tập nằm ở nút Phát hành từng sản phẩm), lọc meta.rss.on thật ở service.
  listRssPodcastCandidates() {
    return this._products.model.viralProduct.findMany({
      where: {
        format: 'podcast',
        status: 'done',
        deletedAt: null,
        meta: { contains: '"rss"' },
      },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
  }

  async topicIdsWithProducts(orgId: string, topicIds: string[]): Promise<string[]> {
    if (!topicIds.length) return [];
    const rows = await this._products.model.viralProduct.findMany({
      where: { organizationId: orgId, topicId: { in: topicIds }, deletedAt: null },
      select: { topicId: true },
      distinct: ['topicId'],
    });
    return rows.map((r) => r.topicId as string);
  }

  // Mọi chủ đề ĐÃ DUYỆT còn sống — cho lượt chạy bù khi mở phanh ② (thẻ duyệt
  // trong lúc phanh đóng bị kẹt ở Đã duyệt, không có lệnh sản xuất nào bắn ra).
  async approvedTopicIds(orgId: string): Promise<string[]> {
    const rows = await this._topics.model.viralTopic.findMany({
      where: { organizationId: orgId, status: 'approved', deletedAt: null },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  // Chủ đề (distinct) của một nhóm bài — cho luồng "duyệt bài = duyệt chủ đề".
  async topicIdsOfPosts(orgId: string, postIds: string[]): Promise<string[]> {
    if (!postIds.length) return [];
    const rows = await this._posts.model.viralPost.findMany({
      where: { organizationId: orgId, id: { in: postIds }, topicId: { not: null } },
      select: { topicId: true },
      distinct: ['topicId'],
    });
    return rows.map((r) => r.topicId as string);
  }

  getProduct(orgId: string, id: string) {
    return this._products.model.viralProduct.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  updateProduct(id: string, data: any) {
    return this._products.model.viralProduct.update({ where: { id }, data });
  }

  hardDeleteProduct(orgId: string, id: string) {
    return this._products.model.viralProduct.deleteMany({
      where: { id, organizationId: orgId },
    });
  }

  // Watchdog sản phẩm bỏ rơi: job sản xuất chạy TRONG RAM backend (fire-and-
  // forget) nên restart/deploy giữa chừng là job chết mà DB vẫn 'processing'
  // vĩnh viễn — UI quay "Đang sản xuất…" không có nút cứu. Quá N phút không
  // nhúc nhích updatedAt (job sống luôn có heartbeat/checkpoint) → chuyển
  // 'error' để hiện nút "↻ Thử lại". updatedAt null (hàng cổ) xét theo createdAt.
  failStaleProducts(orgId: string, minutes = 45) {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000);
    return this._products.model.viralProduct.updateMany({
      where: {
        organizationId: orgId,
        status: 'processing',
        deletedAt: null,
        OR: [
          { updatedAt: { lt: cutoff } },
          { updatedAt: null, createdAt: { lt: cutoff } },
        ],
      },
      data: {
        status: 'error',
        error:
          'Bị ngắt giữa chừng (hệ thống khởi động lại trong lúc sản xuất) — bấm "↻ Thử lại" để chạy tiếp.',
      },
    });
  }

  // Heartbeat hàng đợi: chạm updatedAt các sản phẩm còn xếp hàng trong một mẻ
  // runProducts để watchdog failStaleProducts không giết oan job đang chờ lượt.
  touchProducts(ids: string[]) {
    if (!ids.length) return Promise.resolve(null as any);
    return this._products.model.viralProduct.updateMany({
      where: { id: { in: ids }, status: 'processing' },
      // ghi lại đúng giá trị cũ — @updatedAt vẫn nhảy theo mỗi lần update
      data: { status: 'processing' },
    });
  }

  // Đếm sản phẩm đang chạy — chặn dồn job khi bấm Sản xuất liên tục.
  countProcessingProducts(orgId: string) {
    return this._products.model.viralProduct.count({
      where: { organizationId: orgId, status: 'processing', deletedAt: null },
    });
  }

  // Bài chưa được AI chấm điểm (score null) — để chấm sau mỗi lần cào.
  unscored(orgId: string, limit = 60) {
    return this._posts.model.viralPost.findMany({
      where: { organizationId: orgId, deletedAt: null, score: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  setStatus(orgId: string, id: string, status: string) {
    return this._posts.model.viralPost.updateMany({
      where: { id, organizationId: orgId },
      data: { status },
    });
  }

  getById(orgId: string, id: string) {
    return this._posts.model.viralPost.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  // Đã thấy URL này chưa — check tombstone (BỀN qua purge, chuẩn hoá) + bảng
  // post (bài nhập tay trước khi có tombstone).
  async existsByUrl(orgId: string, url: string) {
    if (!url) return false;
    const norm = ViralRepository.normUrl(url);
    const seen = await this._seen.model.viralSeen.findFirst({
      where: { organizationId: orgId, url: norm },
      select: { id: true },
    });
    if (seen) return true;
    const found = await this._posts.model.viralPost.findFirst({
      where: { organizationId: orgId, url },
      select: { id: true },
    });
    return !!found;
  }

  // Ghi tombstone URL (bỏ qua trùng) — gọi khi tạo bài có URL.
  markSeen(orgId: string, url?: string | null) {
    const norm = ViralRepository.normUrl(url);
    if (!norm) return Promise.resolve(null);
    return this._seen.model.viralSeen
      .createMany({
        data: [{ organizationId: orgId, url: norm }],
        skipDuplicates: true,
      })
      .catch(() => null);
  }

  // Backfill tombstone từ bài đang có (chạy 1 lần lúc khởi động) — bài đã purge
  // trước khi có tombstone thì chịu, từ nay về sau không cào lại nữa.
  async backfillSeen() {
    const rows = await this._posts.model.viralPost.findMany({
      where: { url: { not: null } },
      select: { organizationId: true, url: true },
      take: 20000,
    });
    if (!rows.length) return 0;
    const data = rows
      .map((r) => ({
        organizationId: r.organizationId,
        url: ViralRepository.normUrl(r.url),
      }))
      .filter((r) => r.url);
    const res = await this._seen.model.viralSeen.createMany({
      data,
      skipDuplicates: true,
    });
    return res.count;
  }

  // Tín hiệu NHÂN KHẨU (kind='profile') N giờ gần nhất — nuôi persona động.
  profileSignalsSince(orgId: string, hours: number) {
    return this._posts.model.viralPost.findMany({
      where: {
        organizationId: orgId,
        kind: 'profile',
        deletedAt: null,
        createdAt: { gte: new Date(Date.now() - hours * 3600 * 1000) },
      },
      orderBy: [{ comments: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 30,
    });
  }

  // Chủ đề nóng N ngày (cho gợi ý ưu tiên cào của đối tác) — nhiều bài/nguồn nhất.
  hotTopicsSince(orgId: string, days: number, take = 8) {
    return this._topics.model.viralTopic.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        synthesizedAt: { not: null },
        createdAt: { gte: new Date(Date.now() - days * 24 * 3600 * 1000) },
      },
      orderBy: [{ postCount: 'desc' }, { score: { sort: 'desc', nulls: 'last' } }],
      take,
      select: { label: true, postCount: true, sourceCount: true, score: true },
    });
  }

  // Mọi org có dữ liệu viral — cho nhắc duyệt / digest tuần.
  orgIdsWithPosts() {
    return this._posts.model.viralPost.findMany({
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
  }

  // ── Bản tin tuần đã tạo (ViralReport — tab 📰 Bản tin) ───────────────────
  createReport(orgId: string, data: { kind: string; title: string; content: string; meta?: string }) {
    return this._reports.model.viralReport.create({
      data: {
        organizationId: orgId,
        kind: String(data.kind).slice(0, 20),
        title: String(data.title).slice(0, 300),
        content: String(data.content).slice(0, 20000),
        meta: data.meta ? String(data.meta).slice(0, 20000) : null,
      },
    });
  }

  listReports(orgId: string) {
    return this._reports.model.viralReport.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
      take: 40,
    });
  }

  deleteReport(orgId: string, id: string) {
    return this._reports.model.viralReport.deleteMany({
      where: { id, organizationId: orgId },
    });
  }

  getReport(orgId: string, id: string) {
    return this._reports.model.viralReport.findFirst({
      where: { id, organizationId: orgId },
    });
  }

  // Vá cờ vào meta JSON của bản tin (zaloPending/zaloSentAt...) — merge, không đè.
  async setReportMetaFlag(id: string, patch: Record<string, any>) {
    const r = await this._reports.model.viralReport.findFirst({ where: { id } });
    if (!r) return null;
    let meta: any = {};
    try {
      meta = JSON.parse(r.meta || '{}');
    } catch {
      /* meta hỏng — ghi mới */
    }
    return this._reports.model.viralReport.update({
      where: { id },
      data: { meta: JSON.stringify({ ...meta, ...patch }).slice(0, 20000) },
    });
  }

  // Bản tin đang CHỜ GỬI Zalo theo giờ hẹn (meta.zaloPending=true).
  pendingZaloReports(orgId: string) {
    return this._reports.model.viralReport.findMany({
      where: { organizationId: orgId, meta: { contains: '"zaloPending":true' } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
  }

  // Nguyên liệu bản tin tuần: tin báo nổi bật + bài đối thủ share cao (7 ngày).
  async weeklyBriefPosts(orgId: string) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [trend, winning] = await Promise.all([
      // Tin BÁO: bản tin mới chỉ dành ~15% cho báo → 25 bài là thừa, AI đọc
      // nhiều báo rồi viết nhiều báo. Cắt còn 10 tin điểm cao nhất.
      this._posts.model.viralPost.findMany({
        where: {
          organizationId: orgId,
          platform: 'news',
          createdAt: { gte: since },
          deletedAt: null,
          status: { not: 'skipped' },
        },
        orderBy: [{ score: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: 10,
        select: { title: true, sourceName: true, score: true, persona: true },
      }),
      // Bài MXH (FB/TikTok/YouTube…): đây mới là phần chính của bản tin →
      // 15 bài là quá ít để thấy chủ đề nào đang nóng. Nâng lên 60 và lấy ĐỦ
      // 4 chỉ số (trước chỉ có shares/views nên like/comment không tới AI).
      this._posts.model.viralPost.findMany({
        where: {
          organizationId: orgId,
          platform: { not: 'news' },
          kind: 'content', // loại tín hiệu nhân khẩu (purpose='profile')
          createdAt: { gte: since },
          deletedAt: null,
        },
        orderBy: [
          { shares: { sort: 'desc', nulls: 'last' } },
          { likes: { sort: 'desc', nulls: 'last' } },
          { views: { sort: 'desc', nulls: 'last' } },
        ],
        take: 60,
        select: {
          title: true,
          sourceName: true,
          sourceType: true,
          platform: true,
          shares: true,
          likes: true,
          comments: true,
          views: true,
          persona: true,
        },
      }),
    ]);
    return { trend, winning };
  }

  // CHỦ ĐỀ NÓNG trên MXH (bản tin tuần) — "1 content = nhiều bài": lấy thẳng
  // các cụm ViralTopic (đã gom bằng embeddings) hoạt động trong 7 ngày, xếp
  // theo tổng share. Trước đây bản tin KHÔNG hề đọc bảng này nên chỉ kể được
  // từng bài lẻ, không thấy được chủ đề nào đang được cả thị trường đẩy.
  // Kèm số nguồn khác nhau (sourceCount) — chủ đề nhiều nguồn cùng nói = thật
  // sự nóng, không phải 1 trang tự đẩy.
  async weeklyHotTopics(orgId: string) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const topics = await this._topics.model.viralTopic.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        status: { not: 'skipped' },
        OR: [{ lastSeenAt: { gte: since } }, { firstSeenAt: { gte: since } }],
      },
      orderBy: [
        { totalShares: 'desc' },
        { postCount: 'desc' },
        { sourceCount: 'desc' },
      ],
      take: 15,
      select: {
        id: true,
        label: true,
        platforms: true,
        postCount: true,
        sourceCount: true,
        totalShares: true,
        totalViews: true,
        topShare: true,
        score: true,
        persona: true,
        status: true,
      },
    });
    if (!topics.length) return [];
    // Ai đang ĐẨY chủ đề đó + like/comment (ViralTopic chỉ tổng hợp share/view)
    // → gom từ chính các bài thuộc cụm. Một truy vấn cho tất cả chủ đề.
    const posts = await this._posts.model.viralPost.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        topicId: { in: topics.map((t) => t.id) },
      },
      select: {
        topicId: true,
        title: true,
        sourceName: true,
        sourceType: true,
        platform: true,
        shares: true,
        likes: true,
        comments: true,
        views: true,
      },
    });
    const byTopic = new Map<string, any[]>();
    for (const p of posts) {
      const k = p.topicId as string;
      if (!byTopic.has(k)) byTopic.set(k, []);
      byTopic.get(k)!.push(p);
    }
    const eng = (p: any) =>
      (Number(p.shares) || 0) * 3 +
      (Number(p.likes) || 0) +
      (Number(p.comments) || 0) * 2 +
      (Number(p.views) || 0) / 1000;
    return topics.map((t) => {
      const list = byTopic.get(t.id) || [];
      const drivers: Record<string, { name: string; type: string; count: number; shares: number }> = {};
      let likes = 0;
      let comments = 0;
      for (const p of list) {
        likes += Number(p.likes) || 0;
        comments += Number(p.comments) || 0;
        const name = p.sourceName || '(không rõ nguồn)';
        if (!drivers[name])
          drivers[name] = { name, type: p.sourceType || 'other', count: 0, shares: 0 };
        drivers[name].count++;
        drivers[name].shares += Number(p.shares) || 0;
      }
      const top = list.slice().sort((a, b) => eng(b) - eng(a))[0] || null;
      return {
        ...t,
        totalLikes: likes,
        totalComments: comments,
        // nguồn đẩy mạnh nhất trước (nhiều bài → nhiều share)
        drivers: Object.values(drivers)
          .sort((a, b) => b.count - a.count || b.shares - a.shares)
          .slice(0, 5),
        top,
      };
    });
  }

  // ĐỘNG TĨNH ĐỐI THỦ + HỘI NHÓM (bản tin tuần): với các nguồn theo dõi
  // (type ∈ kol/school/group) → đếm bài cào được 7 ngày qua theo từng nguồn +
  // bài tương tác cao nhất. Khớp bài với nguồn qua sourceName.
  // 'group' (hội nhóm phụ huynh trên FB) TRƯỚC ĐÂY BỊ LOẠI khỏi truy vấn này,
  // nên toàn bộ insight hội nhóm không bao giờ tới được bản tin — nay đưa vào.
  async weeklyCompetitorActivity(orgId: string) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const TYPES = ['kol', 'school', 'group'];
    // Nguồn chính: bài TỰ MANG nhãn sourceType (đối tác cào gắn kol/school/
    // group) — không cần danh bạ ViralSource nữa. Danh bạ (nếu còn) chỉ là
    // fallback cho bài cũ chưa có nhãn.
    const comps = await this._sources.model.viralSource.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        type: { in: TYPES },
      },
      select: { name: true, type: true, platform: true },
    });
    const regType = new Map(comps.map((c) => [c.name, c.type]));
    const names = comps.map((c) => c.name).filter(Boolean);
    const posts = await this._posts.model.viralPost.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        createdAt: { gte: since },
        OR: [
          { sourceType: { in: TYPES } },
          ...(names.length ? [{ sourceName: { in: names } }] : []),
        ],
      },
      select: {
        sourceName: true,
        sourceType: true,
        title: true,
        platform: true,
        shares: true,
        likes: true,
        comments: true,
        views: true,
      },
    });
    if (!posts.length) return [];
    // gom theo tên nguồn — loại lấy từ nhãn trên bài, thiếu thì tra danh bạ
    const byName: Record<string, any> = {};
    const eng = (p: any) =>
      (Number(p.shares) || 0) * 3 +
      (Number(p.views) || 0) / 1000 +
      (Number(p.likes) || 0) +
      (Number(p.comments) || 0) * 2;
    for (const p of posts) {
      const name = p.sourceName || '(không rõ nguồn)';
      if (!byName[name]) {
        byName[name] = {
          name,
          type: p.sourceType || regType.get(name) || 'school',
          platform: p.platform,
          count: 0,
          totalShares: 0,
          totalLikes: 0,
          totalComments: 0,
          top: null as any,
        };
      }
      const b = byName[name];
      b.count++;
      b.totalShares += Number(p.shares) || 0;
      b.totalLikes += Number(p.likes) || 0;
      b.totalComments += Number(p.comments) || 0;
      if (!b.top || eng(p) > eng(b.top)) b.top = p;
    }
    // chỉ nguồn có hoạt động, xếp nhiều bài trước
    return Object.values(byName)
      .filter((b: any) => b.count > 0)
      .sort((a: any, b: any) => b.count - a.count || b.totalShares - a.totalShares);
  }

  // Số liệu 7 ngày cho digest tuần: cào mới / duyệt / sản phẩm.
  async weeklyDigest(orgId: string) {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const [crawled, approved, produced] = await Promise.all([
      this._posts.model.viralPost.count({
        where: { organizationId: orgId, createdAt: { gte: since } },
      }),
      this._posts.model.viralPost.count({
        where: {
          organizationId: orgId,
          status: 'approved',
          deletedAt: null,
          updatedAt: { gte: since },
        },
      }),
      this._products.model.viralProduct.count({
        where: { organizationId: orgId, createdAt: { gte: since } },
      }),
    ]);
    return { crawled, approved, produced };
  }

  // danh sách org có nguồn auto (cho scheduler cào định kỳ)
  orgIdsWithAutoSources() {
    return this._sources.model.viralSource.findMany({
      where: { auto: true, deletedAt: null },
      distinct: ['organizationId'],
      select: { organizationId: true },
    });
  }

  autoSources(orgId: string) {
    return this._sources.model.viralSource.findMany({
      where: { organizationId: orgId, auto: true, deletedAt: null },
    });
  }

  // Mọi nguồn còn sống — cho nút "Cào ngay" (người dùng bấm tay thì quét hết,
  // kể cả nguồn chưa bật lịch tự động).
  allSources(orgId: string) {
    return this._sources.model.viralSource.findMany({
      where: { organizationId: orgId, deletedAt: null },
    });
  }

  private num(v: any) {
    if (v === '' || v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
  }

  create(orgId: string, body: any) {
    // tombstone URL — dedup bền qua purge (không chờ kết quả, lỗi bỏ qua)
    if (body.url) this.markSeen(orgId, body.url);
    return this._posts.model.viralPost.create({
      data: {
        organizationId: orgId,
        kind: body.kind === 'profile' ? 'profile' : 'content',
        ...(body.status === 'skipped' ? { status: 'skipped' } : {}),
        platform: String(body.platform || 'facebook'),
        level: String(body.level || 'all'),
        title: String(body.title || 'Bài viral').slice(0, 300),
        sourceName: body.sourceName ? String(body.sourceName).slice(0, 120) : null,
        sourceType: ['kol', 'school', 'group', 'news', 'other'].includes(body.sourceType)
          ? body.sourceType
          : null,
        url: body.url ? String(body.url).slice(0, 800) : null,
        thumbnail: body.thumbnail ? String(body.thumbnail).slice(0, 800) : null,
        content: body.content ? String(body.content).slice(0, 5000) : null,
        shares: this.num(body.shares),
        likes: this.num(body.likes),
        comments: this.num(body.comments),
        views: this.num(body.views),
        origin: body.origin === 'auto' ? 'auto' : 'manual',
      },
    });
  }

  update(id: string, data: any) {
    return this._posts.model.viralPost.update({ where: { id }, data });
  }

  softDelete(orgId: string, id: string) {
    return this._posts.model.viralPost.updateMany({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  stats(orgId: string) {
    return Promise.all([
      this._posts.model.viralPost.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
      this._posts.model.viralPost.aggregate({
        where: { organizationId: orgId, deletedAt: null },
        _sum: { shares: true, clonedCount: true },
      }),
      this._sources.model.viralSource.count({
        where: { organizationId: orgId, deletedAt: null },
      }),
    ]);
  }

  // sources
  listSources(orgId: string) {
    return this._sources.model.viralSource.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  private static SOURCE_TYPES = ['kol', 'school', 'group', 'news', 'other'];
  private normType(t: any): string {
    const v = String(t || '').toLowerCase();
    return ViralRepository.SOURCE_TYPES.includes(v) ? v : 'other';
  }

  createSource(orgId: string, body: any) {
    return this._sources.model.viralSource.create({
      data: {
        organizationId: orgId,
        platform: String(body.platform || 'facebook'),
        name: String(body.name || 'Nguồn').slice(0, 120),
        url: body.url ? String(body.url).slice(0, 800) : null,
        type: this.normType(body.type),
        auto: !!body.auto,
      },
    });
  }

  setSourceType(orgId: string, id: string, type: string) {
    return this._sources.model.viralSource.updateMany({
      where: { id, organizationId: orgId },
      data: { type: this.normType(type) },
    });
  }

  deleteSource(orgId: string, id: string) {
    return this._sources.model.viralSource.updateMany({
      where: { id, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  updateSource(orgId: string, id: string, data: { type?: string; auto?: boolean }) {
    return this._sources.model.viralSource.updateMany({
      where: { id, organizationId: orgId },
      data,
    });
  }

  setSourceAuto(orgId: string, id: string, auto: boolean) {
    return this._sources.model.viralSource.updateMany({
      where: { id, organizationId: orgId },
      data: { auto },
    });
  }

  // ── GOM CỤM THEO CHỦ ĐỀ (embeddings) ─────────────────────────────────────
  // Bài chưa có vector nhúng — để tính embedding sau mỗi lần cào.
  unembedded(orgId: string, limit = 200) {
    return this._posts.model.viralPost.findMany({
      where: { organizationId: orgId, deletedAt: null, embedding: null, kind: 'content' },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, title: true, content: true },
    });
  }

  setEmbedding(id: string, embedding: string) {
    return this._posts.model.viralPost.update({
      where: { id },
      data: { embedding },
    });
  }

  // Bài đã có vector, chưa gán chủ đề, trong N ngày — nguyên liệu gom cụm.
  postsToCluster(orgId: string, days = 14, limit = 400) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    return this._posts.model.viralPost.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        topicId: null,
        embedding: { not: null },
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        sourceName: true,
        platform: true,
        shares: true,
        views: true,
        embedding: true,
        createdAt: true,
      },
    });
  }

  // GOM CỤM BẰNG AI — bài chưa gán chủ đề, TỪ mốc bắt đầu mẻ cào (cửa sổ = mỗi
  // lần cào). Không kèm điều kiện embedding (AI gom không cần vector).
  unclusteredSince(orgId: string, since: Date, limit = 300) {
    return this._posts.model.viralPost.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        topicId: null,
        kind: 'content', // tín hiệu nhân khẩu (profile) KHÔNG vào phễu content
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        sourceName: true,
        platform: true,
      },
    });
  }

  setPostsTopic(ids: string[], topicId: string) {
    return this._posts.model.viralPost.updateMany({
      where: { id: { in: ids } },
      data: { topicId },
    });
  }

  // Chủ đề còn sống trong N ngày (có centroid) — để gán bài mới vào cụm gần nhất.
  activeTopics(orgId: string, days = 14) {
    const since = new Date(Date.now() - days * 24 * 3600 * 1000);
    return this._topics.model.viralTopic.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        centroid: { not: null },
        OR: [{ lastSeenAt: { gte: since } }, { createdAt: { gte: since } }],
      },
      select: { id: true, centroid: true },
    });
  }

  createTopic(orgId: string, data: any) {
    return this._topics.model.viralTopic.create({
      data: {
        organizationId: orgId,
        label: String(data.label || '').slice(0, 300),
        centroid: data.centroid ? String(data.centroid) : null,
        origin: data.origin === 'manual' ? 'manual' : 'auto',
      },
    });
  }

  getTopic(orgId: string, id: string) {
    return this._topics.model.viralTopic.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });
  }

  updateTopic(id: string, data: any) {
    return this._topics.model.viralTopic.update({ where: { id }, data });
  }

  // Bài thuộc một chủ đề (bằng chứng) — hiển thị bên trong + nguyên liệu tổng hợp.
  topicPosts(orgId: string, topicId: string, limit = 60) {
    return this._posts.model.viralPost.findMany({
      where: { organizationId: orgId, topicId, deletedAt: null },
      orderBy: [{ shares: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: limit,
    });
  }

  // Tính lại số liệu tổng hợp của cụm từ các bài thành viên.
  async topicMemberStats(orgId: string, topicId: string) {
    const rows = await this._posts.model.viralPost.findMany({
      where: { organizationId: orgId, topicId, deletedAt: null },
      select: { sourceName: true, platform: true, shares: true, views: true },
    });
    const sources = new Set<string>();
    const platforms = new Set<string>();
    let totalShares = 0;
    let totalViews = 0;
    let topShare = 0;
    for (const r of rows) {
      if (r.sourceName) sources.add(r.sourceName.trim().toLowerCase());
      if (r.platform) platforms.add(r.platform);
      totalShares += r.shares || 0;
      totalViews += r.views || 0;
      if ((r.shares || 0) > topShare) topShare = r.shares || 0;
    }
    return {
      postCount: rows.length,
      // đếm theo NGUỒN khác nhau; nếu thiếu tên nguồn thì tính theo số bài
      sourceCount: sources.size || rows.length,
      platforms: Array.from(platforms),
      totalShares,
      totalViews,
      topShare,
    };
  }

  // Chủ đề đủ ngưỡng nhưng chưa tổng hợp — để AI viết content gốc + chấm. Ngưỡng
  // tính theo SỐ BÀI chung 1 content (postCount ≥ convergenceMin, mặc định 2).
  topicsToSynthesize(orgId: string, convergenceMin: number, limit = 12) {
    return this._topics.model.viralTopic.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        synthesizedAt: null,
        postCount: { gte: convergenceMin },
      },
      orderBy: [{ postCount: 'desc' }, { sourceCount: 'desc' }, { totalShares: 'desc' }],
      take: limit,
    });
  }

  // Danh sách chủ đề cho UI (tab Chờ duyệt / Đã duyệt / Lưu trữ).
  listTopics(
    orgId: string,
    filter: { status?: string; sort?: string; convergenceMin?: number }
  ) {
    const min = filter.convergenceMin ?? 3;
    const where: any = { organizationId: orgId };
    if (filter.status === 'archive') {
      where.OR = [
        { status: 'skipped', deletedAt: null },
        { deletedAt: { not: null } },
      ];
    } else if (
      filter.status === 'pending' ||
      filter.status === 'approved'
    ) {
      where.status = filter.status;
      where.deletedAt = null;
      // chỉ hiện chủ đề đã tổng hợp (đủ hội tụ) — cụm lẻ tẻ ẩn đi
      where.synthesizedAt = { not: null };
    } else {
      where.deletedAt = null;
      where.synthesizedAt = { not: null };
    }
    const orderBy =
      filter.sort === 'new'
        ? [{ lastSeenAt: { sort: 'desc' as const, nulls: 'last' as const } }, { createdAt: 'desc' as const }]
        : filter.sort === 'score'
        ? [{ score: { sort: 'desc' as const, nulls: 'last' as const } }, { sourceCount: 'desc' as const }]
        : // mặc định: nhiều BÀI chung nhất lên đầu, rồi nhiều nguồn + share cao
          [
            { postCount: 'desc' as const },
            { sourceCount: 'desc' as const },
            { totalShares: 'desc' as const },
          ];
    return this._topics.model.viralTopic.findMany({
      where,
      orderBy,
      take: 300,
    });
  }

  async topicStatusCounts(orgId: string) {
    const [rows, deletedCount] = await Promise.all([
      this._topics.model.viralTopic.groupBy({
        by: ['status'],
        where: { organizationId: orgId, deletedAt: null, synthesizedAt: { not: null } },
        _count: { _all: true },
      }),
      this._topics.model.viralTopic.count({
        where: { organizationId: orgId, deletedAt: { not: null } },
      }),
    ]);
    const by: Record<string, number> = { approved: 0, pending: 0, skipped: 0 };
    for (const r of rows) by[r.status] = r._count._all;
    return {
      pending: by.pending,
      approved: by.approved,
      archive: by.skipped + deletedCount,
    };
  }

  setTopicStatusMany(orgId: string, ids: string[], status: string) {
    return this._topics.model.viralTopic.updateMany({
      where: { id: { in: ids }, organizationId: orgId },
      data: { status, deletedAt: null },
    });
  }

  softDeleteTopics(orgId: string, ids: string[]) {
    return this._topics.model.viralTopic.updateMany({
      where: { id: { in: ids }, organizationId: orgId },
      data: { deletedAt: new Date() },
    });
  }

  // Reaper chủ đề: pending quá N ngày → bỏ qua (tránh ứ đọng như bài lẻ cũ).
  expireTopicsOlderThan(days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
    return this._topics.model.viralTopic.updateMany({
      where: {
        status: 'pending',
        deletedAt: null,
        synthesizedAt: { not: null },
        createdAt: { lt: cutoff },
      },
      data: { status: 'skipped' },
    });
  }
}
