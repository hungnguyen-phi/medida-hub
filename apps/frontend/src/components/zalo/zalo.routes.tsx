'use client';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  bot,
  BotRoute,
  BotRoutesFile,
  Card,
  channelLabel,
  DangerLink,
  FieldLabel,
  HubChannel,
  inputCls,
  isSupportedChannel,
  PrimaryButton,
  selectCls,
  SimpleButton,
  StatusChip,
  Toggle,
  ZaloGroup,
} from './zalo.shared';

// ============================================================================
//  Tab "Nhóm → Trang" — mỗi nhóm Zalo nguồn nối tới MỘT kênh Media Hub (bài
//  thành bản nháp chờ duyệt trên Lịch). Facebook KHÔNG còn đăng thẳng từ bot:
//  Trang đã kết nối trong Media Hub, bài thành bản nháp chờ duyệt và Hub tự
//  chèn CHÂN BÀI của kênh (cài trong Lịch) dưới caption, trên hashtag.
//  Google Business cũng vậy — trước bot tự đăng bằng Playwright, nay nối bằng
//  GMB API chính thức nên chọn nó như mọi kênh Media Hub khác.
//  Lưu = ghi nguyên file routes.json của bot.
// ============================================================================

const newRoute = (): BotRoute => ({
  threadId: '',
  label: '',
  fanpageId: '',
  fanpageTokenEnv: '',
  published: false,
  facebookAutoPublish: false,
  enabled: true,
  curateImages: true,
  autoHashtags: true,
  captionFooter: '',
  postizIntegrationIds: [],
  postizIntegrationId: '',
  debounceMs: 600000,
  maxWaitMs: 1800000,
});

// Kênh đích của route (chuẩn hoá): mảng mới postizIntegrationIds, có fallback
// về field cũ postizIntegrationId (routes.json bản trước chỉ lưu 1 kênh).
const routeChannelIds = (r: BotRoute): string[] => {
  if (Array.isArray(r.postizIntegrationIds) && r.postizIntegrationIds.length) {
    return r.postizIntegrationIds.filter(Boolean);
  }
  return r.postizIntegrationId ? [r.postizIntegrationId] : [];
};

export const ZaloRoutesTab: FC<{ zaloLogged: boolean; onChanged?: () => void }> = ({
  zaloLogged,
  onChanged,
}) => {
  const t = useT();
  const toast = useToaster();

  const [file, setFile] = useState<BotRoutesFile | null>(null);
  const [groups, setGroups] = useState<ZaloGroup[] | null>(null);
  const [channels, setChannels] = useState<HubChannel[]>([]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [adv, setAdv] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [legacyGbp, setLegacyGbp] = useState(0);

  const load = useCallback(async () => {
    try {
      const f = await bot('/api/routes');
      if (f && Array.isArray(f.routes)) {
        const defs = f.defaults || {};
        f.routes.forEach((r: BotRoute) => {
          if (r.debounceMs == null) r.debounceMs = defs.debounceMs ?? 600000;
          if (r.maxWaitMs == null) r.maxWaitMs = defs.maxWaitMs ?? 1800000;
          // Nâng field cũ 1-kênh → mảng nhiều-kênh (tương thích routes.json cũ).
          if (!Array.isArray(r.postizIntegrationIds)) {
            r.postizIntegrationIds = r.postizIntegrationId
              ? [r.postizIntegrationId]
              : [];
          }
        });
        // routes.json còn sót cấu hình Google Business cũ = bot VẪN tự đăng bằng
        // Playwright (nó đọc thẳng file này, không qua UI). Bật sẵn cờ chưa-lưu
        // để mở khoá nút Lưu — save() sẽ dọn sạch gbp*.
        const legacy = f.routes.filter(
          (r: BotRoute) =>
            r.gbpLocationIds?.length || r.gbpLocationId || r.gbpAutoPublish
        ).length;
        setLegacyGbp(legacy);
        setFile(f);
        setDirty(legacy > 0);
        // Nhóm chưa đủ thông tin (thiếu nhóm nguồn) thì tự mở sẵn để điền tiếp.
        setOpen(new Set(f.routes.map((r: BotRoute, i: number) => (!r.threadId ? i : -1)).filter((i: number) => i >= 0)));
      }
    } catch {
      toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
    }
    bot('/api/postiz/integrations')
      .then((r) => r?.ok && setChannels(r.integrations || []))
      .catch(() => {});
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (zaloLogged && groups === null) {
      bot('/api/zalo/groups', undefined, 60000)
        .then((g) => setGroups(Array.isArray(g) ? g : []))
        .catch(() => setGroups([]));
    }
  }, [zaloLogged, groups]);

  const routes = file?.routes || [];

  const patch = useCallback((i: number, p: Partial<BotRoute>) => {
    setFile((cur) => {
      if (!cur) return cur;
      const next = { ...cur, routes: cur.routes.map((r, j) => (j === i ? { ...r, ...p } : r)) };
      return next;
    });
    setDirty(true);
  }, []);

  const usedThreadIds = useMemo(() => new Set(routes.map((r) => String(r.threadId))), [routes]);

  const save = useCallback(async () => {
    if (!file) return;
    // Chuẩn hoá: Facebook KHÔNG còn đăng thẳng từ bot (đi qua kênh Media Hub),
    // chân bài route cũng bỏ — Hub tự chèn chân bài của kênh lúc tạo bài.
    for (let i = 0; i < file.routes.length; i++) {
      const r = file.routes[i];
      r.fanpageId = '';
      r.fanpageTokenEnv = '';
      r.facebookAutoPublish = false;
      r.captionFooter = '';
      // Google Business rời khỏi route: nay nối bằng GMB API chính thức nên nó
      // là kênh Media Hub bình thường, bot hết phải đăng bằng Playwright. DỌN
      // hẳn cấu hình cũ khỏi routes.json để bot thôi tự đăng theo đường cũ.
      r.gbpLocationIds = [];
      r.gbpLocationId = '';
      r.gbpAutoPublish = false;
      // Kênh đích: chuẩn hoá mảng + GIỮ postizIntegrationId = phần tử đầu để bot
      // bản CŨ (đọc field đơn) vẫn đăng được ít nhất kênh chính khi chưa cập nhật.
      const chIds = routeChannelIds(r);
      r.postizIntegrationIds = chIds;
      r.postizIntegrationId = chIds[0] || '';
      if (!r.threadId) {
        toast.show(
          t('zalo_routes_missing_thread', 'Route {{n}} ({{name}}) has no Zalo group selected')
            .replace('{{n}}', String(i + 1))
            .replace('{{name}}', r.label || t('zalo_routes_unnamed', 'unnamed')),
          'warning'
        );
        return;
      }
      if (!chIds.length) {
        toast.show(
          t('zalo_routes_missing_target', 'Route {{n}} ({{name}}): chọn kênh Media Hub để bài có đích đến.')
            .replace('{{n}}', String(i + 1))
            .replace('{{name}}', r.label || t('zalo_routes_unnamed', 'unnamed')),
          'warning'
        );
        return;
      }
      if (r.debounceMs && r.maxWaitMs && r.maxWaitMs < r.debounceMs) {
        toast.show(
          t('zalo_routes_maxwait_lt', 'Route {{n}}: "Max per session" must be ≥ "Close after silence".').replace('{{n}}', String(i + 1)),
          'warning'
        );
        return;
      }
    }
    setSaving(true);
    try {
      const r = await bot('/api/routes', { method: 'POST', body: JSON.stringify(file) }, 30000);
      if (r?.error) toast.show(r.error, 'warning');
      else {
        toast.show(
          r.footerUpdated
            ? t('zalo_routes_saved_footer', 'Saved — footer refreshed on {{n}} pending posts').replace('{{n}}', String(r.footerUpdated))
            : t('zalo_routes_saved', 'Configuration saved'),
          'success'
        );
        setDirty(false);
        onChanged?.();
        load();
      }
    } catch {
      toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
    } finally {
      setSaving(false);
    }
  }, [file, load, onChanged, t]);

  const remove = useCallback(
    async (i: number) => {
      const r = routes[i];
      if (
        !(await deleteDialog(
          t('zalo_routes_delete_confirm', 'Delete "{{name}}" from the configuration? Published posts are not affected.').replace(
            '{{name}}',
            r?.label || `#${i + 1}`
          ),
          t('zalo_routes_delete', 'Delete route')
        ))
      )
        return;
      setFile((cur) => (cur ? { ...cur, routes: cur.routes.filter((_, j) => j !== i) } : cur));
      setDirty(true);
    },
    [routes, t]
  );

  if (file === null) {
    return (
      <div className="text-[13px] text-textItemBlur py-[30px] text-center">
        {t('zalo_routes_loading', 'Loading configuration from the bot…')}
      </div>
    );
  }

  return (
    // Chừa chỗ cho thanh Lưu fixed đáy trên mobile khi có thay đổi chưa lưu
    <div className={clsx('flex flex-col gap-[14px]', dirty && 'mobile:pb-[76px]')}>
      {!!legacyGbp && (
        <div className="text-[12.5px] leading-[1.6] text-amber-400 border border-amber-400/40 bg-amber-400/10 rounded-[12px] px-[16px] py-[12px] max-w-[720px]">
          {t(
            'zalo_routes_legacy_gbp',
            '⚠ {{n}} nhóm còn cấu hình Google Business kiểu cũ — bot VẪN đang tự đăng lên Google bằng trình duyệt ngầm. Bấm "Lưu cấu hình" để dọn hẳn. Sau đó muốn đăng Google Business thì chọn kênh Google Business ở ô kênh Media Hub của nhóm.'
          ).replace('{{n}}', String(legacyGbp))}
        </div>
      )}

      {!routes.length && (
        <div className="text-[13px] text-textItemBlur border border-dashed border-newTableBorder rounded-[12px] px-[16px] py-[14px]">
          {t('zalo_routes_empty_title', 'Chưa nối nhóm nào — bấm "+ Thêm nhóm" bên dưới để bắt đầu.')}
        </div>
      )}

      {routes.map((r, i) => {
        const isOpen = open.has(i);
        const advOpen = adv.has(i);
        return (
          <div key={i} className="border border-newTableBorder rounded-[12px] overflow-hidden">
            {/* Header thẻ route */}
            <div
              onClick={() =>
                setOpen((cur) => {
                  const next = new Set(cur);
                  if (next.has(i)) next.delete(i);
                  else next.add(i);
                  return next;
                })
              }
              className="flex items-center gap-[10px] p-[14px] cursor-pointer hover:bg-boxHover flex-wrap"
            >
              <b className="text-[14px] flex-1 min-w-[140px] truncate">
                {r.label || t('zalo_routes_route_n', 'Route {{n}}').replace('{{n}}', String(i + 1))}
              </b>
              <StatusChip tone={r.enabled !== false ? 'ok' : 'off'}>
                {r.enabled !== false ? t('zalo_on', 'On') : t('zalo_off', 'Off')}
              </StatusChip>
              {(() => {
                const n = routeChannelIds(r).length;
                return (
                  <StatusChip tone={n ? 'wait' : 'warn'}>
                    {n
                      ? t('zalo_routes_hub_draft_n', '→ {{n}} kênh · nháp chờ duyệt').replace('{{n}}', String(n))
                      : t('zalo_routes_hub_missing', 'Chưa chọn kênh Media Hub')}
                  </StatusChip>
                );
              })()}
              <span className="text-textItemBlur text-[12px]">{isOpen ? '▾' : '▸'}</span>
            </div>

            {isOpen && (
              <div className="p-[14px] pt-0 flex flex-col gap-[12px]">
                {/* Tên hiển thị */}
                <div className="flex flex-col gap-[5px]">
                  <FieldLabel>{t('zalo_routes_label', 'Display name')}</FieldLabel>
                  <input
                    value={r.label || ''}
                    onChange={(e) => patch(i, { label: e.target.value })}
                    placeholder={t('zalo_routes_label_ph', 'e.g. Kindergarten class → Việt Anh Page')}
                    className={inputCls}
                  />
                </div>

                {/* Nguồn + đích */}
                <div className="grid grid-cols-1 md:grid-cols-2 mobile:grid-cols-1 gap-[10px]">
                  <div className="flex flex-col gap-[5px]">
                    <FieldLabel hint={t('zalo_routes_group_hint', 'The group whose images are collected.')}>
                      {t('zalo_routes_group', 'Zalo group (source)')}
                    </FieldLabel>
                    {groups && groups.length ? (
                      <select
                        value={r.threadId || ''}
                        onChange={(e) => {
                          const g = groups.find((x) => String(x.threadId) === e.target.value);
                          patch(i, {
                            threadId: e.target.value,
                            label: r.label || g?.name || '',
                          });
                        }}
                        className={selectCls}
                      >
                        <option value="">{t('zalo_routes_pick_group', '— Pick a group —')}</option>
                        {r.threadId && !groups.some((g) => String(g.threadId) === String(r.threadId)) && (
                          <option value={r.threadId}>{r.label || r.threadId}</option>
                        )}
                        {groups.map((g) => (
                          <option
                            key={g.threadId}
                            value={g.threadId}
                            disabled={usedThreadIds.has(String(g.threadId)) && String(g.threadId) !== String(r.threadId)}
                          >
                            {g.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={r.threadId || ''}
                        onChange={(e) => patch(i, { threadId: e.target.value })}
                        placeholder={t('zalo_routes_thread_ph', 'Group ID (threadId)')}
                        className={inputCls}
                      />
                    )}
                  </div>
                  <div className="flex flex-col gap-[5px]">
                    <FieldLabel>
                      {t('zalo_routes_hub_channel', 'Kênh Media Hub (chọn nhiều)')}
                    </FieldLabel>
                    {(() => {
                      const sel = routeChannelIds(r);
                      const list = channels.filter((ch) => isSupportedChannel(ch.identifier));
                      if (!list.length)
                        return (
                          <div className="text-[12px] text-textItemBlur">
                            {t('zalo_routes_no_channels', 'Chưa có kênh nào — kết nối kênh ở Lịch → Add Channel.')}
                          </div>
                        );
                      const toggle = (id: string) =>
                        patch(i, {
                          postizIntegrationIds: sel.includes(id)
                            ? sel.filter((x) => x !== id)
                            : [...sel, id],
                        });
                      return (
                        <div className="flex gap-[8px] flex-wrap">
                          {list.map((ch) => {
                            const on = sel.includes(ch.id);
                            return (
                              <label
                                key={ch.id}
                                className={clsx(
                                  'flex items-center gap-[6px] text-[12.5px] font-[600] border rounded-[8px] px-[10px] h-[32px] mobile:h-[40px] mobile:px-[14px] cursor-pointer tap-shrink',
                                  on ? 'border-btnPrimary text-btnPrimary bg-btnPrimary/10' : 'border-newTableBorder text-textItemBlur'
                                )}
                              >
                                <input type="checkbox" hidden checked={on} onChange={() => toggle(ch.id)} />
                                {on ? '✓ ' : ''}
                                {channelLabel(ch)}
                              </label>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Công tắc chính */}
                <div className="flex items-center gap-[18px] flex-wrap mobile:gap-x-[16px] mobile:gap-y-0">
                  <label className="flex items-center gap-[8px] text-[13px] font-[600] cursor-pointer mobile:min-h-[44px]">
                    <Toggle small on={r.enabled !== false} onChange={() => patch(i, { enabled: !(r.enabled !== false) })} />
                    {t('zalo_routes_enabled', 'Listen to this group')}
                  </label>
                  <label
                    className="flex items-center gap-[8px] text-[13px] font-[600] cursor-pointer mobile:min-h-[44px]"
                    title={t('zalo_routes_curate_title', 'On: AI drops duplicate/blurry/dark images and picks the best ones. Off: keep every image.')}
                  >
                    <Toggle small on={r.curateImages !== false} onChange={() => patch(i, { curateImages: !(r.curateImages !== false) })} />
                    {t('zalo_routes_curate', 'Curate images')}
                  </label>
                </div>

                {/* Nâng cao: thời gian · bình luận · hướng dẫn viết · hashtag */}
                <div
                  onClick={() =>
                    setAdv((cur) => {
                      const next = new Set(cur);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className="border-t border-newTableBorder pt-[10px] flex items-center justify-between cursor-pointer mobile:min-h-[44px]"
                >
                  <b className="text-[13px]">{t('zalo_routes_advanced', 'Advanced settings')}</b>
                  <span className="text-[11.5px] text-textItemBlur">
                    {t('zalo_routes_advanced_sub3', 'thời gian gom bài · hashtag')}{' '}
                    {advOpen ? '▾' : '▸'}
                  </span>
                </div>
                {advOpen && (
                  <div className="flex flex-col gap-[12px]">
                    <div className="grid grid-cols-1 md:grid-cols-2 mobile:grid-cols-1 gap-[10px]">
                      <div className="flex flex-col gap-[5px]">
                        <FieldLabel
                          hint={t('zalo_routes_debounce_hint', 'After the group goes quiet this long, the batch closes and a draft is created.')}
                        >
                          {t('zalo_routes_debounce', 'Close after silence (minutes)')}
                        </FieldLabel>
                        <input
                          type="number"
                          min={0.1}
                          step={0.5}
                          value={Math.round(((r.debounceMs || 600000) / 60000) * 10) / 10}
                          onChange={(e) =>
                            patch(i, { debounceMs: Math.max(5000, Math.round(Number(e.target.value || 0) * 60000)) })
                          }
                          className={inputCls}
                        />
                      </div>
                      <div className="flex flex-col gap-[5px]">
                        <FieldLabel
                          hint={t('zalo_routes_maxwait_hint', 'Hard cap — the batch always closes after this long even if images keep coming.')}
                        >
                          {t('zalo_routes_maxwait', 'Max per session (minutes)')}
                        </FieldLabel>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={Math.round((r.maxWaitMs || 1800000) / 60000)}
                          onChange={(e) =>
                            patch(i, { maxWaitMs: Math.max(30000, Math.round(Number(e.target.value || 0) * 60000)) })
                          }
                          className={inputCls}
                        />
                      </div>
                    </div>
                    <div className="text-[12px] text-textItemBlur border border-dashed border-newTableBorder rounded-[8px] px-[10px] py-[8px] leading-[1.6]">
                      {t(
                        'zalo_routes_footer_moved',
                        'Chân bài (hotline/địa chỉ) nay cài MỘT LẦN cho từng kênh trong Lịch — bấm avatar kênh trên trang Lịch. Hub tự chèn vào mọi bài của kênh, kể cả bản nháp từ Zalo.'
                      )}
                    </div>
                    <label className="flex items-center gap-[8px] text-[13px] font-[600] cursor-pointer w-fit mobile:min-h-[44px]">
                      <Toggle small on={r.autoHashtags !== false} onChange={() => patch(i, { autoHashtags: !(r.autoHashtags !== false) })} />
                      {t('zalo_routes_hashtags', 'AI adds 5 hashtags at the end (below the footer)')}
                    </label>
                  </div>
                )}

                <div className="border-t border-newTableBorder pt-[10px]">
                  <DangerLink onClick={() => remove(i)}>
                    🗑 {t('zalo_routes_delete', 'Delete route')}
                  </DangerLink>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-[10px] flex-wrap">
        {/* Mobile ẩn nút Lưu inline — thay bằng thanh fixed đáy khi dirty */}
        <PrimaryButton className="mobile:hidden" disabled={saving || !dirty} onClick={save}>
          {saving ? t('zalo_routes_saving', 'Saving…') : t('zalo_routes_save', 'Save configuration')}
        </PrimaryButton>
        <SimpleButton
          onClick={() => {
            setFile((cur) => (cur ? { ...cur, routes: [...cur.routes, newRoute()] } : cur));
            setOpen((cur) => new Set([...cur, routes.length]));
            setDirty(true);
          }}
        >
          + {t('zalo_routes_add', 'Add group')}
        </SimpleButton>
        {dirty && (
          <span className="text-[12.5px] text-amber-400 font-[600] mobile:hidden">
            {t('zalo_routes_unsaved', 'Unsaved changes')}
          </span>
        )}
        {groups === null && zaloLogged && (
          <span className="text-[12px] text-textItemBlur">
            {t('zalo_routes_groups_loading', 'Loading group list… (first time can take 10–30s)')}
          </span>
        )}
      </div>

      {/* Mobile: thanh Lưu dính trên tab bar dưới — hành động chính luôn trong tầm ngón cái */}
      {dirty && (
        <div className="hidden mobile:flex fixed bottom-[var(--bottom-nav-h,64px)] inset-x-0 z-[120] bg-newBgColorInner border-t border-newTableBorder p-[10px] items-center gap-[10px]">
          <span className="text-[12px] text-amber-400 font-[600] flex-1 min-w-0">
            {t('zalo_routes_unsaved', 'Unsaved changes')}
          </span>
          <PrimaryButton className="!h-[44px] tap-shrink" disabled={saving} onClick={save}>
            {saving ? t('zalo_routes_saving', 'Saving…') : t('zalo_routes_save', 'Save configuration')}
          </PrimaryButton>
        </div>
      )}
    </div>
  );
};
