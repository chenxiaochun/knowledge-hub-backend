import {
  Controller,
  BadRequestException,
  BadGatewayException,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  Inject,
  StreamableFile,
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
import { TtsRequestDto } from './dto/tts.dto';
import { SpeechService } from './speech.service';
import { TtsOneShotService } from './tts-one-shot.service';

@ApiTags('speech')
@ApiBearerAuth()
@Controller('speech')
export class SpeechController {
  @Inject(SpeechService)
  private readonly speechService!: SpeechService;

  @Inject(TtsOneShotService)
  private readonly ttsOneShot!: TtsOneShotService;

  constructor() {}

  /**
   * 文本转语音：返回 MP3，前端可直接 blob + Audio 播放
   */
  @Post('tts')
  @ApiOperation({ summary: '文本转语音（返回 MP3）' })
  @ApiBody({ type: TtsRequestDto })
  @ApiOkResponse({
    description: 'MP3 音频',
    content: { 'audio/mpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  async synthesize(@Body() dto: TtsRequestDto): Promise<StreamableFile> {
    const text = dto.text.trim();
    if (!text) {
      throw new BadRequestException('文本不能为空');
    }
    const buffer = await this.ttsOneShot.synthesizeToMp3(text);
    if (!buffer.length) {
      throw new BadGatewayException('未收到音频数据');
    }
    return new StreamableFile(buffer, {
      type: 'audio/mpeg',
      disposition: 'inline',
    });
  }

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
