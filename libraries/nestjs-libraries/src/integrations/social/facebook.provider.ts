import {
  AnalyticsData,
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import dayjs from 'dayjs';
import {
  BadBody,
  SocialAbstract,
  ValidityMedia,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { FacebookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { DribbbleDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/dribbble.dto';
import { Integration } from '@prisma/client';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { timer } from '@gitroom/helpers/utils/timer';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';

@Rules(
  "Facebook posts can be text only, or include photos or a video. If it's a story, it must have at least one attachment (photo or video), and each media is published as a separate story."
)
export class FacebookProvider extends SocialAbstract implements SocialProvider {
  identifier = 'facebook';
  name = 'Facebook Page';
  isBetweenSteps = true;
  // read_insights + pages_read_user_content đã bật trong use case "Manage
  // everything on your Page" + app để Development mode + tài khoản có App Role
  // → cấp được KHÔNG cần App Review. read_insights: biểu đồ analytics.
  // pages_read_user_content: đọc reactions/comments của bài (mục "Bài nổi bật").
  // Nếu app chuyển Live hoặc tài khoản không có vai trò → 2 quyền này cần review.
  scopes = [
    'pages_show_list',
    'business_management',
    'pages_manage_posts',
    'pages_read_engagement',
    // Bắt buộc để ĐĂNG bình luận thay Trang (POST /{post-id}/comments) — tính
    // năng "Add comment / post" (bình luận tự động sau bài chính). Trước đây
    // THIẾU scope này: comment() vẫn được GỌI (isCommentable chỉ kiểm tra hàm
    // có tồn tại, không kiểm tra quyền thật), Facebook âm thầm từ chối bằng
    // permissions error — kênh vẫn đăng bài chính bình thường nên trông như
    // "không có gì sai" dù bình luận chưa từng lên thật.
    'pages_manage_engagement',
    'read_insights',
    'pages_read_user_content',
  ];
  override maxConcurrentJob = 500; // Facebook has reasonable rate limits
  editor = 'normal' as const;
  maxLength() {
    return 63206;
  }
  dto = FacebookDto;

  override async checkValidity(
    [firstPost]: Array<ValidityMedia[]>,
    settings: any
  ): Promise<string | true> {
    if (settings?.post_type === 'story') {
      if (!firstPost?.length) {
        return 'Story should have at least one media';
      }
    }
    return true;
  }

  override handleErrors(
    body: string,
    status: number
  ):
    | {
        type: 'refresh-token' | 'bad-body';
        value: string;
      }
    | undefined {
    // Access token validation errors - require re-authentication
    if (body.indexOf('Error validating access token') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Please re-authenticate your Facebook account',
      };
    }

    if (body.indexOf('REVOKED_ACCESS_TOKEN') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token has been revoked, please re-authenticate',
      };
    }

    if (body.indexOf('1366046') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Photos should be smaller than 4 MB and saved as JPG, PNG',
      };
    }

    if (body.indexOf('1390008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'You are posting too fast, please slow down',
      };
    }

    // Content policy violations
    if (body.indexOf('1346003') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content flagged as abusive by Facebook',
      };
    }

    if (body.indexOf('1404006') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          "We couldn't post your comment, A security check in facebook required to proceed.",
      };
    }

    if (body.indexOf('2069019') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid file',
      }
    }

    if (body.indexOf('1404102') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Content violates Facebook Community Standards',
      };
    }

    // Permission errors
    if (body.indexOf('1404078') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Page publishing authorization required, please re-authenticate',
      };
    }

    if (body.indexOf('1366051') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'These photos were already posted.',
      };
    }

    if (body.indexOf('1609008') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Cannot post Facebook.com links',
      };
    }

    // Parameter validation errors
    if (body.indexOf('2061006') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid URL format in post content',
      };
    }

    if (body.indexOf('1349125') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Invalid content format',
      };
    }

    if (body.indexOf('1404112') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'For security reasons, your account has limited access to the site for a few days',
      };
    }

    if (body.indexOf('Name parameter too long') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Post content is too long',
      };
    }

    // Service errors - checking specific subcodes first
    if (body.indexOf('1363047') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    if (body.indexOf('1609010') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook service temporarily unavailable',
      };
    }

    if (body.indexOf('4854002') > -1) {
      return {
        type: 'bad-body' as const,
        value:
          'Confirm your identity before you can publish as this Page. Open the Facebook app on your phone and follow the instructions',
      };
    }
    if (body.indexOf('(#100) No permission to publish the video') > -1) {
      return {
        type: 'bad-body' as const,
        value: 'Facebook return: No permission to publish the video',
      };
    }
    if (body.indexOf('490') > -1) {
      return {
        type: 'refresh-token' as const,
        value: 'Access token expired, please re-authenticate',
      };
    }

    if (status === 401) {
      return {
        type: 'bad-body' as const,
        value:
          'An unknown error occurred, please try again later or contact support',
      };
    }

    // CATCH-ALL: lỗi FB KHÔNG khớp mã nào ở trên → bóc message THẬT từ body
    // (FB trả {"error":{"message","code","error_subcode"}}) thay vì trả undefined
    // → trước đây tầng fetch rơi về "Unknown Error", giấu mất lý do thật (token,
    // quyền, nội dung vi phạm, ảnh lỗi…). Giờ hiện đúng câu FB nói.
    try {
      const fbErr = JSON.parse(body)?.error;
      if (fbErr?.message) {
        const code = fbErr.code
          ? ` (#${fbErr.code}${
              fbErr.error_subcode ? '/' + fbErr.error_subcode : ''
            })`
          : '';
        return {
          type: 'bad-body' as const,
          value: `Facebook: ${String(fbErr.message).slice(0, 400)}${code}`,
        };
      }
    } catch {
      /* body không phải JSON — giữ hành vi cũ (trả undefined) */
    }

    return undefined;
  }

  async refreshToken(refresh_token: string): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async generateAuthUrl() {
    const state = makeId(6);
    return {
      url:
        'https://www.facebook.com/v20.0/dialog/oauth' +
        `?client_id=${process.env.FACEBOOK_APP_ID}` +
        `&redirect_uri=${encodeURIComponent(
          `${process.env.FRONTEND_URL}/integrations/social/facebook`
        )}` +
        `&state=${state}` +
        `&scope=${this.scopes.join(',')}`,
      codeVerifier: makeId(10),
      state,
    };
  }

  async reConnect(
    id: string,
    requiredId: string,
    accessToken: string
  ): Promise<Omit<AuthTokenDetails, 'refreshToken' | 'expiresIn'>> {
    const information = await this.fetchPageInformation(accessToken, {
      page: requiredId,
    });

    return {
      id: information.id,
      name: information.name,
      accessToken: information.access_token,
      picture: information.picture,
      username: information.username,
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    const getAccessToken = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          `?client_id=${process.env.FACEBOOK_APP_ID}` +
          `&redirect_uri=${encodeURIComponent(
            `${process.env.FRONTEND_URL}/integrations/social/facebook${
              params.refresh ? `?refresh=${params.refresh}` : ''
            }`
          )}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&code=${params.code}`
      )
    ).json();

    const { access_token } = await (
      await fetch(
        'https://graph.facebook.com/v20.0/oauth/access_token' +
          '?grant_type=fb_exchange_token' +
          `&client_id=${process.env.FACEBOOK_APP_ID}` +
          `&client_secret=${process.env.FACEBOOK_APP_SECRET}` +
          `&fb_exchange_token=${getAccessToken.access_token}&fields=access_token,expires_in`
      )
    ).json();

    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me/permissions?access_token=${access_token}`
      )
    ).json();

    const permissions = (data || [])
      .filter((d: any) => d.status === 'granted')
      .map((p: any) => p.permission);
    // CHỈ bắt buộc quyền LÕI để đăng bài. read_insights + pages_read_user_content
    // (+ đôi khi pages_read_engagement) khi app Live cần App Review → tài khoản
    // KHÔNG cấp được → nếu để trong danh sách bắt buộc, checkScopes ném
    // NotEnoughScopes làm NỐI KÊNH văng 500 ("Không thể thêm nhà cung cấp") dù
    // kênh thừa sức đăng bài. Vẫn XIN ĐỦ quyền ở generateAuthUrl (this.scopes):
    // cấp được → trang Phân tích chạy; không → kênh VẪN nối/đăng được, chỉ
    // analytics trống (xem [[facebook-app-live-analytics]] để mở lại quyền).
    this.checkScopes(['pages_show_list', 'pages_manage_posts'], permissions);

    const { id, name, picture } = await (
      await fetch(
        `https://graph.facebook.com/v20.0/me?fields=id,name,picture&access_token=${access_token}`
      )
    ).json();

    return {
      id,
      name,
      accessToken: access_token,
      refreshToken: access_token,
      expiresIn: dayjs().add(59, 'days').unix() - dayjs().unix(),
      picture: picture?.data?.url || '',
      username: '',
    };
  }

  async pages(accessToken: string) {
    const seenIds = new Set<string>();
    const allPages: any[] = [];

    const fetchPaginated = async (startUrl: string) => {
      let nextUrl: string | undefined = startUrl;
      while (nextUrl) {
        const response = await (await fetch(nextUrl)).json();
        if (response.data) {
          for (const page of response.data) {
            if (!seenIds.has(page.id)) {
              seenIds.add(page.id);
              allPages.push(page);
            }
          }
        }
        nextUrl = response.paging?.next;
      }
    };

    // Fetch pages the user explicitly shared during the OAuth dialog
    await fetchPaginated(
      `https://graph.facebook.com/v20.0/me/accounts?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
    );

    // Also fetch pages via Business Manager API to discover pages
    // not selected during the OAuth page selection step
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetch(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              await fetchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/owned_pages?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }

            try {
              await fetchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/client_pages?fields=id,username,name,access_token,picture.type(large)&limit=100&access_token=${accessToken}`
              );
            } catch {
              // Continue with other businesses
            }
          }
        }
        bizUrl = bizResponse.paging?.next;
      }
    } catch {
      // Business Manager API not available for all users
    }

    return allPages;
  }

  async fetchPageInformation(accessToken: string, data: { page: string }) {
    const pageId = data.page;
    const fields = 'id,username,name,access_token,picture.type(large)';

    const searchPaginated = async (startUrl: string) => {
      let url: string | undefined = startUrl;
      while (url) {
        const response = await (await fetch(url)).json();
        if (response.data) {
          const page = response.data.find(
            (p: any) => String(p.id) === String(pageId)
          );
          if (page) {
            return {
              id: page.id,
              name: page.name,
              access_token: page.access_token,
              picture: page.picture?.data?.url || '',
              username: page.username,
            };
          }
        }
        url = response.paging?.next;
      }
      return null;
    };

    // 1. Check /me/accounts
    const fromAccounts = await searchPaginated(
      `https://graph.facebook.com/v20.0/me/accounts?fields=${fields}&limit=100&access_token=${accessToken}`
    );
    if (fromAccounts) return fromAccounts;

    // 2. Check Business Manager owned_pages and client_pages
    try {
      let bizUrl:
        | string
        | undefined = `https://graph.facebook.com/v20.0/me/businesses?access_token=${accessToken}`;

      while (bizUrl) {
        const bizResponse = await (await fetch(bizUrl)).json();
        if (bizResponse.data) {
          for (const business of bizResponse.data) {
            try {
              const fromOwned = await searchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/owned_pages?fields=${fields}&limit=100&access_token=${accessToken}`
              );
              if (fromOwned) return fromOwned;
            } catch {
              // Continue with other businesses
            }

            try {
              const fromClient = await searchPaginated(
                `https://graph.facebook.com/v20.0/${business.id}/client_pages?fields=${fields}&limit=100&access_token=${accessToken}`
              );
              if (fromClient) return fromClient;
            } catch {
              // Continue with other businesses
            }
          }
        }
        bizUrl = bizResponse.paging?.next;
      }
    } catch {
      // Business Manager API not available for all users
    }

    throw new Error('Page not found in your accounts');
  }

  // Bảo đảm ĐĂNG BẰNG TOKEN TRANG. Kênh có thể đang lưu token NGƯỜI DÙNG thay vì
  // token Trang → ảnh "ẩn" (published:false) khi ghép vào /feed bị FB từ chối #200
  // "Unpublished posts must be posted to a page as the page itself". Nếu /me.id ≠
  // pageId thì đổi token Trang qua 2 đường: (1) /{pageId}?fields=access_token,
  // (2) quét /me/accounts + Business Manager (fetchPageInformation — đúng đường đã
  // dùng lúc NỐI KÊNH). Cả 2 fail → KHÔNG rơi êm về token cũ nữa (đăng kiểu gì
  // cũng #200): ném BadBody nêu rõ lý do FB + cách sửa, để user thấy ngay trên UI.
  // Kênh khỏe: /me = pageId → trả ngay, chỉ tốn 1 GET rẻ.
  private async ensurePageToken(
    pageId: string,
    token: string,
    throwOnFail = true
  ): Promise<string> {
    // 1) Token thuộc về ai? Lỗi mạng/token hỏng → giữ hành vi cũ (đường
    // refresh_token phía sau tự xử lý).
    let meId = '';
    try {
      const me = await (
        await fetch(
          `https://graph.facebook.com/v20.0/me?fields=id&access_token=${token}`
        )
      ).json();
      meId = me?.id ? String(me.id) : '';
    } catch {
      return token;
    }
    if (!meId || meId === String(pageId)) {
      return token; // đã là token Trang (hoặc không xác định được) → như cũ
    }

    // 2) Chắc chắn USER token → đổi trực tiếp
    let reason = '';
    try {
      const direct = await (
        await fetch(
          `https://graph.facebook.com/v20.0/${pageId}?fields=access_token&access_token=${token}`
        )
      ).json();
      if (direct?.access_token) {
        return direct.access_token;
      }
      reason =
        direct?.error?.message || JSON.stringify(direct || {}).slice(0, 200);
    } catch (e: any) {
      reason = e?.message || 'network error';
    }

    // 3) Đường vòng: /me/accounts + Business Manager
    try {
      const info = await this.fetchPageInformation(token, { page: pageId });
      if (info?.access_token) {
        return info.access_token;
      }
    } catch (e: any) {
      reason += ` | me/accounts: ${e?.message || 'failed'}`;
    }

    console.log(
      `[facebook] ensurePageToken THẤT BẠI page=${pageId} me=${meId} lý do=${reason}`
    );
    if (!throwOnFail) {
      return token;
    }
    throw new BadBody(
      'facebook-page-token',
      JSON.stringify({ pageId, meId, reason }),
      '',
      `Facebook: kênh đang lưu token NGƯỜI DÙNG (id ${meId}) thay vì token TRANG nên không đăng được (#200). Tự đổi sang token Trang thất bại: ${reason}. Cách sửa: vào Kênh → "Nối lại" (Reconnect) kênh này rồi chọn lại Trang.`
    );
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<FacebookDto>[]
  ): Promise<PostResponse[]> {
    accessToken = await this.ensurePageToken(id, accessToken);
    const [firstPost] = postDetails;
    const isStory = firstPost?.settings?.post_type === 'story';

    let finalId = '';
    let finalUrl = '';
    if (isStory) {
      let lastPostId = '';
      for (const media of firstPost?.media || []) {
        const isVideoStory = hasExtension(media.path, 'mp4');
        if (isVideoStory) {
          const { video_id, upload_url } = await (
            await this.fetch(
              `https://graph.facebook.com/v20.0/${id}/video_stories?upload_phase=start&access_token=${accessToken}`,
              {
                method: 'POST',
              },
              'start video story upload'
            )
          ).json();

          await this.fetch(
            upload_url,
            {
              method: 'POST',
              headers: {
                Authorization: `OAuth ${accessToken}`,
                file_url: media.path,
              },
            },
            'upload video story'
          );

          let videoStatus = 'in_progress';
          let attempts = 0;
          const maxAttempts = 54; // ~9 minutes at 10s interval
          while (videoStatus !== 'upload_complete' && videoStatus !== 'ready') {
            if (attempts++ >= maxAttempts) {
              throw new Error('Video processing timed out');
            }

            const { status } = await (
              await this.fetch(
                `https://graph.facebook.com/v20.0/${video_id}?fields=status&access_token=${accessToken}`,
                undefined,
                '',
                0,
                true
              )
            ).json();
            videoStatus = status?.video_status || 'in_progress';
            if (videoStatus === 'error') {
              throw new Error('Video processing failed');
            }
            if (videoStatus !== 'upload_complete' && videoStatus !== 'ready') {
              await timer(10000);
            }
          }

          const { post_id: storyPostId } = await (
            await this.fetch(
              `https://graph.facebook.com/v20.0/${id}/video_stories?upload_phase=finish&video_id=${video_id}&access_token=${accessToken}`,
              {
                method: 'POST',
              },
              'finish video story upload'
            )
          ).json();

          lastPostId = storyPostId;
        } else {
          const { id: photoId } = await (
            await this.fetch(
              `https://graph.facebook.com/v20.0/${id}/photos?access_token=${accessToken}`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  url: media.path,
                  published: false,
                }),
              },
              'upload photo story'
            )
          ).json();

          const { post_id: storyPostId } = await (
            await this.fetch(
              `https://graph.facebook.com/v20.0/${id}/photo_stories?photo_id=${photoId}&access_token=${accessToken}`,
              {
                method: 'POST',
              },
              'publish photo story'
            )
          ).json();

          lastPostId = storyPostId;
        }
      }

      finalId = lastPostId;
      finalUrl = `https://www.facebook.com/stories/${lastPostId}`;
    } else if (hasExtension(firstPost?.media?.[0]?.path, 'mp4')) {
      const {
        id: videoId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/videos?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              file_url: firstPost?.media?.[0]?.path!,
              description: firstPost.message,
              published: true,
            }),
          },
          'upload mp4'
        )
      ).json();

      finalUrl = 'https://www.facebook.com/reel/' + videoId;
      finalId = videoId;
    } else {
      const uploadPhotos = !firstPost?.media?.length
        ? []
        : await Promise.all(
            firstPost.media.map(async (media) => {
              const { id: photoId } = await (
                await this.fetch(
                  `https://graph.facebook.com/v20.0/${id}/photos?access_token=${accessToken}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      url: media.path,
                      published: false,
                    }),
                  },
                  'upload images slides'
                )
              ).json();

              return { media_fbid: photoId };
            })
          );

      const {
        id: postId,
        permalink_url,
        ...all
      } = await (
        await this.fetch(
          `https://graph.facebook.com/v20.0/${id}/feed?access_token=${accessToken}&fields=id,permalink_url`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...(uploadPhotos?.length ? { attached_media: uploadPhotos } : {}),
              ...(firstPost?.settings?.url
                ? { link: firstPost.settings.url }
                : {}),
              message: firstPost.message,
              published: true,
            }),
          },
          'finalize upload'
        )
      ).json();

      finalUrl = permalink_url;
      finalId = postId;
    }

    return [
      {
        id: firstPost.id,
        postId: finalId,
        releaseURL: finalUrl,
        status: 'success',
      },
    ];
  }

  async comment(
    id: string,
    postId: string,
    lastCommentId: string | undefined,
    accessToken: string,
    postDetails: PostDetails<FacebookDto>[],
    integration: Integration
  ): Promise<PostResponse[]> {
    accessToken = await this.ensurePageToken(id, accessToken);
    const [commentPost] = postDetails;
    const replyToId = lastCommentId || postId;

    const data = await (
      await this.fetch(
        `https://graph.facebook.com/v20.0/${replyToId}/comments?access_token=${accessToken}&fields=id,permalink_url`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            ...(commentPost.media?.length
              ? { attachment_url: commentPost.media[0].path }
              : {}),
            message: commentPost.message,
          }),
        },
        'add comment'
      )
    ).json();

    return [
      {
        id: commentPost.id,
        postId: data.id,
        releaseURL: data.permalink_url,
        status: 'success',
      },
    ];
  }

  async analytics(
    id: string,
    accessToken: string,
    date: number
  ): Promise<AnalyticsData[]> {
    // Insights cũng cần token TRANG — kênh lỡ lưu user token thì tự đổi;
    // không đổi được thì giữ token cũ (không ném, analytics trống còn hơn văng lỗi).
    accessToken = await this.ensurePageToken(id, accessToken, false);
    const until = dayjs().endOf('day').unix();
    const since = dayjs().subtract(date, 'day').unix();

    // Chỉ dùng metric v23 CÒN SỐNG & trả DỮ LIỆU THẬT (đã probe 2026-07-05).
    // Metric cũ (page_impressions*, page_fans, page_engaged_users…) đã bị Meta
    // gỡ → KHÔNG dùng (tránh số giả/lỗi). Thứ tự = thứ tự hiện trên dashboard.
    const METRICS: { name: string; label: string; cumulative?: boolean }[] = [
      { name: 'page_total_media_view_unique', label: 'Reach' },
      { name: 'page_media_view', label: 'Media views' },
      { name: 'page_video_views', label: 'Video views' },
      { name: 'page_post_engagements', label: 'Post engagement' },
      { name: 'page_views_total', label: 'Profile views' },
      { name: 'page_actions_post_reactions_total', label: 'Reactions' },
      { name: 'page_daily_follows', label: 'New followers' },
      { name: 'page_follows', label: 'Total followers', cumulative: true },
    ];
    const { data } = await (
      await fetch(
        `https://graph.facebook.com/v23.0/${id}/insights?metric=${METRICS.map(
          (m) => m.name
        ).join(',')}&access_token=${accessToken}&period=day&since=${since}&until=${until}`
      )
    ).json();

    // Nhiều metric trả object (paid/organic hoặc {like,love,...}); cộng lại thành 1 số.
    const sumValue = (value: any): number => {
      if (value && typeof value === 'object') {
        return Object.values(value as Record<string, number>).reduce(
          (sum: number, v: number) => sum + (Number(v) || 0),
          0
        );
      }
      return Number(value) || 0;
    };

    // % thay đổi THẬT: trung bình nửa sau kỳ so với nửa đầu kỳ.
    const trend = (points: { total: number }[]): number => {
      if (!points || points.length < 2) return 0;
      const mid = Math.floor(points.length / 2);
      const avg = (arr: { total: number }[]) =>
        arr.length ? arr.reduce((s, p) => s + (p.total || 0), 0) / arr.length : 0;
      const first = avg(points.slice(0, mid));
      const second = avg(points.slice(mid));
      if (first === 0) return second > 0 ? 100 : 0;
      return Math.round(((second - first) / first) * 1000) / 10;
    };

    const byName: Record<string, any> = {};
    for (const d of data || []) byName[d.name] = d;

    // Trả theo THỨ TỰ METRICS, kèm meta để frontend xếp KPI/biểu đồ. Không bịa:
    // metric nào Graph không trả thì bỏ qua.
    return METRICS.filter((m) => byName[m.name]).map((m) => {
      const d = byName[m.name];
      const points =
        d?.values?.map((v: any) => ({
          total: sumValue(v.value),
          date: dayjs(v.end_time).format('YYYY-MM-DD'),
          // giữ breakdown reaction để vẽ donut (nếu là object)
          breakdown:
            v.value && typeof v.value === 'object' ? v.value : undefined,
        })) || [];
      return {
        label: m.label,
        key: m.name,
        cumulative: !!m.cumulative,
        percentageChange: trend(points),
        // với metric tích luỹ, "tổng" nên là giá trị MỚI NHẤT, không phải cộng dồn
        latest: points.length ? points[points.length - 1].total : 0,
        data: points,
      } as any;
    });
  }

  async postAnalytics(
    integrationId: string,
    accessToken: string,
    postId: string,
    date: number
  ): Promise<AnalyticsData[]> {
    const today = dayjs().format('YYYY-MM-DD');

    try {
      // Fetch post insights from Facebook Graph API.
      // post_impressions_unique was deprecated by Meta on 2026-06-15; it is replaced
      // by post_total_media_view_unique (unique media views = reach), available on
      // Graph API v23.0+. Engagement metrics below are unaffected.
      const { data } = await (
        await this.fetch(
          `https://graph.facebook.com/v23.0/${postId}/insights?metric=post_total_media_view_unique,post_reactions_by_type_total,post_clicks,post_clicks_by_type&access_token=${accessToken}`
        )
      ).json();

      if (!data || data.length === 0) {
        return [];
      }

      const result: AnalyticsData[] = [];

      for (const metric of data) {
        const value = metric.values?.[0]?.value;
        if (value === undefined) continue;

        let label = '';
        let total = '';

        switch (metric.name) {
          case 'post_total_media_view_unique':
            label = 'Impressions';
            total = String(value);
            break;
          case 'post_clicks':
            label = 'Clicks';
            total = String(value);
            break;
          case 'post_clicks_by_type':
            // This returns an object with click types
            if (typeof value === 'object') {
              const totalClicks = Object.values(
                value as Record<string, number>
              ).reduce((sum: number, v: number) => sum + v, 0);
              label = 'Clicks by Type';
              total = String(totalClicks);
            }
            break;
          case 'post_reactions_by_type_total':
            // This returns an object with reaction types
            if (typeof value === 'object') {
              const totalReactions = Object.values(
                value as Record<string, number>
              ).reduce((sum: number, v: number) => sum + v, 0);
              label = 'Reactions';
              total = String(totalReactions);
            }
            break;
        }

        if (label) {
          result.push({
            label,
            percentageChange: 0,
            data: [{ total, date: today }],
          });
        }
      }

      return result;
    } catch (err) {
      console.error('Error fetching Facebook post analytics:', err);
      return [];
    }
  }
}
