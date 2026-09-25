import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PipelineModule } from 'src/pipeline/pipeline.module';
import { ToolsModule } from 'src/tools/tools.module';

import { AiChatService } from './ai-chat.service';
import { AiStreamService } from './ai-stream.service';
import { AiController } from './ai.controller';
import { ChatSessionService } from './chat-session.service';
import { AiMessageEntity } from './entities/ai-message.entity';
import { AiSessionEntity } from './entities/ai-session.entity';
import { HybridRetrievalService } from './hybrid-retrieval.service';
import { RerankerService } from './reranker.service';

@Module({
  imports: [
    PipelineModule,
    TypeOrmModule.forFeature([AiSessionEntity, AiMessageEntity]),
    ToolsModule,
  ],
  controllers: [AiController],
  providers: [
    AiChatService,
    HybridRetrievalService,
    RerankerService,
    ChatSessionService,
    AiStreamService,
  ],
})
export class AiModule {}
