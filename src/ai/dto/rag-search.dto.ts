import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class RagSearchDto {
  @IsString() @IsNotEmpty() query!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) topK?: number = 5;
}
