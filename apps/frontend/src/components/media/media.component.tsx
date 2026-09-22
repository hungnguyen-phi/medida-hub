'use client';

import React, {
  ChangeEvent,
  ClipboardEvent,
  FC,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Button } from '@gitroom/react/form/button';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { Media } from '@prisma/client';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { loadVars } from '@gitroom/react/helpers/variable.context';
import EventEmitter from 'events';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import { useUppyUploader } from '@gitroom/frontend/components/media/new.uploader';
import dynamic from 'next/dynamic';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { AiImage } from '@gitroom/frontend/components/launches/ai.image';
import { DropFiles } from '@gitroom/frontend/components/layout/drop.files';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  FRAME_MAX_TILES,
  FrameVariant,
  frameItemCls,
  frameVariantsFor,
  frameWrapCls,
  resolveFrameVariant,
  useFrameVariant,
} from '@gitroom/frontend/components/media/frame.variant';
import { ThirdPartyMedia } from '@gitroom/frontend/components/third-parties/third-party.media';
import { ReactSortable } from 'react-sortablejs';
import { MediaComponentInner } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { AiVideo } from '@gitroom/frontend/components/launches/ai.video';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { ThirdPartyMediaLibrary } from '@gitroom/frontend/components/third-parties/third-party.media-library';
import { Dashboard } from '@uppy/react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  DeleteCircleIcon,
  CloseCircleIcon,
  DragHandleIcon,
  MediaSettingsIcon,
  InsertMediaIcon,
  DesignMediaIcon,
  VerticalDividerIcon,
  NoMediaIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { useShallow } from 'zustand/react/shallow';
import { useIsMobile } from '@gitroom/frontend/components/new-layout/use.is.mobile';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useDebounce } from 'use-debounce';
import { MediaFromUrl } from '@gitroom/frontend/components/new-launch/media.from.url';
// Editor ảnh: dùng Filerobot (MIT, miễn phí, không cần license key) thay Polotno.
const FilerobotEditor = dynamic(
  () => import('@gitroom/frontend/components/launches/filerobot.editor')
);
const showModalEmitter = new EventEmitter();
export const Pagination: FC<{
  current: number;
  totalPages: number;
  setPage: (num: number) => void;
}> = (props) => {
  const t = useT();

  const { current, totalPages, setPage } = props;

  const paginationItems = useMemo(() => {
    // Convert to 1-based for algorithm (current is 0-based)
    const c = current + 1;
    const m = totalPages;

    // If total pages <= 10, show all pages
    if (m <= 10) {
      return Array.from({ length: m }, (_, i) => i + 1);
    }

    const delta = 3;
    const left = c - delta;
    const right = c + delta + 1;
    const range: number[] = [];
    const rangeWithDots: (number | '...')[] = [];
    let l: number | undefined;

    // Build the range of pages to show
    for (let i = 1; i <= m; i++) {
      if (i === 1 || i === m || (i >= left && i < right)) {
        range.push(i);
      }
    }

    // Add dots where there are gaps
    for (const i of range) {
      if (l !== undefined) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push('...');
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    // Limit to maximum 10 items by trimming pages near edges if needed
    while (rangeWithDots.length > 10) {
      const currentIndex = rangeWithDots.findIndex((item) => item === c);
      if (currentIndex !== -1 && currentIndex > rangeWithDots.length / 2) {
        // Current is in second half, remove one item from start side
        rangeWithDots.splice(2, 1);
      } else {
        // Current is in first half, remove one item from end side
        rangeWithDots.splice(-3, 1);
      }
    }

    return rangeWithDots;
  }, [current, totalPages]);

  return (
    <ul className="flex flex-row flex-wrap items-center gap-1 justify-center mt-[15px]">
      <li className={clsx(current === 0 && 'opacity-20 pointer-events-none')}>
        <div
          className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2 gap-1 ps-2.5 text-gray-400 hover:text-white border-[#1F1F1F] hover:bg-forth"
          aria-label="Go to previous page"
          onClick={() => setPage(current - 1)}
        >
          <ChevronLeftIcon className="lucide lucide-chevron-left h-4 w-4" />
          <span className="xs:hidden">{t('previous', 'Previous')}</span>
        </div>
      </li>
      {paginationItems.map((item, index) => (
        <li key={index}>
          {item === '...' ? (
            <span className="inline-flex items-center justify-center h-10 w-10 text-textColor select-none">
              ...
            </span>
          ) : (
            <div
              aria-current="page"
              onClick={() => setPage(item - 1)}
              className={clsx(
                'cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:bg-forth h-10 w-10 hover:text-white border-newBorder',
                current === item - 1
                  ? 'bg-forth !text-white'
                  : 'text-textColor hover:text-white'
              )}
            >
              {item}
            </div>
          )}
        </li>
      ))}
      <li
        className={clsx(
          current + 1 === totalPages && 'opacity-20 pointer-events-none'
        )}
      >
        <a
          className="text-textColor hover:text-white group cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2 gap-1 pe-2.5 text-gray-400 border-[#1F1F1F] hover:bg-forth"
          aria-label="Go to next page"
          onClick={() => setPage(current + 1)}
        >
          <span className="xs:hidden">{t('next', 'Next')}</span>
          <ChevronRightIcon className="lucide lucide-chevron-right h-4 w-4" />
        </a>
      </li>
    </ul>
  );
};
export const ShowMediaBoxModal: FC = () => {
  const [showModal, setShowModal] = useState(false);
  const [callBack, setCallBack] =
    useState<(params: { id: string; path: string }[]) => void | undefined>();
  const closeModal = useCallback(() => {
    setShowModal(false);
    setCallBack(undefined);
  }, []);
  useEffect(() => {
    showModalEmitter.on('show-modal', (cCallback) => {
      setShowModal(true);
      setCallBack(() => cCallback);
    });
    return () => {
      showModalEmitter.removeAllListeners('show-modal');
    };
  }, []);
  if (!showModal) return null;
  return (
    <div className="text-textColor">
      <MediaBox setMedia={callBack!} closeModal={closeModal} />
    </div>
  );
};
export const showMediaBox = (
  callback: (params: { id: string; path: string }) => void
) => {
  showModalEmitter.emit('show-modal', callback);
};
const CHUNK_SIZE = 1024 * 1024;
const MAX_UPLOAD_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB (video to hơn: dán link Drive — trần 5GB)
export const MediaBox: FC<{
  setMedia: (params: { id: string; path: string }[]) => void;
  standalone?: boolean;
  type?: 'image' | 'video';
  closeModal: () => void;
}> = ({ type, standalone, setMedia }) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch] = useDebounce(search, 300);
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const isMobile = useIsMobile();
  useEffect(() => {
    setPage(0);
  }, [debouncedSearch]);
  const loadMedia = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page + 1) });
    if (debouncedSearch.trim()) {
      params.set('search', debouncedSearch.trim());
    }
    return (await fetch(`/media?${params.toString()}`)).json();
  }, [page, debouncedSearch]);
  const { data, mutate, isLoading } = useSWR(
    `get-media-${page}-${debouncedSearch}`,
    loadMedia
  );
  const [selected, setSelected] = useState([]);
  const t = useT();
  const uploaderRef = useRef<any>(null);
  const mediaDirectory = useMediaDirectory();
  const [loading, setLoading] = useState(false);

  const uppy = useUppyUploader({
    allowedFileTypes:
      type == 'image'
        ? 'image/*'
        : type == 'video'
        ? 'video/mp4'
        : 'image/*,video/mp4',
    onUploadSuccess: async (arr) => {
      await mutate();
      if (standalone) {
        return;
      }
      setSelected((prevSelected) => {
        return [...prevSelected, ...arr];
      });
    },
    onStart: () => setLoading(true),
    onEnd: () => setLoading(false),
  });

  const addRemoveSelected = useCallback(
    (media: any) => () => {
      if (standalone) {
        return;
      }
      const exists = selected.find((p: any) => p.id === media.id);
      if (exists) {
        setSelected(selected.filter((f: any) => f.id !== media.id));
        return;
      }
      setSelected([...selected, media]);
    },
    [selected]
  );

  const addMedia = useCallback(async () => {
    if (standalone) {
      return;
    }
    // @ts-ignore
    setMedia(selected);
    modals.closeCurrent();
  }, [selected]);

  const addToUpload = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      const totalSize = files.reduce((acc, file) => acc + file.size, 0);

      if (totalSize > MAX_UPLOAD_SIZE) {
        toaster.show(
          t(
            'upload_size_limit_exceeded',
            'Upload size limit exceeded. Maximum 1 GB per upload session.'
          ),
          'warning'
        );
        return;
      }

      setLoading(true);

      // @ts-ignore
      uppy.addFiles(files);
    },
    [toaster, t]
  );

  const dragAndDrop = useCallback(
    async (event: ClipboardEvent<HTMLDivElement> | File[]) => {
      // @ts-ignore
      const clipboardItems = event.map((p) => ({
        kind: 'file',
        getAsFile: () => p,
      }));
      if (!clipboardItems) {
        return;
      }

      const files: File[] = [];
      // @ts-ignore
      for (const item of clipboardItems) {
        if (item.kind === 'file') {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }

      const totalSize = files.reduce((acc, file) => acc + file.size, 0);

      if (totalSize > MAX_UPLOAD_SIZE) {
        toaster.show(
          t(
            'upload_size_limit_exceeded',
            'Upload size limit exceeded. Maximum 1 GB per upload session.'
          ),
          'warning'
        );
        return;
      }

      setLoading(true);

      for (const file of files) {
        uppy.addFile(file);
      }
    },
    [toaster, t]
  );

  // Mở Filerobot editor với ảnh thư viện làm nguồn để SỬA/THIẾT KẾ trực tiếp.
  const designMediaLibrary = useCallback(
    (media: Media) => async (e: any) => {
      e.stopPropagation();
      modals.openModal({
        askClose: false,
        closeOnEscape: true,
        removeLayout: true,
        fullScreen: true,
        children: (close) => (
          <FilerobotEditor
            source={mediaDirectory.set(media.path)}
            setMedia={async () => {
              await mutate();
            }}
            closeModal={close}
          />
        ),
      });
    },
    [mediaDirectory, mutate]
  );

  const maximize = useCallback(
    (media: Media) => async (e: any) => {
      e.stopPropagation();
      const url = mediaDirectory.set(media.path);
      const isVideo = hasExtension(media.path, 'mp4');
      const download = () => {
        const a = document.createElement('a');
        a.href = url;
        a.download = media.originalName || media.path.split('/').pop() || 'media';
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        a.remove();
      };
      modals.openModal({
        title: '',
        top: 10,
        children: (close) => (
          <div className="w-full h-full flex flex-col gap-[12px] p-[16px] mobile:p-[8px]">
            <div className="flex-1 min-h-0 flex items-center justify-center">
              {isVideo ? (
                <VideoFrame autoplay={true} url={url} />
              ) : (
                <img
                  className="max-h-full max-w-full object-contain rounded-[6px]"
                  src={url}
                  alt="media"
                />
              )}
            </div>
            <div className="shrink-0 flex justify-end gap-[8px]">
              <button
                onClick={download}
                className="cursor-pointer h-[40px] px-[16px] items-center justify-center border border-newTextColor/10 flex rounded-[8px] text-textColor"
              >
                {t('download', 'Download')}
              </button>
              {!isVideo && (
                <button
                  onClick={(ev) => {
                    close();
                    designMediaLibrary(media)(ev);
                  }}
                  className="cursor-pointer text-white h-[40px] px-[16px] items-center justify-center bg-[#1e6fd9] flex rounded-[8px]"
                >
                  {t('edit_design', 'Edit / Design')}
                </button>
              )}
            </div>
          </div>
        ),
      });
    },
    [mediaDirectory, designMediaLibrary, t]
  );

  const deleteImage = useCallback(
    (media: Media) => async (e: any) => {
      e.stopPropagation();
      if (
        !(await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete_the_image',
            'Are you sure you want to delete the image?'
          )
        ))
      ) {
        return;
      }
      await fetch(`/media/${media.id}`, {
        method: 'DELETE',
      });
      mutate();
    },
    [mutate]
  );

  const btn = useMemo(() => {
    return (
      <button
        disabled={loading}
        onClick={() => uploaderRef?.current?.click()}
        className="relative cursor-pointer bg-btnSimple changeColor flex gap-[8px] h-[44px] px-[18px] justify-center items-center rounded-[8px]"
      >
        {loading ? (
          <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
            <div className="animate-spin h-[20px] w-[20px] border-4 border-white border-t-transparent rounded-full" />
          </div>
        ) : (
          <PlusIcon size={14} />
        )}
        <div className={loading ? 'invisible' : undefined}>{t('upload', 'Upload')}</div>
      </button>
    );
  }, [t, loading]);

  return (
    <DropFiles disabled={loading} className="flex flex-col flex-1" onDrop={dragAndDrop}>
      <div className="flex flex-col flex-1">
        <div
          className={clsx(
            'flex items-center gap-[12px] flex-wrap',
            !isLoading &&
              !data?.results?.length &&
              !debouncedSearch &&
              'hidden'
          )}
        >
          <div className="flex-1">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search_media_by_name', 'Search by file name')}
              className="w-full h-[44px] px-[14px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] outline-none focus:border-[#1e6fd9]"
            />
          </div>
          <input
            type="file"
            ref={uploaderRef}
            onChange={addToUpload}
            className="hidden"
            multiple={true}
          />
          <div className="flex gap-[8px]">
            {btn}
            <ThirdPartyMediaLibrary onImported={() => mutate()} />
          </div>
        </div>
        <div className="w-full pointer-events-none relative mt-[5px] mb-[5px]">
          <div className="w-full h-[46px] overflow-hidden absolute left-0 bg-newBgColorInner uppyChange">
            <Dashboard
              height={46}
              uppy={uppy}
              id={`uploader`}
              showProgressDetails={true}
              hideUploadButton={true}
              hideRetryButton={true}
              hidePauseResumeButton={true}
              hideCancelButton={true}
              hideProgressAfterFinish={true}
            />
          </div>
          <div className="w-full h-[46px] uppyChange" />
        </div>
        <div
          className={clsx(
            'flex-1 relative',
            !isLoading &&
              !data?.results?.length &&
              'bg-newTextColor/[0.02] rounded-[12px]'
          )}
        >
          <div
            className={clsx(
              'absolute -left-[3px] -top-[3px] withp3 h-full overflow-x-hidden overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner',
              !isLoading &&
                !data?.results?.length &&
                'flex justify-center items-center gap-[20px] flex-col'
            )}
          >
            {!isLoading && !data?.results?.length && (
              <>
                <NoMediaIcon />
                <div className="text-[20px] font-[600]">
                  {debouncedSearch
                    ? t(
                        'no_media_match_search',
                        'No media matches your search'
                      )
                    : t(
                        'you_dont_have_any_media_yet',
                        "You don't have any media yet"
                      )}
                </div>
                <div className="whitespace-pre-line text-newTextColor/[0.6] text-center">
                  {t(
                    'select_or_upload_pictures_max_1gb',
                    'Select or upload pictures (maximum 1 GB per upload).'
                  )}{' '}
                  {'\n'}
                  {t(
                    'you_can_drag_drop_pictures',
                    'You can also drag & drop pictures.'
                  )}
                </div>
                <div className="forceChange flex gap-[8px]">
                  {btn}
                  <ThirdPartyMediaLibrary onImported={() => mutate()} />
                </div>
              </>
            )}
            {isLoading && (
              <>
                {[...new Array(16)].map((_, i) => (
                  <div
                    className={clsx(
                      'px-[3px] py-[3px] float-left rounded-[6px] cursor-pointer w8-max aspect-square'
                    )}
                    key={i}
                  >
                    <div className="w-full h-full bg-newSep rounded-[6px] animate-pulse" />
                  </div>
                ))}
              </>
            )}
            {data?.results
              ?.filter((f: any) => {
                if (type === 'video') {
                  return hasExtension(f.path, 'mp4');
                } else if (type === 'image') {
                  return !hasExtension(f.path, 'mp4');
                }
                return true;
              })
              .map((media: any) => (
                <div
                  className={clsx(
                    'group px-[3px] py-[3px] float-left rounded-[6px] w8-max aspect-square',
                    !standalone && 'cursor-pointer'
                  )}
                  key={media.id}
                >
                  <div
                    className={clsx(
                      'w-full h-full rounded-[6px] border-[4px] relative',
                      !!selected.find((p) => p.id === media.id)
                        ? 'border-[#1e6fd9]'
                        : 'border-transparent'
                    )}
                    // Standalone (trang /media) trên mobile: không có hover →
                    // chạm ảnh = mở Xem (thay vì return sớm không làm gì).
                    onClick={
                      standalone && isMobile
                        ? maximize(media)
                        : addRemoveSelected(media)
                    }
                  >
                    {!!selected.find((p: any) => p.id === media.id) ? (
                      <div className="text-white flex z-[101] justify-center items-center text-[14px] font-[500] w-[24px] h-[24px] rounded-full bg-[#1e6fd9] absolute -bottom-[10px] -end-[10px]">
                        {selected.findIndex((z: any) => z.id === media.id) + 1}
                      </div>
                    ) : (
                      <DeleteCircleIcon
                        className="cursor-pointer hidden z-[100] group-hover:block mobile:block absolute -top-[5px] -end-[5px]"
                        onClick={deleteImage(media)}
                      />
                    )}
                    <div className="absolute bottom-[6px] start-[6px] end-[6px] z-[100] truncate text-[11px] text-white bg-black/50 rounded-[4px] px-[6px] py-[2px] pointer-events-none">{media.originalName}</div>
                    <div className="w-full h-full rounded-[6px] overflow-hidden relative">
                      {/* Mobile không có hover: nút Xem/Sửa luôn hiện, dời từ
                          giữa ảnh về góc dưới-phải (trên nhãn tên file) */}
                      <div className="absolute z-[20] left-[50%] top-[50%] -translate-x-[50%] -translate-y-[50%] flex items-center gap-[6px] mobile:left-auto mobile:top-auto mobile:translate-x-0 mobile:translate-y-0 mobile:end-[4px] mobile:bottom-[30px]">
                        <div
                          onClick={maximize(media)}
                          title={t('view_media', 'View')}
                          aria-label={t('view_media', 'View')}
                          className="cursor-pointer p-[4px] bg-black/40 hidden group-hover:block hover:scale-125 transition-all mobile:block mobile:p-[6px] mobile:rounded-[8px] mobile:bg-black/60 tap-shrink"
                        >
                          <svg
                            width="26"
                            height="26"
                            viewBox="0 0 14 14"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M2 9H0V14H5V12H2V9ZM0 5H2V2H5V0H0V5ZM12 12H9V14H14V9H12V12ZM9 0V2H12V5H14V0H9Z"
                              fill="#F1F5F9"
                            />
                          </svg>
                        </div>
                        {!hasExtension(media.path, 'mp4') && (
                          <div
                            onClick={designMediaLibrary(media)}
                            title={t('edit_design', 'Edit / Design')}
                            aria-label={t('edit_design', 'Edit / Design')}
                            className="cursor-pointer p-[4px] bg-black/40 hidden group-hover:block hover:scale-125 transition-all mobile:block mobile:p-[6px] mobile:rounded-[8px] mobile:bg-black/60 tap-shrink"
                          >
                            <svg
                              width="26"
                              height="26"
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3ZM13.5 6.5l4 4"
                                stroke="#F1F5F9"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                        )}
                      </div>
                      {hasExtension(media.path, 'mp4') ? (
                        <VideoFrame url={mediaDirectory.set(media.path)} />
                      ) : (
                        <img
                          width="100%"
                          height="100%"
                          className="w-full h-full object-cover"
                          src={mediaDirectory.set(media.path)}
                          alt="media"
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
        {(data?.pages || 0) > 1 && (
          <Pagination
            current={page}
            totalPages={data?.pages}
            setPage={setPage}
          />
        )}
        {!standalone && (
          <div className="flex justify-end mt-[32px] gap-[8px]">
            <button
              onClick={() => modals.closeCurrent()}
              className="cursor-pointer h-[52px] px-[20px] items-center justify-center border border-newTextColor/10 flex rounded-[10px]"
            >
              {t('cancel', 'Cancel')}
            </button>
            {!isLoading && !!data?.results?.length && (
              <button
                onClick={standalone ? () => {} : addMedia}
                disabled={selected.length === 0}
                className="cursor-pointer text-white disabled:opacity-80 disabled:cursor-not-allowed h-[52px] px-[20px] items-center justify-center bg-[#1e6fd9] flex rounded-[10px]"
              >
                {t('add_selected_media', 'Add selected media')}
              </button>
            )}
          </div>
        )}
      </div>
    </DropFiles>
  );
};

// ── Xem trước KHUNG bài đăng — các BIẾN THỂ CHUẨN FACEBOOK theo số ảnh ──────
// Kéo ảnh NGAY TRONG KHUNG để đổi thứ tự (cùng list với hàng thumbnail).
// Định nghĩa bố cục nằm ở frame.variant.tsx để khung Post Preview bên phải
// dùng CHUNG — chọn kiểu nào thì bên đó hiện đúng kiểu đó.
const FramePreview: FC<{
  media: Array<{ id: string; path: string }>;
  variant: FrameVariant;
  onSort: (value: any[]) => void;
}> = ({ media, variant, onSort }) => {
  const mediaDirectory = useMediaDirectory();
  const n = media.length;
  // các khung 5-ảnh chỉ hiện 5 ô đầu (đúng FB), ô 5 phủ "+N"
  const isFive = variant.startsWith('five');
  const shown = isFive ? media.slice(0, FRAME_MAX_TILES) : media;
  const hidden = isFive ? n - FRAME_MAX_TILES : 0;

  return (
    <ReactSortable
      list={shown as any}
      setList={(value) =>
        // khung 5 chỉ hiện 5 đầu → ghép phần còn lại giữ nguyên thứ tự
        onSort(isFive ? [...value, ...media.slice(FRAME_MAX_TILES)] : value)
      }
      animation={200}
      className={clsx(
        'w-full max-w-[430px] rounded-[10px] overflow-hidden',
        frameWrapCls(variant, n)
      )}
    >
      {shown.map((m, i) => (
        <div
          key={m.id}
          className={clsx(
            'relative cursor-move overflow-hidden bg-newBgColor',
            frameItemCls(variant, n, i)
          )}
        >
          {hasExtension(m.path, 'mp4') ? (
            <video src={mediaDirectory.set(m.path)} muted playsInline className="w-full h-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaDirectory.set(m.path)} alt="" className="w-full h-full object-cover" draggable={false} />
          )}
          <span className="absolute top-[4px] start-[4px] w-[18px] h-[18px] rounded-full bg-black/60 text-white text-[10px] font-[800] grid place-items-center">
            {i + 1}
          </span>
          {i === FRAME_MAX_TILES - 1 && hidden > 0 && (
            <div className="absolute inset-0 bg-black/55 grid place-items-center text-white text-[26px] font-[800]">
              +{hidden}
            </div>
          )}
        </div>
      ))}
    </ReactSortable>
  );
};

// ============================================================================
//  Trình quản lý media (2026-09-22) — mở từ nút "Design Media". Gộp MỘT chỗ:
//  xem lưới toàn bộ ảnh/video đã đính kèm + kéo-thả đổi thứ tự (grid, không
//  còn dải ngang 40px vỡ trận khi đính 60 ảnh) + sửa từng ảnh bằng Filerobot
//  ngay tại chỗ + thêm ảnh (thư viện / thiết kế mới) mà không cần đóng modal.
//  Giữ state RIÊNG (list) trong lúc mở — mỗi thao tác vừa cập nhật list vừa
//  gọi onChange đẩy ra ngoài, nên form thật luôn đồng bộ dù modal không re-render
//  theo props ngoài (modal system gọi lại closure con trỏ cũ, xem ADR trong PR).
//  Bàn phím: ô đang focus dùng phím mũi tên để đổi chỗ — thay thế không-chuột
//  cho kéo-thả (WCAG 2.2 Dragging Movements).
// ============================================================================
type ManagerMediaItem = { id: string; path: string; [k: string]: any };

const MediaManagerModal: FC<{
  initialMedia: ManagerMediaItem[];
  onChange: (value: ManagerMediaItem[]) => void;
  closeModal: () => void;
}> = ({ initialMedia, onChange, closeModal }) => {
  const t = useT();
  const mediaDirectory = useMediaDirectory();
  const modals = useModals();
  const [list, setList] = useState<ManagerMediaItem[]>(initialMedia);
  const [editing, setEditing] = useState<ManagerMediaItem | null>(null);

  const commit = useCallback(
    (next: ManagerMediaItem[]) => {
      setList(next);
      onChange(next);
    },
    [onChange]
  );

  const addMedia = useCallback(
    (added: ManagerMediaItem[]) => {
      setList((prev) => {
        const next = [...prev, ...(Array.isArray(added) ? added : [added])];
        onChange(next);
        return next;
      });
    },
    [onChange]
  );

  const move = useCallback(
    (from: number, to: number) => {
      setList((prev) => {
        if (to < 0 || to >= prev.length || from === to) return prev;
        const next = [...prev];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        onChange(next);
        return next;
      });
    },
    [onChange]
  );

  const remove = useCallback(
    (id: string) => {
      setList((prev) => {
        const next = prev.filter((m) => m.id !== id);
        onChange(next);
        return next;
      });
    },
    [onChange]
  );

  // Ẩn = vẫn thấy ảnh trong Trình quản lý (bấm mắt để hiện lại) nhưng KHÔNG
  // đăng lên (lọc ở post.activity.ts lúc đăng thật) — thay vì xoá hẳn, phòng
  // khi AI/bộ lọc nhóm nhầm một ảnh còn đẹp.
  const toggleHidden = useCallback(
    (id: string) => {
      setList((prev) => {
        const next = prev.map((m) =>
          m.id === id ? { ...m, hidden: !m.hidden } : m
        );
        onChange(next);
        return next;
      });
    },
    [onChange]
  );

  const openInsertFromLibrary = useCallback(() => {
    modals.openModal({
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: 'calc(100% - 80px)',
      height: 'calc(100% - 80px)',
      children: (close) => (
        <MediaBox
          setMedia={(m) => {
            addMedia(m);
            close();
          }}
          closeModal={close}
        />
      ),
    });
  }, [addMedia, modals]);

  const openNewDesign = useCallback(() => {
    modals.openModal({
      askClose: false,
      closeOnEscape: true,
      removeLayout: true,
      fullScreen: true,
      children: (close) => (
        <FilerobotEditor
          setMedia={(m) => {
            addMedia(m);
            close();
          }}
          closeModal={close}
        />
      ),
    });
  }, [addMedia, modals]);

  if (editing) {
    return (
      <FilerobotEditor
        source={mediaDirectory.set(editing.path)}
        setMedia={(edited) => {
          const next = edited?.[0];
          if (next) {
            commit(list.map((m) => (m.id === editing.id ? { ...m, ...next } : m)));
          }
          setEditing(null);
        }}
        closeModal={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="bg-white text-black relative z-[400] flex flex-col h-full min-h-0 overflow-hidden">
      <div className="shrink-0 flex items-center gap-[8px] flex-wrap px-[16px] py-[10px] border-b border-[#e5e7eb] bg-[#fafafa]">
        <span className="text-[14px] font-[700] text-[#111827] me-[6px]">
          {t('media_manager_title', 'Manage media')} ({list.length})
        </span>
        <button
          type="button"
          onClick={openInsertFromLibrary}
          className="h-[36px] px-[12px] rounded-[8px] bg-[#eef0f2] text-[#111827] text-[13px] font-[600] hover:bg-[#e5e7eb] transition-colors"
        >
          + {t('insert_media', 'Insert Media')}
        </button>
        <button
          type="button"
          onClick={openNewDesign}
          className="h-[36px] px-[12px] rounded-[8px] bg-[#eef0f2] text-[#111827] text-[13px] font-[600] hover:bg-[#e5e7eb] transition-colors"
        >
          + {t('design_media_new', 'New design')}
        </button>
        <button
          type="button"
          onClick={closeModal}
          aria-label={t('close', 'Close')}
          className="ms-auto shrink-0 w-[36px] h-[36px] rounded-[8px] flex items-center justify-center text-[#6b7280] hover:text-[#111827] hover:bg-[#eef0f2] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-[16px] bg-[#f3f4f6]">
        {!list.length ? (
          <div className="text-center text-[13px] text-[#6b7280] py-[60px]">
            {t('media_manager_empty', 'No media yet — insert from the library or design a new one above.')}
          </div>
        ) : (
          <ReactSortable
            list={list as any}
            setList={(v) => commit(v as any)}
            animation={200}
            className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-[12px]"
          >
            {list.map((m, i) => (
              <div
                key={m.id}
                tabIndex={0}
                role="group"
                aria-label={t(
                  'media_manager_item',
                  'Media {{n}} of {{total}} — Enter to edit, Delete to remove, H to hide/show, arrow keys to reorder'
                )
                  .replace('{{n}}', String(i + 1))
                  .replace('{{total}}', String(list.length))}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    move(i, i - 1);
                  } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    move(i, i + 1);
                  } else if (e.key === 'Enter' && !hasExtension(m.path, 'mp4')) {
                    e.preventDefault();
                    setEditing(m);
                  } else if (e.key === 'Delete' || e.key === 'Backspace') {
                    e.preventDefault();
                    remove(m.id);
                  } else if (e.key === 'h' || e.key === 'H') {
                    e.preventDefault();
                    toggleHidden(m.id);
                  }
                }}
                className={clsx(
                  'relative group aspect-square rounded-[10px] border overflow-hidden bg-white cursor-grab focus:outline-none focus:ring-2 focus:ring-blue-500',
                  m.hidden ? 'border-amber-400' : 'border-[#e5e7eb]'
                )}
              >
                <span className="absolute top-[6px] left-[6px] z-[5] bg-black/70 text-white text-[11px] font-[700] rounded-full min-w-[20px] h-[20px] px-[5px] flex items-center justify-center pointer-events-none">
                  {i + 1}
                </span>
                {m.hidden && (
                  <span className="absolute top-[6px] right-[6px] z-[5] bg-amber-500 text-white text-[10px] font-[700] rounded-full px-[7px] h-[20px] flex items-center justify-center pointer-events-none">
                    {t('media_hidden_badge', 'Hidden')}
                  </span>
                )}
                {hasExtension(m.path, 'mp4') ? (
                  <video
                    src={mediaDirectory.set(m.path)}
                    muted
                    playsInline
                    className={clsx(
                      'w-full h-full object-cover pointer-events-none',
                      m.hidden && 'opacity-40'
                    )}
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaDirectory.set(m.path)}
                    alt=""
                    draggable={false}
                    className={clsx(
                      'w-full h-full object-cover pointer-events-none',
                      m.hidden && 'opacity-40'
                    )}
                  />
                )}
                <div className="absolute inset-0 flex items-center justify-center gap-[10px] bg-black/45 opacity-0 group-hover:opacity-100 group-focus:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHidden(m.id);
                    }}
                    title={
                      m.hidden
                        ? t('media_show', 'Show — include when publishing')
                        : t('media_hide', 'Hide — keep visible here, exclude from publish')
                    }
                    aria-label={
                      m.hidden ? t('media_show', 'Show — include when publishing') : t('media_hide', 'Hide — keep visible here, exclude from publish')
                    }
                    className="w-[32px] h-[32px] rounded-full bg-white/95 flex items-center justify-center hover:bg-white transition-colors"
                  >
                    {m.hidden ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M3 3l18 18M10.58 10.58a2 2 0 0 0 2.83 2.83M9.88 5.09A9.77 9.77 0 0 1 12 5c5 0 9 4.5 10 7-.32.9-1.02 2.06-2.06 3.15M6.53 6.53C4.6 7.8 3.14 9.8 2 12c1 2.5 5 7 10 7 1.35 0 2.6-.32 3.71-.84"
                          stroke="#111827"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Z"
                          stroke="#111827"
                          strokeWidth="1.8"
                          strokeLinejoin="round"
                        />
                        <circle cx="12" cy="12" r="3" stroke="#111827" strokeWidth="1.8" />
                      </svg>
                    )}
                  </button>
                  {!hasExtension(m.path, 'mp4') && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditing(m);
                      }}
                      title={t('edit_design', 'Edit / Design')}
                      aria-label={t('edit_design', 'Edit / Design')}
                      className="w-[32px] h-[32px] rounded-full bg-white/95 flex items-center justify-center hover:bg-white transition-colors"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                        <path
                          d="M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3ZM13.5 6.5l4 4"
                          stroke="#111827"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(m.id);
                    }}
                    title={t('remove', 'Remove')}
                    aria-label={t('remove', 'Remove')}
                    className="w-[32px] h-[32px] rounded-full bg-white/95 flex items-center justify-center hover:bg-white transition-colors"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M6 6l12 12M18 6L6 18"
                        stroke="#dc2626"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </ReactSortable>
        )}
      </div>
    </div>
  );
};

export const MultiMediaComponent: FC<{
  label: string;
  description: string;
  mediaNotAvailable?: boolean;
  dummy: boolean;
  allData: {
    content: string;
    id?: string;
    image?: Array<{
      id: string;
      path: string;
    }>;
  }[];
  value?: Array<{
    path: string;
    id: string;
  }>;
  text: string;
  name: string;
  error?: any;
  onOpen?: () => void;
  onClose?: () => void;
  toolBar?: React.ReactNode;
  information?: React.ReactNode;
  onChange: (event: {
    target: {
      name: string;
      value?: Array<{
        id: string;
        path: string;
        alt?: string;
        thumbnail?: string;
        thumbnailTimestamp?: number;
      }>;
    };
  }) => void;
}> = (props) => {
  const {
    name,
    error,
    text,
    onChange,
    value,
    allData,
    dummy,
    toolBar,
    information,
    mediaNotAvailable,
  } = props;
  const user = useUser();
  const modals = useModals();
  const t = useT();
  useEffect(() => {
    if (value) {
      setCurrentMedia(value);
    }
  }, [value]);

  const [currentMedia, setCurrentMedia] = useState(value);
  // Xem trước khung bài đăng: bật/tắt + biến thể khung FB đang chọn
  const [frame, setFrame] = useState(false);
  // Biến thể khung nằm ở store dùng chung — khung Post Preview bên phải đọc
  // cùng giá trị này nên đổi kiểu ở đây là bên đó đổi theo ngay.
  const variant = useFrameVariant((state) => state.variant);
  const setVariant = useFrameVariant((state) => state.setVariant);
  const mediaDirectory = useMediaDirectory();
  const changeMedia = useCallback(
    (
      m:
        | {
            path: string;
            id: string;
          }
        | {
            path: string;
            id: string;
          }[]
    ) => {
      const mediaArray = Array.isArray(m) ? m : [m];
      const newMedia = [...(currentMedia || []), ...mediaArray];
      setCurrentMedia(newMedia);
      onChange({
        target: {
          name,
          value: newMedia,
        },
      });
    },
    [currentMedia]
  );
  const showModal = useCallback(() => {
    modals.openModal({
      title: t('media_library', 'Media Library'),
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: 'calc(100% - 80px)',
      height: 'calc(100% - 80px)',
      children: (close) => (
        <MediaBox setMedia={changeMedia} closeModal={close} />
      ),
    });
  }, [changeMedia, t]);

  const clearMedia = useCallback(
    (topIndex: number) => () => {
      const newMedia = currentMedia?.filter((f, index) => index !== topIndex);
      setCurrentMedia(newMedia);
      onChange({
        target: {
          name,
          value: newMedia,
        },
      });
    },
    [currentMedia]
  );

  // Nút "Design Media" LUÔN hiện — dùng Filerobot Image Editor (MIT, miễn phí,
  // không cần license key, không watermark). Xem filerobot.editor.tsx.
  const canDesign = true;
  // Sua thang anh da dinh kem trong bai: mo Filerobot voi chinh anh do lam nguon,
  // luu xong thay luon anh cu trong bai (khong phai vao thu vien chon lai).
  const editAttachedMedia = useCallback(
    (media: { id: string; path: string }) => (e: any) => {
      e.stopPropagation();
      modals.openModal({
        askClose: false,
        closeOnEscape: true,
        removeLayout: true,
        fullScreen: true,
        children: (close) => (
          <FilerobotEditor
            source={mediaDirectory.set(media.path)}
            setMedia={(edited) => {
              const next = edited?.[0];
              if (!next) {
                return;
              }
              onChange({
                target: {
                  name: 'upload',
                  value: (currentMedia || []).map((p) =>
                    p.id === media.id ? { ...p, ...next } : p
                  ),
                },
              });
            }}
            closeModal={close}
          />
        ),
      });
    },
    [currentMedia, onChange, mediaDirectory]
  );

  // "Design Media" mở Trình quản lý media (grid + kéo-thả đổi thứ tự + sửa
  // từng ảnh bằng Filerobot ngay tại chỗ) thay vì thẳng vào editor trắng —
  // gộp 1 chỗ theo yêu cầu user (trước đây dải ảnh 40px vỡ trận khi đính 60 ảnh).
  const designMedia = useCallback(() => {
    if (!!user?.tier?.ai && !dummy) {
      modals.openModal({
        askClose: false,
        closeOnEscape: true,
        // removeLayout + fullScreen: bỏ thanh tiêu đề + padding + khoảng gap của
        // modal (thứ đẩy editor xuống + căn giữa gây lề chết trên/dưới + kẹp
        // thanh công cụ khi zoom). MediaManagerModal tự có header (tiêu đề + đóng).
        removeLayout: true,
        fullScreen: true,
        children: (close) => (
          <MediaManagerModal
            initialMedia={currentMedia || []}
            onChange={(next) =>
              onChange({ target: { name: 'upload', value: next } })
            }
            closeModal={close}
          />
        ),
      });
    }
  }, [currentMedia, onChange, t]);

  return (
    <>
      <div className="b1 flex flex-col gap-[8px] rounded-bl-[8px] select-none w-full">
        <div className="flex gap-[10px] px-[12px]">
          {!!currentMedia && (
            <ReactSortable
              list={currentMedia}
              setList={(value) =>
                onChange({ target: { name: 'upload', value } })
              }
              className="flex gap-[10px] sortable-container"
              animation={200}
              swap={true}
              handle=".dragging"
            >
              {currentMedia.map((media, index) => (
                  <div
                    key={media.id}
                    title={
                      (media as any).hidden
                        ? t('media_hidden_hint', 'Hidden — won\'t be published (open Design Media to show it again)')
                        : undefined
                    }
                    className={clsx(
                      'cursor-pointer rounded-[5px] w-[40px] h-[40px] border-2 relative flex transition-all',
                      (media as any).hidden ? 'border-amber-400' : 'border-tableBorder'
                    )}
                  >
                    <DragHandleIcon className="z-[20] dragging absolute pe-[1px] pb-[3px] -start-[4px] -top-[4px] cursor-move" />
                    {(media as any).hidden && (
                      <span className="absolute -end-[4px] -bottom-[4px] z-[20] w-[14px] h-[14px] rounded-full bg-amber-400 border border-white" />
                    )}

                    <div className="w-full h-full relative group">
                      <div className="absolute inset-0 flex items-center justify-center gap-[1px] bg-black/80 text-white rounded-[4px] opacity-0 group-hover:opacity-100 transition-opacity z-[9]">
                        {!hasExtension(media?.path, 'mp4') && (
                          <div
                            onClick={editAttachedMedia(media)}
                            title={t('edit_design', 'Edit / Design')}
                            aria-label={t('edit_design', 'Edit / Design')}
                            className="cursor-pointer relative z-[200] shrink-0"
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M4 20h4L18.5 9.5a2.121 2.121 0 0 0-3-3L5 17v3ZM13.5 6.5l4 4"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </div>
                        )}
                        <div
                          onClick={async () => {
                            modals.openModal({
                              title: t('media_settings', 'Media Settings'),
                              children: (close) => (
                                <MediaComponentInner
                                  media={media as any}
                                  onClose={close}
                                  onSelect={(value: any) => {
                                    onChange({
                                      target: {
                                        name: 'upload',
                                        value: currentMedia.map((p) => {
                                          if (p.id === media.id) {
                                            return {
                                              ...p,
                                              ...value,
                                            };
                                          }
                                          return p;
                                        }),
                                      },
                                    });
                                  }}
                                />
                              ),
                            });
                          }}
                          title={t('media_settings', 'Media Settings')}
                          aria-label={t('media_settings', 'Media Settings')}
                          className="cursor-pointer relative z-[200] shrink-0"
                        >
                          <MediaSettingsIcon size={20} className="cursor-pointer" />
                        </div>
                      </div>
                      {hasExtension(media?.path, 'mp4') ? (
                        <VideoFrame url={mediaDirectory.set(media?.path)} />
                      ) : (
                        <img
                          className={clsx(
                            'w-full h-full object-cover rounded-[4px]',
                            (media as any).hidden && 'opacity-40'
                          )}
                          src={mediaDirectory.set(media?.path)}
                        />
                      )}
                    </div>

                    <CloseCircleIcon
                      onClick={clearMedia(index)}
                      className="absolute -end-[4px] -top-[4px] z-[20] rounded-full bg-white"
                    />
                  </div>
              ))}
            </ReactSortable>
          )}
        </div>
        {/* Khung xem trước bài đăng — chọn biến thể CHUẨN FB + kéo ô đổi thứ tự */}
        {frame && !!currentMedia?.length && (() => {
          const variants = frameVariantsFor(currentMedia.length);
          const active = resolveFrameVariant(variant, currentMedia.length);
          const LABELS: Record<FrameVariant, string> = {
            v2col: t('media_frame_v2col', '2 side-by-side'),
            v2row: t('media_frame_v2row', '2 stacked'),
            topBig: t('media_frame_topbig', 'Big top'),
            leftBig: t('media_frame_leftbig', 'Big left'),
            cols3: t('media_frame_cols3', '3 columns'),
            grid22: t('media_frame_grid22', '2×2 grid'),
            fiveTop2: t('media_frame_fivetop2', '2 top + 3 below'),
            fiveTop1: t('media_frame_fivetop1', '1 big + 4 below'),
            grid: t('media_frame_grid', 'Even grid'),
          };
          return (
            <div className="px-[12px] pb-[10px] w-full flex flex-col gap-[6px]">
              <div className="flex items-center gap-[6px] flex-wrap">
                <span className="text-[11px] text-textItemBlur">
                  {t('media_frame_hint', 'Post preview — drag tiles to reorder')}
                </span>
                {variants.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVariant(v)}
                    className={clsx(
                      'px-[9px] py-[3px] rounded-[6px] text-[10.5px] font-[700] border',
                      active === v
                        ? 'bg-forth text-white border-forth'
                        : 'border-newColColor text-textItemBlur hover:text-textColor'
                    )}
                  >
                    {LABELS[v]}
                  </button>
                ))}
              </div>
              <FramePreview
                media={currentMedia as any}
                variant={active}
                onSort={(value) => onChange({ target: { name: 'upload', value } })}
              />
            </div>
          );
        })()}
        {/* Mobile: dãy nút dài → 1 hàng cuộn ngang thay vì gãy 3-4 hàng */}
        <div className="flex flex-wrap mobile:flex-nowrap mobile-hscroll gap-[8px] px-[12px] border-t border-newColColor w-full b1 text-textColor">
          {!mediaNotAvailable && (
            <div className="flex py-[10px] b2 items-center gap-[4px]">
              <div
                onClick={showModal}
                className="cursor-pointer h-[30px] mobile:h-[40px] mobile:px-[12px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px] tap-shrink"
              >
                <div className="flex gap-[8px] items-center">
                  <div>
                    <InsertMediaIcon />
                  </div>
                  <div className="text-[10px] mobile:text-[12px] font-[600] maxMedia:hidden block">
                    {t('insert_media', 'Insert Media')}
                  </div>
                </div>
              </div>
              {canDesign && (
                <div
                  onClick={designMedia}
                  title={t(
                    'design_media_tooltip',
                    'Design media — open image editor'
                  )}
                  aria-label={t(
                    'design_media_tooltip',
                    'Design media — open image editor'
                  )}
                  className="cursor-pointer h-[30px] mobile:h-[40px] mobile:px-[12px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px] tap-shrink"
                >
                  <div className="flex gap-[5px] items-center">
                    <div>
                      <DesignMediaIcon />
                    </div>
                    <div className="text-[10px] font-[600] iconBreak:hidden block">
                      {t('design_media', 'Design Media')}
                    </div>
                  </div>
                </div>
              )}

              <ThirdPartyMedia allData={allData} onChange={changeMedia} />

              {/* Dán link Google Drive / URL — server tải về (file lớn tới 5GB) */}
              <MediaFromUrl onMedia={changeMedia} />

              {/* Bật/tắt khung xem trước bài đăng (FB collage / lưới) */}
              {!!currentMedia?.length && currentMedia.length > 1 && (
                <div
                  onClick={() => setFrame(!frame)}
                  title={t('media_frame_toggle', 'Preview post frame & reorder')}
                  className={clsx(
                    'cursor-pointer h-[30px] mobile:h-[40px] mobile:px-[12px] rounded-[6px] justify-center items-center flex px-[8px] tap-shrink',
                    frame ? 'bg-forth text-white' : 'bg-newColColor'
                  )}
                >
                  <div className="flex gap-[5px] items-center">
                    <span className="text-[13px] leading-none">🖼</span>
                    <div className="text-[10px] font-[600] iconBreak:hidden block">
                      {t('media_frame', 'Frame')}
                    </div>
                  </div>
                </div>
              )}

              {!!user?.tier?.ai && (
                <>
                  <span
                    title={t('generate_ai_image', 'Generate AI image')}
                    aria-label={t('generate_ai_image', 'Generate AI image')}
                    className="flex"
                  >
                    <AiImage value={text} onChange={changeMedia} />
                  </span>
                  <AiVideo value={text} onChange={changeMedia} />
                </>
              )}
            </div>
          )}
          {!mediaNotAvailable && (
            <div className="text-newColColor h-full flex items-center">
              <VerticalDividerIcon />
            </div>
          )}
          {!!toolBar && (
            <div className="flex py-[10px] b2 items-center gap-[4px]">
              {toolBar}
            </div>
          )}
          {information && (
            <div className="flex-1 justify-end flex py-[10px] b2 items-center gap-[4px]">
              {information}
            </div>
          )}
        </div>
      </div>
      <div className="text-[12px] text-red-400">{error}</div>
    </>
  );
};
export const MediaComponent: FC<{
  label: string;
  description: string;
  value?: {
    path: string;
    id: string;
  };
  name: string;
  onChange: (event: {
    target: {
      name: string;
      value?: {
        id: string;
        path: string;
      };
    };
  }) => void;
  type?: 'image' | 'video';
  width?: number;
  height?: number;
}> = (props) => {
  const t = useT();

  const { name, type, label, description, onChange, value, width, height } =
    props;
  const { getValues } = useSettings();
  const user = useUser();
  useEffect(() => {
    const settings = getValues()[props.name];
    if (settings) {
      setCurrentMedia(settings);
    }
  }, []);
  const [currentMedia, setCurrentMedia] = useState(value);
  const modals = useModals();
  const mediaDirectory = useMediaDirectory();

  const showDesignModal = useCallback(() => {
    modals.openModal({
      askClose: false,
      closeOnEscape: true,
      // editor lấp đầy màn hình, không còn chrome modal chèn ép (xem designMedia)
      removeLayout: true,
      fullScreen: true,
      children: (close) => (
        <FilerobotEditor
          width={width}
          height={height}
          setMedia={changeMedia}
          closeModal={close}
        />
      ),
    });
  }, [t]);
  const changeMedia = useCallback((m: { path: string; id: string }[]) => {
    setCurrentMedia(m[0]);
    onChange({
      target: {
        name,
        value: m[0],
      },
    });
  }, []);
  const showModal = useCallback(() => {
    modals.openModal({
      title: t('media_library', 'Media Library'),
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: 'calc(100% - 80px)',
      height: 'calc(100% - 80px)',
      children: (close) => (
        <MediaBox setMedia={changeMedia} closeModal={close} type={type} />
      ),
    });
  }, [t]);
  const clearMedia = useCallback(() => {
    setCurrentMedia(undefined);
    onChange({
      target: {
        name,
        value: undefined,
      },
    });
  }, [value]);
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="text-[14px]">{label}</div>
      <div className="text-[12px]">{description}</div>
      {!!currentMedia && (
        <div className="my-[20px] cursor-pointer w-[200px] h-[200px] border-2 border-tableBorder">
          <img
            className="w-full h-full object-cover"
            src={currentMedia.path}
            onClick={() => window.open(mediaDirectory.set(currentMedia.path))}
          />
        </div>
      )}
      <div className="flex gap-[5px]">
        <Button onClick={showModal}>{t('select', 'Select')}</Button>
        <Button onClick={showDesignModal} className="!bg-customColor45">
          {t('editor', 'Editor')}
        </Button>
        <Button secondary={true} onClick={clearMedia}>
          {t('clear', 'Clear')}
        </Button>
      </div>
    </div>
  );
};
