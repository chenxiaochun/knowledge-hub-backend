import { Inject, Injectable } from '@nestjs/common';

import { AsrClientService } from './asr-client.service';

export type UploadAudio = {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
};

@Injectable()
export class SpeechService {
  @Inject(AsrClientService)
  private readonly asrClientService!: AsrClientService;

  /**
   * 根据音频文件的 MIME 类型和文件名，确定音频格式
   * @param file - 音频文件
   * @returns 音频格式
   */
  private resolveVoiceFormat(file: UploadAudio): string {
    const mime = (file.mimeType || '').toLowerCase();
    const name = (file.originalName || '').toLowerCase();
    if (mime.includes('ogg') || name.endsWith('.ogg')) return 'ogg-opus';
    if (mime.includes('wav') || name.endsWith('.wav')) return 'wav';
    if (mime.includes('mp3') || name.endsWith('.mp3')) return 'mp3';
    if (mime.includes('m4a') || name.endsWith('.m4a') || mime.includes('mp4')) return 'm4a';
    // Chrome MediaRecorder 多为 webm+opus；腾讯云无 webm，按 ogg-opus 尝试
    if (mime.includes('webm') || name.endsWith('.webm')) return 'ogg-opus';
    return 'ogg-opus';
  }

  /**
   * 根据音频文件，识别语音内容
   * @param file - 音频文件
   * @returns 语音内容
   */
  async recognizeBySentence(file: UploadAudio) {
    const audioBase64 = file.buffer.toString('base64');
    const result = await this.asrClientService.client.SentenceRecognition({
      EngSerViceType: '16k_zh',
      SourceType: 1,
      Data: audioBase64,
      DataLen: file.buffer.length,
      VoiceFormat: this.resolveVoiceFormat(file),
    });
    return result;
  }
}
