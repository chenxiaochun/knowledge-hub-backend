import type { UIMessageChunk } from 'ai';

import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AI_TTS_STREAM_EVENT, type AiTtsStreamEvent } from './stream-events';

/**
 * 统一发布 AI → TTS 的流式事件，避免 Ai / AiCorn / Agui 各自重复 emit。
 * TtsRelayService 通过 @OnEvent(AI_TTS_STREAM_EVENT) 消费。
 */
@Injectable()
export class TtsStreamPublisher {
  /** 每个会话的 TTS 轮次，用于丢弃旧流残留 chunk/end */
  private readonly turnBySession = new Map<string, number>();

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * 透传 UIMessage 流，并把 text-delta 同步发给 TTS。
   */
  pipeUiMessageStream<T extends UIMessageChunk>(
    stream: ReadableStream<T>,
    sessionId: string,
    query: string,
  ): ReadableStream<T> {
    const turn = this.nextTurn(sessionId);
    this.emit({ type: 'start', sessionId, query, turn });

    return stream.pipeThrough(
      new TransformStream<T, T>({
        transform: (chunk, controller) => {
          controller.enqueue(chunk);
          if (chunk.type === 'text-delta' && chunk.delta) {
            this.emit({ type: 'chunk', sessionId, chunk: chunk.delta, turn });
          }
        },
        flush: () => {
          this.emit({ type: 'end', sessionId, turn });
        },
      }),
    );
  }

  error(sessionId: string, error: unknown, turn?: number): void {
    this.emit({
      type: 'error',
      sessionId,
      turn,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private nextTurn(sessionId: string): number {
    const turn = (this.turnBySession.get(sessionId) ?? 0) + 1;
    this.turnBySession.set(sessionId, turn);
    return turn;
  }

  private emit(event: AiTtsStreamEvent): void {
    this.eventEmitter.emit(AI_TTS_STREAM_EVENT, event);
  }
}
