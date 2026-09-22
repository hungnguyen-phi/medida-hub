'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  bot,
  Card,
  DangerLink,
  fmtFull,
  getBotUrl,
  PrimaryButton,
  SimpleButton,
  StatusChip,
  Toggle,
} from './zalo.shared';

// ============================================================================
//  Tab "Cài đặt" — thay tab Settings của dashboard bot: tạm dừng nhận ảnh,
//  tài khoản Zalo (QR / kết nối lại / đăng xuất giữ-hay-xoá dữ liệu). Key &
//  model Claude nằm ở Settings CHUNG (tự đồng bộ sang bot). + Tab "Nhật ký"
//  (log hoạt động của bot).
//  (2026-09-22: bỏ tính năng "Lọc nhóm hiển thị"/groupAllowlist theo yêu cầu
//  user — dropdown chọn nhóm ở tab Nhóm→Trang giờ luôn hiện ĐỦ mọi nhóm.)
// ============================================================================

export const ZaloSettingsTab: FC<{ onChanged?: () => void }> = ({ onChanged }) => {
  const t = useT();
  const toast = useToaster();

  const [botUrl, setBotUrl] = useState('/botapi');
  useEffect(() => setBotUrl(getBotUrl()), []);

  const [settings, setSettings] = useState<{ paused?: boolean; groupAllowlist?: string[] } | null>(null);
  const [zalo, setZalo] = useState<{
    connected?: boolean;
    relogging?: boolean;
    ownId?: string | null;
    hasCreds?: boolean;
    qr?: boolean;
  } | null>(null);
  const [qrTick, setQrTick] = useState(0);

  const load = useCallback(async () => {
    try {
      const st = await bot('/api/status');
      if (st?.settings) {
        setSettings(st.settings);
        // Tính năng "Lọc nhóm hiển thị" đã bỏ (2026-09-22, yêu cầu user): dropdown
        // chọn nhóm ở tab Nhóm→Trang luôn hiện ĐỦ mọi nhóm. Nếu trước đó đã lưu
        // allowlist thì tự xoá 1 lần ở đây để không còn ai bị lọc ngầm.
        if ((st.settings.groupAllowlist || []).length) {
          bot('/api/settings', {
            method: 'POST',
            body: JSON.stringify({ groupAllowlist: [] }),
          }).catch(() => {});
        }
      }
    } catch {
      /* bot chưa phản hồi */
    }
    bot('/api/zalo/status').then((z) => z && setZalo(z)).catch(() => {});
    setQrTick((v) => v + 1);
  }, []);

  useEffect(() => {
    load();
    // App nền thì bỏ tick — đỡ hao pin/4G
    const i = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 8000);
    return () => clearInterval(i);
  }, [load]);

  const setS = useCallback(
    async (patch: any, okMsg?: string) => {
      try {
        const r = await bot('/api/settings', { method: 'POST', body: JSON.stringify(patch) });
        if (r) setSettings(r);
        toast.show(okMsg || t('zalo_settings_updated', 'Settings updated'), 'success');
        onChanged?.();
      } catch {
        toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
      }
    },
    [onChanged, t]
  );

  const logout = useCallback(
    async (wipe: boolean) => {
      const msg = wipe
        ? t(
            'zalo_settings_logout_wipe_confirm',
            'Log out AND delete old account data (Groups → Pages config + pending posts)? Facebook tokens are kept.'
          )
        : t(
            'zalo_logout_confirm',
            'Log out of the current Zalo account? The bot will show a new QR code to scan another account.'
          );
      if (!(await deleteDialog(msg, t('zalo_logout', 'Log out')))) return;
      try {
        const r = await bot('/api/zalo/logout', { method: 'POST', body: JSON.stringify({ wipe }) });
        if (r?.ok)
          toast.show(t('zalo_logged_out', 'Logged out — scan the new QR code above to log in again'), 'success');
        else toast.show(r?.error || t('zalo_error', 'Error'), 'warning');
        load();
        onChanged?.();
      } catch {
        toast.show(t('zalo_bot_unreachable', 'Cannot reach the Zalo bot'), 'warning');
      }
    },
    [load, onChanged, t]
  );

  if (settings === null) {
    return (
      <div className="text-[13px] text-textItemBlur py-[30px] text-center">
        {t('zalo_settings_loading', 'Loading bot settings…')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[14px]">
      {/* Vận hành */}
      <Card title={t('zalo_settings_ops', 'Vận hành')}>
        <label className="flex items-center gap-[10px] cursor-pointer w-fit mobile:min-h-[44px]">
          <Toggle on={!!settings.paused} onChange={() => setS({ paused: !settings.paused })} />
          <b className="text-[13.5px]">{t('zalo_settings_pause', 'Tạm dừng nhận ảnh (mọi nhóm)')}</b>
        </label>
      </Card>

      {/* Tài khoản Zalo */}
      <Card
        title={
          <div className="flex items-center gap-[10px] w-full">
            <span className="flex-1">{t('zalo_settings_account', 'Zalo account')}</span>
            <StatusChip tone={zalo?.connected ? 'ok' : zalo?.relogging ? 'warn' : 'off'}>
              {zalo?.connected
                ? t('zalo_logged_in', 'Zalo logged in')
                : zalo?.relogging
                ? t('zalo_settings_waiting_qr', 'Waiting for QR scan…')
                : t('zalo_not_logged_in', 'Zalo not logged in')}
            </StatusChip>
          </div>
        }
      >
        <div className="text-[12.5px] text-textItemBlur">
          {zalo?.ownId
            ? t('zalo_settings_own_id', 'ID tài khoản: {{id}}').replace('{{id}}', String(zalo.ownId))
            : zalo?.hasCreds
            ? t('zalo_settings_has_creds', 'Đã có session lưu.')
            : t('zalo_settings_no_creds', 'Chưa đăng nhập tài khoản nào.')}
        </div>
        {!zalo?.connected && zalo?.qr && (
          <div className="w-[190px] h-[190px] rounded-[10px] bg-white flex items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={qrTick}
              src={`${botUrl}/api/zalo/qr?t=${qrTick}`}
              alt={t('zalo_qr_alt', 'Zalo login QR code')}
              className="w-full h-full object-contain"
            />
          </div>
        )}
        <div className="flex items-center gap-[10px] flex-wrap">
          {!zalo?.connected && (
            <PrimaryButton
              className="!h-[36px] mobile:!h-[44px] text-[13px]"
              disabled={!!zalo?.relogging}
              onClick={async () => {
                await bot('/api/zalo/reconnect', { method: 'POST', body: '{}' }).catch(() => {});
                toast.show(t('zalo_generating_qr', 'Generating a new QR code — please wait a few seconds…'), 'success');
                setTimeout(load, 1500);
              }}
            >
              ↻ {t('zalo_settings_reconnect', 'Reconnect')}
            </PrimaryButton>
          )}
          <SimpleButton className="!h-[36px] mobile:!h-[44px] text-[13px]" onClick={() => logout(false)}>
            {t('zalo_settings_logout_keep', 'Log out · KEEP data')}
          </SimpleButton>
          <DangerLink onClick={() => logout(true)}>
            {t('zalo_settings_logout_wipe', 'Log out + DELETE old data')}
          </DangerLink>
        </div>
      </Card>

      {/* Key & model Claude đặt ở Settings CHUNG của Hub — tự đồng bộ sang bot,
          không quản lý key riêng ở đây nữa. */}
      <div className="text-[12.5px] text-textItemBlur leading-[1.6]">
        🤖{' '}
        {t(
          'zalo_settings_claude_moved',
          'The Claude API key & model are managed in the main Settings and sync to the bot automatically.'
        )}{' '}
        <a href="/settings" className="text-btnPrimary font-[600] hover:underline">
          {t('zalo_settings_open_settings', 'Open Settings')} →
        </a>
      </div>
    </div>
  );
};

// ---- Tab Nhật ký -------------------------------------------------------------

export const ZaloLogsTab: FC = () => {
  const t = useT();
  const [logs, setLogs] = useState<{ t: number; line: string }[] | null>(null);

  const load = useCallback(async () => {
    try {
      const l = await bot('/api/logs');
      if (Array.isArray(l)) setLogs(l);
    } catch {
      /* giữ log cũ */
    }
  }, []);

  useEffect(() => {
    load();
    // App nền thì bỏ tick — đỡ hao pin/4G
    const i = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, 8000);
    return () => clearInterval(i);
  }, [load]);

  if (logs === null) {
    return (
      <div className="text-[13px] text-textItemBlur py-[30px] text-center">
        {t('zalo_logs_loading', 'Loading activity log…')}
      </div>
    );
  }

  return (
    <Card title={t('zalo_logs_title', 'Bot activity log')}>
      {logs.length ? (
        <div className="flex flex-col max-h-[560px] overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner">
          {logs.map((l, i) => (
            // Mobile: timestamp lên dòng riêng, nội dung ăn trọn bề ngang
            <div key={i} className="flex gap-[10px] py-[5px] border-b border-newTableBorder last:border-b-0 text-[12.5px] leading-[1.5] mobile:flex-col mobile:gap-[2px] mobile:py-[7px]">
              <span className="text-textItemBlur shrink-0 tabular-nums mobile:text-[11px]">{fmtFull(l.t)}</span>
              <span className="break-words min-w-0">{l.line}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-[13px] text-textItemBlur">{t('zalo_logs_empty', 'No log entries yet.')}</div>
      )}
    </Card>
  );
};
