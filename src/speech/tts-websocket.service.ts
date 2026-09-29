import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { WebSocketServer } from 'ws';

import { TtsRelayService } from './tts-relay.service';

/** 在 HTTP 服务就绪后挂载 TTS 客户端 WebSocket（path 含全局 /api 前缀） */
@Injectable()
export class TtsWebSocketService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TtsWebSocketService.name);
  private wss?: WebSocketServer;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly ttsRelay: TtsRelayService,
  ) {}

  onApplicationBootstrap(): void {
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/api/speech/tts/ws',
    });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const sessionId = url.searchParams.get('sessionId') ?? undefined;
      const id = this.ttsRelay.registerClient(ws, sessionId);
      ws.on('close', () => this.ttsRelay.unregisterClient(id));
    });

    this.logger.log('TTS WebSocket mounted at /api/speech/tts/ws');
  }

  onModuleDestroy(): void {
    this.wss?.close();
    this.wss = undefined;
  }
}
