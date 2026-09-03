import { IsOptional, IsString } from 'class-validator';

/** multipart 里除 file 外的可选字段 */
export class UploadParseDto {
  @IsOptional()
  @IsString()
  tags?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}
