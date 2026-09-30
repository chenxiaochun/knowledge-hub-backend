import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateImageDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  prompt!: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() ? value.trim() : undefined))
  imageUrl?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value ?? true)
  promptExtend?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value ?? false)
  watermark?: boolean;
}

/** 与模块命名一致，同 CreateImageDto */
export { CreateImageDto as CreateAiCanvaDto };
