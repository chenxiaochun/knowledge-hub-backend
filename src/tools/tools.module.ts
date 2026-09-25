import { Module } from '@nestjs/common';

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
  ],
  exports: ['WEB_SEARCH_TOOL'],
})
export class ToolsModule {}
