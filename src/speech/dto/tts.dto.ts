import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 文本转语音请求 */
export class TtsRequestDto {
  @ApiProperty({ description: '要朗读的文本', example: '你好，欢迎使用知识库。' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  text!: string;
}
