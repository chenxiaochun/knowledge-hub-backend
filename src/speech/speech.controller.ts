import {
  Controller,
  BadRequestException,
  Post,
  UploadedFile,
  UseInterceptors,
  Inject,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import type { UploadAudio } from './speech.service';

import { AsrResponseDto, AsrUploadDto } from './dto/asr.dto';
import { SpeechService } from './speech.service';

@ApiTags('speech')
@ApiBearerAuth()
@Controller('speech')
export class SpeechController {
  @Inject(SpeechService)
  private readonly speechService!: SpeechService;

  constructor() {}

  /**
   * 语音识别（一句话识别）
   * @param file - 音频文件（form-data 字段名: audio）
   * @returns 识别文本
   */
  @Post('asr')
  @ApiOperation({ summary: '语音识别（一句话识别）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ type: AsrUploadDto })
  @ApiOkResponse({ description: '识别成功', type: AsrResponseDto })
  @UseInterceptors(FileInterceptor('audio'))
  async recognize(@UploadedFile() file?: Express.Multer.File): Promise<AsrResponseDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('音频文件不能为空');
    }
    const audio: UploadAudio = {
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
    const result = await this.speechService.recognizeBySentence(audio);
    // 腾讯云返回对象时取 Result；统一给前端 string
    const text =
      typeof result === 'string'
        ? result
        : ((result as { Result?: string; result?: string })?.Result ??
          (result as { result?: string })?.result ??
          '');
    return { text };
  }
}
