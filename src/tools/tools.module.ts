import { Module } from '@nestjs/common';

import { MailerModule } from '@nestjs-modules/mailer';

import { AiCanvasModule } from '../ai-canvas/ai-canvas.module';
import { AsrClientService } from './asr-client.service';
import { CanvasImageService } from './canvas-image.service';
import { LlmService } from './llm.service';
import { MailService } from './mail.service';
import { WebSearchService } from './web-search.service';

@Module({
  imports: [MailerModule, AiCanvasModule],
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
    CanvasImageService,
    {
      provide: 'GENERATE_IMAGE_TOOL',
      useFactory: (canvasImage: CanvasImageService) => canvasImage.tool,
      inject: [CanvasImageService],
    },
  ],
  exports: [
    'WEB_SEARCH_TOOL',
    'LLM_TOOL',
    'MULTI_LLM_TOOL',
    'ASR_CLIENT_TOOL',
    'MAIL_TOOL',
    'GENERATE_IMAGE_TOOL',
  ],
})
export class ToolsModule {}
