import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Configuration, GenerationResult, MultiModalConversation } from 'dashscope-sdk-official';

import { RustfsService } from '../storage/rustfs.service';
import { CreateImageDto } from './dto/create-ai-canva.dto';

interface WanImageOptions {
  size?: string;
  promptExtend: boolean;
  watermark: boolean;
}

interface MultiModalConversationInternal {
  syncRequest(data: Record<string, unknown>): Promise<GenerationResult>;
}

@Injectable()
export class AiCanvasService {
  private readonly logger = new Logger(AiCanvasService.name);
  private readonly client: MultiModalConversation;

  constructor(
    private readonly config: ConfigService,
    private readonly rustfs: RustfsService,
  ) {
    this.client = new MultiModalConversation(
      new Configuration({
        apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      }),
    );
  }

  async createImage(
    dto: CreateImageDto,
  ): Promise<{
    url: string;
    prompt: string;
    inputImageUrl: string | undefined;
    mode: string;
    size: string;
  }> {
    const options: WanImageOptions = {
      size: dto.size,
      promptExtend: dto.promptExtend ?? true,
      watermark: dto.watermark ?? false,
    };
    const inputImageUrl = dto.imageUrl;
    const resultUrl = inputImageUrl
      ? await this.generateByEdit(
          [{ text: dto.prompt }, { image: this.rustfs.resolveReadableUrl(inputImageUrl) }],
          options,
        )
      : await this.generateByText([{ text: dto.prompt }], options);

    const url = await this.rustfs.uploadFromUrl(resultUrl, { prefix: 'ai-canvas' });

    return {
      prompt: dto.prompt,
      url,
      inputImageUrl,
      mode: inputImageUrl ? 'edit' : 'text',
      size: options.size ?? (inputImageUrl ? '1K' : '1280*1280'),
    };
  }

  private async generateByEdit(
    content: Array<{ text?: string; image?: string }>,
    options: WanImageOptions,
  ): Promise<string> {
    const raw = await this.wanCall({
      model: 'wan2.6-image',
      messages: [{ role: 'user', content }],
      prompt_extend: options.promptExtend,
      watermark: options.watermark,
      n: 1,
      enable_interleave: false,
      size: options.size ?? '1K',
    });

    const result = raw as GenerationResult;
    this.assertSuccess(result);

    const resultUrl = this.extractImageUrl(result);
    if (!resultUrl) {
      throw new BadRequestException(
        `No image URL in DashScope response: ${JSON.stringify(result)}`,
      );
    }

    return resultUrl;
  }

  private async generateByText(
    content: Array<{ text?: string; image?: string }>,
    options: WanImageOptions,
  ): Promise<string> {
    const startedAt = Date.now();
    this.logger.log('text-to-image started (wan2.6-t2i sync)');

    const raw = await this.wanCall({
      model: 'wan2.6-t2i',
      messages: [{ role: 'user', content }],
      prompt_extend: options.promptExtend,
      watermark: options.watermark,
      n: 1,
      size: options.size ?? '1280*1280',
    });

    const result = raw as GenerationResult;
    this.assertSuccess(result);

    const resultUrl = this.extractImageUrl(result);
    if (!resultUrl) {
      throw new BadRequestException(
        `No image URL in DashScope response: ${JSON.stringify(result)}`,
      );
    }

    this.logger.log(`text-to-image finished in ${Date.now() - startedAt}ms`);

    return resultUrl;
  }

  private extractImageUrl(result: GenerationResult): string | undefined {
    const content = result.output?.choices?.[0]?.message?.content;
    if (!Array.isArray(content)) {
      return undefined;
    }

    for (const item of content) {
      if (item.image) {
        return item.image;
      }
    }

    return undefined;
  }

  private assertSuccess(result: GenerationResult): void {
    if (result.status_code !== 200 || result.code) {
      throw new BadRequestException(
        result.message ?? `DashScope request failed: ${result.status_code}`,
      );
    }
  }

  private wanCall(options: {
    model: string;
    messages: Array<{
      role: 'user' | 'assistant' | 'system';
      content: Array<{ text?: string; image?: string }>;
    }>;
    [key: string]: unknown;
  }): Promise<GenerationResult> {
    const { model, messages, ...rest } = options;
    return (this.client as unknown as MultiModalConversationInternal).syncRequest({
      model,
      input: { messages },
      parameters: { ...rest, stream: false },
    });
  }
}
