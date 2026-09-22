// ============================================================================
//  CẦU NỐI Zalo → Postiz (Việt Anh Media Hub)
// ----------------------------------------------------------------------------
//  Đẩy 1 bài (caption + ảnh/video đã lưu local) vào Postiz dưới dạng BẢN NHÁP
//  chờ duyệt, qua Public API. KHÔNG đụng pipeline FB/GBP đang chạy — bật/tắt
//  bằng env POSTIZ_ENABLED (cấu hình ngay trên dashboard: /postiz).
//
//  Luồng: upload từng file local -> POST /public/v1/upload (multipart) -> lấy
//  media {id,path} -> POST /public/v1/posts (type:draft) gắn media + caption.
//  Cấu hình: POSTIZ_ENABLED / POSTIZ_API_URL / POSTIZ_API_KEY / POSTIZ_INTEGRATION_ID
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';

function apiUrl() {
  return (process.env.POSTIZ_API_URL || 'http://localhost:3000').replace(/\/$/, '');
}

// Lấy danh sách kênh đã kết nối trong Postiz (để chọn integration id).
export async function listIntegrations({ url, key } = {}) {
  const base = (url || apiUrl()).replace(/\/$/, '');
  const apiKey = key || process.env.POSTIZ_API_KEY;
  const res = await fetch(`${base}/public/v1/integrations`, {
    headers: { Authorization: apiKey || '' },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`integrations ${res.status}: ${text.slice(0, 200)}`);
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    list = [];
  }
  return Array.isArray(list) ? list : list.integrations || [];
}

/**
 * Trang Facebook đã kết nối trong Media Hub (Add Channel) KÈM page token.
 * Bot dùng token này để đăng thẳng Facebook — user chỉ kết nối Trang MỘT lần
 * ở Media Hub, không phải dán user token riêng cho bot nữa.
 * Trả []: chưa có key / Hub chưa chạy / Hub bản cũ chưa có endpoint.
 */
export async function fetchHubFacebookPages() {
  const apiKey = process.env.POSTIZ_API_KEY;
  if (!apiKey) return [];
  try {
    const res = await fetch(`${apiUrl()}/public/v1/facebook-pages`, {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const list = await res.json().catch(() => []);
    return Array.isArray(list) ? list.filter((p) => p && p.pageId && p.token) : [];
  } catch {
    return [];
  }
}

// Upload 1 file local vào Postiz, trả về media record {id, path}.
async function uploadLocalFile(base, apiKey, filePath) {
  const buf = fs.readFileSync(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(filePath));
  const res = await fetch(`${base}/public/v1/upload`, {
    method: 'POST',
    headers: { Authorization: apiKey }, // KHÔNG set content-type — để fetch tự set multipart boundary
    body: form,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`upload ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

// Đẩy 1 bài nháp vào Postiz.
//   caption       : nội dung bài
//   imagePaths    : mảng đường dẫn FILE ẢNH local (từ draft.savedImages)
//   videoPaths    : mảng đường dẫn FILE VIDEO local (từ draft.savedVideos)
//   imageCaptions : caption riêng TỪNG ảnh (cùng thứ tự imagePaths) → gắn vào alt
//   videoCaptions : caption riêng từng video (cùng thứ tự videoPaths)
//   groupName      : tên nhóm/route (để log)
//   integrationIds : NHIỀU kênh Media Hub của nhóm (route.postizIntegrationIds)
//                    → MỖI kênh tạo MỘT thẻ nháp RIÊNG trên Lịch (không cross-post
//                    chung 1 thẻ). Upload media 1 lần, dùng lại cho mọi thẻ.
//   integrationId  : (cũ) 1 kênh — vẫn nhận để tương thích ngược.
//                    Tất cả bỏ trống = dùng kênh mặc định POSTIZ_INTEGRATION_ID
export async function pushToPostiz({
  caption = '',
  imagePaths = [],
  videoPaths = [],
  imageCaptions = [],
  videoCaptions = [],
  // Song song với imagePaths (theo đúng thứ tự): true = ảnh bị lọc/chặn an
  // toàn, gắn cờ hidden để Media Hub vẫn hiển thị cho người duyệt xem lại
  // (bấm mắt để hiện) nhưng KHÔNG đăng thật. videoPaths chưa có khái niệm ẩn.
  imageHidden = [],
  imageHiddenReasons = [],
  groupName = '',
  integrationId = '',
  integrationIds = [],
}) {
  if (process.env.POSTIZ_ENABLED !== 'true') return { skipped: 'disabled' };

  const apiKey = process.env.POSTIZ_API_KEY;
  // Danh sách kênh đích: mảng mới → field cũ 1 kênh → kênh mặc định env.
  let ids = (Array.isArray(integrationIds) ? integrationIds : [])
    .map((x) => String(x || '').trim())
    .filter(Boolean);
  if (!ids.length && integrationId) ids = [String(integrationId).trim()].filter(Boolean);
  if (!ids.length && process.env.POSTIZ_INTEGRATION_ID) ids = [process.env.POSTIZ_INTEGRATION_ID];
  // Bỏ trùng (lỡ chọn 2 lần cùng kênh) — mỗi kênh 1 thẻ, không nhân đôi.
  ids = [...new Set(ids)];
  if (!apiKey || !ids.length) {
    return { skipped: 'missing-config' };
  }
  const base = apiUrl();

  // Upload media local MỘT LẦN -> lấy {id, path}; dùng lại cho MỌI kênh. Kèm alt
  // = caption riêng từng ảnh/video (Media Hub hiển thị/sửa alt, đăng kèm bài).
  // Ảnh có hidden=true (lọc trùng/mờ/tối/AI chặn an toàn) vẫn upload + hiện
  // trong Media Hub như bình thường, chỉ gắn cờ để Hub loại nó lúc đăng thật.
  const media = [];
  const files = [
    ...(imagePaths || []).map((f, i) => ({
      f,
      alt: (imageCaptions || [])[i] || '',
      hidden: !!(imageHidden || [])[i],
      hiddenReason: (imageHiddenReasons || [])[i] || '',
    })),
    ...(videoPaths || []).map((f, i) => ({ f, alt: (videoCaptions || [])[i] || '', hidden: false, hiddenReason: '' })),
  ];
  for (const { f, alt, hidden, hiddenReason } of files) {
    try {
      const m = await uploadLocalFile(base, apiKey, f);
      media.push({
        id: m.id,
        path: m.path,
        ...(alt ? { alt } : {}),
        ...(hidden ? { hidden: true, hiddenReason: hiddenReason || 'loc-tu-dong' } : {}),
      });
    } catch (e) {
      console.warn(`[postiz] upload lỗi (${path.basename(f)}): ${e.message}`);
    }
  }

  // MỖI kênh = MỘT lời gọi /public/v1/posts riêng → một thẻ nháp độc lập trên
  // Lịch (gộp nhiều kênh vào 1 posts[] sẽ thành 1 thẻ cross-post, KHÔNG phải cái
  // ta muốn). Lệch giờ 1 phút/kênh để các thẻ không đè cùng một ô.
  const postIds = [];
  const errors = [];
  for (let i = 0; i < ids.length; i++) {
    const body = {
      type: 'draft', // vào hàng chờ duyệt trong Media Hub
      date: new Date(Date.now() + 2 * 3600 * 1000 + i * 60 * 1000).toISOString(),
      // Tag "Zalo" để Media Hub nhận diện bài chờ duyệt từ nhóm Zalo.
      tags: [{ value: 'Zalo', label: 'Zalo' }],
      shortLink: false,
      posts: [
        {
          integration: { id: ids[i] },
          value: [{ content: caption || '', image: media }],
        },
      ],
    };
    try {
      const res = await fetch(`${base}/public/v1/posts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: apiKey },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) {
        errors.push(`${res.status}: ${text.slice(0, 200)}`);
        continue;
      }
      try {
        const arr = JSON.parse(text);
        if (Array.isArray(arr) && arr[0]?.postId) postIds.push(arr[0].postId);
      } catch {}
    } catch (e) {
      errors.push(e.message);
    }
  }

  if (!postIds.length && errors.length) {
    // Không thẻ nào tạo được → coi như lỗi (giữ thẻ ở hàng chờ bot làm lưới an toàn).
    return { ok: false, error: errors[0], count: 0 };
  }
  console.log(
    `[postiz] ✅ Đã đẩy "${groupName}" thành ${postIds.length}/${ids.length} thẻ nháp (${media.length} media) sang Media Hub.`
  );
  // postId (số ít) = thẻ đầu, giữ cho code cũ; postIds = mọi thẻ; count = số kênh OK.
  return {
    ok: true,
    media: media.length,
    postId: postIds[0] || null,
    postIds,
    count: postIds.length,
    ...(errors.length ? { partialError: errors[0] } : {}),
  };
}
