export const AI_TTS_STREAM_EVENT = 'ai.tts.stream';

export type AiTtsStreamEvent =
  | { type: 'start'; sessionId: string; query: string; turn: number }
  | { type: 'chunk'; sessionId: string; chunk: string; turn: number }
  | { type: 'end'; sessionId: string; turn: number }
  | { type: 'error'; sessionId: string; error: string; turn?: number };
