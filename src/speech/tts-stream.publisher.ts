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
  constructor(private readonly eventEmitter: EventEmitter2) {}

  start(sessionId: string, query: string): void {
    this.emit({ type: 'start', sessionId, query });
  }

  chunk(sessionId: string, chunk: string): void {
    if (!chunk) return;
    this.emit({ type: 'chunk', sessionId, chunk });
  }

  end(sessionId: string): void {
    this.emit({ type: 'end', sessionId });
  }

  error(sessionId: string, error: unknown): void {
    this.emit({
      type: 'error',
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * 透传 UIMessage 流，并把 text-delta 同步发给 TTS。
   */
  pipeUiMessageStream<T extends UIMessageChunk>(
    stream: ReadableStream<T>,
    sessionId: string,
    query: string,
  ): ReadableStream<T> {
    this.start(sessionId, query);

    return stream.pipeThrough(
      new TransformStream<T, T>({
        transform: (chunk, controller) => {
          controller.enqueue(chunk);
          if (chunk.type === 'text-delta' && chunk.delta) {
            this.chunk(sessionId, chunk.delta);
          }
        },
        flush: () => {
          this.end(sessionId);
        },
      }),
    );
  }

  private emit(event: AiTtsStreamEvent): void {
    this.eventEmitter.emit(AI_TTS_STREAM_EVENT, event);
  }
}
