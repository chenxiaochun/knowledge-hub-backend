import { ApiProperty } from '@nestjs/swagger';

/** 语音识别上传（multipart/form-data，字段名 audio） */
export class AsrUploadDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: '音频文件（支持 wav / mp3 / m4a / ogg / webm 等）',
  })
  audio!: Express.Multer.File;
}

/** 语音识别结果 */
export class AsrResponseDto {
  @ApiProperty({ description: '识别出的文本', example: '你好世界' })
  text!: string;
}
