import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  readonly dimension: number | undefined = undefined;
  private readonly mode: string | undefined = undefined;
  private readonly apiKey?: string | undefined = undefined;
  private readonly baseUrl: string | undefined = undefined;
  private readonly model: string | undefined = undefined;

  constructor(config: ConfigService) {
    this.mode = config.get('EMBEDDING_MODE', 'mock');
    this.dimension = Number(config.get('EMBEDDING_DIMENSION', 64));
    this.apiKey = config.get('OPENAI_API_KEY') || undefined;
    this.baseUrl = config.get('OPENAI_BASE_URL');
    this.model = config.get('EMBEDDINGS_MODEL_NAME', 'text-embedding-v3');
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: { embedding: number[]; index: number }[];
    };
    // API 返回的 data 可能乱序；用 index 对齐到入参 texts 的顺序，再只取出向量
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}
