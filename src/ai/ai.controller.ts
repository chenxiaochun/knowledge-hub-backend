import { Controller, Post, Body } from '@nestjs/common';

import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { PermissionCode } from 'src/common/constant/permissions';

import { AiChatService } from './ai-chat.service';
import { ChatDto } from './dto/chat.dto';
import { RagSearchDto } from './dto/rag-search.dto';
import { HybridRetrievalService } from './hybrid-retrieval.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiChat: AiChatService,
    private readonly retrieval: HybridRetrievalService,
  ) {}

  @Post('rag/search')
  @RequirePermission(PermissionCode.search)
  search(@Body() dto: RagSearchDto) {
    return this.retrieval.retrieve(dto.query.trim(), dto.topK ?? 5);
  }

  @Post('ai/chat')
  @RequirePermission(PermissionCode.search)
  chat(@Body() dto: ChatDto) {
    return this.aiChat.chat(dto.content, dto.topK ?? 5);
  }
}
