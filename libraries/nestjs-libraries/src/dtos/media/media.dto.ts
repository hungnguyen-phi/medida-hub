import {
  IsBoolean,
  IsDefined,
  IsString,
  IsUrl,
  ValidateIf,
  Validate,
} from 'class-validator';
import { ValidUrlExtension, ValidUrlPath } from '@gitroom/helpers/utils/valid.url.path';

export class MediaDto {
  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  @Validate(ValidUrlPath)
  @Validate(ValidUrlExtension)
  path: string;

  @ValidateIf((o) => o.alt)
  @IsString()
  alt?: string;

  @ValidateIf((o) => o.thumbnail)
  @IsUrl()
  thumbnail?: string;

  // Ảnh bị ẩn khỏi bài đăng thật (AI lọc mờ/tối/trùng/nguy hiểm khi gom từ
  // Zalo, hoặc user tự ẩn trong Trình quản lý media) — vẫn hiện trong
  // composer để xem/mở lại (bấm mắt để hiện lại), chỉ bị loại lúc ĐĂNG THẬT
  // (xem post.activity.ts postSocial/postComment).
  @ValidateIf((o) => o.hidden !== undefined)
  @IsBoolean()
  hidden?: boolean;

  @ValidateIf((o) => o.hiddenReason)
  @IsString()
  hiddenReason?: string;
}
