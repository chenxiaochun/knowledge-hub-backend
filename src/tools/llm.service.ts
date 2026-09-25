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
      modelKwargs: { enable_thinking: true },
    });
  }
}
