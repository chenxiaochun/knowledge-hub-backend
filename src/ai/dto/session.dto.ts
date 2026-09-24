import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class QuerySessionDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class CreateSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  title?: string;
}

export class UpdateSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  title!: string;
}
