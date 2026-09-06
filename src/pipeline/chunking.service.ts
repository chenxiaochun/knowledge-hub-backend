import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface DocumentChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  chunkIndex: number;
}

@Injectable()
export class ChunkingService {
  private readonly chunkSize: number | undefined = undefined;
  private readonly overlap: number | undefined = undefined;

  constructor(private readonly configService: ConfigService) {
    this.chunkSize = this.configService.get('RAG_CHUNK_CHARS') || 800;
    this.overlap = this.configService.get('RAG_CHUNK_OVERLAP_CHARS') || 100;
  }

  chunk(params: { content: string; documentId: string; documentTitle: string }): DocumentChunk[] {
    const text = (params.content || '').trim();
    if (!text) return [];
    const parts: DocumentChunk[] = [];
    let start = 0;
    let idx = 0;
    while (start < text.length) {
      const end = Math.min(start + this.chunkSize!, text.length);
      const content = text.slice(start, end);
      const chunkId = createHash('sha1')
        .update(`${params.documentId}:${idx}:${content}`)
        .digest('hex')
        .slice(0, 16);
      parts.push({
        chunkId,
        documentId: params.documentId,
        documentTitle: params.documentTitle,
        content,
        chunkIndex: idx,
      });
      if (end >= text.length) break;
      start = Math.max(end - this.overlap!, start + 1);
      idx += 1;
    }
    return parts;
  }
}
