import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ChatOpenAI } from '@langchain/openai';

@Injectable()
export class LlmService {
  public readonly tool: ChatOpenAI;

  constructor(private readonly configService: ConfigService) {
    const modelName = this.configService.get<string>('MODEL_NAME');
    const baseUrl = this.configService.get<string>('OPENAI_BASE_URL');
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');
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
  }
}
