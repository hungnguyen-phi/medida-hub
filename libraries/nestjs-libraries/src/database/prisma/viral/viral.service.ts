import { Injectable, OnModuleInit } from '@nestjs/common';
import { ViralRepository } from '@gitroom/nestjs-libraries/database/prisma/viral/viral.repository';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { GeminiService } from '@gitroom/nestjs-libraries/openai/gemini.service';
import { isQuotaLikeError } from '@gitroom/nestjs-libraries/openai/openrouter.error';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import {
  getViralConfig,
  hasBgm,
  bgmPath,
} from '@gitroom/nestjs-libraries/viral/viral.keys';
import { getPodcastConfig } from '@gitroom/nestjs-libraries/viral/podcast.keys';
import { normalizeLeadMagnets } from '@gitroom/nestjs-libraries/viral/viral.leadmagnet';
import {
  buildPodcastRss,
  RssEpisode,
} from '@gitroom/nestjs-libraries/viral/podcast.rss';
import {
  VIRAL_PERSONAS,
  VIRAL_RUBRIC,
  viralStatusForScore,
} from '@gitroom/nestjs-libraries/viral/viral.personas';
import {
  buildBlogPrompt,
  buildCarouselPrompt,
  buildChannelRoutingPrompt,
  buildPodcastPrompt,
  buildSiteRoutingPrompt,
  carouselSlidePrompt,
  ECOSYSTEM_SITES,
  ProduceInput,
} from '@gitroom/nestjs-libraries/viral/viral.produce.prompts';
import { VIRAL_DEFAULT_SOURCES } from '@gitroom/nestjs-libraries/viral/viral.default.sources';
import { VIRAL_PERSONA_SEEDS } from '@gitroom/nestjs-libraries/viral/viral.personas.seed';
import {
  getSkill,
  retireSkillOverride,
} from '@gitroom/nestjs-libraries/viral/viral.skills';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { blogHtmlToDocx } from '@gitroom/nestjs-libraries/viral/viral.docx';

// Entity HTML có tên hay gặp trong RSS tiếng Việt (báo VN dùng Latin-1 có dấu).
const RSS_ENTITIES: Record<string, string> = {
  yacute: 'ý', Yacute: 'Ý', aacute: 'á', Aacute: 'Á', agrave: 'à', Agrave: 'À',
  acirc: 'â', Acirc: 'Â', atilde: 'ã', Atilde: 'Ã', eacute: 'é', Eacute: 'É',
  egrave: 'è', Egrave: 'È', ecirc: 'ê', Ecirc: 'Ê', iacute: 'í', Iacute: 'Í',
  igrave: 'ì', Igrave: 'Ì', oacute: 'ó', Oacute: 'Ó', ograve: 'ò', Ograve: 'Ò',
  ocirc: 'ô', Ocirc: 'Ô', otilde: 'õ', Otilde: 'Õ', uacute: 'ú', Uacute: 'Ú',
  ugrave: 'ù', Ugrave: 'Ù', ndash: '–', mdash: '—', hellip: '…',
};

// Giải mã entity HTML (RSS báo VN hay để &yacute; &amp; &#233; ...).
export const decodeEntities = (s?: string | null): string => {
  if (!s) return s || '';
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&([A-Za-z]+);/g, (m, name) => RSS_ENTITIES[name] ?? m);
};

// ── Toán vector cho gom cụm theo chủ đề (embeddings) ─────────────────────────
function safeVec(s?: string | null): number[] | null {
  try {
    const v = JSON.parse(s || '');
    return Array.isArray(v) && v.length ? (v as number[]) : null;
  } catch {
    return null;
  }
}
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
function meanVec(vecs: number[][]): number[] {
  const n = vecs[0].length;
  const out = new Array(n).fill(0);
  for (const v of vecs) for (let k = 0; k < n; k++) out[k] += v[k] || 0;
  for (let k = 0; k < n; k++) out[k] /= vecs.length;
  return out;
}

// "Phát hiện" (Discover): CÀO nhiều nguồn → GOM CỤM theo chủ đề (embeddings) →
// chủ đề nhiều nguồn = "đáng hack" → TỔNG HỢP 1 content gốc → chấm điểm cấp chủ
// đề → viết lại + sản xuất. Thước đo chính: số nguồn hội tụ + lượt share.
@Injectable()
export class ViralService implements OnModuleInit {
  // storage cho sản phẩm sản xuất (ảnh infographic, mp3 podcast) — cùng
  // provider với media library (local/cloudflare theo env).
  private storage = UploadFactory.createStorage();

  constructor(
    private _repo: ViralRepository,
    private _openai: OpenaiService,
    private _gemini: GeminiService,
    private _media: MediaService,
    private _postsService: PostsService,
    private _integrationService: IntegrationService,
    private _notification: NotificationService
  ) {}

  // Scheduler cào định kỳ — CHỈ chạy ở tiến trình backend (main.ts set cờ),
  // không chạy ở orchestrator để tránh cào 2 lần.
  onModuleInit() {
    // Bản tin tuần đổi CHẤT (báo → mạng xã hội, thêm mục chủ đề/press) nên
    // prompt tuỳ chỉnh cũ lưu trong CONFIG_DIR phải nhường chỗ, nếu không
    // getSkill() vẫn trả bản cũ và deploy coi như không ăn. Chạy đúng 1 lần,
    // bản cũ được giữ lại dưới dạng .bak-social-first nếu cần xem lại.
    // Đặt TRƯỚC lệnh return bên dưới: máy không chạy crawler vẫn phải thu hồi.
    retireSkillOverride('skill-ban-tin-tuan', 'social-first');
    if (process.env.RUN_VIRAL_CRAWLER !== '1') return;
    const tick = async () => {
      const hours = getViralConfig().crawlEveryHours;
      if (!hours || hours <= 0) return;
      try {
        const orgs = await this._repo.orgIdsWithAutoSources();
        for (const { organizationId } of orgs) {
          await this.crawlAll(organizationId).catch(() => null);
        }
      } catch {
        /* bỏ qua vòng lỗi */
      }
    };
    // Chế độ "mỗi N giờ": chạy 1 lần sau 60s khi khởi động, rồi mỗi giờ kiểm
    // hạn. Giá trị 246 = lịch T2-4-6 19h VN — xử ở vòng 10 phút bên dưới.
    let lastRun = 0;
    const hourly = () => {
      const hours = getViralConfig().crawlEveryHours;
      return hours > 0 && hours !== 246 ? hours : 0;
    };
    setTimeout(() => {
      if (hourly()) tick().then(() => (lastRun = Date.now()));
    }, 60000);
    setInterval(() => {
      const hours = hourly();
      if (hours && Date.now() - lastRun >= hours * 3600000) {
        tick().then(() => (lastRun = Date.now()));
      }
    }, 3600000);

    // Lịch T2-4-6 19h VN (như cron n8n): cào → ĐỢI chấm điểm xong → bản tin
    // tuần + todo list gửi Zalo/email/in-app.
    let lastCrawl246Day = '';
    setInterval(async () => {
      if (getViralConfig().crawlEveryHours !== 246) return;
      const vn = new Date(Date.now() + 7 * 3600 * 1000);
      const day = vn.toISOString().slice(0, 10);
      // getUTCDay trên trục VN: T2=1, T4=3, T6=5
      if (![1, 3, 5].includes(vn.getUTCDay())) return;
      if (vn.getUTCHours() !== 19 || lastCrawl246Day === day) return;
      lastCrawl246Day = day;
      try {
        const orgs = await this._repo.orgIdsWithAutoSources();
        for (const { organizationId } of orgs) {
          await this.crawlAll(organizationId, false, true).catch(() => null);
          await this.sendWeeklyReport(organizationId, 'crawl').catch(() => null);
        }
      } catch {
        /* vòng lỗi — kỳ cào sau thử lại */
      }
    }, 10 * 60000);

    // Tự dọn Lưu trữ (bỏ qua + đã xóa) cũ hơn 7 ngày + reaper bài & CONTENT chờ
    // duyệt ứ quá 30 ngày → bỏ qua. Chạy sau 2 phút rồi mỗi 6h.
    const purge = () =>
      this._repo
        .expirePendingOlderThan(30)
        .catch(() => null)
        .then(() => this._repo.expireTopicsOlderThan(30))
        .catch(() => null)
        .then(() => this._repo.purgeArchiveOlderThan(7))
        .catch(() => null);
    setTimeout(purge, 120000);
    setInterval(purge, 6 * 3600000);

    // Backfill tombstone URL 1 lần lúc khởi động — dedup bền qua purge.
    setTimeout(() => this._repo.backfillSeen().catch(() => null), 90000);

    // Nhắc duyệt 9h sáng + digest tuần CN 20h (giờ VN) — notification in-app
    // (port cron "nhắc duyệt 9h" + "digest tuần CN 20h" của n8n, bỏ Telegram).
    let lastRemindDay = '';
    let lastDigestDay = '';
    let lastZaloSendDay = '';
    setInterval(async () => {
      const vn = new Date(Date.now() + 7 * 3600 * 1000); // giờ VN qua trục UTC
      const day = vn.toISOString().slice(0, 10);
      const hour = vn.getUTCHours();
      try {
        // Gửi bản tin Zalo theo GIỜ HẸN (reportSendHour) — các bản tin đã gom
        // chờ (meta.zaloPending) được gửi 1 lượt/ngày vào đúng giờ đó.
        const cfgZ = getViralConfig();
        if (
          cfgZ.reportSendHour >= 0 &&
          hour === cfgZ.reportSendHour &&
          lastZaloSendDay !== day
        ) {
          lastZaloSendDay = day;
          const orgsZ = await this._repo.orgIdsWithPosts();
          for (const { organizationId } of orgsZ) {
            const pend: any[] = await this._repo
              .pendingZaloReports(organizationId)
              .catch(() => [] as any[]);
            for (const r of pend) {
              await this.sendReportToRecipients(r.content, undefined, r.title || undefined).catch(() => null);
              await this._repo
                .setReportMetaFlag(r.id, {
                  zaloPending: false,
                  zaloSentAt: new Date().toISOString(),
                })
                .catch(() => null);
            }
          }
        }
        if (hour === 9 && lastRemindDay !== day) {
          lastRemindDay = day;
          const orgs = await this._repo.orgIdsWithPosts();
          for (const { organizationId } of orgs) {
            const c = await this._repo.statusCounts(organizationId);
            if (c.pending > 0) {
              await this._notification
                .inAppNotification(
                  organizationId,
                  'Phát hiện: bài chờ duyệt',
                  `🔔 Có ${c.pending} bài đang chờ duyệt trong trang Phát hiện — vào duyệt/bỏ để dây chuyền chạy tiếp.`,
                  false
                )
                .catch(() => null);
            }
          }
        }
        if (vn.getUTCDay() === 0 && hour === 20 && lastDigestDay !== day) {
          lastDigestDay = day;
          const orgs = await this._repo.orgIdsWithPosts();
          for (const { organizationId } of orgs) {
            // Tổng kết CN: AI viết bản tin tuần + todo → in-app + email + Zalo
            await this.sendWeeklyReport(organizationId, 'sunday').catch(() => null);
          }
        }
      } catch {
        /* vòng nhắc lỗi — thử lại lượt sau */
      }
    }, 10 * 60000);
  }

  async list(
    orgId: string,
    filter: { platform?: string; level?: string; sort?: string; status?: string }
  ) {
    const items = await this._repo.list(orgId, filter);
    // Giải mã entity ngay khi trả về (bài cũ cào trước bản vá vẫn hiện đúng)
    return items.map((p: any) => ({
      ...p,
      title: decodeEntities(p.title),
      content: decodeEntities(p.content),
    }));
  }

  async stats(orgId: string) {
    const [total, sums, sources] = await this._repo.stats(orgId);
    return {
      total,
      totalShares: sums._sum.shares || 0,
      cloned: sums._sum.clonedCount || 0,
      sources,
    };
  }

  // Tải trang web (link báo/blog/bài công khai) → rút og:title/og:image + text thô.
  private async fetchUrl(url: string): Promise<{
    title?: string;
    image?: string;
    text?: string;
  }> {
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; SocialHubBot/1.0)' },
        signal: AbortSignal.timeout(12000),
        redirect: 'follow',
      });
      const html = (await res.text()).slice(0, 400000);
      const pick = (re: RegExp) => html.match(re)?.[1]?.trim();
      const title =
        pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i) ||
        pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title/i) ||
        pick(/<title[^>]*>([^<]+)<\/title>/i);
      const image =
        pick(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i) ||
        pick(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/i);
      // text thô: bỏ script/style/tag
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 12000);
      return { title, image, text };
    } catch {
      return {};
    }
  }

  // YouTube: fetch trang chỉ ra mã JS nội bộ (ytcfg) → AI bó tay. Dùng oEmbed
  // (free, không cần key) lấy title/kênh/thumbnail; có key YouTube thì lấy thêm
  // view/like/comment qua Data API.
  private async youtubeMeta(url: string): Promise<{
    title?: string;
    author?: string;
    thumbnail?: string;
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    description?: string;
  } | null> {
    const idMatch = url.match(
      /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/
    );
    if (!idMatch && !/youtube\.com|youtu\.be/.test(url)) return null;
    const out: any = {};
    try {
      const oe = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (oe.ok) {
        const d: any = await oe.json();
        out.title = d.title;
        out.author = d.author_name;
        out.thumbnail = d.thumbnail_url;
      }
    } catch {
      /* oEmbed lỗi — thử tiếp Data API */
    }
    const key = getViralConfig().youtubeKey;
    const videoId = idMatch?.[1];
    if (key && videoId) {
      try {
        const st = await fetch(
          `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${videoId}&key=${key}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (st.ok) {
          const d: any = await st.json();
          const v = d.items?.[0];
          if (v) {
            out.title = out.title || v.snippet?.title;
            out.author = out.author || v.snippet?.channelTitle;
            out.thumbnail =
              out.thumbnail || v.snippet?.thumbnails?.high?.url;
            out.description = (v.snippet?.description || '').slice(0, 1500);
            out.views = Number(v.statistics?.viewCount) || null;
            out.likes = Number(v.statistics?.likeCount) || null;
            out.comments = Number(v.statistics?.commentCount) || null;
          }
        }
      } catch {
        /* thiếu stats vẫn dùng được oEmbed */
      }
    }
    return out.title ? out : null;
  }

  // Link Facebook: page HTML chặn bot → thử Graph og_object (app token) lấy
  // tiêu đề/mô tả/ảnh + share count của chính URL đó.
  private async fbOgObject(url: string): Promise<{
    title?: string;
    description?: string;
    image?: string;
    shares?: number | null;
  } | null> {
    const id = process.env.FACEBOOK_APP_ID;
    const secret = process.env.FACEBOOK_APP_SECRET;
    if (!id || !secret) return null;
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/?id=${encodeURIComponent(url)}&fields=og_object{title,description,image},engagement&access_token=${id}|${secret}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      const data: any = await res.json();
      const og = data?.og_object;
      if (!og && !data?.engagement) return null;
      return {
        title: og?.title,
        description: og?.description,
        image: og?.image?.[0]?.url || og?.image?.url,
        shares:
          typeof data?.engagement?.share_count === 'number'
            ? data.engagement.share_count
            : null,
      };
    } catch {
      return null;
    }
  }

  // Tra lượt share của MỘT URL qua Graph API (free, dùng app token sẵn có).
  // Chỉ chạy cho link web/báo — bài FB gốc không tra được (Meta không cho).
  private async fbShareCount(url: string): Promise<number | null> {
    const id = process.env.FACEBOOK_APP_ID;
    const secret = process.env.FACEBOOK_APP_SECRET;
    if (!id || !secret) return null;
    try {
      const res = await fetch(
        `https://graph.facebook.com/v20.0/?id=${encodeURIComponent(url)}&fields=engagement&access_token=${id}|${secret}`,
        { signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return null;
      const data: any = await res.json();
      return typeof data?.engagement?.share_count === 'number'
        ? data.engagement.share_count
        : null;
    } catch {
      return null;
    }
  }

  // Thêm bài viral: AI đọc (link/text/ảnh) → metadata → lưu.
  async capture(
    orgId: string,
    body: {
      url?: string;
      text?: string;
      images?: { base64: string; mediaType: string }[];
      platform?: string;
      level?: string;
    }
  ) {
    let pageTitle: string | undefined;
    let pageImage: string | undefined;
    let pageText: string | undefined;
    let ytStats: Awaited<ReturnType<typeof this.youtubeMeta>> = null;
    let fbOg: Awaited<ReturnType<typeof this.fbOgObject>> = null;
    let forcedPlatform: string | undefined;

    if (body.url) {
      if (/youtube\.com|youtu\.be/.test(body.url)) {
        // YouTube: trang render bằng JS, fetch thô chỉ ra ytcfg → dùng oEmbed/API
        ytStats = await this.youtubeMeta(body.url);
        if (ytStats) {
          forcedPlatform = 'youtube';
          pageTitle = ytStats.title;
          pageImage = ytStats.thumbnail;
          pageText = [ytStats.title, ytStats.author, ytStats.description]
            .filter(Boolean)
            .join('\n');
        }
      } else if (/facebook\.com|fb\.watch|fb\.com/.test(body.url)) {
        // Facebook: HTML chặn bot → hỏi Graph og_object trước, fetch làm dự phòng
        forcedPlatform = 'facebook';
        fbOg = await this.fbOgObject(body.url);
        const page = await this.fetchUrl(body.url);
        pageTitle = fbOg?.title || page.title;
        pageImage = fbOg?.image || page.image;
        pageText =
          [fbOg?.title, fbOg?.description].filter(Boolean).join('\n') ||
          page.text;
      } else {
        const page = await this.fetchUrl(body.url);
        pageTitle = page.title;
        pageImage = page.image;
        pageText = page.text;
      }
    }

    const ai = await this._openai
      .viralAnalyze({
        url: body.url,
        text: body.text || pageText,
        images: body.images,
      })
      .catch(() => null);

    // share của link web/báo: tra Graph API nếu AI không đọc được số
    let shares = ai?.shares ?? fbOg?.shares ?? null;
    if (shares == null && body.url) {
      shares = await this.fbShareCount(body.url);
    }

    const created = await this._repo.create(orgId, {
      platform: body.platform || forcedPlatform || ai?.platform || 'facebook',
      level: body.level || ai?.level || 'all',
      title: ai?.title || pageTitle || body.text?.slice(0, 120) || body.url || 'Bài viral',
      sourceName: ai?.sourceName || ytStats?.author || (body.url ? new URL(body.url).hostname : null),
      url: body.url || null,
      thumbnail: pageImage || null,
      content: ai?.content || pageText || body.text || null,
      shares,
      likes: ai?.likes ?? ytStats?.likes ?? null,
      comments: ai?.comments ?? ytStats?.comments ?? null,
      views: ai?.views ?? ytStats?.views ?? null,
      origin: 'manual',
    });

    // tạo chủ đề 1 nguồn + tổng hợp ngay (lỗi không chặn bắt bài)
    await this.makeManualTopic(orgId, created.id).catch(() => null);
    return this._repo.getById(orgId, created.id);
  }

  // ── ĐỐI TÁC CÀO (Claude Cowork qua Public API) ──────────────────────────
  // Nhận bài thô từ đối tác — khác capture tay ở 3 điểm: chặn URL trùng NGAY
  // TẠI CỬA, origin 'auto', KHÔNG tạo chủ đề 1 nguồn (bài chờ gom CHUNG cả mẻ
  // khi đối tác gọi finish).
  async capturePartner(
    orgId: string,
    body: {
      url?: string;
      text?: string;
      images?: { base64: string; mediaType: string }[];
      platform?: string;
      level?: string;
      purpose?: string;
      sourceType?: string;
    }
  ): Promise<{ id?: string; duplicated?: boolean; spam?: boolean; profile?: boolean }> {
    if (body.url && (await this._repo.existsByUrl(orgId, body.url))) {
      return { duplicated: true };
    }
    // TÍN HIỆU NHÂN KHẨU (purpose='profile') — bài group cư dân quanh trường,
    // không liên quan giáo dục trực tiếp: KHÔNG vào phễu content (không gom/
    // chấm/sản xuất), chỉ nuôi persona động ở mẻ enrich kế tiếp rồi tự dọn sau
    // 7 ngày. Không gọi AI khi nhận (regex bóc số theo mẫu chuẩn) — chi phí ~0.
    // Đối tác nên ghi "Khu vực: <tên khu>" trong text để AI enrich gán đúng
    // persona khu vực.
    if (body.purpose === 'profile') {
      const text = String(body.text || '').trim();
      if (!text) return { spam: true };
      const num = (re: RegExp) => {
        const m = text.match(re);
        return m ? parseInt(m[1].replace(/[.,]/g, ''), 10) : null;
      };
      const created = await this._repo.create(orgId, {
        platform: body.platform || 'facebook',
        level: 'all',
        kind: 'profile',
        status: 'skipped',
        sourceType: body.sourceType || 'group',
        title: text.split('\n')[0].slice(0, 120) || 'Tín hiệu dân cư',
        sourceName: (text.match(/Nguồn:\s*(.+)/i) || [])[1]?.slice(0, 120) || null,
        url: body.url || null,
        content: text,
        shares: num(/share:?\s*([\d.,]+)/i),
        likes: num(/like:?\s*([\d.,]+)/i),
        comments: num(/comment:?\s*([\d.,]+)/i),
        views: num(/view:?\s*([\d.,]+)/i),
        origin: 'auto',
      });
      return { id: created.id, profile: true };
    }
    // Lọc rác lớp 2 (đối tác đã lọc lớp 1): minigame/câu share/khuyến mãi.
    if (this.isSpam(body.text?.slice(0, 300))) {
      return { spam: true };
    }
    const ai = await this._openai
      .viralAnalyze({ url: body.url, text: body.text, images: body.images })
      .catch(() => null);
    const created = await this._repo.create(orgId, {
      platform: body.platform || ai?.platform || 'facebook',
      level: body.level || ai?.level || 'all',
      sourceType: body.sourceType || null,
      title:
        ai?.title || body.text?.slice(0, 120) || body.url || 'Bài đối tác cào',
      sourceName: ai?.sourceName || null,
      url: body.url || null,
      content: ai?.content || body.text || null,
      shares: ai?.shares ?? null,
      likes: ai?.likes ?? null,
      comments: ai?.comments ?? null,
      views: ai?.views ?? null,
      origin: 'auto',
    });
    return { id: created.id };
  }

  // Chống gọi finish chồng nhau (đối tác lỡ gọi 2 lần) — mỗi org 1 pipeline.
  private finishingOrgs = new Set<string>();

  // Kết mẻ đối tác: cào RSS/News/YouTube nội bộ → gom cụm CHUNG với bài đối
  // tác (cửa sổ 24h — bài gửi rải nhiều giờ trước finish vẫn vào mẻ) → tổng
  // hợp + chấm → làm giàu persona → bản tin phễu. Gọi ở chế độ NỀN (Cloudflare
  // cắt request ~100s nên controller không đợi).
  async finishPartnerBatch(orgId: string) {
    if (this.finishingOrgs.has(orgId)) return;
    this.finishingOrgs.add(orgId);
    try {
      await this.runPartnerBatch(orgId);
    } finally {
      this.finishingOrgs.delete(orgId);
    }
  }

  private async runPartnerBatch(orgId: string) {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const sources = await this._repo.autoSources(orgId);
    for (const s of sources) {
      try {
        if (s.platform === 'news') await this.crawlRss(orgId, s);
        else if (s.platform === 'gnews') await this.crawlGnews(orgId, s);
        else if (s.platform === 'youtube') await this.crawlYoutube(orgId, s);
        else await this.crawlApify(orgId, s);
      } catch {
        /* nguồn lỗi — bỏ qua, cào tiếp nguồn khác */
      }
    }
    await this.afterCrawl(orgId, since).catch(() => null);
    // Vét bài MỒ CÔI cửa sổ rộng 7 ngày (bài gửi sớm hơn 24h trước finish,
    // backlog gửi bù, bài test lẻ) — không bài nào kẹt vô hình mãi.
    await this.topicizeLeftovers(
      orgId,
      new Date(Date.now() - 7 * 24 * 3600 * 1000)
    ).catch(() => null);
    // Mẻ lớn: mỗi lượt tổng hợp tối đa 12 chủ đề — vét tiếp tới khi hết
    // (trần 8 lượt ≈ 108 content/mẻ, phòng lặp vô hạn).
    for (let i = 0; i < 8; i++) {
      const more = await this.synthesizeTopics(orgId).catch(() => 0);
      if (!more) break;
    }
    await this.sendWeeklyReport(orgId, 'crawl').catch(() => null);
  }

  // Gợi ý ưu tiên cào cho đối tác (vòng lặp phản hồi: insight → kỳ cào sau):
  // chủ đề nóng 7 ngày + insight persona động + todo bản tin gần nhất. KHÔNG
  // gọi AI — đọc từ dữ liệu đã chưng cất sẵn, gọi bao nhiêu lần cũng miễn phí.
  async partnerPriorities(orgId: string) {
    const [topics, personas, reports] = await Promise.all([
      this._repo.hotTopicsSince(orgId, 7, 8).catch(() => [] as any[]),
      this._repo.listPersonas(orgId).catch(() => [] as any[]),
      this._repo.listReports(orgId).catch(() => [] as any[]),
    ]);
    let todos: any[] = [];
    try {
      const meta = JSON.parse((reports as any[])[0]?.meta || '{}');
      todos = Array.isArray(meta.todos) ? meta.todos.slice(0, 8) : [];
    } catch {
      /* meta hỏng — bỏ qua todo */
    }
    return {
      hotTopics: (topics as any[]).map((t) => ({
        label: decodeEntities(t.label),
        posts: t.postCount,
        sources: t.sourceCount,
        score: t.score,
      })),
      personaFocus: (personas as any[]).map((p) => ({
        code: p.code,
        khuVuc: p.khuVuc,
        moiQuanTam: p.moiQuanTam,
        insights: p.insights,
      })),
      todos,
    };
  }

  // Mổ công thức (cache vào formula để không tốn token gọi lại).
  async formula(orgId: string, id: string) {
    const post = await this._repo.getById(orgId, id);
    if (!post) return null;
    if (post.formula) {
      try {
        return { post, formula: JSON.parse(post.formula) };
      } catch {
        /* cache hỏng → mổ lại */
      }
    }
    const formula = await this._openai.viralFormula({
      title: post.title,
      content: post.content,
      platform: post.platform,
      shares: post.shares,
    });
    if (formula) {
      await this._repo.update(id, { formula: JSON.stringify(formula) });
    }
    return { post, formula };
  }

  // Nhân bản: sinh bài mới theo công thức → BẢN NHÁP vào hàng chờ duyệt.
  async clone(orgId: string, id: string, integrationId: string) {
    const data = await this.formula(orgId, id);
    if (!data?.formula) return null;
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) return null;

    const content = await this._openai.viralClone({
      formula: data.formula,
      original: { title: data.post.title, platform: data.post.platform },
      target: {
        channelName: integration.name,
        platform: integration.providerIdentifier,
        level: data.post.level,
      },
    });

    const nextTime = await this._postsService.findFreeDateTime(orgId);
    await this._postsService.createPost(
      orgId,
      {
        date: nextTime + 'Z',
        order: makeId(10),
        shortLink: false,
        type: 'draft',
        tags: [],
        posts: [
          {
            settings: {
              __type: integration.providerIdentifier as any,
              title: '',
              tags: [],
              subreddit: [],
            },
            group: makeId(10),
            integration: { id: integration.id },
            value: [
              {
                id: makeId(10),
                delay: 0,
                content: content.replace(/\n/g, '\n\n'),
                image: [],
              },
            ],
          },
        ],
      } as any,
      'MCP' as any
    );

    await this._repo.update(id, { clonedCount: (data.post.clonedCount || 0) + 1 });
    return { ok: true, content };
  }

  delete(orgId: string, id: string) {
    return this._repo.softDelete(orgId, id);
  }

  // ── THAO TÁC HÀNG LOẠT ────────────────────────────────────────────────────
  async bulkStatus(orgId: string, ids: string[], status: string) {
    const valid = ['approved', 'pending', 'skipped'];
    if (!valid.includes(status)) throw new Error('Trạng thái không hợp lệ');
    const res = await this._repo.setStatusMany(orgId, ids, status);
    // DUYỆT TAY trên UI (thẻ bài) = duyệt CHỦ ĐỀ chứa bài đó → tự sản xuất
    // 1 bộ/chủ đề (không nhân theo số bài). Chạy nền — duyệt không chờ AI.
    if (
      status === 'approved' &&
      getViralConfig().autoProduce &&
      !getViralConfig().pauseProduce
    ) {
      this._repo
        .topicIdsOfPosts(orgId, ids)
        .then(async (tids) => {
          if (!tids.length) return;
          await this._repo.setTopicStatusMany(orgId, tids, 'approved');
          await this.autoProduceTopics(orgId, tids);
        })
        .catch(() => null);
    }
    return res;
  }

  bulkSoftDelete(orgId: string, ids: string[]) {
    return this._repo.softDeleteMany(orgId, ids);
  }

  // Clone hàng loạt → "Bài của mình". Chạy NỀN (mỗi bài 1 lần gọi AI) rồi thẻ
  // hiện dần ở tab Bài của mình. Trả số bài đưa vào hàng đợi.
  async bulkCloneToMine(orgId: string, ids: string[]): Promise<{ queued: number }> {
    const posts = await this._repo.getByIds(orgId, ids);
    const toClone = posts.filter((p: any) => !p.deletedAt);
    (async () => {
      for (const p of toClone) {
        await this.cloneToMine(orgId, p).catch(() => null);
      }
    })();
    return { queued: toClone.length };
  }

  // Viết lại 1 bài viral thành "Bài của mình" (tốt hơn) + chấm điểm lại.
  private async cloneToMine(orgId: string, post: any) {
    const personasText = VIRAL_PERSONAS.map(
      (p) => `- ${p.code} (${p.label}): ${p.profile}`
    ).join('\n');
    const res = await this._openai
      .viralRewriteAndScore({
        title: post.title,
        content: post.content,
        prevContent: post.aiContent,
        prevScore: post.score,
        persona: post.persona,
        personasText,
        rubric: getSkill('tieu-chi-cham-diem') || VIRAL_RUBRIC,
      })
      .catch(() => null);
    if (!res?.content) return null;
    const clone = await this._repo.createClone(orgId, {
      sourceId: post.id,
      title: post.title,
      content: res.content,
      persona: res.persona || post.persona,
      score: typeof res.score === 'number' ? Math.round(res.score) : null,
      sourceScore: post.score ?? null,
      scoreDetail: JSON.stringify({
        scores: res.scores || {},
        verdict: res.verdict || '',
        reason: res.reason || '',
      }),
    });
    await this._repo
      .update(post.id, { clonedCount: (post.clonedCount || 0) + 1 })
      .catch(() => null);
    return clone;
  }

  // ── BÀI CỦA MÌNH ──────────────────────────────────────────────────────────
  listClones(orgId: string) {
    return this._repo.listClones(orgId);
  }

  async regenerateClone(orgId: string, cloneId: string) {
    const clone = await this._repo.getClone(orgId, cloneId);
    if (!clone) return null;
    const personasText = VIRAL_PERSONAS.map(
      (p) => `- ${p.code} (${p.label}): ${p.profile}`
    ).join('\n');
    // nguồn để so: bản clone hiện tại (viết cho hơn nó)
    const source = clone.sourceId
      ? await this._repo.getById(orgId, clone.sourceId)
      : null;
    const res = await this._openai
      .viralRewriteAndScore({
        title: clone.title,
        content: source?.content || clone.content,
        prevContent: clone.content,
        prevScore: clone.score,
        persona: clone.persona,
        personasText,
        rubric: getSkill('tieu-chi-cham-diem') || VIRAL_RUBRIC,
      })
      .catch(() => null);
    if (!res?.content) return null;
    return this._repo.updateClone(cloneId, {
      content: res.content,
      persona: res.persona || clone.persona,
      score: typeof res.score === 'number' ? Math.round(res.score) : clone.score,
      scoreDetail: JSON.stringify({
        scores: res.scores || {},
        verdict: res.verdict || '',
        reason: res.reason || '',
      }),
    });
  }

  // Đăng "Bài của mình" → tạo BẢN NHÁP trên Lịch cho kênh đã chọn.
  async postClone(orgId: string, cloneId: string, integrationId: string) {
    const clone = await this._repo.getClone(orgId, cloneId);
    if (!clone) return null;
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) return null;
    const nextTime = await this._postsService.findFreeDateTime(orgId);
    await this._postsService.createPost(
      orgId,
      {
        date: nextTime + 'Z',
        order: makeId(10),
        shortLink: false,
        type: 'draft',
        tags: [],
        posts: [
          {
            settings: {
              __type: integration.providerIdentifier as any,
              title: '',
              tags: [],
              subreddit: [],
            },
            group: makeId(10),
            integration: { id: integration.id },
            value: [
              {
                id: makeId(10),
                delay: 0,
                content: clone.content.replace(/\n/g, '\n\n'),
                image: [],
              },
            ],
          },
        ],
      } as any,
      'MCP' as any
    );
    await this._repo.updateClone(cloneId, { status: 'posted' });
    return { ok: true };
  }

  deleteClone(orgId: string, cloneId: string) {
    return this._repo.hardDeleteClone(orgId, cloneId);
  }

  // Đẩy INFOGRAPHIC (bộ carousel) lên Lịch: bản nháp bài đăng kèm TOÀN BỘ ảnh
  // + caption album — người chỉnh giờ rồi bấm đăng trên Lịch như thường.
  async postProduct(orgId: string, productId: string, integrationId: string) {
    const p: any = await this._repo.getProduct(orgId, productId);
    if (!p || p.format !== 'infographic' || p.status !== 'done') return null;
    const integration = await this._integrationService.getIntegrationById(
      orgId,
      integrationId
    );
    if (!integration) return null;
    let meta: any = {};
    try {
      meta = JSON.parse(p.meta || '{}');
    } catch {
      /* meta hỏng */
    }
    // slides mới = [{id, path}] (id media để đính ảnh); bản cũ chỉ có path
    // string → không đính được, yêu cầu chạy lại để có id
    const images = (Array.isArray(meta.slides) ? meta.slides : [])
      .map((s: any) =>
        s && typeof s === 'object' && s.id ? { id: s.id, path: s.path } : null
      )
      .filter(Boolean) as { id: string; path: string }[];
    if (!images.length) return { needRetry: true };
    const nextTime = await this._postsService.findFreeDateTime(orgId);
    await this._postsService.createPost(
      orgId,
      {
        date: nextTime + 'Z',
        order: makeId(10),
        shortLink: false,
        type: 'draft',
        tags: [],
        posts: [
          {
            settings: {
              __type: integration.providerIdentifier as any,
              title: '',
              tags: [],
              subreddit: [],
            },
            group: makeId(10),
            integration: { id: integration.id },
            value: [
              {
                id: makeId(10),
                delay: 0,
                content: String(p.textContent || p.title || '').replace(/\n/g, '\n\n'),
                image: images,
              },
            ],
          },
        ],
      } as any,
      'MCP' as any
    );
    return { ok: true, images: images.length };
  }

  // ── LƯU TRỮ (xóa cứng khỏi DB) ────────────────────────────────────────────
  hardDelete(orgId: string, ids: string[]) {
    return this._repo.hardDelete(orgId, ids);
  }

  hardDeleteArchive(orgId: string) {
    return this._repo.hardDeleteArchive(orgId);
  }

  // ── CÀO TỰ ĐỘNG ─────────────────────────────────────────────────────────
  // Scheduler chỉ quét nguồn auto; nút "Cào ngay" (includeManual=true) quét
  // TẤT CẢ nguồn còn sống. Cào xong → AI chấm điểm các bài chưa chấm.
  // Việc NỀN sau cào: chấm điểm → làm giàu persona. Trả số bài đã chấm.
  // Sau khi cào: NHÚNG vector → GOM CỤM theo chủ đề → TỔNG HỢP + chấm những
  // chủ đề đủ ngưỡng hội tụ → làm giàu persona. (Thay cho chấm-từng-bài cũ.)
  private async afterCrawl(orgId: string, startedAt: Date): Promise<number> {
    // Hai cách gom (toggle ở Cài đặt): 'ai' = Claude gom cả mẻ vừa cào (cửa sổ =
    // mỗi lần cào) · 'embeddings' = vector cosine, gom xuyên nhiều lần cào.
    if (getViralConfig().clusterMode === 'embeddings') {
      await this.embedUnembedded(orgId).catch(() => null);
      await this.clusterRecent(orgId).catch(() => null);
    } else {
      await this.clusterByAI(orgId, startedAt).catch(() => null);
    }
    // MỌI bài đều thành CONTENT (user chốt: 1 content = nhiều bài HOẶC 1 bài):
    // bài không gom được vào cụm nào → mỗi bài 1 chủ đề 1-nguồn, vẫn đi qua
    // tổng hợp + chấm + phễu 90/70/3 như chủ đề nhiều nguồn.
    await this.topicizeLeftovers(orgId, startedAt).catch(() => null);
    const synthed = await this.synthesizeTopics(orgId).catch(() => 0);
    if (synthed > 0) await this.enrichPersonas(orgId).catch(() => null);
    return synthed;
  }

  // Bài lẻ chưa có chủ đề (dưới ngưỡng hội tụ) → chủ đề 1 bài. Trần 150/mẻ.
  private async topicizeLeftovers(orgId: string, since: Date): Promise<number> {
    const rows = await this._repo.unclusteredSince(orgId, since, 150);
    let made = 0;
    for (const p of rows as any[]) {
      const topic = await this._repo
        .createTopic(orgId, {
          label: decodeEntities(p.title).slice(0, 120),
          origin: 'auto',
        })
        .catch(() => null);
      if (!topic) continue;
      await this._repo.setPostsTopic([p.id], topic.id).catch(() => null);
      await this.recomputeTopic(orgId, topic.id).catch(() => null);
      made++;
    }
    return made;
  }

  // ── GOM CỤM BẰNG AI (cửa sổ = mỗi lần cào) ────────────────────────────────
  // Đẩy toàn bộ bài MỚI của mẻ cào (chưa gán chủ đề) cho Claude gom theo cùng sự
  // việc → tạo 1 chủ đề cho mỗi cụm ≥ convergenceMin bài. KHÔNG gộp vào chủ đề
  // của mẻ cào trước (mỗi mẻ độc lập — duyệt xong sản xuất là hết). Cụm dưới
  // ngưỡng để nguyên (topicId null) → không nổi lên duyệt.
  private async clusterByAI(orgId: string, since: Date): Promise<number> {
    const min = Math.max(2, getViralConfig().convergenceMin);
    const rows = await this._repo.unclusteredSince(orgId, since, 250);
    if (rows.length < 2) return 0;
    const idByIndex = rows.map((p: any) => p.id);
    const clusters = await this._openai.viralClusterBatch(
      rows.map((p: any, i: number) => ({
        i,
        title: decodeEntities(p.title),
        sourceName: p.sourceName,
        platform: p.platform,
      }))
    );
    if (!clusters) return 0;
    let made = 0;
    for (const c of clusters) {
      const ids = [...new Set(c.members)]
        .filter((i) => i >= 0 && i < idByIndex.length)
        .map((i) => idByIndex[i]);
      if (ids.length < min) continue; // dưới ngưỡng → chưa "đáng hack"
      const topic = await this._repo
        .createTopic(orgId, { label: c.label || '', origin: 'auto' })
        .catch(() => null);
      if (!topic) continue;
      await this._repo.setPostsTopic(ids, topic.id).catch(() => null);
      await this.recomputeTopic(orgId, topic.id).catch(() => null);
      made++;
    }
    return made;
  }

  // ── GOM CỤM THEO CHỦ ĐỀ (embeddings) ─────────────────────────────────────
  // Tính vector nhúng cho bài chưa có (tiêu đề + nội dung).
  private async embedUnembedded(orgId: string): Promise<number> {
    const posts = await this._repo.unembedded(orgId, 300);
    if (!posts.length) return 0;
    const texts = posts.map(
      (p: any) =>
        `${decodeEntities(p.title)}\n${decodeEntities(p.content || '').slice(0, 1000)}`
    );
    const vecs = await this._openai.embed(texts).catch(() => null);
    if (!vecs) return 0;
    let done = 0;
    for (let j = 0; j < posts.length; j++) {
      const v = vecs[j];
      if (v && Array.isArray(v)) {
        await this._repo.setEmbedding((posts[j] as any).id, JSON.stringify(v)).catch(() => null);
        done++;
      }
    }
    return done;
  }

  // Gán bài (đã có vector, chưa gán chủ đề) vào chủ đề gần nhất; còn lại gom
  // thành chủ đề mới. Ngưỡng độ giống lấy từ cấu hình (clusterThreshold).
  private async clusterRecent(orgId: string): Promise<number> {
    const T = getViralConfig().clusterThreshold;
    const rows = await this._repo.postsToCluster(orgId, 14, 500);
    const items = rows
      .map((p: any) => ({ id: p.id, vec: safeVec(p.embedding) }))
      .filter((x) => x.vec) as { id: string; vec: number[] }[];
    if (!items.length) return 0;
    const topics = (await this._repo.activeTopics(orgId, 14))
      .map((t: any) => ({ id: t.id, vec: safeVec(t.centroid) }))
      .filter((x) => x.vec) as { id: string; vec: number[] }[];

    const assign: Record<string, string[]> = {}; // topicId -> postIds
    const leftovers: { id: string; vec: number[] }[] = [];
    for (const it of items) {
      let best = -1;
      let bestId = '';
      for (const t of topics) {
        const s = cosine(it.vec, t.vec);
        if (s > best) {
          best = s;
          bestId = t.id;
        }
      }
      if (best >= T && bestId) (assign[bestId] ||= []).push(it.id);
      else leftovers.push(it);
    }
    // gom các bài lẻ với nhau (greedy) thành cụm mới
    const fresh: { vec: number[]; ids: string[] }[] = [];
    for (const it of leftovers) {
      let best = -1;
      let bi = -1;
      for (let k = 0; k < fresh.length; k++) {
        const s = cosine(it.vec, fresh[k].vec);
        if (s > best) {
          best = s;
          bi = k;
        }
      }
      if (best >= T && bi >= 0) {
        fresh[bi].ids.push(it.id);
        fresh[bi].vec = meanVec([fresh[bi].vec, it.vec]);
      } else {
        fresh.push({ vec: it.vec.slice(), ids: [it.id] });
      }
    }
    const touched = new Set<string>();
    for (const [tid, ids] of Object.entries(assign)) {
      await this._repo.setPostsTopic(ids, tid).catch(() => null);
      touched.add(tid);
    }
    for (const c of fresh) {
      const topic = await this._repo
        .createTopic(orgId, { label: '', centroid: JSON.stringify(c.vec), origin: 'auto' })
        .catch(() => null);
      if (!topic) continue;
      await this._repo.setPostsTopic(c.ids, topic.id).catch(() => null);
      touched.add(topic.id);
    }
    for (const tid of touched) await this.recomputeTopic(orgId, tid).catch(() => null);
    return touched.size;
  }

  // Tính lại số liệu tổng hợp + centroid của một chủ đề từ các bài thành viên.
  private async recomputeTopic(orgId: string, topicId: string): Promise<void> {
    const stats = await this._repo.topicMemberStats(orgId, topicId);
    if (!stats.postCount) return;
    const members = await this._repo.topicPosts(orgId, topicId, 100);
    const vecs = members
      .map((m: any) => safeVec(m.embedding))
      .filter(Boolean) as number[][];
    await this._repo.updateTopic(topicId, {
      postCount: stats.postCount,
      sourceCount: stats.sourceCount,
      totalShares: stats.totalShares,
      totalViews: stats.totalViews,
      topShare: stats.topShare || null,
      platforms: JSON.stringify(stats.platforms),
      lastSeenAt: new Date(),
      ...(vecs.length ? { centroid: JSON.stringify(meanVec(vecs)) } : {}),
    });
  }

  // ── TỔNG HỢP CHỦ ĐỀ (nhiều nguồn → 1 content gốc) + chấm điểm cấp chủ đề ───
  private async synthesizeTopics(orgId: string): Promise<number> {
    // min=1: chủ đề 1 bài cũng tổng hợp (mọi bài đều thành content); cụm nhiều
    // bài/nguồn vẫn được ưu tiên trước nhờ orderBy postCount/sourceCount.
    const topics = await this._repo.topicsToSynthesize(orgId, 1, 12);
    if (!topics.length) return 0;
    const personasText = await this.personasTextFor(orgId);
    const rubric = getSkill('tieu-chi-cham-diem') || VIRAL_RUBRIC;
    let done = 0;
    for (const t of topics as any[]) {
      const ok = await this.synthesizeOne(orgId, t, personasText, rubric).catch(() => false);
      if (ok) done++;
    }
    return done;
  }

  private async synthesizeOne(
    orgId: string,
    topic: any,
    personasText: string,
    rubric: string
  ): Promise<boolean> {
    const posts = await this._repo.topicPosts(orgId, topic.id, 40);
    if (!posts.length) return false;
    const res = await this._openai
      .viralSynthesizeTopic({
        posts: posts.map((p: any) => ({
          title: decodeEntities(p.title),
          sourceName: p.sourceName,
          platform: p.platform,
          shares: p.shares,
          content: decodeEntities(p.content || ''),
        })),
        personasText,
        rubric,
      })
      .catch(() => null);
    if (!res) return false;
    let score = Math.max(0, Math.min(100, Number(res.score) || 0));
    let persona = res.persona ? String(res.persona).slice(0, 30) : null;
    let aiContent = res.rewritten ? String(res.rewritten).slice(0, 4000) : null;
    let scores = res.scores;
    let verdict = res.verdict;
    let reason = res.reason;
    const label =
      String(res.label || '').slice(0, 300) ||
      decodeEntities((posts[0] as any).title).slice(0, 120);
    // VÒNG LẶP VIẾT LẠI (phễu 90/70/3, ngưỡng chỉnh trong Cài đặt): điểm nằm
    // giữa "tự bỏ" và "tự duyệt" → viết lại + chấm lại, GIỮ BẢN TỐT HƠN, tối
    // đa N vòng. Đạt ngưỡng duyệt → dừng sớm; hết vòng chưa đạt → chờ người.
    const cfg = getViralConfig();
    let rounds = 0;
    // ⏸① Phanh TỰ DUYỆT: bỏ vòng viết lại (mục đích của nó là đẩy điểm lên
    // ngưỡng tự duyệt — đang chặn duyệt thì viết lại chỉ tốn tiền AI vô ích).
    while (
      !cfg.pauseApprove &&
      rounds < cfg.rewriteMaxRounds &&
      score < cfg.autoApproveMin &&
      score >= cfg.autoSkipMax
    ) {
      rounds++;
      const syn: any = res.synthesis || {};
      const rw = await this._openai
        .viralRewriteAndScore({
          title: label,
          content:
            [syn.angle, ...(syn.agreedFacts || []), syn.whyItMatters]
              .filter(Boolean)
              .join('\n') || aiContent,
          prevContent: aiContent,
          prevScore: score,
          persona,
          personasText,
          rubric,
        })
        .catch(() => null);
      if (!rw || typeof rw.score !== 'number' || !rw.content) break;
      const newScore = Math.max(0, Math.min(100, Math.round(rw.score)));
      if (newScore > score) {
        score = newScore;
        aiContent = String(rw.content).slice(0, 4000);
        persona = rw.persona ? String(rw.persona).slice(0, 30) : persona;
        scores = rw.scores || scores;
        verdict = rw.verdict || verdict;
        reason = rw.reason || reason;
      }
    }
    // ⏸① Phanh TỰ DUYỆT: điểm cao đến mấy cũng đứng ở Chờ duyệt
    // (điểm thấp vẫn tự bỏ như thường để khỏi ngập rác).
    let status = viralStatusForScore(score, {
      approveMin: cfg.autoApproveMin,
      skipMax: cfg.autoSkipMax,
    });
    if (cfg.pauseApprove && status === 'approved') status = 'pending';
    await this._repo.updateTopic(topic.id, {
      label,
      synthesis: JSON.stringify(res.synthesis || {}).slice(0, 8000),
      persona,
      aiContent,
      score,
      scoreDetail: JSON.stringify({
        scores,
        verdict,
        reason,
        content_type: res.content_type,
        podcast_score: res.podcast_score,
        // 🧲 Mồi câu (lead magnet) nên làm kèm content này — bảng xếp hạng 6
        // loại, AI chấm lúc tổng hợp chủ đề.
        lead_magnets: normalizeLeadMagnets(res.lead_magnets),
        rounds, // số vòng viết lại đã chạy (đếm theo yêu cầu vận hành)
      }).slice(0, 6000),
      status,
      synthesizedAt: new Date(),
    });
    // Gắn persona + điểm xuống bài thành viên để enrichPersonas giữ tín hiệu
    // VOICE/TREND/WINNING (đọc từ scoredSince — bài có persona, updatedAt mới).
    if (persona) {
      await this._repo
        .tagMemberPersona(orgId, topic.id, persona, score)
        .catch(() => null);
    }
    // DUYỆT = TỰ SẢN XUẤT (tắt được trong Cài đặt): đạt ngưỡng tự duyệt → sản
    // xuất ngay định dạng AI đề xuất, sản phẩm chờ ở tab Sản phẩm (không tự
    // lên Lịch — người kéo tay theo quyết định vận hành).
    if (status === 'approved' && cfg.autoProduce && !cfg.pauseProduce) {
      await this.autoProduceTopics(orgId, [topic.id]).catch(() => null);
    }
    return true;
  }

  // ── 🧲 MỒI CÂU (LEAD MAGNET) ────────────────────────────────────────────
  // Chấm/chấm lại bảng xếp hạng mồi câu cho MỘT content đã có (chủ đề hoặc bài
  // lẻ). Dùng cho content chấm từ trước khi có tính năng này, hoặc khi muốn AI
  // gợi ý lại. CHỈ ghi khoá "lead_magnets" vào scoreDetail — điểm/persona/bản
  // viết lại giữ nguyên.
  async suggestLeadMagnets(
    orgId: string,
    id: string,
    source: 'topic' | 'post' = 'topic'
  ) {
    const row: any =
      source === 'topic'
        ? await this._repo.getTopic(orgId, id)
        : await this._repo.getById(orgId, id);
    if (!row) throw new Error('Không tìm thấy content.');

    // Chất liệu cho AI: bản viết sẵn + phần tổng hợp (chủ đề) hoặc nội dung gốc
    // (bài lẻ) — càng nhiều dữ kiện, mồi câu càng ít bịa.
    let material = decodeEntities(row.aiContent || '');
    if (source === 'topic') {
      let syn: any = {};
      try {
        syn = JSON.parse(row.synthesis || '{}');
      } catch {
        /* synthesis hỏng — chỉ dùng aiContent */
      }
      material = [
        material,
        syn.angle,
        ...(syn.agreedFacts || []),
        ...(syn.keyNumbers || []),
        ...(syn.uniqueAngles || []),
        syn.whyItMatters,
      ]
        .filter(Boolean)
        .join('\n');
    } else {
      material = [material, decodeEntities(row.content || '')]
        .filter(Boolean)
        .join('\n');
    }
    const title = decodeEntities(row.label || row.title || '');
    if (!title && !material.trim())
      throw new Error('Content chưa có nội dung để gợi ý mồi câu.');

    const raw = await this._openai.viralLeadMagnets({
      title,
      content: material,
      persona: row.persona,
      personaProfile: row.persona
        ? await this.personaProfileText(orgId, row.persona)
        : null,
    });
    const leadMagnets = normalizeLeadMagnets(raw);
    if (!leadMagnets.length)
      throw new Error('AI chưa gợi ý được mồi câu — bấm thử lại.');

    let detail: any = {};
    try {
      detail = JSON.parse(row.scoreDetail || '{}') || {};
    } catch {
      /* scoreDetail hỏng — viết lại từ đầu, chỉ mất phần hiển thị phụ */
    }
    detail.lead_magnets = leadMagnets;
    const scoreDetail = JSON.stringify(detail).slice(0, 6000);
    if (source === 'topic') await this._repo.updateTopic(id, { scoreDetail });
    else await this._repo.update(id, { scoreDetail });
    return { leadMagnets };
  }

  // Hồ sơ 1 chân dung (dạng text) — nạp kèm khi gợi ý mồi câu để AI biết nhóm
  // này chịu để lại SĐT đổi lấy thứ gì. Không tìm thấy thì bỏ qua.
  private async personaProfileText(orgId: string, code: string) {
    const list: any[] = await this.listPersonas(orgId).catch(() => []);
    const p = list.find((x) => x.code === code);
    if (!p) return null;
    return [p.label, p.moiQuanTam, p.tamLy, p.hanhVi, p.insights]
      .filter(Boolean)
      .join('\n');
  }

  // Chạy bù khi MỞ PHANH ② (Đã duyệt → Chờ đăng): thẻ được duyệt trong lúc
  // phanh đóng chưa từng có lệnh sản xuất — quét mọi topic approved, giao cho
  // autoProduceTopics (tự bỏ qua topic đã có sản phẩm nên không tạo trùng).
  async produceApprovedBacklog(orgId: string) {
    const cfg = getViralConfig();
    if (!cfg.autoProduce || cfg.pauseProduce) return { kicked: 0 };
    const ids = await this._repo.approvedTopicIds(orgId).catch(() => []);
    if (ids.length) this.autoProduceTopics(orgId, ids).catch(() => null);
    return { kicked: ids.length };
  }

  // Tự sản xuất cho chủ đề vừa duyệt: định dạng chính theo content_type AI đề
  // xuất (video → podcast; mặc định infographic) + podcast kèm nếu độ hợp ≥75.
  // Chủ đề đã có sản phẩm thì bỏ qua (duyệt lại không tạo trùng). Lỗi sản xuất
  // không chặn duyệt.
  private async autoProduceTopics(orgId: string, topicIds: string[]) {
    if (!topicIds.length) return;
    const had = new Set(
      await this._repo.topicIdsWithProducts(orgId, topicIds).catch(() => [])
    );
    // Gộp theo bộ định dạng → 1 lệnh produce/nhóm (1 chuỗi chạy tuần tự) thay
    // vì 1 chuỗi/chủ đề — duyệt hàng loạt không dội rate-limit AI.
    const groups = new Map<string, string[]>();
    for (const id of topicIds) {
      if (had.has(id)) continue;
      const t: any = await this._repo.getTopic(orgId, id).catch(() => null);
      if (!t || t.status !== 'approved') continue;
      let d: any = {};
      try {
        d = JSON.parse(t.scoreDetail || '{}');
      } catch {
        /* scoreDetail hỏng — dùng định dạng mặc định */
      }
      const primary =
        d.content_type === 'blog'
          ? 'blog'
          : d.content_type === 'video'
          ? 'podcast'
          : 'infographic';
      const formats = [primary];
      if ((d.podcast_score ?? 0) >= 75 && primary !== 'podcast')
        formats.push('podcast');
      const key = formats.join(',');
      groups.set(key, [...(groups.get(key) || []), id]);
    }
    for (const [key, ids] of groups) {
      try {
        await this.produce(orgId, {
          ids,
          source: 'topic',
          formats: key.split(','),
          bgm: true,
        });
      } catch (e: any) {
        // Không tạo được job (vd nghẽn hàng sản xuất): content VẪN nằm ở
        // "Đã duyệt" — báo chuông để người bấm 🏭 Sản xuất chạy lại sau.
        await this._notification
          .inAppNotification(
            orgId,
            'Phát hiện: chưa sản xuất được content đã duyệt',
            `⚠ ${ids.length} content đã duyệt nhưng chưa tạo được job sản xuất: ${String(e?.message || e).slice(0, 200)}. Thẻ vẫn ở tab "Đã duyệt" — chọn thẻ rồi bấm 🏭 Sản xuất để chạy lại.`,
            false
          )
          .catch(() => null);
      }
    }
  }

  // Nhập tay ("Thêm bài viral"): tạo chủ đề 1 nguồn + tổng hợp NGAY (bất kể
  // ngưỡng hội tụ) để thẻ hiện điểm + trạng thái như trước.
  private async makeManualTopic(orgId: string, postId: string): Promise<void> {
    const post = await this._repo.getById(orgId, postId);
    if (!post) return;
    const [vec] = await this._openai
      .embed([`${decodeEntities(post.title)}\n${decodeEntities(post.content || '').slice(0, 1000)}`])
      .catch(() => [null]);
    if (vec && Array.isArray(vec))
      await this._repo.setEmbedding(postId, JSON.stringify(vec)).catch(() => null);
    const topic = await this._repo.createTopic(orgId, {
      label: decodeEntities(post.title).slice(0, 120),
      centroid: vec && Array.isArray(vec) ? JSON.stringify(vec) : null,
      origin: 'manual',
    });
    await this._repo.setPostsTopic([postId], topic.id).catch(() => null);
    await this.recomputeTopic(orgId, topic.id).catch(() => null);
    const personasText = await this.personasTextFor(orgId);
    const rubric = getSkill('tieu-chi-cham-diem') || VIRAL_RUBRIC;
    await this.synthesizeOne(orgId, { id: topic.id }, personasText, rubric).catch(() => null);
  }

  async crawlAll(
    orgId: string,
    includeManual = false,
    awaitScoring = false // lịch T2-4-6 cần đợi chấm xong mới gửi bản tin
  ): Promise<{ added: number; scanned: number; scored: number }> {
    // Mốc bắt đầu mẻ cào — gom cụm AI chỉ xét bài tạo TỪ đây (cửa sổ = mỗi lần cào).
    const startedAt = new Date();
    const sources = includeManual
      ? await this._repo.allSources(orgId)
      : await this._repo.autoSources(orgId);
    let added = 0;
    for (const s of sources) {
      try {
        if (s.platform === 'news') added += await this.crawlRss(orgId, s);
        else if (s.platform === 'gnews')
          added += await this.crawlGnews(orgId, s);
        else if (s.platform === 'youtube')
          added += await this.crawlYoutube(orgId, s);
        else added += await this.crawlApify(orgId, s);
      } catch {
        /* nguồn lỗi — bỏ qua, cào tiếp nguồn khác */
      }
    }
    // Chấm điểm + enrich persona: mặc định chạy NỀN — không giữ request
    // (tunnel Cloudflare cắt ~100s); lịch T2-4-6 thì ĐỢI xong để gửi bản tin.
    if (awaitScoring) await this.afterCrawl(orgId, startedAt).catch(() => null);
    else this.afterCrawl(orgId, startedAt).catch(() => null);
    return { added, scanned: sources.length, scored: 0 };
  }

  // ── CHỦ ĐỀ cho UI (đơn vị chính của trang Phát hiện) ─────────────────────
  // Danh sách chủ đề đã tổng hợp — giải mã nhãn, parse synthesis + scoreDetail.
  async listTopics(
    orgId: string,
    filter: { status?: string; sort?: string }
  ) {
    const min = getViralConfig().convergenceMin;
    const rows = await this._repo.listTopics(orgId, { ...filter, convergenceMin: min });
    // đính trạng thái SẢN XUẤT vào từng content — thẻ hiện ❌ khi SX lỗi (thẻ
    // không bị xóa, người vào xử lý rồi thử lại)
    const prods = await this._repo
      .productsOfTopics(orgId, rows.map((r: any) => r.id))
      .catch(() => []);
    const byTopic = new Map<string, any[]>();
    for (const pr of prods as any[]) {
      byTopic.set(pr.topicId, [...(byTopic.get(pr.topicId) || []), pr]);
    }
    const shaped = rows.map((t: any) => ({
      ...this.shapeTopic(t),
      products: byTopic.get(t.id) || [],
    }));
    // Tab "Đã duyệt" chỉ giữ thẻ CHƯA SẢN XUẤT XONG (chưa có sản phẩm / đang
    // chạy / lỗi) — sản xuất đủ thì sản phẩm đã nằm bên "Chờ đăng", thẻ tự
    // rời tab cho đỡ rối (yêu cầu vận hành 13/07).
    if (filter.status === 'approved') {
      return shaped.filter(
        (t: any) =>
          !(
            t.products.length &&
            t.products.every((p: any) => p.status === 'done')
          )
      );
    }
    return shaped;
  }

  async topicStatusCounts(orgId: string) {
    const counts = await this._repo.topicStatusCounts(orgId);
    // khớp với listTopics: thẻ approved đã sản xuất XONG rời tab → trừ khỏi số
    if (counts.approved > 0) {
      const rows: any[] = await this._repo
        .listTopics(orgId, { status: 'approved', convergenceMin: 1 })
        .catch(() => [] as any[]);
      const prods: any[] = await this._repo
        .productsOfTopics(orgId, rows.map((r) => r.id))
        .catch(() => [] as any[]);
      const by = new Map<string, string[]>();
      for (const p of prods) by.set(p.topicId, [...(by.get(p.topicId) || []), p.status]);
      let fullyDone = 0;
      for (const [, sts] of by) {
        if (sts.length && sts.every((x) => x === 'done')) fullyDone++;
      }
      counts.approved = Math.max(0, counts.approved - fullyDone);
    }
    return counts;
  }

  // Chi tiết 1 chủ đề: content tổng hợp + các bài NGUỒN (bằng chứng).
  async topicDetail(orgId: string, id: string) {
    const t = await this._repo.getTopic(orgId, id);
    if (!t) return null;
    const posts = await this._repo.topicPosts(orgId, id, 60);
    const products = await this._repo.productsOfTopics(orgId, [id]).catch(() => []);
    return {
      topic: { ...this.shapeTopic(t), products },
      posts: posts.map((p: any) => ({
        id: p.id,
        platform: p.platform,
        title: decodeEntities(p.title),
        sourceName: p.sourceName,
        url: p.url,
        thumbnail: p.thumbnail,
        shares: p.shares,
        likes: p.likes,
        views: p.views,
        createdAt: p.createdAt,
      })),
    };
  }

  private shapeTopic(t: any) {
    let synthesis: any = null;
    let scoreDetail: any = null;
    try {
      synthesis = t.synthesis ? JSON.parse(t.synthesis) : null;
    } catch {
      /* synthesis hỏng */
    }
    try {
      scoreDetail = t.scoreDetail ? JSON.parse(t.scoreDetail) : null;
    } catch {
      /* scoreDetail hỏng */
    }
    let platforms: string[] = [];
    try {
      platforms = t.platforms ? JSON.parse(t.platforms) : [];
    } catch {
      /* platforms hỏng */
    }
    return {
      id: t.id,
      label: decodeEntities(t.label),
      synthesis,
      scoreDetail,
      platforms,
      sourceCount: t.sourceCount,
      postCount: t.postCount,
      totalShares: t.totalShares,
      totalViews: t.totalViews,
      topShare: t.topShare,
      score: t.score,
      persona: t.persona,
      aiContent: t.aiContent,
      status: t.status,
      origin: t.origin,
      lastSeenAt: t.lastSeenAt,
      createdAt: t.createdAt,
    };
  }

  async bulkTopicStatus(orgId: string, ids: string[], status: string) {
    if (status === 'hard-delete') return this._repo.hardDeleteTopics(orgId, ids);
    if (status === 'delete') return this._repo.softDeleteTopics(orgId, ids);
    const res = await this._repo.setTopicStatusMany(orgId, ids, status);
    // Duyệt chủ đề = tự sản xuất định dạng đề xuất (nền, tắt được ở Cài đặt).
    if (
      status === 'approved' &&
      getViralConfig().autoProduce &&
      !getViralConfig().pauseProduce
    ) {
      this.autoProduceTopics(orgId, ids).catch(() => null);
    }
    return res;
  }

  // "Viết lại thành bài của mình" từ 1 chủ đề: dùng luôn bản AI đã viết
  // (aiContent) khi tổng hợp — tạo ViralClone để đưa vào hàng "Chờ đăng".
  async cloneTopic(orgId: string, id: string) {
    const t = await this._repo.getTopic(orgId, id);
    if (!t) return null;
    let scoreDetail: string | null = null;
    try {
      scoreDetail = t.scoreDetail || null;
    } catch {
      /* giữ null */
    }
    return this._repo.createClone(orgId, {
      topicId: t.id,
      title: decodeEntities(t.label),
      content: t.aiContent || '',
      persona: t.persona,
      score: t.score,
      sourceScore: t.score,
      scoreDetail,
    });
  }

  // ── CHÂN DUNG KHÁCH HÀNG (persona động) ───────────────────────────────────
  // Org chưa có persona trong DB → seed 8 hồ sơ từ sheet Profiles n8n.
  private async ensurePersonas(orgId: string) {
    if ((await this._repo.countPersonas(orgId)) > 0) return;
    for (const s of VIRAL_PERSONA_SEEDS) {
      await this._repo.createPersona(orgId, s).catch(() => null);
    }
  }

  // Text hồ sơ cho prompt chấm điểm — đọc từ DB (đã enrich); DB trống thì
  // rơi về bộ tĩnh VIRAL_PERSONAS.
  private async personasTextFor(orgId: string): Promise<string> {
    await this.ensurePersonas(orgId);
    const rows = await this._repo.listPersonas(orgId);
    if (!rows.length) {
      return VIRAL_PERSONAS.map(
        (p) => `- ${p.code} (${p.label}): ${p.profile}`
      ).join('\n');
    }
    return rows
      .map(
        (p: any) =>
          `- ${p.code} (${p.label}) [${p.capHoc || ''} · ${p.khuVuc || ''}]:` +
          ` Mối quan tâm: ${p.moiQuanTam || ''} | Tâm lý: ${p.tamLy || ''}` +
          (p.insights ? ` | Insight content: ${p.insights}` : '')
      )
      .join('\n');
  }

  // Làm giàu hồ sơ từ bài đã chấm 24h qua — 3 tín hiệu: VOICE (group),
  // TREND (news), WINNING (share cao). Port [Prof] Aggregate của n8n.
  private async enrichPersonas(orgId: string): Promise<void> {
    const personas = await this._repo.listPersonas(orgId);
    if (!personas.length) return;
    const posts = await this._repo.scoredSince(orgId, 24);
    // Tín hiệu NHÂN KHẨU từ group cư dân (kind='profile', đối tác gửi) — không
    // phải content giáo dục nhưng nuôi phần ĐỘNG của persona khu vực.
    const area = await this._repo.profileSignalsSince(orgId, 24).catch(() => [] as any[]);
    if (!posts.length && !(area as any[]).length) return;
    const isGroup = (p: any) =>
      p.sourceType === 'group' || /group|hội/i.test(String(p.sourceName || ''));
    const isNews = (p: any) => String(p.platform) === 'news';
    const eng = (p: any) =>
      (Number(p.shares) || 0) * 3 +
      (Number(p.comments) || 0) * 2 +
      (Number(p.likes) || 0);
    const byProf: Record<
      string,
      { voice: { t: string; e: number }[]; trend: { t: string; e: number }[]; win: { t: string; e: number }[] }
    > = {};
    const cnt: Record<string, number> = {};
    for (const r of posts as any[]) {
      const c = r.persona;
      if (!c) continue;
      if (!byProf[c]) {
        byProf[c] = { voice: [], trend: [], win: [] };
        cnt[c] = 0;
      }
      cnt[c]++;
      const cap = String(r.content || r.title || '').replace(/\s+/g, ' ').slice(0, 220);
      if (isGroup(r))
        byProf[c].voice.push({ t: `"${cap}" (cmt=${r.comments || 0}, like=${r.likes || 0})`, e: eng(r) });
      else if (isNews(r)) byProf[c].trend.push({ t: `${r.title}${cap ? ` — ${cap.slice(0, 120)}` : ''}`, e: eng(r) });
      else byProf[c].win.push({ t: `[share=${r.shares || 0}] ${r.title} -> ${cap.slice(0, 140)}`, e: eng(r) });
    }
    const top = (arr: { t: string; e: number }[], n: number) =>
      arr.sort((a, b) => b.e - a.e).slice(0, n).map((x) => x.t).join('\n    ');
    const blocks = (personas as any[])
      .map((p) => {
        const s = byProf[p.code] || { voice: [], trend: [], win: [] };
        let st: any = {};
        try {
          st = JSON.parse(p.statics || '{}');
        } catch {
          /* statics hỏng — bỏ qua nhân khẩu */
        }
        return `### ${p.code} (${p.label})
NHAN KHAU (tinh - khong sua): hoc van ${st.hoc_van || '?'} | nghe ${st.nghe_nghiep || '?'} | thu nhap ${st.thu_nhap || '?'} | ${st.kinh_te || '?'}
HIEN TAI:
- moi_quan_tam: ${p.moiQuanTam || ''}
- tam_ly: ${p.tamLy || ''}
- hanh_vi: ${p.hanhVi || ''}
- insights: ${p.insights || '(chua co)'}
TIN HIEU MOI (${cnt[p.code] || 0} content):
  [VOICE - loi phu huynh that tu group, ${s.voice.length} tin]:
    ${top(s.voice, 8) || '(khong co)'}
  [TREND - chu de nong tu bao chi, ${s.trend.length} tin]:
    ${top(s.trend, 5) || '(khong co)'}
  [WINNING - content thang cua KOL/doi thu, ${s.win.length} tin]:
    ${top(s.win, 6) || '(khong co)'}`;
      })
      .join('\n\n');
    // Khối chung TIN HIỆU DÂN CƯ — AI tự gán cho persona khu vực tương ứng
    // (mỗi tin có dòng "Khu vực:" do đối tác ghi trong text).
    const areaBlock = (area as any[]).length
      ? `\n\n### TIN HIEU DAN CU / KHU VUC (tu group cu dan-cong nhan quanh truong — KHONG phai content giao duc; dung de lam giau nhan khau hoc/moi quan tam/loi song cho persona KHU VUC tuong ung, doc dong "Khu vực:" trong tung tin; vd Long Hau/Can Giuoc/Nha Be -> MN-CG/TH-CG):\n` +
        (area as any[])
          .slice(0, 20)
          .map(
            (r) =>
              `- "${String(r.content || r.title || '')
                .replace(/\s+/g, ' ')
                .slice(0, 240)}" (cmt=${r.comments || 0}, like=${r.likes || 0})`
          )
          .join('\n')
      : '';
    const out = await this._openai
      .viralUpdatePersonas(blocks + areaBlock)
      .catch(() => null);
    if (!Array.isArray(out)) return;
    for (const u of out) {
      if (!u?.profile_id) continue;
      await this._repo
        .updatePersonaDynamic(orgId, String(u.profile_id), {
          moiQuanTam: u.moi_quan_tam,
          tamLy: u.tam_ly,
          hanhVi: u.hanh_vi,
          insights: u.insights,
          addDataPoints: cnt[String(u.profile_id)] || 0,
        })
        .catch(() => null);
    }
  }

  listPersonas(orgId: string) {
    return this.ensurePersonas(orgId).then(() => this._repo.listPersonas(orgId));
  }

  // ── AI CHẤM ĐIỂM THEO CHÂN DUNG ─────────────────────────────────────────
  // Chấm các bài score=null theo lô 8 bài/lần gọi. Ngưỡng duyệt/bỏ lấy từ
  // Cài đặt (autoApproveMin / autoSkipMax — mặc định 90/70).
  async scoreUnscored(orgId: string, limit = 60): Promise<number> {
    const posts = await this._repo.unscored(orgId, limit);
    if (!posts.length) return 0;
    const personasText = await this.personasTextFor(orgId);
    const cfg = getViralConfig();
    // Rubric đọc ĐỘNG từ kho skill (tab 🧪 Công thức AI) — chỉnh là ăn ngay.
    const rubric = getSkill('tieu-chi-cham-diem') || VIRAL_RUBRIC;
    let scored = 0;
    for (let i = 0; i < posts.length; i += 8) {
      const batch = posts.slice(i, i + 8);
      const results = await this._openai
        .viralScoreBatch(
          batch.map((p, idx) => ({
            i: idx,
            title: p.title,
            content: p.content,
            platform: p.platform,
            shares: p.shares,
            likes: p.likes,
          })),
          personasText,
          rubric
        )
        .catch(() => null);
      if (!results) continue;
      for (const r of results) {
        const post = batch[r.i];
        if (!post || typeof r.score !== 'number') continue;
        const score = Math.max(0, Math.min(100, Math.round(r.score)));
        await this._repo
          .update(post.id, {
            score,
            persona: r.persona ? String(r.persona).slice(0, 30) : null,
            aiContent: r.rewritten ? String(r.rewritten).slice(0, 5000) : null,
            // biến thể cho các nhóm khác cùng cấp (multi-variant n8n K5/B)
            aiVariants: Array.isArray(r.variants)
              ? JSON.stringify(
                  r.variants
                    .filter((v: any) => v?.persona && v?.text)
                    .slice(0, 3)
                    .map((v: any) => ({
                      persona: String(v.persona).slice(0, 30),
                      text: String(v.text).slice(0, 3000),
                    }))
                ).slice(0, 10000)
              : null,
            scoreDetail: JSON.stringify({
              scores: r.scores || {},
              verdict: r.verdict || '',
              reason: r.reason || '',
              // gợi ý sản xuất (AI gán): loại + độ hợp podcast (n8n K5/D)
              content_type: ['blog', 'infographic', 'video'].includes(
                String(r.content_type)
              )
                ? r.content_type
                : 'blog',
              podcast_score:
                typeof r.podcast_score === 'number'
                  ? Math.max(0, Math.min(100, Math.round(r.podcast_score)))
                  : null,
              // 🧲 Mồi câu nên làm — bài lẻ chỉ có loại tốt nhất (bản gọn);
              // xếp hạng đủ 5 loại nằm ở cấp chủ đề.
              lead_magnets: normalizeLeadMagnets(r.lead_magnet),
            }).slice(0, 6000),
            // ⏸① Phanh TỰ DUYỆT: bài lẻ cũng không tự duyệt — đứng ở chờ duyệt.
            status: (() => {
              const st = viralStatusForScore(score, {
                approveMin: cfg.autoApproveMin,
                skipMax: cfg.autoSkipMax,
              });
              return cfg.pauseApprove && st === 'approved' ? 'pending' : st;
            })(),
          })
          .catch(() => null);
        scored++;
      }
    }
    return scored;
  }

  setStatus(orgId: string, id: string, status: string) {
    const valid = ['approved', 'pending', 'skipped'];
    if (!valid.includes(status)) throw new Error('Trạng thái không hợp lệ');
    return this._repo.setStatus(orgId, id, status);
  }

  statusCounts(orgId: string) {
    return this._repo.statusCounts(orgId);
  }

  setSourceAuto(orgId: string, id: string, auto: boolean) {
    return this._repo.setSourceAuto(orgId, id, auto);
  }

  // "🧹 Dọn nguồn" 1 nút: XÓA HẲN nguồn Facebook/IG/TikTok (đối tác Cowork cào
  // và tự gắn nhãn sourceType trên từng bài — danh bạ hết vai trò), xoá nguồn
  // TRÙNG, bật AUTO cho báo + Google News + YouTube (phần hệ thống tự cào).
  // Bấm lại vô hại.
  async cleanupSources(orgId: string) {
    const sources: any[] = await this._repo.allSources(orgId);
    // bản đã phân loại/bật auto đứng trước — khi trùng thì bản "tốt hơn" sống
    sources.sort(
      (a, b) =>
        (a.type === 'other' ? 1 : 0) - (b.type === 'other' ? 1 : 0) ||
        (b.auto ? 1 : 0) - (a.auto ? 1 : 0)
    );
    const norm = (s: string) =>
      String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const seen = new Set<string>();
    let removed = 0;
    let retyped = 0;
    let autoOn = 0;
    for (const s of sources) {
      // nguồn mạng xã hội = việc của đối tác cào → xoá khỏi danh sách theo dõi
      if (['facebook', 'instagram', 'tiktok'].includes(String(s.platform))) {
        await this._repo.deleteSource(orgId, s.id).catch(() => null);
        removed++;
        continue;
      }
      const key = s.url
        ? `u:${ViralRepository.normUrl(s.url)}`
        : `n:${s.platform}|${norm(s.name)}`;
      if (seen.has(key)) {
        await this._repo.deleteSource(orgId, s.id).catch(() => null);
        removed++;
        continue;
      }
      seen.add(key);
      const type = s.platform === 'news' || s.platform === 'gnews' ? 'news' : s.type;
      const patch: { type?: string; auto?: boolean } = {};
      if (type !== s.type) {
        patch.type = type;
        retyped++;
      }
      if (!s.auto) {
        patch.auto = true;
        autoOn++;
      }
      if (Object.keys(patch).length) {
        await this._repo.updateSource(orgId, s.id, patch).catch(() => null);
      }
    }
    return { removed, retyped, autoOn, autoOff: 0 };
  }

  setSourceType(orgId: string, id: string, type: string) {
    return this._repo.setSourceType(orgId, id, type);
  }

  // ── LỌC SPAM + TUỔI + NGƯỠNG VIRAL (port node "[Filter] Spam + Cũ + Viral")
  // Chặn minigame/câu share/khuyến mãi + bài quá cũ + bài ít tương tác TRƯỚC
  // khi lưu (đỡ rác tường + đỡ tốn tiền Claude chấm). News/GNews miễn ngưỡng
  // tương tác (RSS không có metric).
  private static MAX_AGE_DAYS = 45;
  private static SPAM_RES = [
    /minigame|mini game|give ?away/,
    /the le|the le chuong trinh|le trao giai/,
    /trung thuong|giai thuong|co cau giai|qua tang|tang qua|san qua|rinh qua/,
    /like ?(&|va|and|,) ?share|share ?(&|va|,) ?like/,
    /vong quay may man/,
    /tag \d* ?(nguoi|ban)\b/,
    /(comment|binh luan)[^.\n]{0,15}(de |nhan|trung)/,
    /(inbox|nhan tin)[^.\n]{0,12}(de |nhan)/,
    /khuyen mai|uu dai|giam gia|flash ?sale|sale ?off/,
    /dang ky ngay|dang ky nhan|nhanh tay/,
    /(share|chia se)[^.\n]{0,20}(diem|point|\+ ?\d|x ?\d)/,
    /moi (luot )?(share|chia se)/,
    /(han chot|deadline)[^.\n]{0,15}(tham gia|du thi|nhan|minigame)?/,
  ];

  // Bỏ dấu tiếng Việt để regex spam bắt được mọi cách gõ.
  private stripVn(s: any): string {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/\s+/g, ' ');
  }

  private isSpam(...texts: (string | null | undefined)[]): boolean {
    const t = this.stripVn(texts.filter(Boolean).join(' '));
    if (!t) return false;
    return ViralService.SPAM_RES.some((re) => re.test(t));
  }

  // Ngưỡng tương tác tối thiểu theo nền tảng (giá trị "THẬT" của n8n).
  private passesEngagement(
    platform: string,
    isGroup: boolean,
    m: { views?: number | null; likes?: number | null; shares?: number | null }
  ): boolean {
    const view = Number(m.views) || 0;
    const like = Number(m.likes) || 0;
    const share = Number(m.shares) || 0;
    if (platform === 'tiktok') return view >= 10000 || share >= 50;
    if (platform === 'facebook') {
      return isGroup ? like >= 20 || share >= 5 : like >= 50 || share >= 10;
    }
    return true; // news/gnews/youtube/instagram: miễn ngưỡng
  }

  // Bài quá cũ (>45 ngày) — parse mốc thời gian nếu nguồn có.
  private isTooOld(ts: any): boolean {
    if (!ts) return false;
    const t = new Date(ts).getTime();
    if (isNaN(t)) return false;
    return (Date.now() - t) / 86400000 > ViralService.MAX_AGE_DAYS;
  }

  // RSS (báo/blog) — FREE, không cần key. Lấy title/link/ảnh + tra share qua FB.
  private async crawlRss(orgId: string, source: any): Promise<number> {
    if (!source.url) return 0;
    let xml = '';
    try {
      const res = await fetch(source.url, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; SocialHubBot/1.0)' },
        signal: AbortSignal.timeout(12000),
      });
      xml = (await res.text()).slice(0, 500000);
    } catch {
      return 0;
    }
    const items = xml.split(/<item[\s>]/i).slice(1, 21);
    let added = 0;
    for (const it of items) {
      const grab = (re: RegExp) =>
        decodeEntities(
          (it.match(re)?.[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim()
        );
      const title = grab(/<title[^>]*>([\s\S]*?)<\/title>/i);
      const link =
        grab(/<link[^>]*>([\s\S]*?)<\/link>/i) ||
        (it.match(/<link[^>]*href=["']([^"']+)/i)?.[1] || '').trim();
      if (!title || !link) continue;
      if (this.isSpam(title)) continue; // tin PR/khuyến mãi trên RSS
      if (await this._repo.existsByUrl(orgId, link)) continue;
      const image =
        it.match(/<enclosure[^>]+url=["']([^"']+)/i)?.[1] ||
        it.match(/<media:content[^>]+url=["']([^"']+)/i)?.[1] ||
        it.match(/<img[^>]+src=["']([^"']+)/i)?.[1] ||
        null;
      const shares = await this.fbShareCount(link);
      await this._repo.create(orgId, {
        platform: 'news',
        level: 'all',
        title: title.slice(0, 250),
        sourceName: source.name,
        url: link,
        thumbnail: image,
        shares,
        origin: 'auto',
      });
      added++;
    }
    return added;
  }

  // YouTube Data API — FREE (key Google Cloud). Tìm theo từ khoá, xếp theo view.
  private async crawlYoutube(orgId: string, source: any): Promise<number> {
    const key = getViralConfig().youtubeKey;
    if (!key || !source.name) return 0;
    try {
      const s = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&order=viewCount&regionCode=VN&relevanceLanguage=vi&q=${encodeURIComponent(source.name)}&key=${key}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (!s.ok) return 0;
      const sd: any = await s.json();
      const ids = (sd.items || [])
        .map((i: any) => i.id?.videoId)
        .filter(Boolean);
      if (!ids.length) return 0;
      const st = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&id=${ids.join(',')}&key=${key}`,
        { signal: AbortSignal.timeout(10000) }
      );
      const std: any = await st.json();
      let added = 0;
      for (const v of std.items || []) {
        const url = `https://www.youtube.com/watch?v=${v.id}`;
        if (this.isSpam(v.snippet?.title)) continue; // video minigame/quảng cáo
        if (await this._repo.existsByUrl(orgId, url)) continue;
        await this._repo.create(orgId, {
          platform: 'youtube',
          level: 'all',
          title: v.snippet?.title,
          sourceName: v.snippet?.channelTitle,
          url,
          thumbnail:
            v.snippet?.thumbnails?.high?.url ||
            v.snippet?.thumbnails?.medium?.url,
          views: Number(v.statistics?.viewCount) || null,
          likes: Number(v.statistics?.likeCount) || null,
          comments: Number(v.statistics?.commentCount) || null,
          origin: 'auto',
        });
        added++;
      }
      return added;
    } catch {
      return 0;
    }
  }

  // Google News RSS theo TỪ KHOÁ — FREE. AI mở rộng từ khoá thành 6-7 truy vấn
  // cùng chủ đề (port node n8n "🔑 Mở rộng chủ đề" + "🌐 Cào News") rồi cào
  // news.google.com/rss/search từng truy vấn, dedup theo URL.
  private async crawlGnews(orgId: string, source: any): Promise<number> {
    const kw = String(source.name || '').trim();
    if (!kw) return 0;
    let queries = [kw];
    try {
      const more = await this._openai.viralExpandQueries(kw);
      if (more.length) queries = [...new Set([kw, ...more])].slice(0, 7);
    } catch {
      /* AI lỗi — vẫn cào với từ khoá gốc */
    }
    const clean = (s: string) =>
      decodeEntities(
        String(s || '')
          .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      );
    const xmls = await Promise.all(
      queries.map(async (q) => {
        try {
          const res = await fetch(
            `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:7d`)}&hl=vi&gl=VN&ceid=VN:vi`,
            {
              headers: { 'user-agent': 'Mozilla/5.0' },
              signal: AbortSignal.timeout(10000),
            }
          );
          return res.ok ? (await res.text()).slice(0, 400000) : '';
        } catch {
          return '';
        }
      })
    );
    let added = 0;
    for (const xml of xmls) {
      if (!xml) continue;
      const items = xml.split(/<item[\s>]/i).slice(1, 13); // ~12 tin/truy vấn
      for (const it of items) {
        const title = clean(it.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
        const link = (it.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '')
          .replace(/<!\[CDATA\[|\]\]>/g, '')
          .trim();
        if (!title || !link) continue;
        if (this.isSpam(title)) continue; // tin PR/khuyến mãi
        if (await this._repo.existsByUrl(orgId, link)) continue;
        const src =
          clean(it.match(/<source[^>]*>([\s\S]*?)<\/source>/i)?.[1] || '') ||
          'Google News';
        await this._repo.create(orgId, {
          platform: 'news',
          level: 'all',
          title,
          sourceName: `${src} · ${kw}`,
          url: link,
          origin: 'auto',
        });
        added++;
        if (added >= 30) return added; // trần mỗi nguồn/lần cào
      }
    }
    return added;
  }

  // Apify — TRẢ PHÍ (token). Cào trang FB/IG/TikTok → bài kèm lượt share.
  private async crawlApify(orgId: string, source: any): Promise<number> {
    const token = getViralConfig().apifyToken;
    if (!token || !source.url) return 0;
    // actor phù hợp theo nền tảng (mặc định phổ biến; user có thể đổi sau)
    const actor =
      source.platform === 'tiktok'
        ? 'clockworks~tiktok-scraper'
        : source.platform === 'instagram'
        ? 'apify~instagram-scraper'
        : 'apify~facebook-posts-scraper';
    const input =
      source.platform === 'tiktok'
        ? { profiles: [source.url], resultsPerPage: 10 }
        : source.platform === 'instagram'
        ? { directUrls: [source.url], resultsLimit: 10 }
        : { startUrls: [{ url: source.url }], resultsLimit: 10 };
    try {
      const run = await fetch(
        `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=90`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(100000),
        }
      );
      if (!run.ok) return 0;
      const rows: any[] = await run.json();
      let added = 0;
      const isGroup =
        /group/i.test(String(source.name || '')) ||
        /\/groups\//i.test(String(source.url || ''));
      for (const r of (rows || []).slice(0, 12)) {
        const url = r.url || r.postUrl || r.webVideoUrl || r.link;
        if (!url || (await this._repo.existsByUrl(orgId, url))) continue;
        // lọc spam / bài quá cũ / dưới ngưỡng tương tác (port filter n8n)
        if (this.isSpam(r.text, r.caption, r.title, r.desc)) continue;
        if (this.isTooOld(r.time || r.createTimeISO || r.createTime || r.timestamp)) continue;
        if (
          !this.passesEngagement(source.platform, isGroup, {
            views: r.views ?? r.playCount ?? r.videoViewCount,
            likes: r.likes ?? r.likesCount ?? r.diggCount,
            shares: r.shares ?? r.shareCount ?? r.sharesCount,
          })
        )
          continue;
        await this._repo.create(orgId, {
          platform: source.platform,
          level: 'all',
          title: r.text || r.caption || r.title || r.desc || '(không tiêu đề)',
          sourceName: source.name,
          url,
          thumbnail:
            r.thumbnailUrl || r.displayUrl || r.previewImageUrl || r.image || null,
          content: r.text || r.caption || null,
          shares:
            r.shares ?? r.shareCount ?? r.sharesCount ?? null,
          likes: r.likes ?? r.likesCount ?? r.diggCount ?? null,
          comments: r.comments ?? r.commentsCount ?? null,
          views: r.views ?? r.playCount ?? r.videoViewCount ?? null,
          origin: 'auto',
        });
        added++;
      }
      return added;
    } catch {
      return 0;
    }
  }

  // ── SẢN XUẤT (port WF-SanXuat n8n): blog / infographic / podcast ──────────
  // Từ bài đã duyệt (post) hoặc "Bài của mình" (clone) → tạo hàng ViralProduct
  // (processing) → chạy NỀN tuần tự → done/error. Đầu ra hiện ở tab Sản phẩm.

  private static PRODUCE_FORMATS = ['blog', 'infographic', 'podcast'];

  async produce(
    orgId: string,
    body: { ids?: string[]; source?: string; formats?: string[]; bgm?: boolean }
  ): Promise<{ queued: number }> {
    const ids = (body.ids || []).filter(Boolean).slice(0, 20);
    const formats = (body.formats || []).filter((f) =>
      ViralService.PRODUCE_FORMATS.includes(f)
    );
    if (!ids.length || !formats.length) return { queued: 0 };
    // dọn xác 'processing' bỏ rơi trước — kẻo chúng ăn oan trần 40 job
    await this._repo.failStaleProducts(orgId).catch(() => null);
    // chặn dồn job: tối đa 40 sản phẩm đang chạy / org
    const processing = await this._repo.countProcessingProducts(orgId);
    if (processing > 40) throw new Error('Đang sản xuất quá nhiều — đợi xong bớt rồi bấm tiếp.');

    const from = body.source === 'clone' ? 'clone' : body.source === 'topic' ? 'topic' : 'post';
    const created: any[] = [];
    for (const id of ids) {
      const src =
        from === 'clone'
          ? await this._repo.getClone(orgId, id)
          : from === 'topic'
          ? await this._repo.getTopic(orgId, id)
          : await this._repo.getById(orgId, id);
      if (!src) continue;
      for (const format of formats) {
        const row = await this._repo.createProduct(orgId, {
          postId: from === 'post' ? id : null,
          cloneId: from === 'clone' ? id : null,
          topicId: from === 'topic' ? id : null,
          format,
          topic: decodeEntities((src as any).label || (src as any).title),
        });
        // podcast: ghi Ý MUỐN trộn nhạc (bgmWant) vào meta ngay khi tạo job —
        // TÁCH khỏi cờ kết quả 'bgm' (đã ghép hay chưa) để Thử lại/Tạo lại không
        // mất ý muốn. Mặc định BẬT: chỉ tắt khi frontend gửi bgm:false rõ ràng.
        if (format === 'podcast') {
          await this._repo
            .updateProduct(row.id, {
              meta: JSON.stringify({ bgmWant: body.bgm !== false }),
            })
            .catch(() => null);
        }
        created.push(row);
      }
    }
    // chạy nền — không giữ request (giống scoreUnscored)
    if (created.length) {
      this.runProducts(orgId, created.map((p) => p.id)).catch(() => null);
    }
    return { queued: created.length };
  }

  // Chạy tuần tự từng sản phẩm (tránh dội rate-limit Claude/Gemini/MiniMax).
  private async runProducts(orgId: string, productIds: string[]) {
    const failed: string[] = [];
    for (let i = 0; i < productIds.length; i++) {
      const pid = productIds[i];
      // heartbeat: chạm updatedAt cả phần đuôi hàng đợi để watchdog
      // failStaleProducts biết mẻ này còn sống, không giết oan job đang chờ
      await this._repo.touchProducts(productIds.slice(i)).catch(() => null);
      const product = await this._repo.getProduct(orgId, pid).catch(() => null);
      if (!product || product.status !== 'processing') continue;
      try {
        await this.produceOne(orgId, product);
      } catch (e: any) {
        // 800: lỗi carousel nay gồm cả lý do gốc + số slide đã lưu + hướng dẫn
        // key free-tier — cắt 500 là mất đúng phần người dùng cần đọc.
        const error = String(e?.message || e).slice(0, 800);
        failed.push(error);
        await this._repo
          .updateProduct(pid, { status: 'error', error })
          .catch(() => null);
      }
    }
    // SX lỗi: thẻ content GIỮ NGUYÊN ở "Đã duyệt", sản phẩm lỗi nằm tab Chờ
    // đăng + badge ❌ trên thẻ — báo chuông 1 lần/mẻ để người vào xử lý rồi bấm
    // "Thử lại". Gợi ý "hết hạn mức" CHỈ gắn khi lý do thật sự có dáng dấp
    // quota/hết tiền (429/402/credit…) — lỗi khác (vd OpenRouter không có
    // provider khả dụng) phải giữ nguyên nguyên nhân thật, không quy về quota.
    if (failed.length) {
      const reason = failed[0].slice(0, 300);
      const hint = isQuotaLikeError(reason)
        ? 'Thường do hết hạn mức AI (Claude/Gemini/MiniMax) — xử lý xong bấm "↻ Thử lại" trên sản phẩm lỗi.'
        : 'Xử lý theo đúng lý do trên rồi bấm "↻ Thử lại" trên sản phẩm lỗi.';
      await this._notification
        .inAppNotification(
          orgId,
          'Phát hiện: sản xuất thất bại',
          `❌ ${failed.length} sản phẩm lỗi — thẻ content vẫn giữ nguyên, KHÔNG bị xóa. Lý do: ${reason}. ${hint}`,
          false
        )
        .catch(() => null);
    }
  }

  // Nội dung nguồn → input prompt (chủ đề, định hướng, góc tiếp cận, nhóm).
  private async produceInput(orgId: string, product: any): Promise<ProduceInput | null> {
    if (product.topicId) {
      const t = await this._repo.getTopic(orgId, product.topicId);
      if (!t) return null;
      let syn: any = {};
      try {
        syn = JSON.parse(t.synthesis || '{}');
      } catch {
        /* synthesis hỏng — dùng aiContent */
      }
      let detail = '';
      try {
        detail = JSON.parse(t.scoreDetail || '{}')?.reason || '';
      } catch {
        /* scoreDetail hỏng — bỏ qua */
      }
      const brief = [
        syn.angle,
        syn.agreedFacts?.length ? 'Điểm đồng thuận: ' + syn.agreedFacts.join('; ') : '',
        syn.keyNumbers?.length ? 'Số liệu: ' + syn.keyNumbers.join('; ') : '',
        syn.quotes?.length ? 'Trích dẫn: ' + syn.quotes.join(' | ') : '',
        syn.uniqueAngles?.length ? 'Góc lạ: ' + syn.uniqueAngles.join('; ') : '',
      ]
        .filter(Boolean)
        .join('\n');
      return {
        id: product.id,
        topic: decodeEntities(t.label),
        idea: [t.aiContent, brief].filter(Boolean).join('\n\n') || t.label,
        detail: detail || syn.whyItMatters || '',
        category: t.persona || '',
      };
    }
    if (product.cloneId) {
      const c = await this._repo.getClone(orgId, product.cloneId);
      if (!c) return null;
      let detail = '';
      try {
        detail = JSON.parse(c.scoreDetail || '{}')?.reason || '';
      } catch {
        /* scoreDetail hỏng — bỏ qua góc tiếp cận */
      }
      return {
        id: product.id,
        topic: decodeEntities(c.title),
        idea: c.content || c.title,
        detail,
        category: c.persona || '',
      };
    }
    if (product.postId) {
      const p = await this._repo.getById(orgId, product.postId);
      if (!p) return null;
      let detail = '';
      try {
        detail = JSON.parse(p.scoreDetail || '{}')?.reason || '';
      } catch {
        /* scoreDetail hỏng — bỏ qua góc tiếp cận */
      }
      return {
        id: product.id,
        topic: decodeEntities(p.title),
        // ưu tiên bản AI viết lại (đã duyệt) — bám sát n8n (noi_dung_sx)
        idea: p.aiContent || decodeEntities(p.content) || decodeEntities(p.title),
        detail,
        category: p.persona || '',
        url: p.url || '',
      };
    }
    return null;
  }

  // Chấm 1 bài blog nên đăng trang nào (hệ sinh thái 4 website). Trả null nếu
  // AI không chắc / lỗi — nơi gọi tự quyết định bỏ qua.
  private async suggestSiteFor(x: {
    topic?: string;
    idea?: string;
    title?: string;
    meta_description?: string;
    tags?: string[] | string;
    category?: string;
  }): Promise<{ site: string; why: string; angle_note: string } | null> {
    const { system, user } = buildSiteRoutingPrompt(x);
    return this._openai.viralSuggestBlogSite(system, user, ECOSYSTEM_SITES);
  }

  // Chấm 1 bộ infographic nên đăng lên (những) KÊNH FACEBOOK nào đang kết nối.
  // Trả [] nếu không có kênh FB / AI không chọn được. Kèm tên kênh để hiện chip.
  private async suggestChannelsForOrg(
    orgId: string,
    x: { topic?: string; title?: string; caption?: string; category?: string }
  ): Promise<{ id: string; name: string; why: string }[]> {
    const list = await this._integrationService.getIntegrationsList(orgId);
    const fb = (list || [])
      .filter(
        (i: any) => i.providerIdentifier === 'facebook' && !i.disabled
      )
      .map((i: any) => ({ id: i.id, name: i.name }));
    if (!fb.length) return [];
    const { system, user } = buildChannelRoutingPrompt(x, fb);
    const picks = await this._openai.viralSuggestChannels(
      system,
      user,
      fb.map((c) => c.id)
    );
    const byId = new Map(fb.map((c) => [c.id, c.name]));
    return picks.map((p) => ({ id: p.id, name: byId.get(p.id) || '', why: p.why }));
  }

  // BACKFILL: chấm gợi ý kênh cho 1 sản phẩm ĐÃ SẢN XUẤT (nút "🌐 Gợi ý kênh" ở
  // các bài cũ chưa có). Blog → gợi ý website; infographic → gợi ý kênh FB.
  // Dựng đầu vào từ chính product (khỏi phụ thuộc bài nguồn đã có thể bị xóa).
  async suggestForProduct(orgId: string, id: string) {
    const product = await this._repo.getProduct(orgId, id);
    if (!product) throw new Error('Không tìm thấy sản phẩm.');
    let meta: any = {};
    try {
      meta = product.meta ? JSON.parse(product.meta) : {};
    } catch {
      meta = {};
    }

    if (product.format === 'blog') {
      // trích thân bài (bỏ thẻ HTML) làm ngữ cảnh chấm
      const excerpt = String(product.textContent || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1500);
      const site = await this.suggestSiteFor({
        topic: product.topic || product.title,
        idea: excerpt || meta.meta_description,
        title: product.title,
        meta_description: meta.meta_description,
        tags: meta.tags,
      });
      if (!site) throw new Error('AI chưa chấm được trang phù hợp — thử lại sau.');
      const nextMeta = {
        ...meta,
        suggestSite: site.site,
        suggestSiteWhy: site.why,
        suggestSiteAngle: site.angle_note,
      };
      await this._repo.updateProduct(id, {
        meta: JSON.stringify(nextMeta).slice(0, 3000),
      });
      return { ok: true, format: 'blog', ...site };
    }

    if (product.format === 'infographic') {
      const channels = await this.suggestChannelsForOrg(orgId, {
        topic: product.topic || product.title,
        title: product.title,
        caption: product.textContent,
      });
      if (!channels.length)
        throw new Error(
          'Chưa gợi ý được kênh — cần có kênh Facebook đang kết nối và nội dung phù hợp.'
        );
      const nextMeta = { ...meta, suggestChannels: channels };
      await this._repo.updateProduct(id, {
        meta: JSON.stringify(nextMeta).slice(0, 8000),
      });
      return { ok: true, format: 'infographic', channels };
    }

    throw new Error('Chỉ gợi ý kênh cho bài blog hoặc bộ infographic.');
  }

  private async produceOne(orgId: string, product: any) {
    const input = await this.produceInput(orgId, product);
    if (!input) throw new Error('Bài nguồn không còn (đã bị xóa?).');

    if (product.format === 'blog') {
      const { system, user } = buildBlogPrompt(input);
      const out = await this._openai.viralProduceBlog(system, user);
      if (!out?.body_html)
        throw new Error('AI trả JSON hợp lệ nhưng thiếu body_html — bấm Thử lại.');
      // Gợi ý kênh đăng theo hệ sinh thái 4 website — lượt gọi RIÊNG, lỗi thì
      // bỏ qua chứ KHÔNG làm hỏng bài đã viết xong.
      const site = await this.suggestSiteFor({
        topic: input.topic,
        idea: out.meta_description || input.idea,
        title: out.title,
        meta_description: out.meta_description,
        tags: out.tags,
        category: input.category,
      }).catch(() => null);
      await this._repo.updateProduct(product.id, {
        status: 'done',
        title: String(out.title || input.topic).slice(0, 300),
        textContent: String(out.body_html).slice(0, 60000),
        meta: JSON.stringify({
          slug: out.slug || 'blog',
          meta_description: out.meta_description || '',
          tags: Array.isArray(out.tags) ? out.tags.slice(0, 12) : [],
          ...(site
            ? {
                suggestSite: site.site,
                suggestSiteWhy: site.why,
                suggestSiteAngle: site.angle_note,
              }
            : {}),
        }).slice(0, 3000),
        error: null,
      });
      return;
    }

    if (product.format === 'infographic') {
      // BỘ CAROUSEL như n8n WF-SanXuat: Claude soạn bộ slide (bìa + thân +
      // CTA) → Gemini vẽ BÌA trước → vẽ từng slide thân KÈM ảnh bìa làm mẫu
      // (đồng bộ phong cách cả bộ) → lưu hết vào Media library. Thiếu 1 slide
      // = lỗi cả bộ (không giao album thiếu — giống n8n).
      // VẼ ĐẾN ĐÂU LƯU ĐẾN ĐÓ: mỗi slide xong ghi ngay checkpoint (kịch bản +
      // các slide đã vẽ) vào meta. Lỗi giữa chừng (hết hạn mức, rớt mạng) →
      // "Thử lại" vẽ TIẾP từ slide hỏng, dùng ĐÚNG kịch bản cũ và ĐÚNG ảnh bìa
      // cũ làm mẫu nên phong cách khớp bộ đang dở; không đốt lại slide đã có.
      // Muốn bộ hoàn toàn mới thì bấm "Tạo lại" (xoá checkpoint).
      let ck: any = {};
      try {
        ck = JSON.parse(product.meta || '{}');
      } catch {
        /* meta hỏng — coi như chưa có checkpoint, dựng lại từ đầu */
      }
      // Chỉ nhận slide cũ khi CÒN kịch bản cũ đi kèm: slide của kịch bản khác
      // thì thứ tự vô nghĩa và phong cách cũng đã khác.
      const oldStory = ck?.story?.slides?.length ? ck.story : null;
      let story = oldStory;
      if (!story) {
        const { system, user } = buildCarouselPrompt(input);
        story = await this._openai.viralProduceCarousel(system, user);
      }
      // Tối đa 15 slide như n8n — AI được dặn CHIA THÊM slide cho thoáng chữ
      // (ít chữ mỗi slide = ít lỗi chính tả khi Gemini render).
      const slides = (story.slides || []).filter((s) => s?.heading || s?.body).slice(0, 15);
      if (!slides.length)
        throw new Error('AI không trả slide nào — bấm Thử lại.');
      const style =
        String(story.style || '').trim() ||
        'hiện đại, ấm áp, màu pastel, font sans-serif tròn';
      const slideItems: { id: string; path: string }[] = oldStory
        ? (Array.isArray(ck.slides) ? ck.slides : [])
            .filter((s: any) => s?.id && s?.path)
            .slice(0, slides.length)
        : [];
      const checkpoint = () =>
        this._repo
          .updateProduct(product.id, {
            meta: JSON.stringify({
              ratio: '1:1',
              story,
              slides: slideItems,
              total: slides.length,
            }),
          })
          .catch(() => null);
      // Ghi kịch bản NGAY trước khi vẽ — hỏng ngay slide đầu vẫn còn kịch bản,
      // Thử lại khỏi tốn thêm một lượt Claude.
      await checkpoint();
      let coverB64: string | undefined;
      if (slideItems.length) {
        // Vẽ tiếp phải ĐÚNG PHONG CÁCH bộ dở → nạp lại ảnh bìa đã lưu làm mẫu.
        // Bìa bay mất thì thà vẽ lại cả bộ còn hơn giao album hai phong cách.
        coverB64 = await this._media
          .loadMediaBase64(slideItems[0].path)
          .catch(() => undefined);
        if (!coverB64) slideItems.length = 0;
      }
      for (let i = slideItems.length; i < slides.length; i++) {
        const prompt = carouselSlidePrompt(slides[i], i + 1, slides.length, style);
        // 3 nhịp thử/slide; 429 = đụng hạn mức → chờ theo retryDelay Gemini
        // gợi ý (mặc định 25s) thay vì 1.5s vô ích
        let b64: string | null = null;
        let lastErr: any = null;
        for (let a = 0; a < 3 && !b64; a++) {
          try {
            b64 = await this._gemini.generateImage(prompt, i > 0 ? coverB64 : undefined);
          } catch (e: any) {
            lastErr = e;
            const msg = String(e?.message || '');
            // key FREE TIER (limit 0) → thử lại vô nghĩa, báo thẳng
            if (/free_tier[^,]*,\s*limit:\s*0/i.test(msg)) break;
            const m = msg.match(/retry in\s*([\d.]+)s|retryDelay[^0-9]*(\d+)/i);
            // 503 = model quá tải phía Google; gemini.service đã chờ tới ~80s
            // trong lượt vừa rồi, nghỉ thêm 30s nữa mới đáng thử lượt kế.
            const wait = /429/.test(msg)
              ? Math.min((parseFloat(m?.[1] || m?.[2] || '25') + 3) * 1000, 65000)
              : /503/.test(msg)
              ? 30000
              : 2000;
            await new Promise((r) => setTimeout(r, wait));
          }
        }
        if (!b64) {
          const msg = String(lastErr?.message || 'Gemini không trả ảnh');
          const tier = /free_tier[^,]*,\s*limit:\s*0/i.test(msg)
            ? ' ⚠ KEY GEMINI ĐANG Ở FREE TIER (hạn mức ảnh = 0): tiền đã nạp nằm ở PROJECT KHÁC với project của key — vào aistudio.google.com/apikey tạo key mới trong project có billing rồi dán vào Cài đặt.'
            : /503|high demand|overloaded/i.test(msg)
            ? ' ⚠ MODEL ẢNH ĐANG QUÁ TẢI PHÍA GOOGLE (503) — không phải lỗi key hay hạn mức. Chờ vài phút rồi Thử lại; nếu nghẽn cả buổi thì vào Cài đặt đổi model ảnh sang Nano Banana (gemini-2.5-flash-image) cho nhẹ tải.'
            : '';
          const kept = i
            ? ` — ĐÃ LƯU ${i} slide đầu, bấm "Thử lại" là vẽ tiếp từ slide ${
                i + 1
              } (giữ nguyên phong cách bộ này).`
            : '';
          throw new Error(
            `Slide ${i + 1}/${slides.length} lỗi: ${msg.slice(0, 200)}${kept}${tier}`
          );
        }
        if (i === 0) coverB64 = b64;
        const file = await this.storage.uploadSimple(`data:image/png;base64,${b64}`);
        const saved = await this._media.saveFile(
          orgId,
          file.split('/').pop()!,
          file
        );
        slideItems.push({ id: saved.id, path: saved.path });
        await checkpoint(); // vẽ tới đâu lưu tới đó
        // giãn nhịp giữa các slide — model ảnh có hạn mức/phút thấp
        if (i < slides.length - 1) await new Promise((r) => setTimeout(r, 5000));
      }
      // Gợi ý (những) kênh Facebook nên đăng bộ ảnh này — lượt gọi RIÊNG, lỗi/
      // thiếu kênh thì bỏ qua, KHÔNG làm hỏng bộ ảnh đã vẽ xong.
      const channels = await this.suggestChannelsForOrg(orgId, {
        topic: input.topic,
        title: story.title,
        caption: story.fb_caption,
        category: input.category,
      }).catch(() => []);
      await this._repo.updateProduct(product.id, {
        status: 'done',
        title: String(story.title || input.topic).slice(0, 300),
        mediaPath: slideItems[0].path, // bìa — thẻ sản phẩm hiện ảnh này
        // caption đăng kèm album (hook + giá trị + CTA + hashtag)
        textContent: story.fb_caption
          ? String(story.fb_caption).slice(0, 5000)
          : null,
        // slides = [{id, path}]: id media để nút "Đăng lên Lịch" đính ảnh.
        // Xong bộ thì BỎ kịch bản checkpoint khỏi meta — nó chỉ để vẽ tiếp lúc
        // dở dang, giữ lại sẽ phình meta và có nguy cơ chạm trần cắt 8000.
        meta: JSON.stringify({
          ratio: '1:1',
          slides: slideItems,
          total: slideItems.length,
          ...(channels.length ? { suggestChannels: channels } : {}),
        }).slice(0, 8000),
        error: null,
      });
      return;
    }

    if (product.format === 'podcast') {
      const cfg = getViralConfig();
      if (!cfg.minimaxKey || !cfg.minimaxGroupId) {
        throw new Error(
          'Chưa có key MiniMax — vào Cài đặt (trang Phát hiện) nhập MiniMax API key + GroupId.'
        );
      }
      const { system, user } = buildPodcastPrompt(input);
      const script = await this._openai.viralProducePodcast(system, user);
      if (!script?.full_script)
        throw new Error('AI trả JSON hợp lệ nhưng thiếu full_script — bấm Thử lại.');
      // MiniMax TTS t2a_v2 (giọng đọc sách tiếng Việt, như n8n)
      const ttsRes = await fetch(
        `https://api.minimax.io/v1/t2a_v2?GroupId=${encodeURIComponent(cfg.minimaxGroupId)}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${cfg.minimaxKey}`,
          },
          body: JSON.stringify({
            // Model/giọng/tốc độ lấy từ Cấu hình → mục Podcast (rỗng = mặc định)
            model: cfg.minimaxModel || 'speech-02-hd',
            text: script.full_script,
            stream: false,
            language_boost: 'Vietnamese',
            output_format: 'url',
            voice_setting: {
              voice_id: cfg.minimaxVoiceId || 'Vietnamese_Audiobook_woman_v2',
              speed: Math.max(0.5, Math.min(2, cfg.minimaxSpeed || 1.2)),
              vol: 1,
              pitch: 0,
              emotion: 'calm',
            },
            audio_setting: {
              sample_rate: 32000,
              bitrate: 128000,
              format: 'mp3',
              channel: 1,
            },
          }),
          signal: AbortSignal.timeout(180000),
        }
      );
      const tts: any = await ttsRes.json().catch(() => null);
      if (tts?.base_resp?.status_code !== 0 || !tts?.data?.audio) {
        throw new Error(
          'TTS lỗi: ' + (tts?.base_resp?.status_msg || `HTTP ${ttsRes.status}`)
        );
      }
      // tải mp3 về rồi lưu qua storage (URL MiniMax hết hạn nhanh)
      const audioRes = await fetch(tts.data.audio, {
        signal: AbortSignal.timeout(180000),
      });
      if (!audioRes.ok) throw new Error(`Không tải được audio (HTTP ${audioRes.status}).`);
      let buf = Buffer.from(await audioRes.arrayBuffer());
      // trộn nhạc nền nếu job chọn + có file nhạc + có ffmpeg (lỗi → giọng thuần
      // nhưng GHI LÝ DO vào meta.bgmNote để chẩn đoán, không nuốt im lặng nữa)
      let bgmMixed = false;
      let bgmNote = '';
      // bgmWant = ý muốn (mới, tách khỏi cờ kết quả). Mặc định BẬT khi thiếu
      // trường (job/tập cũ, Tạo lại tập plain trước đây) — chỉ tắt khi = false rõ.
      let wantBgm = true;
      try {
        wantBgm = JSON.parse(product.meta || '{}')?.bgmWant !== false;
      } catch {
        /* meta hỏng — giữ mặc định bật */
      }
      if (!wantBgm) {
        bgmNote = 'đã bỏ tick ghép nhạc';
      } else if (!hasBgm()) {
        bgmNote = 'chưa upload file nhạc nền (viral-bgm.mp3)';
      } else {
        // truyền câu [[CLIMAX]] + script để nhạc dâng đúng đoạn cao trào
        const mixed = await this.mixBgm(
          buf,
          String((script as any).climax_quote || ''),
          String(script.full_script || '')
        ).catch((e: any) => {
          bgmNote = 'lỗi ffmpeg: ' + String(e?.message || e).slice(0, 200);
          return null;
        });
        if (mixed) {
          buf = mixed;
          bgmMixed = true;
        } else if (!bgmNote) {
          bgmNote = 'ffmpeg không tạo được bản trộn (kiểm tra ffmpeg/ffprobe trong PATH)';
        }
      }
      const file = await this.storage.uploadSimple(
        `data:audio/mpeg;base64,${buf.toString('base64')}`
      );
      const saved = await this._media.saveFile(
        orgId,
        file.split('/').pop()!,
        file
      );
      // bytes + durationSec lưu sẵn cho feed RSS (enclosure length là BẮT BUỘC
      // theo spec Spotify; duration đo ffprobe, hỏng thì ước từ est_minutes)
      const durationSec =
        (await this.probeDurationSec(buf).catch(() => null)) ??
        (script.est_minutes ? Math.round(script.est_minutes * 60) : null);
      await this._repo.updateProduct(product.id, {
        status: 'done',
        title: String(script.title || input.topic).slice(0, 300),
        textContent: String(script.full_script).slice(0, 20000),
        mediaPath: saved.path,
        meta: JSON.stringify({
          est_minutes: script.est_minutes || null,
          bgm: bgmMixed, // KẾT QUẢ: đã ghép nhạc hay chưa (để hiển thị)
          bgmWant: wantBgm, // Ý MUỐN: giữ lại cho Tạo lại
          bgmNote: bgmMixed ? '' : bgmNote,
          bytes: buf.length,
          durationSec,
        }),
        error: null,
      });
      return;
    }

    throw new Error('Định dạng không hỗ trợ.');
  }

  // Trộn nhạc nền vào giọng đọc bằng ffmpeg — CÔNG THỨC 2.0 (nền n8n "🎚️ Trộn
  // nhạc" + 4 nâng cấp studio; số n8n gốc ghi cạnh từng chỗ):
  //   GIỮ cấu trúc n8n: nhạc solo 6s đầu / 8s cuối, fade in 3s / out 5s, CAO
  //   TRÀO nhạc dâng ~+3.5dB tại câu AI đánh dấu [[CLIMAX]] (không khớp → auto
  //   75–90%), nhạc LẶP vô hạn khi voice dài hơn (-stream_loop -1).
  //   ① VOICE tiền xử lý: highpass 80Hz cắt ù + ĐO loudness rồi bù gain TĨNH về
  //      -16 LUFS (tuyến tính, không đổi sắc) → tập nào cũng duck đều nhau.
  //   ② DUCK MỀM: ratio 6, release 800ms (n8n 16/400 gây "bơm hơi" ở ngắt câu).
  //   ③ KHOÉT EQ nhạc -4dB quanh 2.5kHz (dải trí tuệ giọng nói) → nền nhạc nâng
  //      0.18 → 0.22 mà lời vẫn rõ (mẹo radio/broadcast).
  //   ④ LOUDNORM 2-PASS TUYẾN TÍNH về -14 LUFS / TP -1dB (đo premix → áp
  //      measured_* + linear=true; 1-pass là normalize ĐỘNG, dễ phập phồng).
  //      Premix ghi WAV để không nén mp3 hai lần. Đo lỗi → fallback 1-pass.
  //   Voice tách asplit 2 nhánh: [v1] kích duck, [v2] vào mix (ffmpeg cấm tái
  //   dùng 1 nhãn 2 lần — bản đầu dùng [v] 2 chỗ nên filter lỗi, luôn rơi về
  //   giọng thuần). Trả null nếu thiếu ffmpeg/lỗi → phát hành giọng thuần.
  private async mixBgm(
    voice: Buffer,
    climaxQuote = '',
    fullScript = ''
  ): Promise<Buffer | null> {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { execFile } = await import('child_process');
    const INTRO = 6, OUTRO = 8, FADEIN = 3, FADEOUT = 5;
    const MUSIC_BASE = 0.22; // n8n: 0.18 — nâng được nhờ khoét EQ ③
    const SC = 'threshold=0.03:ratio=6:attack=20:release=800'; // n8n: ratio=16:release=400
    const MUSIC_EQ = 'equalizer=f=2500:t=q:w=1.0:g=-4'; // ③ khoét dải 1–4kHz
    const VOICE_TARGET = -16; // ① LUFS đích của voice trước khi mix
    const BOOST = 0.5, RAMP = 2.5, C_START = 0.75, C_END = 0.9;
    const id = makeId(8);
    const vPath = path.join(os.tmpdir(), `viral-voice-${id}.mp3`);
    const pPath = path.join(os.tmpdir(), `viral-premix-${id}.wav`);
    const oPath = path.join(os.tmpdir(), `viral-mix-${id}.mp3`);
    // loudnorm print_format=json in kết quả đo ra STDERR ngay cả khi exit 0
    // → resolve gộp cả stdout lẫn stderr để bóc được JSON.
    const run = (cmd: string, args: string[], timeout = 180000) =>
      new Promise<string>((resolve, reject) => {
        execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) =>
          err
            ? reject(new Error(String(stderr || err.message).slice(0, 300)))
            : resolve(String(stdout) + '\n' + String(stderr))
        );
      });
    // bóc khối JSON CUỐI CÙNG trong output (loudnorm in ra stderr, SAU nó vẫn
    // còn log đuôi → phải cắt đúng từ '{' tới '}' — JSON loudnorm phẳng, không
    // có ngoặc lồng; parse cả đuôi sẽ văng "Extra data" và mất số đo).
    const lastJson = (s: string): any => {
      const i = s.lastIndexOf('{');
      if (i < 0) return null;
      const e = s.indexOf('}', i);
      if (e < 0) return null;
      try {
        return JSON.parse(s.slice(i, e + 1));
      } catch {
        return null;
      }
    };
    try {
      fs.writeFileSync(vPath, voice);
      // thời lượng voice → tổng = intro + voice + outro
      const probe = await run('ffprobe', [
        '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', vPath,
      ]);
      const dur = parseFloat(probe.trim());
      if (!Number.isFinite(dur) || dur <= 0) return null;
      // ① đo loudness voice → bù gain TĨNH về VOICE_TARGET (kẹp ±12dB an toàn)
      let vGain = 0;
      try {
        const m = await run('ffmpeg', [
          '-hide_banner', '-i', vPath,
          '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
          '-f', 'null', '-',
        ]);
        const inI = parseFloat(lastJson(m)?.input_i);
        if (Number.isFinite(inI)) {
          vGain = Math.max(-12, Math.min(12, VOICE_TARGET - inI));
        }
      } catch {
        /* không đo được → giữ gain 0 */
      }
      const total = Math.round((INTRO + dur + OUTRO) * 100) / 100;
      const fadeOutStart = Math.max(0, total - FADEOUT).toFixed(2);
      // Cao trào: vị trí câu trích ≈ tỷ lệ ký tự trong script (như n8n);
      // không có/không khớp câu → auto 75–90% thời lượng voice.
      let cs = C_START * dur;
      let ce = C_END * dur;
      if (climaxQuote && fullScript) {
        const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
        const F = norm(fullScript);
        const Q = norm(climaxQuote);
        const idx = Q ? F.indexOf(Q) : -1;
        if (idx >= 0 && F.length) {
          cs = (idx / F.length) * dur;
          ce = ((idx + Q.length) / F.length) * dur;
        }
      }
      if (ce - cs < 8) ce = Math.min(dur, cs + 8); // cửa sổ đủ rộng để nhạc kịp dâng
      const CS = (INTRO + Math.max(0, cs)).toFixed(2);
      const CE = (INTRO + Math.min(ce, dur)).toFixed(2);
      const swell = `1+${BOOST}*max(0,min(1,(t-${CS})/${RAMP}))*max(0,min(1,(${CE}-t)/${RAMP}))`;
      const filter =
        `[0:a]highpass=f=80,volume=${vGain.toFixed(1)}dB,aformat=sample_rates=44100:channel_layouts=stereo,adelay=${INTRO * 1000}|${INTRO * 1000},apad,aformat=sample_rates=44100:channel_layouts=stereo,asplit=2[v1][v2];` +
        `[1:a]aformat=sample_rates=44100:channel_layouts=stereo,${MUSIC_EQ},volume=${MUSIC_BASE}[mraw];` +
        `[mraw][v1]sidechaincompress=${SC}[mduck];` +
        `[mduck]volume=eval=frame:volume='${swell}'[mclimax];` +
        `[v2][mclimax]amix=inputs=2:duration=longest,` +
        `afade=t=in:st=0:d=${FADEIN},afade=t=out:st=${fadeOutStart}:d=${FADEOUT}[out]`;
      // render PREMIX (wav, CHƯA loudnorm — để đo chính xác rồi áp tuyến tính)
      await run('ffmpeg', [
        '-hide_banner', '-y', '-i', vPath, '-stream_loop', '-1', '-i', bgmPath(),
        '-filter_complex', filter, '-map', '[out]',
        '-t', String(total), '-c:a', 'pcm_s16le', pPath,
      ]);
      // ④ loudnorm 2-pass: đo premix → áp measured_* + linear=true
      let lnFilter = 'loudnorm=I=-14:TP=-1:LRA=11'; // fallback 1-pass nếu đo hỏng
      try {
        const meas = await run('ffmpeg', [
          '-hide_banner', '-i', pPath,
          '-af', 'loudnorm=I=-14:TP=-1:LRA=11:print_format=json',
          '-f', 'null', '-',
        ]);
        const j = lastJson(meas);
        const nums = [
          j?.input_i, j?.input_tp, j?.input_lra, j?.input_thresh, j?.target_offset,
        ].map((x: any) => parseFloat(x));
        if (nums.every((n: number) => Number.isFinite(n))) {
          lnFilter =
            `loudnorm=I=-14:TP=-1:LRA=11:measured_i=${nums[0]}:measured_tp=${nums[1]}` +
            `:measured_lra=${nums[2]}:measured_thresh=${nums[3]}:offset=${nums[4]}:linear=true`;
        }
      } catch {
        /* đo lỗi → dùng 1-pass */
      }
      await run('ffmpeg', [
        '-hide_banner', '-y', '-i', pPath, '-af', lnFilter,
        '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '128k', oPath,
      ]);
      const out = fs.readFileSync(oPath);
      return out.length > 1000 ? out : null;
    } finally {
      try { fs.unlinkSync(vPath); } catch { /* dọn tmp */ }
      try { fs.unlinkSync(pPath); } catch { /* dọn tmp */ }
      try { fs.unlinkSync(oPath); } catch { /* dọn tmp */ }
    }
  }

  async listProducts(orgId: string) {
    // mở tab Sản phẩm = dịp quét xác 'processing' bỏ rơi → hiện ❌ + Thử lại
    await this._repo.failStaleProducts(orgId).catch(() => null);
    return this._repo.listProducts(orgId);
  }

  // ── KÊNH PODCAST RSS (Spotify/Apple) ────────────────────────────────────
  // Bật/tắt phát hành 1 sản phẩm podcast lên feed + tiêu đề/mô tả TẬP.
  async setProductRss(
    orgId: string,
    id: string,
    body: { on: boolean; title?: string; description?: string }
  ) {
    const p = await this._repo.getProduct(orgId, id);
    if (!p || p.format !== 'podcast' || p.status !== 'done' || !p.mediaPath) {
      throw new Error('Chỉ phát hành được sản phẩm podcast đã sản xuất xong.');
    }
    let meta: any = {};
    try {
      meta = JSON.parse(p.meta || '{}');
    } catch {
      /* meta hỏng — dựng lại */
    }
    if (body.on) {
      // enclosure length (BYTE) là BẮT BUỘC theo spec Spotify — tập cũ chưa
      // lưu bytes thì đo bù: ưu tiên stat file local, fallback HTTP HEAD.
      if (!meta.bytes) {
        meta.bytes = await this.resolveAudioBytes(p.mediaPath);
        if (!meta.bytes) {
          throw new Error(
            'Không đo được dung lượng file audio (enclosure length bắt buộc theo spec Spotify) — bấm "↻ Tạo lại" sản phẩm rồi phát hành lại.'
          );
        }
      }
      meta.rss = {
        on: true,
        title: String(body.title || meta.rss?.title || p.title || 'Tập podcast')
          .trim()
          .slice(0, 300),
        description: String(
          body.description || meta.rss?.description || p.textContent || ''
        )
          .trim()
          .slice(0, 3900),
        // giữ pubDate lần phát hành ĐẦU — Spotify xếp thứ tự tập theo mốc này
        publishedAt: meta.rss?.publishedAt || new Date().toISOString(),
      };
    } else if (meta.rss) {
      meta.rss = { ...meta.rss, on: false };
    }
    await this._repo.updateProduct(id, { meta: JSON.stringify(meta) });
    return { ok: true, rss: meta.rss || null };
  }

  private async resolveAudioBytes(url: string): Promise<number> {
    try {
      const marker = '/uploads/';
      const i = url.indexOf(marker);
      const dir = process.env.UPLOAD_DIRECTORY || '';
      if (i >= 0 && dir) {
        const fs = await import('fs');
        const path = await import('path');
        const st = fs.statSync(path.join(dir, url.slice(i + marker.length)));
        if (st.size > 0) return st.size;
      }
    } catch {
      /* không có file local — thử HEAD */
    }
    try {
      const r = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(15000),
      });
      const len = parseInt(r.headers.get('content-length') || '0', 10);
      if (r.ok && len > 0) return len;
    } catch {
      /* chịu — trả 0 để nơi gọi báo lỗi rõ */
    }
    return 0;
  }

  // XML feed công khai — gom sản phẩm podcast đã bật 📡 trên TOÀN instance
  // (Hub một tổ chức; kiểm soát tập nào lên sóng = nút Phát hành từng sản phẩm).
  async podcastFeedXml(): Promise<string> {
    const cfg = getPodcastConfig();
    const base = (
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      `${process.env.FRONTEND_URL || ''}/api`
    ).replace(/\/$/, '');
    const rows = await this._repo.listRssPodcastCandidates();
    const eps: RssEpisode[] = [];
    for (const r of rows) {
      let meta: any = {};
      try {
        meta = JSON.parse(r.meta || '{}');
      } catch {
        continue;
      }
      if (!meta?.rss?.on || !r.mediaPath || !meta?.bytes) continue;
      eps.push({
        id: r.id,
        title: meta.rss.title || r.title || 'Tập podcast',
        description: meta.rss.description || '',
        audioUrl: r.mediaPath,
        bytes: Number(meta.bytes) || 0,
        durationSec: Number(meta.durationSec) || null,
        publishedAt: meta.rss.publishedAt || (r as any).createdAt,
      });
    }
    eps.sort(
      (a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
    return buildPodcastRss(cfg, `${base}/public/podcast/cover`, eps);
  }

  // Đo thời lượng mp3 bằng ffprobe (giây, làm tròn) — hỏng trả null.
  private async probeDurationSec(buf: Buffer): Promise<number | null> {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { execFile } = await import('child_process');
    const p = path.join(os.tmpdir(), `viral-dur-${makeId(6)}.mp3`);
    try {
      fs.writeFileSync(p, buf);
      const out = await new Promise<string>((resolve, reject) =>
        execFile(
          'ffprobe',
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p],
          { timeout: 30000 },
          (e, so) => (e ? reject(e) : resolve(String(so)))
        )
      );
      const d = parseFloat(out.trim());
      return Number.isFinite(d) && d > 0 ? Math.round(d) : null;
    } catch {
      return null;
    } finally {
      try {
        fs.unlinkSync(p);
      } catch {
        /* dọn tmp */
      }
    }
  }

  deleteProduct(orgId: string, id: string) {
    return this._repo.hardDeleteProduct(orgId, id);
  }

  // Thử lại sản phẩm lỗi — reset về processing rồi chạy nền.
  //   fresh=false ("↻ Thử lại" trên thẻ lỗi): GIỮ checkpoint → bộ carousel vẽ
  //     tiếp từ slide hỏng, đúng kịch bản và phong cách bộ đang dở.
  //   fresh=true  ("↻ Tạo lại" / cứu bộ ảnh cũ thiếu media id): XOÁ checkpoint
  //     → dựng bộ hoàn toàn mới từ đầu.
  async retryProduct(orgId: string, id: string, fresh = false): Promise<boolean> {
    const p = await this._repo.getProduct(orgId, id);
    if (!p) return false;
    const data: any = { status: 'processing', error: null };
    if (fresh) {
      // podcast: giữ Ý MUỐN trộn nhạc (bgmWant) khi Tạo lại, phần còn lại bỏ.
      // Đọc bgmWant (mới); tập cũ chỉ có cờ kết quả 'bgm' hoặc không có gì →
      // MẶC ĐỊNH BẬT để Tạo lại tập plain trước đây cũng ghép được nhạc.
      let want = true;
      try {
        want = JSON.parse(p.meta || '{}')?.bgmWant !== false;
      } catch {
        /* meta hỏng — giữ mặc định bật */
      }
      data.meta = JSON.stringify({ bgmWant: want });
    }
    await this._repo.updateProduct(id, data);
    this.runProducts(orgId, [id]).catch(() => null);
    return true;
  }

  // Blog → file .docx (base64) cho nút tải về.
  async productDocx(
    orgId: string,
    id: string
  ): Promise<{ fileName: string; base64: string } | null> {
    const p = await this._repo.getProduct(orgId, id);
    if (!p || p.format !== 'blog' || !p.textContent) return null;
    let meta: any = {};
    try {
      meta = JSON.parse(p.meta || '{}');
    } catch {
      /* meta hỏng — vẫn xuất docx với tiêu đề */
    }
    const buf = blogHtmlToDocx({
      title: p.title || p.topic || 'blog',
      metaDescription: meta.meta_description || '',
      bodyHtml: p.textContent,
      tags: Array.isArray(meta.tags) ? meta.tags : [],
    });
    const slug = String(meta.slug || 'blog')
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .slice(0, 60);
    return { fileName: `${slug || 'blog'}.docx`, base64: buf.toString('base64') };
  }

  // ── BẢN TIN TUẦN + TODO LIST (gửi Zalo/email/in-app) ─────────────────────
  // Chia văn bản dài thành phần ≤ max ký tự, cắt theo ranh giới đoạn/dòng cho
  // đẹp; đoạn liền quá dài thì cắt cứng.
  private splitText(text: string, max: number): string[] {
    const parts: string[] = [];
    let buf = '';
    const flush = () => {
      if (buf) {
        parts.push(buf);
        buf = '';
      }
    };
    const add = (piece: string, sep: string) => {
      if (!piece) return;
      if ((buf ? buf.length + sep.length : 0) + piece.length > max) {
        flush();
        while (piece.length > max) {
          parts.push(piece.slice(0, max));
          piece = piece.slice(max);
        }
        buf = piece;
      } else {
        buf = buf ? buf + sep + piece : piece;
      }
    };
    for (const para of String(text || '').split(/\n\n+/)) {
      if (para.length > max) para.split('\n').forEach((l) => add(l, '\n'));
      else add(para, '\n\n');
    }
    flush();
    return parts.length ? parts : [String(text || '').slice(0, max)];
  }

  // Gửi tin nhắn văn bản qua bot Zalo (endpoint /api/postiz/send, auth
  // x-hub-token). type 'user' = nhắn thẳng 1 người (bạn bè), 'group' = nhóm.
  // "Cho bằng được" — chạy ĐƯỢC NGAY với bot đang chạy, không đợi bot cập nhật:
  //  • Zalo giới hạn độ dài → CHIA NHỎ phía Hub (~1800/phần), gửi lần lượt.
  //  • "Tham số không hợp lệ" thường do SAI loại thread → đọc lỗi bot, tự đổi
  //    loại (user↔group) và nhớ loại đúng cho các phần sau.
  private async sendZaloReport(
    threadId: string,
    text: string,
    type: 'user' | 'group' = 'group'
  ): Promise<void> {
    const base = (process.env.ZALO_BOT_URL || 'http://127.0.0.1:8088').replace(/\/$/, '');
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(process.env.HUB_BOT_TOKEN ? { 'x-hub-token': process.env.HUB_BOT_TOKEN } : {}),
    };
    const postOne = async (msg: string, tt: 'user' | 'group') => {
      const res = await fetch(`${base}/api/postiz/send`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ threadId, text: msg, threadType: tt }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) return { ok: true as const };
      const body = await res.text().catch(() => '');
      return { ok: false as const, status: res.status, body };
    };

    const parts = this.splitText(text, 1800);
    let curType = type;
    let switched = false;
    for (let i = 0; i < parts.length; i++) {
      const msg = parts.length > 1 ? `(${i + 1}/${parts.length})\n${parts[i]}` : parts[i];
      let r = await postOne(msg, curType);
      // Sai loại thread → thử loại kia MỘT lần, dùng luôn cho các phần sau.
      if (!r.ok && !switched && /hợp lệ|invalid|param/i.test(r.body || '')) {
        curType = curType === 'user' ? 'group' : 'user';
        switched = true;
        r = await postOne(msg, curType);
      }
      if (!r.ok) {
        throw new Error(`Bot Zalo trả ${r.status}: ${(r.body || '').slice(0, 120)}`);
      }
      if (i < parts.length - 1) await new Promise((res) => setTimeout(res, 600));
    }
  }

  // Bản tin plain-text → HTML đọc được (email). Escape + tách đoạn theo dòng
  // trống, xuống dòng đơn thành <br>. sendEmailSync bọc thêm khung/tiêu đề.
  private reportTextToHtml(text: string): string {
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return esc(String(text || ''))
      .split(/\n{2,}/)
      .map((p) => `<p style="margin:0 0 12px;line-height:1.6">${p.replace(/\n/g, '<br/>')}</p>`)
      .join('');
  }

  // Gửi 1 bản tin tới TOÀN BỘ danh sách người nhận đã lưu (hoặc list truyền
  // vào): Zalo (user/group) qua bot — tuần tự cách 2s né spam-limit; email
  // (type 'email') gửi thẳng qua provider. Chưa cấu hình thì rơi về nhóm Zalo
  // cũ (reportZaloThreadId) cho tương thích.
  private async sendReportToRecipients(
    text: string,
    override?: { threadId: string; type: 'user' | 'group' | 'email'; name?: string }[],
    subject = 'Bản tin Phát hiện — Trường Việt Anh'
  ): Promise<{ sent: number; failed: number }> {
    const cfg = getViralConfig();
    const list =
      override && override.length
        ? override
        : cfg.reportRecipients.length
        ? cfg.reportRecipients
        : cfg.reportZaloThreadId
        ? [{ threadId: cfg.reportZaloThreadId, type: 'group' as const }]
        : [];
    let sent = 0;
    let failed = 0;
    let html = '';
    for (const r of list) {
      try {
        if (r.type === 'email') {
          if (!html) html = this.reportTextToHtml(text);
          const ok = await this._notification.sendReportEmail(r.threadId, subject, html);
          if (ok) sent++;
          else failed++;
        } else {
          await this.sendZaloReport(r.threadId, text, r.type);
          sent++;
          await new Promise((res) => setTimeout(res, 2000)); // né spam-limit Zalo
        }
      } catch {
        failed++;
      }
    }
    return { sent, failed };
  }

  // Gửi TAY 1 bản tin tới danh sách người nhận (Zalo + email) — nút "Gửi ngay".
  async sendReportZalo(
    orgId: string,
    reportId: string
  ): Promise<{ sent: number; failed: number } | null> {
    const r: any = await this._repo.getReport(orgId, reportId);
    if (!r) return null;
    return this.sendReportToRecipients(r.content, undefined, r.title || undefined);
  }

  // Tổng hợp 7 ngày → AI viết bản tin (tin nóng + diễn biến thị trường + todo
  // list) → LƯU vào tab 📰 Bản tin + gửi 3 kênh: chuông in-app, email cả org,
  // nhóm Zalo (nếu cấu hình). kind: 'crawl' = sau cào theo lịch T2-4-6 ·
  // 'sunday' = tổng kết CN · 'manual' = bấm nút tạo ngay.
  async sendWeeklyReport(orgId: string, kind: 'crawl' | 'sunday' | 'manual') {
    const [d, counts, { trend, winning }, competitors, hotTopics] =
      await Promise.all([
        this._repo.weeklyDigest(orgId),
        this._repo.statusCounts(orgId),
        this._repo.weeklyBriefPosts(orgId),
        this._repo.weeklyCompetitorActivity(orgId),
        this._repo.weeklyHotTopics(orgId),
      ]);
    // Nhãn loại nguồn cho dễ đọc — 'group' = hội nhóm phụ huynh trên FB.
    const typeTag = (t?: string) =>
      t === 'kol' ? 'KOL' : t === 'group' ? 'Hội nhóm' : t === 'news' ? 'Báo' : 'Trường';
    // Chuỗi chỉ số: SHARE đứng trước (chỉ số quan trọng nhất), bỏ số 0.
    const metrics = (p: any) =>
      [
        p.shares ? `${p.shares} share` : '',
        p.likes ? `${p.likes} like` : '',
        p.comments ? `${p.comments} comment` : '',
        p.views ? `${p.views} view` : '',
      ]
        .filter(Boolean)
        .join(' · ');
    // CHỦ ĐỀ NÓNG (1 content = nhiều bài) — phần CHÍNH của bản tin. Kèm ai đang
    // đẩy chủ đề đó để AI chỉ ra được khe hở đối thủ.
    const topicText = (hotTopics as any[])
      .map((t) => {
        const drivers = (t.drivers || [])
          .map((dv: any) => `${dv.name} [${typeTag(dv.type)}] ${dv.count} bài`)
          .join(', ');
        const top = t.top
          ? ` · bài mạnh nhất: "${decodeEntities(t.top.title).slice(0, 90)}" (${metrics(t.top) || 'chưa có số'})`
          : '';
        const plat = (() => {
          try {
            const arr = JSON.parse(t.platforms || '[]');
            return Array.isArray(arr) && arr.length ? arr.join('/') : '';
          } catch {
            return '';
          }
        })();
        const mine = t.status === 'approved' ? ' · TA ĐÃ DUYỆT chủ đề này' : '';
        return `- "${decodeEntities(t.label)}"${plat ? ` [${plat}]` : ''}: ${t.postCount} bài · ${t.sourceCount} nguồn · ${metrics(
          { shares: t.totalShares, likes: t.totalLikes, comments: t.totalComments, views: t.totalViews }
        ) || 'chưa có số'}${drivers ? ` · đang đẩy: ${drivers}` : ''}${top}${mine}`;
      })
      .join('\n')
      .slice(0, 7000);
    // Động tĩnh từng nguồn (KOL + trường + HỘI NHÓM) — cho AI phân tích + hiện
    // thành mục riêng trong bản tin.
    const competitorText = (competitors as any[])
      .map((c) => {
        const top = c.top
          ? ` · bài nổi nhất: "${decodeEntities(c.top.title).slice(0, 90)}"${metrics(c.top) ? ` (${metrics(c.top)})` : ''}`
          : '';
        return `- [${typeTag(c.type)} · ${c.platform}] ${c.name}: ${c.count} bài · ${metrics(
          { shares: c.totalShares, likes: c.totalLikes, comments: c.totalComments }
        ) || 'chưa có số'}${top}`;
      })
      .join('\n')
      .slice(0, 6000);
    // Tin báo: phần PHỤ (~15%) → cắt ngắn hạn mức ký tự để không lấn át MXH.
    const trendText = trend
      .map((t: any) => `- [${t.persona || '?'} · ${t.score ?? '-'}đ] ${decodeEntities(t.title)} (${t.sourceName || ''})`)
      .join('\n')
      .slice(0, 2000);
    const winningText = winning
      .map(
        (w: any) =>
          `- [${w.platform}${w.sourceType ? ` · ${typeTag(w.sourceType)}` : ''}] ${decodeEntities(w.title)} (${w.sourceName || ''})${metrics(w) ? ` — ${metrics(w)}` : ''}`
      )
      .join('\n')
      .slice(0, 8000);
    const statsText = `7 ngày qua: cào ${d.crawled} bài mới · duyệt ${d.approved} · sản xuất ${d.produced} sản phẩm · đang chờ duyệt ${counts.pending} bài.`;
    // Trước đây .catch(() => null) NUỐT mọi lỗi AI → bản tin lặng lẽ rớt sạch
    // phần AI (summary/tin nóng/thị trường/việc), chỉ còn số liệu thô → user
    // tưởng "AI không theo prompt". Giờ bắt lỗi + GIỮ thông điệp để hiện ra bản
    // tin (vd "AI viết vượt trần 8000 token…") thay vì degrade âm thầm.
    let brief: Awaited<ReturnType<typeof this._openai.viralWeeklyBrief>> = null;
    let briefError = '';
    try {
      brief = await this._openai.viralWeeklyBrief({
        trendText,
        winningText,
        statsText,
        competitorText,
        topicText,
      });
    } catch (e: any) {
      briefError = e?.message || String(e);
    }

    const dateVn = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
    const head =
      kind === 'sunday'
        ? `📊 TỔNG KẾT TUẦN — Phát hiện (CN ${dateVn})`
        : kind === 'manual'
        ? `📰 BẢN TIN TUẦN — Phát hiện (${dateVn})`
        : `📰 BẢN TIN SAU CÀO — Phát hiện (${dateVn})`;
    const lines: string[] = [head, ''];
    // Hiện lỗi AI NGAY đầu bản tin (nếu có) — user thấy đúng lý do phần phân
    // tích trống thay vì tưởng AI phớt lờ prompt.
    if (briefError)
      lines.push(`⚠️ Phần phân tích AI chưa tạo được: ${briefError}`, '');
    if (brief?.summary) lines.push(brief.summary, '');
    // Thứ tự MỚI: chủ đề MXH → đối thủ/hội nhóm → báo chí (phụ) → việc cần làm.
    if (brief?.themes?.length) {
      lines.push('🔥 CHỦ ĐỀ NÓNG TRÊN MẠNG XÃ HỘI (1 chủ đề = nhiều bài):');
      brief.themes.slice(0, 10).forEach((h, i) => lines.push(`${i + 1}. ${h}`));
      lines.push('');
    } else if (brief?.highlights?.length) {
      // bản tin do prompt CŨ sinh ra (chỉ có highlights) — vẫn hiện được.
      lines.push('🔥 TIN NÓNG TUẦN:');
      brief.highlights.slice(0, 10).forEach((h, i) => lines.push(`${i + 1}. ${h}`));
      lines.push('');
    }
    if (brief?.market?.length) {
      lines.push('📈 ĐỐI THỦ / KOL / HỘI NHÓM ĐANG ĐẨY GÌ:');
      brief.market.slice(0, 10).forEach((m) => lines.push(`• ${m}`));
      lines.push('');
    }
    if (competitorText) {
      lines.push('🏫 ĐIỂM DANH NGUỒN THEO DÕI (tuần qua):');
      (competitors as any[]).slice(0, 15).forEach((c) => {
        const num = [
          c.totalShares ? `${c.totalShares} share` : '',
          c.totalLikes ? `${c.totalLikes} like` : '',
          c.totalComments ? `${c.totalComments} comment` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        lines.push(
          `• ${c.name} [${typeTag(c.type)} · ${c.platform}]: ${c.count} bài${num ? ` · ${num}` : ''}`
        );
      });
      lines.push('');
    }
    if (brief?.press?.length) {
      lines.push('📰 MẶT BÁO (phụ):');
      brief.press.slice(0, 5).forEach((p) => lines.push(`• ${p}`));
      lines.push('');
    }
    if (brief?.todos?.length) {
      lines.push('✅ VIỆC TUẦN NÀY:');
      brief.todos
        .slice(0, 8)
        .forEach((td, i) => lines.push(`${i + 1}. ${td.title} — ${td.action}`));
      lines.push('');
    }
    // (Bỏ dòng "📊 7 ngày qua… 👉 Vào trang Phát hiện" theo yêu cầu — statsText
    //  vẫn dùng làm bối cảnh cho AI + lưu meta, chỉ không hiện trong bản tin gửi.)
    const text = lines.join('\n').replace(/\n+$/, '');

    // Lưu vào tab 📰 Bản tin TRƯỚC khi gửi — kênh gửi lỗi vẫn đọc được trên web.
    const saved = await this._repo
      .createReport(orgId, {
        kind,
        title: head,
        content: text,
        meta: JSON.stringify({
          summary: brief?.summary || '',
          themes: brief?.themes || [],
          highlights: brief?.highlights || [],
          market: brief?.market || [],
          press: brief?.press || [],
          todos: brief?.todos || [],
          competitors: (competitors as any[]).slice(0, 15).map((c) => ({
            name: c.name,
            type: c.type,
            platform: c.platform,
            count: c.count,
            totalShares: c.totalShares,
            totalLikes: c.totalLikes,
            totalComments: c.totalComments,
          })),
          topics: (hotTopics as any[]).slice(0, 10).map((t) => ({
            label: t.label,
            postCount: t.postCount,
            sourceCount: t.sourceCount,
            totalShares: t.totalShares,
            totalLikes: t.totalLikes,
            totalComments: t.totalComments,
          })),
          stats: statsText,
        }),
      })
      .catch(() => null);

    // Chuông in-app (org) — luôn có. KHÔNG email cả org nữa: sau khi gộp tổ
    // chức, org chứa MỌI tài khoản, gửi hết = spam. Bản tin đi tới đúng DANH
    // SÁCH người nhận (Zalo + email) cấu hình ở tab 📰.
    await this._notification
      .inAppNotification(orgId, head, text.slice(0, 3500), false)
      .catch(() => null);
    // Người nhận (Zalo user/group + email) + toggle auto + giờ hẹn.
    const cfgZ = getViralConfig();
    const hasRecipients =
      cfgZ.reportRecipients.length > 0 || !!cfgZ.reportZaloThreadId;
    let sentAny = false;
    if (hasRecipients && cfgZ.reportAutoSend) {
      if (cfgZ.reportSendHour >= 0 && (saved as any)?.id) {
        // gom lại — vòng quét 10 phút sẽ gửi vào đúng giờ đã hẹn trong ngày
        await this._repo
          .setReportMetaFlag((saved as any).id, { zaloPending: true })
          .catch(() => null);
        sentAny = true;
      } else {
        const r = await this.sendReportToRecipients(text, undefined, head).catch(() => null);
        sentAny = !!r && r.sent > 0;
      }
    }
    return { ok: true, zalo: sentAny, reportId: (saved as any)?.id || null };
  }

  listReports(orgId: string) {
    return this._repo.listReports(orgId);
  }

  deleteReport(orgId: string, id: string) {
    return this._repo.deleteReport(orgId, id);
  }

  // Nhập bộ nguồn mặc định (port sheet Sources của n8n) — bỏ qua nguồn đã có
  // (trùng URL hoặc trùng platform+name). FB/TikTok để auto=false (cần Apify);
  // gnews bật auto luôn (free).
  async importDefaultSources(orgId: string): Promise<number> {
    const existing = await this._repo.listSources(orgId);
    const haveUrl = new Set(
      existing.map((s: any) => (s.url || '').toLowerCase()).filter(Boolean)
    );
    const haveKey = new Set(
      existing.map((s: any) => `${s.platform}|${(s.name || '').toLowerCase()}`)
    );
    let added = 0;
    for (const d of VIRAL_DEFAULT_SOURCES) {
      if (d.url && haveUrl.has(d.url.toLowerCase())) continue;
      if (haveKey.has(`${d.platform}|${d.name.toLowerCase()}`)) continue;
      await this._repo.createSource(orgId, {
        platform: d.platform,
        name: d.name,
        url: d.url || null,
        type: d.type,
        auto: d.platform === 'gnews',
      });
      added++;
    }
    return added;
  }

  // sources
  listSources(orgId: string) {
    return this._repo.listSources(orgId);
  }
  createSource(orgId: string, body: any) {
    return this._repo.createSource(orgId, body);
  }
  deleteSource(orgId: string, id: string) {
    return this._repo.deleteSource(orgId, id);
  }
}
