import { Module } from '@nestjs/common';

import { MailerModule } from '@nestjs-modules/mailer';

import { AsrClientService } from './asr-client.service';
import { LlmService } from './llm.service';
import { MailService } from './mail.service';
import { WebSearchService } from './web-search.service';

@Module({
  imports: [MailerModule],
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
    {
      provide: 'MULTI_LLM_TOOL',
      useFactory: (llmService: LlmService) => llmService.multiModalTool,
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
    MailService,
    {
      provide: 'MAIL_TOOL',
      useFactory: (mailService: MailService) => {
        return mailService;
      },
      inject: [MailService],
    },
  ],
  exports: ['WEB_SEARCH_TOOL', 'LLM_TOOL', 'MULTI_LLM_TOOL', 'ASR_CLIENT_TOOL', 'MAIL_TOOL'],
})
export class ToolsModule {}
