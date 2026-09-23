import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

/** 图谱检索查询参数 */
export class GraphSearchQueryDto {
  @IsString()
  @MinLength(1)
  keyword!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}

/** 全景图查询 */
export class GraphOverviewDto {
  @IsString()
  @MinLength(1)
  keyword!: string;

  @IsString()
  entityType!: string;

  @IsString()
  from!: string;

  @IsString()
  to!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(80)
  docLimit?: number = 80;
}
