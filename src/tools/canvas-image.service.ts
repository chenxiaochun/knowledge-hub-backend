import { Injectable, Logger } from '@nestjs/common';

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

import { AiCanvasService } from '../ai-canvas/ai-canvas.service';

@Injectable()
export class CanvasImageService {
  private readonly logger = new Logger(CanvasImageService.name);
  public readonly tool;

  constructor(private readonly aiCanvas: AiCanvasService) {
    this.tool = tool(async (input: GenerateImageInput) => this.generate(input), {
      name: 'generate_image',
      description:
        '根据文字描述生成图片（通义万相）。用户明确要求画图、配图、海报、示意图且知识库无法满足时使用。' +
        '可选 image_url：在已有公网图片上编辑；须为 DashScope 可访问的 HTTP URL（如 RustFS 公网链接）。' +
        '返回 JSON：url（永久存储链接）、mode、size。',
      schema: z.object({
        prompt: z.string().min(1).describe('画面描述'),
        image_url: z.string().optional().describe('参考图/待编辑图公网 URL'),
        size: z.string().optional().describe('文生图如 1280*1280，图生图如 1K'),
      }),
    });
  }

  private async generate(input: GenerateImageInput): Promise<string> {
    this.logger.log(`generate_image 被调用：prompt=${input.prompt.slice(0, 80)}`);
    try {
      const result = await this.aiCanvas.createImage({
        prompt: input.prompt,
        imageUrl: input.image_url,
        size: input.size,
      });
      return JSON.stringify({
        url: result.url,
        mode: result.mode,
        size: result.size,
        prompt: result.prompt,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.logger.warn(`generate_image 失败：${detail}`);
      return JSON.stringify({ error: detail });
    }
  }
}

type GenerateImageInput = {
  prompt: string;
  image_url?: string;
  size?: string;
};
