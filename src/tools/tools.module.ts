import { Module } from '@nestjs/common';

import { AsrClientService } from './asr-client.service';
import { LlmService } from './llm.service';
import { WebSearchService } from './web-search.service';

@Module({
  providers: [
    WebSearchService,
    {
      provide: 'WEB_SEARCH_TOOL',
      useFactory: (webSearchService: WebSearchService) => {
        return webSearchService.tool;
      },
      inject: [WebSearchService],
    },
    LlmService,
    {
      provide: 'LLM_TOOL',
      useFactory: (llmService: LlmService) => {
        return llmService.tool;
      },
      inject: [LlmService],
    },
    AsrClientService,
    {
      provide: 'ASR_CLIENT_TOOL',
      useFactory: (asrClientService: AsrClientService) => {
        return asrClientService;
      },
      inject: [AsrClientService],
    },
  ],
  exports: ['WEB_SEARCH_TOOL', 'LLM_TOOL', 'ASR_CLIENT_TOOL'],
})
export class ToolsModule {}
