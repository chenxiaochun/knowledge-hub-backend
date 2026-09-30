import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ChatOpenAI } from '@langchain/openai';

@Injectable()
export class LlmService {
  public readonly tool: ChatOpenAI;
  /** 视觉 / 多模态（如 qwen-vl-plus），供图片解析等 */
  public readonly multiModalTool: ChatOpenAI;

  constructor(private readonly configService: ConfigService) {
    const baseUrl = this.configService.get<string>('OPENAI_BASE_URL');
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ||
      this.configService.get<string>('DASHSCOPE_API_KEY');
    const modelName = this.configService.get<string>('MODEL_NAME');
    this.tool = new ChatOpenAI({
      apiKey,
      model: modelName,
      timeout: 45_000,
      maxRetries: 1,
      configuration: {
        baseURL: baseUrl,
      },
      // 开启 thinking 时，部分百炼模型会倾向「口头说去搜」而不发 tool_calls
      // 需要边想边调工具时再开；流式思考可在 ai-stream 侧单独处理
      modelKwargs: { enable_thinking: false },
    });

    const multiModel = this.configService.get<string>('MULTI_MODEL_NAME', 'qwen-vl-plus');
    const imageTimeout = Number(this.configService.get('IMAGE_PARSE_TIMEOUT_MS', 120_000));
    this.multiModalTool = new ChatOpenAI({
      apiKey,
      model: multiModel,
      temperature: 0.1,
      timeout: imageTimeout,
      maxRetries: 1,
      configuration: { baseURL: baseUrl },
      modelKwargs: { enable_thinking: false },
    });
  }
}
