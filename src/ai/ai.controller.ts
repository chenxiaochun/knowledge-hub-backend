import type { AuthUser } from 'src/auth/auth-user.interface';

import { Controller, Post, Body, Param, Delete, Patch, Get, Query } from '@nestjs/common';

import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { PermissionCode } from 'src/common/constant/permissions';

import { AiChatService } from './ai-chat.service';
import { ChatSessionService } from './chat-session.service';
import { ChatDto } from './dto/chat.dto';
import { ChatResponseDto } from './dto/chat-response.dto';
import { RagSearchDto } from './dto/rag-search.dto';
import { RagChunkHitDto } from './dto/rag-hit.dto';
import {
  CreateSessionDto,
  QuerySessionDto,
  SessionPageDto,
  UpdateSessionDto,
} from './dto/session.dto';
import { AiMessageEntity } from './entities/ai-message.entity';
import { AiSessionEntity } from './entities/ai-session.entity';
import { HybridRetrievalService } from './hybrid-retrieval.service';

@Controller('ai')
export class AiController {
  constructor(
    private readonly aiChat: AiChatService,
    private readonly retrieval: HybridRetrievalService,
    private readonly sessions: ChatSessionService,
  ) {}

  @Post('rag/search')
  @RequirePermission(PermissionCode.search)
  search(@Body() dto: RagSearchDto): Promise<RagChunkHitDto[]> {
    return this.retrieval.retrieve(dto.query.trim(), dto.topK ?? 5);
  }

  @Post('ai/chat')
  @RequirePermission(PermissionCode.search)
  chat(@Body() dto: ChatDto, @CurrentUser() user?: AuthUser): Promise<ChatResponseDto> {
    return this.aiChat.chat(dto.content, dto.topK ?? 5, user, dto.sessionId);
  }

  @Get('ai/sessions')
  @RequirePermission(PermissionCode.search)
  listSessions(
    @Query() query: QuerySessionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SessionPageDto> {
    return this.sessions.pageMine(user.userId, query);
  }

  @Post('ai/sessions')
  @RequirePermission(PermissionCode.search)
  createSession(
    @Body() dto: CreateSessionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AiSessionEntity> {
    return this.sessions.create(user.userId, dto);
  }

  // 静态段 messages 在 :id 之后没关系；注意不要用会吞掉 sessions 的路由
  @Get('ai/sessions/:id/messages')
  @RequirePermission(PermissionCode.search)
  listMessages(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AiMessageEntity[]> {
    return this.sessions.listMessages(user.userId, id);
  }

  @Patch('ai/sessions/:id')
  @RequirePermission(PermissionCode.search)
  renameSession(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AiSessionEntity> {
    return this.sessions.rename(user.userId, id, dto);
  }

  @Delete('ai/sessions/:id')
  @RequirePermission(PermissionCode.search)
  removeSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.remove(user.userId, id);
  }
}
