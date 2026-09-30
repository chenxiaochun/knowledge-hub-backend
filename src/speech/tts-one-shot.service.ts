import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import {
  buildTencentStreamTtsWsUrl,
  readTencentTtsCredentials,
  type TencentTtsCredentials,
} from './tencent-tts.util';

const SYNTHESIS_TIMEOUT_MS = 120_000;

@Injectable()
export class TtsOneShotService {
  private readonly logger = new Logger(TtsOneShotService.name);
  private readonly creds: TencentTtsCredentials;

  constructor(private readonly configService: ConfigService) {
    this.creds = readTencentTtsCredentials(this.configService);
  }

  /** 将整段文本合成为 MP3（腾讯云流式接口，服务端缓冲后一次返回） */
  async synthesizeToMp3(text: string): Promise<Buffer> {
    this.assertCredentials();

    const synthesisId = randomUUID();
    const url = buildTencentStreamTtsWsUrl(synthesisId, this.creds);

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let settled = false;
      let sentText = false;

      const finish = (error?: Error, buffer?: Buffer) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (ws.readyState < WebSocket.CLOSING) {
          ws.removeAllListeners();
          ws.close();
        }
        if (error) reject(error);
        else resolve(buffer ?? Buffer.alloc(0));
      };

      const ws = new WebSocket(url);

      const timer = setTimeout(() => {
        finish(new BadGatewayException('TTS 合成超时'));
      }, SYNTHESIS_TIMEOUT_MS);

      ws.on('error', (err) => {
        this.logger.warn(`Tencent TTS ws error: ${err.message}`);
        finish(new BadGatewayException(`TTS 连接失败：${err.message}`));
      });

      ws.on('message', (data, isBinary) => {
        if (isBinary) {
          chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
          return;
        }

        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
          return;
        }

        if (Number(msg.code) && Number(msg.code) !== 0) {
          finish(
            new BadGatewayException(String(msg.message ?? '腾讯云 TTS 返回错误')),
          );
          return;
        }

        if (Number(msg.ready) === 1 && !sentText) {
          sentText = true;
          ws.send(
            JSON.stringify({
              session_id: synthesisId,
              message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              action: 'ACTION_SYNTHESIS',
              data: text,
            }),
          );
          ws.send(
            JSON.stringify({
              session_id: synthesisId,
              action: 'ACTION_COMPLETE',
              data: '',
            }),
          );
        }

        if (Number(msg.final) === 1) {
          finish(undefined, Buffer.concat(chunks));
        }
      });

      ws.on('close', () => {
        if (!settled) {
          finish(new BadGatewayException('TTS 连接在合成完成前关闭'));
        }
      });
    });
  }

  private assertCredentials(): void {
    if (!this.creds.secretId || !this.creds.secretKey || !this.creds.appId) {
      throw new ServiceUnavailableException(
        'TTS 凭证缺失：请在 .env 配置 TENCENT_CLOUD_APP_ID（或 APP_ID），以及 TENCENT_CLOUD_SECRET_ID/KEY（或 SECRET_ID/SECRET_KEY）',
      );
    }
  }
}
