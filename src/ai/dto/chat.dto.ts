import { Type } from 'class-transformer';
import { IsString, IsNotEmpty, IsOptional, IsInt, Min, Max } from 'class-validator';

export class ChatDto {
  @IsString() @IsNotEmpty() content!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10) topK?: number = 5;
}
