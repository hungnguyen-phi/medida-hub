'use client';

import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  bot,
  BridgeConfig,
  Card,
  channelLabel,
  getBotUrl,
  HubChannel,
  isSupportedChannel,
  LiveThread,
  Overview,
  Pill,
  PrimaryButton,
  SimpleButton,
  StepBadge,
  Toggle,
} from './zalo.shared';
import { ZaloPostsTab } from './zalo.posts';
import { ZaloRoutesTab } from './zalo.routes';
import { ZaloLogsTab, ZaloSettingsTab } from './zalo.settings';

// ============================================================================
//  Trang Zalo — TRUNG TÂM ĐIỀU KHIỂN thay thế hoàn toàn dashboard bot :8088.
//  Bot CHỈ lo Zalo. 3 tab: Tổng quan (QR, cầu nối, nhóm nghe + trạng thái gom
//  realtime, kèm Bài viết), Nhóm → Trang (chân bài, thời gian chờ, bình luận,
//  hướng dẫn viết — Trang FB lấy từ Add Channel), Cài đặt (kèm Nhật ký).
//  Mọi API đi qua proxy /botapi (JWT + HUB_BOT_TOKEN).
//
//  Google Business ĐÃ RỜI trang này: trước phải lách bằng phiên Playwright trên
//  máy bot vì chưa xin được API; nay nối thẳng bằng GMB API chính thức nên nó
//  là một kênh bình thường — thêm ở Add Channel, đăng qua Lịch như kênh khác.
// ============================================================================

type TabKey = 'overview' | 'routes' | 'settings';

const TAB_HASH: Record<TabKey, string> = {
  overview: 'tong-quan',
  routes: 'nhom-trang',
  settings: 'cai-dat',
};

export const ZaloComponent: FC = () => {
  const t = useT();
  const toast = useToaster();
  const hubFetch = useFetch();

  const [tab, setTab] = useState<TabKey>('overview');
  const [online, setOnline] = useState<boolean | null>(null);
  const [claude, setClaude] = useState({ hasKey: false, masked: '' });
  const [claudeKeyOk, setClaudeKeyOk] = useState<boolean | null>(null);
  const [cfg, setCfg] = useState<BridgeConfig>({
    enabled: false,
    apiUrl: 'http://localhost:3000',
    hasKey: false,
    masked: '',
    integrationId: '',
  });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [channels, setChannels] = useState<HubChannel[]>([]);
  const [groups, setGroups] = useState<{ threadId: string; name: string }[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [live, setLive] = useState<LiveThread[]>([]);
  const [postizKey, setPostizKey] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [qrTick, setQrTick] = useState(0);
  const [qrBroken, setQrBroken] = useState(false);
  // Danh sách nhóm đang nghe: thu gọn mặc định để tiết kiệm không gian.
  const [groupsOpen, setGroupsOpen] = useState(false);

  const zaloLogged = !!(overview?.zaloConnected ?? cfg.zaloConnected);
  const running = online === true && cfg.enabled && cfg.hasKey && zaloLogged;

  const bridgeBlocker = useMemo(() => {
    if (running) return '';
    if (online !== true) return t('zalo_blocker_bot_offline', 'the bot is not running');
    if (!zaloLogged) return t('zalo_blocker_not_logged_in', 'Zalo is not logged in');
    if (!cfg.hasKey) return t('zalo_blocker_no_key', 'the Media Hub API key is not saved');
    if (!cfg.enabled) return t('zalo_blocker_toggle_off', 'the automatic bridge is turned off');
    return '';
  }, [running, online, zaloLogged, cfg.hasKey, cfg.enabled, t]);

  const [botUrl, setBotUrl] = useState('/botapi');
  useEffect(() => {
    setBotUrl(getBotUrl());
    // Deep-link tab qua hash (#bai-viet, #nhom-trang…)
    const fromHash = (Object.entries(TAB_HASH).find(
      ([, h]) => `#${h}` === window.location.hash
    ) || [])[0] as TabKey | undefined;
    if (fromHash) setTab(fromHash);
  }, []);

  const switchTab = useCallback((k: TabKey) => {
    setTab(k);
    try {
      window.history.replaceState(null, '', `#${TAB_HASH[k]}`);
    } catch {}
  }, []);

  // ---- nạp dữ liệu định kỳ (trạng thái + tổng quan) ---------------------------
  const loadAll = useCallback(async () => {
    try {
      const s = await bot('/api/postiz/status');
      setOnline(true);
      setCfg(s);
      const [c, o, lv] = await Promise.all([
        bot('/api/claude/status').catch(() => null),
        bot('/api/postiz/overview').catch(() => null),
        bot('/api/postiz/live').catch(() => null),
      ]);
      if (c) setClaude(c);
      if (o) {
        setOverview(o);
        if (o.hasQr) setQrBroken(false);
      }
      if (lv && Array.isArray(lv.threads)) setLive(lv.threads);
      setQrTick((v) => v + 1);
    } catch {
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
    // App nền (mobile hay để tab chạy ngầm) thì bỏ tick — đỡ hao pin/4G
    const i = setInterval(() => {
      if (document.visibilityState === 'visible') loadAll();
    }, 8000);
    return () => clearInterval(i);
  }, []);

  // Danh sách nhóm Zalo — LẦN ĐẦU chậm (bot lấy tên từng nhóm qua zca-js).
  const loadGroups = useCallback(async (force?: boolean) => {
    setGroupsLoading(true);
    try {
      const g = await bot(`/api/postiz/groups${force ? '?force=1' : ''}`, undefined, 60000);
      if (Array.isArray(g)) setGroups(g);
    } catch {
      /* Zalo chưa kết nối hoặc tải quá lâu — giữ danh sách cũ */
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (zaloLogged) loadGroups();
  }, [zaloLogged]);

  // Tự tải danh sách kênh Media Hub khi đã có API key.
  const channelsLoaded = useRef(false);
  useEffect(() => {
    if (online === true && cfg.hasKey && !channelsLoaded.current) {
      channelsLoaded.current = true;
      bot('/api/postiz/integrations')
        .then((r) => {
          if (r?.ok) setChannels(r.integrations || []);
        })
        .catch(() => {
          channelsLoaded.current = false;
        });
    }
  }, [online, cfg.hasKey]);

  // Claude dùng CHUNG key của Media Hub — tự đồng bộ ngầm sang bot khi cần.
  const keySynced = useRef(false);
  useEffect(() => {
    if (online !== true || keySynced.current) return;
    if (claude.hasKey && claudeKeyOk !== false) return;
    keySynced.current = true;
    (async () => {
      try {
        const hub = await (await hubFetch('/copilot/anthropic-key')).json();
        if (!hub?.hasKey) {
          keySynced.current = false;
          return;
        }
        const res = await hubFetch('/copilot/anthropic-key/sync-zalo-bot', { method: 'POST' });
        const r = await res.json().catch(() => ({}));
        if (res.ok && r.ok) {
          setClaudeKeyOk(true);
          loadAll();
        }
      } catch {
        keySynced.current = false;
      }
    })();
  }, [online, claude.hasKey, claudeKeyOk]);

  // Đảm bảo tag "Zalo" tồn tại trong Media Hub (calendar nhận diện bài bot).
  const ensureZaloTag = useCallback(async () => {
    try {
      const { tags } = await (await hubFetch('/posts/tags')).json();
      const exists = (tags || []).some(
        (x: any) => String(x?.name || '').toLowerCase() === 'zalo'
      );
      if (!exists) {
        await hubFetch('/posts/tags', {
          method: 'POST',
          body: JSON.stringify({ name: 'Zalo', color: '#0068FF' }),
        });
      }
    } catch {
      /* không chặn luồng chính */
    }
  }, []);

  const tagEnsured = useRef(false);
  useEffect(() => {
    if (cfg.enabled && !tagEnsured.current) {
      tagEnsured.current = true;
      ensureZaloTag();
    }
  }, [cfg.enabled, ensureZaloTag]);

  const save = useCallback(
    async (enabled?: boolean) => {
      try {
        const body: any = {
          apiUrl: cfg.apiUrl || 'http://localhost:3000',
          enabled: enabled === undefined ? cfg.enabled : enabled,
        };
        if (postizKey.trim()) body.key = postizKey.trim();
        const r = await bot('/api/postiz/config', { method: 'POST', body: JSON.stringify(body) });
        if (r.ok) {
          if (body.enabled) ensureZaloTag();
          if (postizKey.trim()) {
            channelsLoaded.current = false;
            bot('/api/postiz/integrations')
              .then((res) => res?.ok && setChannels(res.integrations || []))
              .catch(() => {});
          }
          toast.show(t('zalo_bridge_config_saved', 'Zalo → Media Hub bridge settings saved'), 'success');
          setPostizKey('');
          loadAll();
        } else toast.show(r.error || t('zalo_save_error', 'Save failed'), 'warning');
      } catch {
        toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
      }
    },
    [cfg, postizKey, ensureZaloTag]
  );

  // ---- hành động nhóm ----------------------------------------------------------
  const toggleGroup = useCallback(async (threadId: string, name: string, enabled: boolean) => {
    try {
      const r = await bot('/api/postiz/routes', {
        method: 'POST',
        body: JSON.stringify({ threadId, name, enabled }),
      });
      if (r.ok) {
        toast.show(
          enabled
            ? t('zalo_listening_group', 'Now listening to group "{{name}}"').replace('{{name}}', name)
            : t('zalo_stopped_listening_group', 'Stopped listening to group "{{name}}"').replace('{{name}}', name),
          'success'
        );
        loadAll();
      } else toast.show(r.error || t('zalo_error', 'Error'), 'warning');
    } catch {
      toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
    }
  }, []);

  const setGroupChannel = useCallback(
    async (threadId: string, name: string, integrationId: string) => {
      try {
        const r = await bot('/api/postiz/routes', {
          method: 'POST',
          body: JSON.stringify({ threadId, name, integrationId }),
        });
        if (r.ok) {
          toast.show(
            integrationId
              ? t('zalo_group_uses_own_channel', 'Group "{{name}}" will publish to the selected channel').replace('{{name}}', name)
              : t('zalo_group_uses_default_channel', 'Group "{{name}}" uses the default channel').replace('{{name}}', name),
            'success'
          );
          loadAll();
        } else toast.show(r.error || t('zalo_error', 'Error'), 'warning');
      } catch {
        toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
      }
    },
    []
  );

  const closeSession = useCallback(async (threadId: string, name: string) => {
    try {
      const r = await bot('/api/postiz/live/close', {
        method: 'POST',
        body: JSON.stringify({ threadId }),
      });
      if (r.ok)
        toast.show(
          t('zalo_closing_session', 'Closing the collection session for "{{name}}" — processing now').replace('{{name}}', name),
          'success'
        );
      else toast.show(r.error || t('zalo_error', 'Error'), 'warning');
    } catch {
      toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
    }
  }, []);

  const reconnectZalo = useCallback(async () => {
    try {
      await bot('/api/postiz/zalo/reconnect', { method: 'POST', body: '{}' });
      toast.show(t('zalo_generating_qr', 'Generating a new QR code — please wait a few seconds…'), 'success');
      setQrBroken(false);
    } catch {
      toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
    }
  }, []);

  const togglePause = useCallback(async () => {
    try {
      const next = !overview?.paused;
      await bot('/api/postiz/settings', { method: 'POST', body: JSON.stringify({ paused: next }) });
      toast.show(
        next
          ? t('zalo_bot_paused_toast', 'Bot PAUSED (no new images will be collected)')
          : t('zalo_bot_resumed_toast', 'Bot is running again'),
        'success'
      );
      loadAll();
    } catch {
      toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
    }
  }, [overview?.paused]);

  // ---- dữ liệu dẫn xuất ----------------------------------------------------------
  const routes = overview?.routes || [];
  const routeIds = useMemo(() => new Set(routes.map((r) => String(r.threadId))), [routes]);
  const liveByThread = useMemo(() => {
    const m = new Map<string, LiveThread>();
    live.forEach((x) => m.set(String(x.threadId), x));
    return m;
  }, [live]);
  const unlistenedGroups = useMemo(
    () =>
      groups.filter(
        (g) =>
          !routeIds.has(String(g.threadId)) &&
          (!groupSearch.trim() || g.name.toLowerCase().includes(groupSearch.trim().toLowerCase()))
      ),
    [groups, routeIds, groupSearch]
  );
  const listeningCount = routes.filter((r) => r.enabled).length;
  const unroutedListening = routes.filter((r) => r.enabled && !r.postizIntegrationId).length;

  const liveLabel = (lt?: LiveThread) => {
    if (!lt || lt.phase === 'idle') return t('zalo_waiting_images', 'Waiting for new images');
    if (lt.phase === 'prelisten' || lt.phase === 'listening')
      return t('zalo_collecting', 'Collecting: {{img}} images, {{vid}} videos')
        .replace('{{img}}', String(lt.counts?.image || 0))
        .replace('{{vid}}', String(lt.counts?.video || 0));
    if (lt.phase === 'processing') return lt.proc?.stage || t('zalo_processing', 'Processing…');
    if (lt.phase === 'done') return t('zalo_draft_created_tab', 'Draft created — see the Posts tab');
    return t('zalo_waiting_images', 'Waiting for new images');
  };

  // ============================ RENDER =========================================

  if (online === false) {
    return (
      <div className="bg-newBgColorInner flex-1 flex flex-col p-[20px] items-center justify-center gap-[14px]">
        <div className="text-[44px]">🤖</div>
        <div className="text-[20px] font-[600]">
          {t('zalo_bot_not_running', 'The Zalo bot is not running')}
        </div>
        <div className="text-[14px] text-textItemBlur max-w-[480px] text-center leading-[1.6]">
          {t(
            'zalo_bot_not_running_hint_1',
            'The bot listens for images from Zalo groups — normally it starts together with'
          )}{' '}
          <b>start-postiz.bat</b>.{' '}
          {t('zalo_bot_not_running_hint_2', 'Check the log window (the')} <b>[zalo]</b>{' '}
          {t('zalo_bot_not_running_hint_3', 'section) or open')}{' '}
          <b>D:\Zalo bot group\start.bat</b>{' '}
          {t('zalo_bot_not_running_hint_4', 'manually, then try again.')}
        </div>
        <PrimaryButton onClick={loadAll}>{t('zalo_retry', 'Retry')}</PrimaryButton>
      </div>
    );
  }

  const TABS: { key: TabKey; label: string; badge?: number }[] = [
    // Bài viết hiện LUÔN trong Tổng quan; Nhật ký dời vào Cài đặt → bỏ 2 tab.
    // Google Business bỏ nốt — nay là kênh thường, nối bằng GMB API ở Add Channel.
    { key: 'overview', label: t('zalo_tab_overview', 'Overview') },
    { key: 'routes', label: t('zalo_tab_routes', 'Groups → Pages') },
    { key: 'settings', label: t('zalo_tab_settings', 'Settings') },
  ];

  return (
    <div className="bg-newBgColorInner flex-1 flex flex-col p-[20px] mobile:p-[12px] gap-[16px] min-w-0">
      {/* --- Thanh trạng thái --- */}
      <div className="flex items-center gap-[8px] flex-wrap">
        <Pill
          ok={online}
          onLabel={t('zalo_bot_running', 'Bot running')}
          offLabel={t('zalo_bot_not_running_pill', 'Bot not running')}
        />
        <Pill
          ok={online === null ? null : zaloLogged}
          onLabel={t('zalo_logged_in', 'Zalo logged in')}
          offLabel={t('zalo_not_logged_in', 'Zalo not logged in')}
        />
        <Pill
          ok={online === null ? null : running}
          onLabel={t('zalo_bridge_active', 'Bridge active')}
          offLabel={t('zalo_bridge_off', 'Bridge off')}
          title={
            !running && bridgeBlocker
              ? t('zalo_bridge_off_because', 'Off because: {{reason}}').replace('{{reason}}', bridgeBlocker)
              : undefined
          }
        />
        {overview?.paused && (
          <Pill ok={false} onLabel="" offLabel={t('zalo_bot_paused_pill', 'Bot is PAUSED')} />
        )}
        <div className="flex-1" />
        {running && (
          <a href="/launches">
            <SimpleButton className="!h-[32px] mobile:!h-[40px] text-[13px]">
              {t('zalo_open_calendar_review', 'Open Calendar to review posts')}
            </SimpleButton>
          </a>
        )}
      </div>

      {/* --- Thanh tab: desktop = gạch chân, mobile = pill 44px dính đỉnh --- */}
      <div className="flex gap-[4px] border-b border-newTableBorder overflow-x-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner -mx-[4px] px-[4px] mobile-hscroll mobile:sticky mobile:top-[env(safe-area-inset-top,0px)] mobile:z-[5] mobile:bg-newBgColorInner mobile:border-b-0 mobile:gap-[8px] mobile:-mx-[12px] mobile:px-[12px] mobile:py-[6px]">
        {TABS.map(({ key, label, badge }) => (
          <button
            key={key}
            onClick={() => switchTab(key)}
            className={clsx(
              'h-[38px] px-[14px] text-[13px] font-[600] whitespace-nowrap cursor-pointer border-b-2 -mb-[1px] flex items-center gap-[6px] mobile:h-[44px] mobile:px-[16px] mobile:text-[14px] mobile:rounded-full mobile:border-b-0 mobile:mb-0 tap-shrink',
              tab === key
                ? 'border-btnPrimary text-newTextColor mobile:bg-btnPrimary mobile:text-white'
                : 'border-transparent text-textItemBlur hover:text-newTextColor mobile:bg-boxFocused'
            )}
          >
            {label}
            {!!badge && (
              <span className="min-w-[18px] h-[18px] px-[5px] rounded-full bg-btnPrimary text-white text-[11px] font-[700] inline-flex items-center justify-center">
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ============================ TAB TỔNG QUAN ============================ */}
      {tab === 'overview' && (
        <>
          <div className="flex items-center gap-[8px] text-[12.5px] text-textItemBlur flex-wrap -mt-[6px]">
            <span>{t('zalo_flow_group', 'Zalo group')}</span>
            <span className="text-btnPrimary">→</span>
            <span>{t('zalo_flow_ai_caption', 'AI writes caption')}</span>
            <span className="text-btnPrimary">→</span>
            <span>{t('zalo_flow_review_calendar', 'Awaiting review on Calendar')}</span>
          </div>

          {/* QR đăng nhập Zalo */}
          {online === true && !zaloLogged && (
            <div className="border border-amber-400/40 bg-amber-400/10 rounded-[12px] p-[20px] flex gap-[20px] items-center flex-wrap">
              <div className="w-[168px] h-[168px] rounded-[10px] bg-white flex items-center justify-center overflow-hidden shrink-0">
                {!qrBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={qrTick}
                    src={`${botUrl}/api/postiz/qr?t=${qrTick}`}
                    alt={t('zalo_qr_alt', 'Zalo login QR code')}
                    className="w-full h-full object-contain"
                    onError={() => setQrBroken(true)}
                  />
                ) : (
                  <div className="text-[12px] text-black/60 text-center px-[10px]">
                    {t('zalo_no_qr', 'No QR code yet — click "Generate new QR"')}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-[240px] flex flex-col gap-[10px]">
                <div className="text-[17px] font-[600]">
                  {t('zalo_scan_qr_title', 'Scan the QR code to log in to Zalo')}
                </div>
                <div className="text-[13px] text-textItemBlur leading-[1.6]">
                  {t('zalo_scan_qr_hint', 'Open Zalo on your phone → the QR icon → scan the code beside it.')}
                </div>
                <div>
                  <SimpleButton onClick={reconnectZalo}>
                    {t('zalo_generate_qr', 'Generate new QR')}
                  </SimpleButton>
                </div>
              </div>
            </div>
          )}

          {/* Kết nối Media Hub (chỉ khi chưa có key) */}
          {!cfg.hasKey && (
            <Card>
              <div className="flex items-center gap-[12px]">
                <StepBadge step="1" />
                <div className="flex-1">
                  <div className="text-[15px] font-[600]">
                    {t('zalo_connect_media_hub', 'Connect to Media Hub')}
                  </div>
                  <div className="text-[12.5px] text-textItemBlur mt-[2px]">
                    {t('zalo_connect_hint_1', 'Paste the Media Hub API key (')}
                    <b>{t('zalo_connect_hint_path', 'Settings → Public API → create key')}</b>
                    {t('zalo_connect_hint_2', '). The publishing channel is chosen per group below.')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-[8px] flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <Input
                    value={postizKey}
                    disableForm={true}
                    removeError={true}
                    type="password"
                    onChange={(e: any) => setPostizKey(e.target.value)}
                    name="postizKey"
                    label=""
                    placeholder={t('zalo_key_placeholder', 'paste Media Hub API key…')}
                  />
                </div>
                <PrimaryButton onClick={() => save()} disabled={!postizKey.trim()}>
                  {t('zalo_save_key', 'Save key')}
                </PrimaryButton>
              </div>
            </Card>
          )}

          {/* Bài đã gom (lịch sử) — duyệt/sửa/đăng làm ở Calendar (bài tự vào Nháp) */}
          {!!overview?.pendingCount && (
            <div
              className="border border-newTableBorder rounded-[12px] px-[16px] py-[12px] flex items-center gap-[10px] flex-wrap"
            >
              <span className="text-[15px]">🗂</span>
              <span className="text-[13.5px] flex-1 min-w-[220px]">
                {t(
                  'zalo_history_banner',
                  '{{n}} posts collected from Zalo groups — each is already a draft in the Calendar'
                ).replace('{{n}}', String(overview.pendingCount))}
              </span>
              <a
                href="/launches"
                onClick={(e) => e.stopPropagation()}
                className="text-[13px] font-[600] text-btnPrimary whitespace-nowrap mobile:min-h-[44px] mobile:inline-flex mobile:items-center"
              >
                {t('zalo_history_banner_open', 'Open Calendar →')}
              </a>
            </div>
          )}

          {/* Nhóm Zalo + trạng thái gom realtime — thu gọn mặc định */}
          <Card
            title={
              <div className="flex items-center w-full gap-[10px]">
                <span
                  onClick={() => setGroupsOpen((v) => !v)}
                  className="flex-1 cursor-pointer select-none flex items-center gap-[6px] mobile:min-h-[36px]"
                >
                  <span
                    className={clsx(
                      'inline-block transition-transform text-[10px]',
                      groupsOpen && 'rotate-90'
                    )}
                  >
                    ▶
                  </span>
                  {t('zalo_listening_groups', 'Zalo groups being listened to')} ({listeningCount}/{routes.length})
                </span>
                {zaloLogged && groupsOpen && (
                  <span
                    onClick={() => loadGroups(true)}
                    className="cursor-pointer normal-case tracking-normal font-[600] text-btnPrimary mobile:min-h-[36px] mobile:inline-flex mobile:items-center"
                  >
                    ↻ {t('zalo_refresh', 'Refresh')}
                  </span>
                )}
              </div>
            }
          >
            {groupsOpen && (
            <>
            {!routes.length && !groups.length && (
              <div className="text-[13px] text-textItemBlur leading-[1.6]">
                {!zaloLogged
                  ? t('zalo_login_first', 'Log in to Zalo (scan the QR above), then come back here to choose groups to listen to.')
                  : groupsLoading
                  ? t('zalo_groups_loading', 'Loading the Zalo group list — the first time can take 10–30 seconds…')
                  : t('zalo_no_groups_yet', 'No groups found yet. Send any message into a Zalo group so the bot can see it, then click "Refresh".')}
              </div>
            )}

            {!!unroutedListening && (
              <div className="text-[12.5px] text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-[8px] px-[12px] py-[8px] leading-[1.5]">
                ⚠ {t('zalo_unrouted_warn_1', 'There are')} <b>{unroutedListening}</b>{' '}
                {t(
                  'zalo_unrouted_warn_2',
                  'listened groups without a publishing channel selected — their images will not be pushed anywhere. Pick a channel in the box on the right of each group.'
                )}
              </div>
            )}

            {!!routes.length && (
              <div className="flex flex-col">
                {routes.map((r) => {
                  const lt = liveByThread.get(String(r.threadId));
                  const gathering =
                    lt &&
                    (lt.phase === 'listening' || lt.phase === 'prelisten') &&
                    (lt.counts?.image || 0) + (lt.counts?.video || 0) > 0;
                  return (
                    <div
                      key={r.threadId}
                      className="flex items-center gap-[12px] py-[9px] mobile:py-[12px] border-b border-newTableBorder last:border-b-0 hover:bg-boxHover px-[8px] -mx-[8px] rounded-[6px] flex-wrap"
                    >
                      <div className="w-[34px] h-[34px] rounded-[8px] bg-btnSimple flex items-center justify-center text-[15px] shrink-0">
                        💬
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[14px] font-[600] truncate">{r.label || r.threadId}</div>
                        <div
                          className={clsx(
                            'text-[11.5px]',
                            gathering || lt?.phase === 'processing'
                              ? 'text-btnPrimary font-[600]'
                              : 'text-textItemBlur'
                          )}
                        >
                          {r.enabled ? liveLabel(lt) : t('zalo_listening_off', 'Listening off')}
                        </div>
                      </div>
                      {gathering && (
                        <span
                          onClick={() => closeSession(r.threadId, r.label || r.threadId)}
                          className="cursor-pointer text-[12.5px] font-[600] text-btnPrimary whitespace-nowrap mobile:min-h-[36px] mobile:inline-flex mobile:items-center"
                        >
                          {t('zalo_close_now', 'Close now →')}
                        </span>
                      )}
                      {!!channels.length && (
                        <>
                          {/* Mobile: ngắt xuống hàng 2 — select kênh + công tắc to, thao tác một tay */}
                          <div className="hidden mobile:block basis-full h-0" />
                          <select
                            value={r.postizIntegrationId || ''}
                            onChange={(e) => setGroupChannel(r.threadId, r.label || r.threadId, e.target.value)}
                            title={t('zalo_channel_select_title', "The Media Hub channel that receives this group's posts")}
                            className={clsx(
                              'border rounded-[6px] h-[30px] px-[6px] text-[12px] outline-none cursor-pointer max-w-[180px] shrink-0 mobile:h-[44px] mobile:rounded-[8px] mobile:px-[10px] mobile:flex-1 mobile:max-w-none',
                              r.enabled && !r.postizIntegrationId
                                ? 'bg-amber-400/10 border-amber-400/50 text-amber-400'
                                : 'bg-newBgColorInner border-newTableBorder'
                            )}
                          >
                          <option value="">
                            {r.enabled
                              ? t('zalo_pick_channel', '⚠ Pick a channel…')
                              : t('zalo_no_channel_selected', '— No channel selected —')}
                          </option>
                          {channels
                            .filter((ch) => isSupportedChannel(ch.identifier))
                            .map((ch) => (
                              <option key={ch.id} value={ch.id}>
                                → {channelLabel(ch)}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <Toggle
                        small
                        on={r.enabled}
                        onChange={() => toggleGroup(r.threadId, r.label || r.threadId, !r.enabled)}
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {zaloLogged && !!groups.length && (
              <div className="flex flex-col gap-[8px]">
                <div className="text-[12.5px] font-[600] text-textItemBlur">
                  {t('zalo_add_group_to_listen', 'Add a group to listen to:')}
                </div>
                <input
                  value={groupSearch}
                  onChange={(e) => setGroupSearch(e.target.value)}
                  placeholder={t('zalo_search_group', 'Search groups…')}
                  className="bg-newBgColorInner border-newTableBorder border rounded-[8px] h-[38px] mobile:h-[44px] px-[12px] text-[13px] outline-none"
                />
                <div className="max-h-[220px] overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner flex flex-col">
                  {unlistenedGroups.map((g) => (
                    <div
                      key={g.threadId}
                      className="flex items-center gap-[12px] py-[8px] border-b border-newTableBorder last:border-b-0 px-[8px] -mx-[8px] hover:bg-boxHover rounded-[6px]"
                    >
                      <div className="flex-1 min-w-0 text-[13.5px] truncate">{g.name}</div>
                      <span
                        onClick={() => toggleGroup(g.threadId, g.name, true)}
                        className="cursor-pointer text-[13px] font-[600] text-btnPrimary whitespace-nowrap mobile:min-h-[44px] mobile:inline-flex mobile:items-center"
                      >
                        + {t('zalo_listen_this_group', 'Listen to this group')}
                      </span>
                    </div>
                  ))}
                  {!unlistenedGroups.length && (
                    <div className="text-[12.5px] text-textItemBlur py-[6px]">
                      {t('zalo_no_matching_groups', 'No more groups match your search.')}
                    </div>
                  )}
                </div>
              </div>
            )}
            </>
            )}
          </Card>

          {/* Điều khiển nhanh — toggle nhỏ gọn góc dưới */}
          <div className="flex items-center gap-[16px] flex-wrap pt-[4px] text-[13px] text-textItemBlur">
            {/* Cầu nối tự động: toggle nhỏ (trước là 1 Card lớn) */}
            <div
              onClick={() => cfg.hasKey && save(!cfg.enabled)}
              title={
                !cfg.hasKey
                  ? t('zalo_connect_hub_first', 'Connect Media Hub first')
                  : t(
                      'zalo_auto_bridge_hint',
                      'New images from listened groups → posts awaiting review on Calendar.'
                    )
              }
              className={clsx(
                'flex items-center gap-[8px] select-none mobile:min-h-[44px]',
                cfg.hasKey ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
              )}
            >
              <Toggle
                small
                on={cfg.enabled}
                disabled={!cfg.hasKey}
                onChange={() => cfg.hasKey && save(!cfg.enabled)}
              />
              <span className={cfg.enabled ? 'text-green-500 font-[600]' : ''}>
                {t('zalo_auto_bridge', 'Automatic bridge')}
              </span>
            </div>
            <div className="w-[1px] h-[16px] bg-newTableBorder" />
            {/* Tạm dừng bot */}
            <div onClick={togglePause} className="flex items-center gap-[8px] cursor-pointer select-none mobile:min-h-[44px]">
              <Toggle small on={!!overview?.paused} onChange={togglePause} />
              <span className={overview?.paused ? 'text-red-500 font-[600]' : ''}>
                {overview?.paused ? t('zalo_paused', 'Paused') : t('zalo_pause_bot', 'Pause bot')}
              </span>
            </div>
          </div>

          {/* Bài viết hiện LUÔN dưới Tổng quan — khỏi tab riêng */}
          <div className="pt-[8px] mt-[4px] border-t border-newTableBorder">
            <ZaloPostsTab onChanged={loadAll} />
          </div>
        </>
      )}

      {/* ============================ CÁC TAB KHÁC ============================ */}
      {tab === 'routes' && <ZaloRoutesTab zaloLogged={zaloLogged} onChanged={loadAll} />}
      {tab === 'settings' && (
        <>
          <ZaloSettingsTab onChanged={loadAll} />
          {/* Nhật ký dời vào cuối Cài đặt (trước là tab riêng) */}
          <div className="mt-[20px] pt-[16px] border-t border-newTableBorder">
            <div className="text-[14px] font-[600] mb-[10px]">
              {t('zalo_tab_logs', 'Log')}
            </div>
            <ZaloLogsTab />
          </div>
        </>
      )}
    </div>
  );
};

export default ZaloComponent;
