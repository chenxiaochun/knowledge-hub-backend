import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';

import { createHmac, randomUUID } from 'node:crypto';
import WebSocket from 'ws';

import { AI_TTS_STREAM_EVENT, type AiTtsStreamEvent } from './stream-events';

type ClientSession = {
  sessionId: string;
  clientWs: WebSocket;
  tencentWs?: WebSocket;
  /** 当前腾讯云合成轮次 id（握手 SessionId） */
  tencentSynthesisId?: string;
  /** 当前接受的 AI→TTS 轮次 */
  activeTurn: number;
  ready: boolean;
  pendingChunks: string[];
  closed: boolean;
};

@Injectable()
export class TtsRelayService implements OnModuleDestroy {
  private readonly logger = new Logger(TtsRelayService.name);
  private readonly sessions = new Map<string, ClientSession>();
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly appId: number;
  private readonly voiceType: number;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.secretId = configService.get<string>('TENCENT_CLOUD_SECRET_ID') ?? '';
    this.secretKey = configService.get<string>('TENCENT_CLOUD_SECRET_KEY') ?? '';
    this.appId = Number(configService.get<string>('TENCENT_CLOUD_APP_ID') ?? 0);
    this.voiceType = Number(configService.get<string>('TTS_VOICE_TYPE') ?? 101001);
  }

  onModuleDestroy(): void {
    for (const session of this.sessions.values()) {
      this.closeSession(session.sessionId, 'module destroy');
    }
  }

  registerClient(clientWs: WebSocket, wantedSessionId?: string): string {
    const sessionId = wantedSessionId?.trim() || randomUUID();
    const existing = this.sessions.get(sessionId);
    if (existing) {
      this.closeSession(sessionId, 'client reconnected');
    }

    this.sessions.set(sessionId, {
      sessionId,
      clientWs,
      activeTurn: 0,
      ready: false,
      pendingChunks: [],
      closed: false,
    });
    this.sendClientJson(clientWs, { type: 'session', sessionId });
    this.logger.log(`TTS client connected: ${sessionId}`);
    return sessionId;
  }

  unregisterClient(sessionId: string): void {
    this.closeSession(sessionId, 'client disconnected');
  }

  @OnEvent(AI_TTS_STREAM_EVENT)
  handleAiStreamEvent(event: AiTtsStreamEvent): void {
    const session = this.sessions.get(event.sessionId);
    if (!session) return;

    switch (event.type) {
      case 'start': {
        if (event.turn <= session.activeTurn) return;

        const wasActive = this.hasActiveTencent(session) || session.pendingChunks.length > 0;
        if (wasActive) {
          this.sendClientJson(session.clientWs, {
            type: 'tts_interrupted',
            sessionId: session.sessionId,
          });
          this.closeTencentWs(session, 'interrupted');
        }

        session.activeTurn = event.turn;
        session.pendingChunks = [];
        session.ready = false;
        this.openTencentConnection(session);

        this.sendClientJson(session.clientWs, {
          type: 'tts_started',
          sessionId: session.sessionId,
          query: event.query,
          turn: event.turn,
          interrupted: wasActive,
        });
        break;
      }
      case 'chunk': {
        if (event.turn !== session.activeTurn) return;
        const chunk = event.chunk?.trim();
        if (!chunk) return;
        if (
          !session.ready ||
          !session.tencentWs ||
          session.tencentWs.readyState !== WebSocket.OPEN
        ) {
          session.pendingChunks.push(chunk);
          return;
        }
        this.sendTencentChunk(session, chunk);
        break;
      }
      case 'end': {
        if (event.turn !== session.activeTurn) return;
        this.flushPendingChunks(session);
        if (session.tencentWs && session.tencentWs.readyState === WebSocket.OPEN) {
          session.tencentWs.send(
            JSON.stringify({
              session_id: session.tencentSynthesisId,
              action: 'ACTION_COMPLETE',
              data: '',
            }),
          );
        }
        break;
      }
      case 'error': {
        if (event.turn != null && event.turn !== session.activeTurn) return;
        this.sendClientJson(session.clientWs, {
          type: 'tts_error',
          message: event.error,
        });
        this.closeTencentWs(session, 'ai stream error');
        break;
      }
    }
  }

  private openTencentConnection(session: ClientSession): void {
    this.closeTencentWs(session, 'reopen');

    if (!this.secretId || !this.secretKey || !this.appId) {
      const message =
        'TTS 凭证缺失：请在 .env 配置 APP_ID（或 TENCENT_CLOUD_APP_ID），以及 SECRET_ID/SECRET_KEY（或 TENCENT_CLOUD_SECRET_ID/KEY）';
      this.logger.error(
        `${message}; secretId=${Boolean(this.secretId)}, secretKey=${Boolean(this.secretKey)}, appId=${this.appId}`,
      );
      this.sendClientJson(session.clientWs, {
        type: 'tts_error',
        message,
      });
      return;
    }

    const synthesisId = randomUUID();
    session.tencentSynthesisId = synthesisId;
    session.ready = false;

    const url = this.buildTencentTtsWsUrl(synthesisId);
    const tencentWs = new WebSocket(url);
    session.tencentWs = tencentWs;

    tencentWs.on('open', () => {
      if (session.tencentWs !== tencentWs) return;
      this.logger.log(`Tencent TTS ws opened: ${session.sessionId} (${synthesisId})`);
    });

    tencentWs.on('message', (data, isBinary) => {
      if (session.closed || session.tencentWs !== tencentWs) return;
      if (isBinary) {
        if (session.clientWs.readyState === WebSocket.OPEN) {
          session.clientWs.send(data, { binary: true });
        }
        return;
      }

      const raw = data.toString();
      let msg: Record<string, unknown> | undefined;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

      if (Number(msg.ready) === 1) {
        session.ready = true;
        this.flushPendingChunks(session);
      }

      if (Number(msg.code) && Number(msg.code) !== 0) {
        this.sendClientJson(session.clientWs, {
          type: 'tts_error',
          message: String(msg.message ?? 'Tencent TTS error'),
          code: Number(msg.code),
        });
        this.closeTencentWs(session, 'tencent error');
        return;
      }

      if (Number(msg.final) === 1) {
        this.sendClientJson(session.clientWs, { type: 'tts_final', turn: session.activeTurn });
        this.closeTencentWs(session, 'synthesis complete');
      }
    });

    tencentWs.on('error', (error) => {
      if (session.tencentWs !== tencentWs) return;
      this.sendClientJson(session.clientWs, {
        type: 'tts_error',
        message: `Tencent ws error: ${error.message}`,
      });
      this.closeTencentWs(session, 'tencent ws error');
    });

    tencentWs.on('close', () => {
      if (session.tencentWs !== tencentWs) return;
      session.tencentWs = undefined;
      session.tencentSynthesisId = undefined;
      session.ready = false;
    });
  }

  private hasActiveTencent(session: ClientSession): boolean {
    return !!session.tencentWs && session.tencentWs.readyState <= WebSocket.OPEN;
  }

  private closeTencentWs(session: ClientSession, reason: string): void {
    const ws = session.tencentWs;
    if (!ws) return;

    session.tencentWs = undefined;
    session.tencentSynthesisId = undefined;
    session.ready = false;

    ws.removeAllListeners();
    if (ws.readyState < WebSocket.CLOSING) {
      ws.close();
    }
    this.logger.log(`Tencent TTS closed: ${session.sessionId}, reason: ${reason}`);
  }

  private flushPendingChunks(session: ClientSession): void {
    if (!session.ready || !session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
      return;
    }
    while (session.pendingChunks.length > 0) {
      const chunk = session.pendingChunks.shift();
      if (!chunk) continue;
      this.sendTencentChunk(session, chunk);
    }
  }

  private sendTencentChunk(session: ClientSession, text: string): void {
    if (!session.tencentWs || session.tencentWs.readyState !== WebSocket.OPEN) {
      session.pendingChunks.push(text);
      return;
    }

    session.tencentWs.send(
      JSON.stringify({
        session_id: session.tencentSynthesisId,
        message_id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        action: 'ACTION_SYNTHESIS',
        data: text,
      }),
    );
  }

  private closeSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.closed = true;

    this.closeTencentWs(session, reason);
    if (session.clientWs.readyState < WebSocket.CLOSING) {
      this.sendClientJson(session.clientWs, { type: 'tts_closed', reason });
      session.clientWs.close();
    }
    this.sessions.delete(sessionId);
    this.logger.log(`TTS session closed: ${sessionId}, reason: ${reason}`);
  }

  private sendClientJson(clientWs: WebSocket, payload: Record<string, unknown>): void {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    clientWs.send(JSON.stringify(payload));
  }

  private buildTencentTtsWsUrl(synthesisId: string): string {
    const now = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      Action: 'TextToStreamAudioWSv2',
      AppId: this.appId,
      Codec: 'mp3',
      Expired: now + 3600,
      SampleRate: 16000,
      SecretId: this.secretId,
      SessionId: synthesisId,
      Speed: 0,
      Timestamp: now,
      VoiceType: this.voiceType,
      Volume: 5,
    };

    const signStr = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const rawStr = `GETtts.cloud.tencent.com/stream_wsv2?${signStr}`;
    const signature = createHmac('sha1', this.secretKey).update(rawStr).digest('base64');
    const searchParams = new URLSearchParams({
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
      Signature: signature,
    });

    return `wss://tts.cloud.tencent.com/stream_wsv2?${searchParams.toString()}`;
  }
}
