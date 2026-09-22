'use client';

import { FC, ReactNode } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// ============================================================================
//  Dùng chung cho các tab trang Zalo (Tổng quan / Bài viết / Nhóm → Trang /
//  Token Facebook / Google Business / Cài đặt / Nhật ký).
//
//  Bot Zalo LUÔN được gọi qua proxy same-origin /botapi:
//  app/botapi/[[...path]]/route.ts verify JWT của Hub rồi chuyển tiếp tới
//  ZALO_BOT_URL kèm bí mật HUB_BOT_TOKEN → bot coi như phiên dashboard, nên
//  Hub dùng được TOÀN BỘ API dashboard (posts/routes/token/gbp/logs/output).
// ============================================================================

export const getBotUrl = () =>
  typeof window === 'undefined' ? '/botapi' : `${window.location.origin}/botapi`;

export async function bot(path: string, init?: RequestInit, timeoutMs = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${getBotUrl()}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Kênh mà bot đẩy bài vào được KHÔNG kèm settings (mọi field settings optional).
// Kênh ngoài danh sách này (YouTube, Instagram, Pinterest, Slack, Discord...)
// bắt buộc có settings riêng → bài bot đẩy sẽ bị 400, nên chặn ngay từ dropdown.
export const BOT_SUPPORTED_PROVIDERS = new Set([
  'facebook',
  'linkedin',
  'linkedin-page',
  'threads',
  'mastodon',
  'bluesky',
  'telegram',
  'x',
  'vk',
  'gmb',
  'farcaster',
  'wrapcast',
  'kick',
  'twitch',
  'tiktok',
  'mewe',
  'nostr',
  'listmonk',
]);

export const isSupportedChannel = (identifier: string) =>
  BOT_SUPPORTED_PROVIDERS.has(identifier) ||
  BOT_SUPPORTED_PROVIDERS.has(String(identifier || '').split('-')[0]);

// Tên nền tảng hiển thị cạnh tên kênh trong các ô chọn kênh (nhiều kênh trùng
// tên khác nền tảng — không có chữ này thì không phân biệt được).
const PROVIDER_LABELS: Record<string, string> = {
  facebook: 'Facebook',
  linkedin: 'LinkedIn',
  'linkedin-page': 'LinkedIn Page',
  threads: 'Threads',
  mastodon: 'Mastodon',
  bluesky: 'Bluesky',
  telegram: 'Telegram',
  x: 'X',
  vk: 'VK',
  gmb: 'Google Business',
  farcaster: 'Farcaster',
  wrapcast: 'Warpcast',
  kick: 'Kick',
  twitch: 'Twitch',
  tiktok: 'TikTok',
  mewe: 'MeWe',
  nostr: 'Nostr',
  listmonk: 'Listmonk',
};

export const channelLabel = (ch: { name: string; id: string; identifier: string }) => {
  const platform =
    PROVIDER_LABELS[ch.identifier] ||
    PROVIDER_LABELS[String(ch.identifier || '').split('-')[0]] ||
    ch.identifier;
  return `${ch.name || ch.id} · ${platform}`;
};

// ---- Kiểu dữ liệu từ bot ---------------------------------------------------

export type Overview = {
  zaloConnected: boolean;
  zaloRelogging: boolean;
  hasQr: boolean;
  paused: boolean;
  pendingCount: number;
  routes: {
    threadId: string;
    label: string;
    enabled: boolean;
    postizIntegrationId?: string;
  }[];
};

export type BridgeConfig = {
  enabled: boolean;
  apiUrl: string;
  hasKey: boolean;
  masked: string;
  integrationId: string;
  zaloConnected?: boolean;
  zaloRelogging?: boolean;
};

export type LiveThread = {
  threadId: string;
  label: string;
  phase: 'idle' | 'prelisten' | 'listening' | 'processing' | 'done';
  counts: { image: number; video: number; text: number };
  proc?: { stage?: string } | null;
};

export type HubChannel = { id: string; name: string; identifier: string };

// Bài trong /api/posts (gộp chờ duyệt + đã đăng, shape từ store của bot).
export type BotPost = {
  id: string;
  threadId?: string;
  routeLabel?: string;
  fanpageId?: string;
  caption?: string;
  captionFooter?: string;
  hashtags?: string;
  comment?: string;
  imageUrls?: string[];
  videoUrls?: string[];
  imageCaptions?: string[];
  videoCaptions?: string[];
  savedImages?: string[];
  savedVideos?: string[];
  droppedCount?: number;
  createdAt?: number;
  postedAt?: number;
  scheduledAt?: number | null;
  scheduledPublished?: boolean;
  published?: boolean;
  links?: string[];
  gbpLocationId?: string;
  approvals?: Record<
    string,
    { status?: string; published?: boolean; links?: string[]; at?: number }
  >;
  channels?: string[];
  pendingChannels?: string[];
  postedChannels?: string[];
  needsFacebookPublic?: boolean;
  inPending?: boolean;
  queueStatus?: 'pending' | 'done';
  pushedToHub?: boolean;
  hubPostId?: string; // id bài draft trong Hub (mở thẳng trình soạn ở Calendar)
};

export type BotRoute = {
  threadId: string;
  label?: string;
  folder?: string;
  fanpageId?: string;
  fanpageTokenEnv?: string;
  enabled?: boolean;
  published?: boolean;
  facebookAutoPublish?: boolean;
  curateImages?: boolean;
  autoHashtags?: boolean;
  comment?: string;
  captionFooter?: string;
  writeGuide?: string;
  styleSample?: string;
  debounceMs?: number;
  maxWaitMs?: number;
  // CŨ — Google Business đăng bằng Playwright trên máy bot (hồi chưa xin được
  // API). Nay nối bằng GMB API chính thức nên nó là kênh Media Hub thường:
  // routes.json trên bot còn sót 3 trường này, giữ kiểu để lúc lưu DỌN chúng
  // về rỗng (xem zalo.routes.tsx) cho bot thôi đăng theo đường cũ.
  gbpAutoPublish?: boolean;
  gbpLocationIds?: string[];
  gbpLocationId?: string;
  // Kênh Media Hub đích: mảng nhiều-kênh (mới) + field đơn cũ giữ lại để bot
  // bản chưa cập nhật vẫn đăng được kênh chính. Xem routeChannelIds() ở zalo.routes.
  postizIntegrationIds?: string[];
  postizIntegrationId?: string;
  allowSenders?: string[];
};

export type BotRoutesFile = {
  defaults?: {
    debounceMs?: number;
    maxWaitMs?: number;
    published?: boolean;
  };
  routes: BotRoute[];
};

export type FbPage = {
  fanpageId: string;
  name: string;
  envName?: string;
  hasToken: boolean;
  expiresAt?: number | null;
};

export type ZaloGroup = { threadId: string; name: string };

// ---- UI atoms (design token mới: bg-newBgColorInner, border-newTableBorder…) --

export const Pill: FC<{
  ok: boolean | null;
  onLabel: string;
  offLabel: string;
  title?: string;
}> = ({ ok, onLabel, offLabel, title }) => {
  const t = useT();
  return (
    <div
      title={title}
      className={clsx(
        'flex items-center gap-[7px] text-[12px] font-[600] px-[12px] h-[28px] rounded-full border',
        title && 'cursor-help',
        ok === true && 'border-green-500/40 bg-green-500/10 text-green-500',
        ok === false && 'border-red-500/40 bg-red-500/10 text-red-500',
        ok === null && 'border-newTableBorder text-textItemBlur'
      )}
    >
      <span
        className={clsx(
          'w-[8px] h-[8px] rounded-full',
          ok === true && 'bg-green-500',
          ok === false && 'bg-red-500',
          ok === null && 'bg-textItemBlur animate-pulse'
        )}
      />
      {ok === true ? onLabel : ok === false ? offLabel : t('zalo_checking', 'Checking…')}
    </div>
  );
};

// Nhãn trạng thái nhỏ trong thẻ bài (chờ / đã đăng / đã bỏ).
export const StatusChip: FC<{
  tone: 'ok' | 'off' | 'wait' | 'warn';
  children: ReactNode;
}> = ({ tone, children }) => (
  <span
    className={clsx(
      'inline-flex items-center text-[11px] font-[600] px-[8px] h-[20px] rounded-full border whitespace-nowrap',
      tone === 'ok' && 'border-green-500/40 bg-green-500/10 text-green-500',
      tone === 'off' && 'border-red-500/40 bg-red-500/10 text-red-500',
      tone === 'warn' && 'border-amber-400/40 bg-amber-400/10 text-amber-400',
      tone === 'wait' && 'border-newTableBorder text-textItemBlur'
    )}
  >
    {children}
  </span>
);

export const Card: FC<{ title?: ReactNode; className?: string; children: ReactNode }> = ({
  title,
  className,
  children,
}) => (
  <div
    className={clsx(
      'border border-newTableBorder rounded-[12px] p-[20px] mobile:p-[14px] flex flex-col gap-[14px]',
      className
    )}
  >
    {!!title && (
      <div className="text-[13px] font-[700] text-textItemBlur uppercase tracking-[0.5px]">
        {title}
      </div>
    )}
    {children}
  </div>
);

export const StepBadge: FC<{ step: string; done?: boolean; warn?: boolean }> = ({
  step,
  done,
  warn,
}) => (
  <div
    className={clsx(
      'w-[28px] h-[28px] rounded-full flex items-center justify-center text-[13px] font-[700] shrink-0',
      warn ? 'bg-red-500 text-white' : done ? 'bg-green-500 text-white' : 'bg-btnSimple text-btnText'
    )}
  >
    {warn ? '!' : done ? '✓' : step}
  </div>
);

export const PrimaryButton: FC<{
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}> = ({ onClick, disabled, className, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'h-[40px] px-[18px] rounded-[8px] bg-btnPrimary text-white text-[14px] font-[600] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap',
      className
    )}
  >
    {children}
  </button>
);

export const SimpleButton: FC<{
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}> = ({ onClick, disabled, className, title, children }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={title}
    className={clsx(
      'h-[40px] px-[18px] rounded-[8px] bg-btnSimple text-btnText text-[14px] font-[600] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap',
      className
    )}
  >
    {children}
  </button>
);

export const DangerLink: FC<{
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}> = ({ onClick, className, children }) => (
  <span
    onClick={onClick}
    className={clsx(
      // Mobile: link chữ nhỏ vẫn phải đạt vùng chạm 44px
      'cursor-pointer text-[13px] font-[600] text-red-500 whitespace-nowrap mobile:min-h-[44px] mobile:inline-flex mobile:items-center',
      className
    )}
  >
    {children}
  </span>
);

export const Toggle: FC<{
  on: boolean;
  onChange: () => void;
  small?: boolean;
  disabled?: boolean;
  title?: string;
}> = ({ on, onChange, small, disabled, title }) => (
  <div
    onClick={disabled ? undefined : onChange}
    title={title}
    aria-disabled={disabled || undefined}
    className={clsx(
      'rounded-full relative transition-all border shrink-0',
      // Mobile: bản small phóng to bằng bản thường cho dễ gạt bằng ngón cái
      small ? 'w-[38px] h-[22px] mobile:w-[46px] mobile:h-[26px]' : 'w-[46px] h-[26px]',
      disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      on ? 'bg-btnPrimary border-btnPrimary' : 'bg-btnSimple border-newTableBorder'
    )}
  >
    <div
      className={clsx(
        'rounded-full bg-white absolute transition-all shadow',
        small
          ? 'w-[16px] h-[16px] top-[2px] mobile:w-[19px] mobile:h-[19px] mobile:top-[3px]'
          : 'w-[19px] h-[19px] top-[3px]',
        on
          ? small
            ? 'start-[18px] mobile:start-[23px]'
            : 'start-[23px]'
          : small
          ? 'start-[2px] mobile:start-[3px]'
          : 'start-[3px]'
      )}
    />
  </div>
);

// Ô nhập/textarea/select cùng token — dùng lại khắp các tab.
// Mobile ép font 16px toàn cục (chống iOS zoom) → control phải cao 44px mới thoáng.
export const inputCls =
  'bg-newBgColorInner border-newTableBorder border rounded-[8px] h-[38px] mobile:h-[44px] px-[12px] text-[13px] outline-none w-full';
export const textareaCls =
  'bg-newBgColorInner border-newTableBorder border rounded-[8px] p-[12px] text-[13px] leading-[1.6] outline-none resize-y w-full';
export const selectCls =
  'bg-newBgColorInner border-newTableBorder border rounded-[8px] h-[38px] mobile:h-[44px] px-[8px] text-[13px] outline-none cursor-pointer w-full';

export const FieldLabel: FC<{ children: ReactNode; hint?: ReactNode }> = ({
  children,
  hint,
}) => (
  <div className="flex flex-col gap-[2px]">
    <div className="text-[12.5px] font-[600]">{children}</div>
    {!!hint && <div className="text-[11.5px] text-textItemBlur leading-[1.5]">{hint}</div>}
  </div>
);

export const fmtTime = (t: number) =>
  new Date(t).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  });

export const fmtFull = (t: number) => new Date(t).toLocaleString('vi-VN');
