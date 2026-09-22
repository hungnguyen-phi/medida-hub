'use client';

import {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';

// Filerobot Image Editor (MIT, miễn phí, KHÔNG cần license key, KHÔNG watermark)
// — thay cho Polotno để sửa/thiết kế ảnh cho bài đăng. Nạp động ssr:false vì
// editor đụng tới `window`/`document` ngay khi import (import tĩnh sẽ vỡ SSR).
const FilerobotImageEditor = dynamic(
  () => import('react-filerobot-image-editor'),
  { ssr: false }
);

// Tab (đúng giá trị enum TABS của Filerobot) để chuỗi cho khỏi phải import enum
// (import enum cũng kéo theo module đụng `window`).
const TABS = ['Annotate', 'Adjust', 'Filters', 'Finetune', 'Resize', 'Watermark'];

// Nền trắng 1080x1080 (tỉ lệ vuông social) làm ảnh nguồn khi thiết kế từ đầu.
const makeBlankCanvas = () => {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1080;
  const ctx = c.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 1080, 1080);
  }
  return c.toDataURL('image/png');
};

const FilerobotEditor: FC<{
  setMedia: (params: { id: string; path: string }[]) => void;
  // Có source (URL/base64 ảnh đã có) → mở để SỬA ảnh đó; không có → nền trắng.
  source?: string;
  type?: 'image' | 'video';
  closeModal: () => void;
  width?: number;
  height?: number;
}> = ({ setMedia, source: initialSource, closeModal }) => {
  const t = useT();
  const fetch = useFetch();
  const [saving, setSaving] = useState(false);
  // Ảnh nguồn: có thể đổi bằng nút "Tải ảnh lên để sửa".
  const [source, setSource] = useState<string | undefined>(initialSource);
  const fileRef = useRef<HTMLInputElement>(null);

  // Trong lúc mở editor, tắt nút thoát mặc định của composer (giống Polotno cũ).
  const setActivateExitButton = useLaunchStore((e) => e.setActivateExitButton);
  useEffect(() => {
    setActivateExitButton(false);
    return () => {
      setActivateExitButton(true);
    };
  }, []);

  const src = useMemo(() => source || makeBlankCanvas(), [source]);

  // Chọn ảnh từ máy → đọc thành data URL → đặt làm ảnh nguồn để sửa trực tiếp.
  const onPickFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setSource(reader.result as string);
    reader.readAsDataURL(f);
    // reset để chọn lại cùng 1 file vẫn kích hoạt onChange
    e.target.value = '';
  }, []);

  // Việt hoá nhãn nút Save (memo ổn định để editor không bị reset mỗi render).
  const translations = useMemo(
    () => ({ save: t('use_this_media', 'Use this media') }),
    [t]
  );

  // Bấm "Save" → bỏ qua hộp thoại tải file mặc định, lưu thẳng ảnh vào Media Hub.
  const onBeforeSave = useCallback(() => false, []);

  const onSave = useCallback(
    async (edited: any /* savedImageData */) => {
      if (saving) return;
      const dataUrl: string = edited?.imageBase64;
      if (!dataUrl) return;
      setSaving(true);
      try {
        // data URL -> Blob (fetch của trình duyệt, KHÔNG dùng useFetch vì nó gắn base URL API)
        const blob = await (await window.fetch(dataUrl)).blob();
        const formData = new FormData();
        formData.append('file', blob, edited?.fullName || 'design.png');
        const data = await (
          await fetch('/media/upload-simple', {
            method: 'POST',
            body: formData,
          })
        ).json();
        setMedia([{ id: data.id, path: data.path }]);
        closeModal();
      } finally {
        setSaving(false);
      }
    },
    [saving, fetch, setMedia, closeModal]
  );

  return (
    <div className="bg-white text-black relative z-[400] filerobot-wrap flex flex-col h-full min-h-0 overflow-hidden">
      {/* Thanh công cụ trên: tiêu đề + tải ảnh / nền trắng + đóng */}
      <div className="shrink-0 flex items-center gap-[8px] px-[12px] py-[8px] border-b border-[#e5e7eb] bg-[#fafafa]">
        <span className="text-[14px] font-[700] text-[#111827] me-[6px] whitespace-nowrap">
          {t('design_media', 'Design Media')}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPickFile}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-[6px] rounded-[8px] bg-[#2563eb] text-white text-[13px] font-[600] px-[12px] py-[7px] hover:bg-[#1d4ed8] transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('upload_image_to_edit', 'Upload image to edit')}
        </button>
        {source && (
          <button
            type="button"
            onClick={() => setSource(undefined)}
            className="text-[13px] text-[#6b7280] hover:text-[#111827] px-[8px] py-[7px]"
          >
            {t('blank_canvas', 'Blank canvas')}
          </button>
        )}
      </div>

      {/* Vùng editor lấp đầy phần còn lại của modal. Nền xám nhạt để canvas
          TRẮNG nổi rõ (trước đây trắng-trên-trắng → nhìn như editor vỡ). */}
      <div className="flex-1 min-h-0 relative bg-[#e9edf2]">
        {/* Gợi ý cho trạng thái canvas trắng — hướng dẫn người mới bắt đầu. */}
        {!source && (
          <div className="pointer-events-none absolute top-[8px] left-1/2 -translate-x-1/2 z-[10] rounded-full bg-[#111827]/85 text-white text-[12px] px-[12px] py-[6px] shadow-md whitespace-nowrap">
            {t(
              'filerobot_blank_hint',
              'Upload an image above, or start typing or drawing right on the blank canvas'
            )}
          </div>
        )}
        <FilerobotImageEditor
          key={src}
          source={src}
          onSave={onSave}
          onBeforeSave={onBeforeSave}
          onClose={closeModal}
          savingPixelRatio={2}
          previewPixelRatio={2}
          tabsIds={TABS as any}
          defaultTabId="Annotate"
          defaultToolId="Text"
          defaultSavedImageName="design"
          defaultSavedImageType="png"
          defaultSavedImageQuality={0.92}
          useBackendTranslations={false}
          translations={translations}
        />
      </div>
    </div>
  );
};

export default FilerobotEditor;
