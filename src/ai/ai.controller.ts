import type { Response } from 'express';
import type { AuthUser } from 'src/auth/auth-user.interface';

import { Controller, Post, Body, Param, Delete, Patch, Get, Query, Res } from '@nestjs/common';

import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { PermissionCode } from 'src/common/constant/permissions';

import { AiChatService } from './ai-chat.service';
import { AiStreamService } from './ai-stream.service';
import { ChatSessionService } from './chat-session.service';
import { ChatResponseDto } from './dto/chat-response.dto';
import { ChatStreamDto } from './dto/chat-stream.dto';
import { ChatDto } from './dto/chat.dto';
import { RagChunkHitDto } from './dto/rag-hit.dto';
import { RagSearchDto } from './dto/rag-search.dto';
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
    private readonly aiChatService: AiChatService,
    private readonly retrieval: HybridRetrievalService,
    private readonly sessions: ChatSessionService,
    private readonly aiStreamService: AiStreamService,
  ) {}

  @Post('rag/search')
  @RequirePermission(PermissionCode.search)
  search(@Body() dto: RagSearchDto): Promise<RagChunkHitDto[]> {
    return this.retrieval.retrieve(dto.query.trim(), dto.topK ?? 5);
  }

  @Post('chat')
  @RequirePermission(PermissionCode.search)
  chat(@Body() dto: ChatDto, @CurrentUser() user?: AuthUser): Promise<ChatResponseDto> {
    return this.aiChatService.chat(dto.content, dto.topK ?? 5, user, dto.sessionId);
  }

  @Get('sessions')
  @RequirePermission(PermissionCode.search)
  listSessions(
    @Query() query: QuerySessionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<SessionPageDto> {
    return this.sessions.pageMine(user.userId, query);
  }

  @Post('sessions')
  @RequirePermission(PermissionCode.search)
  createSession(
    @Body() dto: CreateSessionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AiSessionEntity> {
    return this.sessions.create(user.userId, dto);
  }

  // 静态段 messages 在 :id 之后没关系；注意不要用会吞掉 sessions 的路由
  @Get('sessions/:id/messages')
  @RequirePermission(PermissionCode.search)
  listMessages(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<AiMessageEntity[]> {
    return this.sessions.listMessages(user.userId, id);
  }

  @Patch('sessions/:id')
  @RequirePermission(PermissionCode.search)
  renameSession(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
    @CurrentUser() user: AuthUser,
  ): Promise<AiSessionEntity> {
    return this.sessions.rename(user.userId, id, dto);
  }

  @Delete('sessions/:id')
  @RequirePermission(PermissionCode.search)
  removeSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.remove(user.userId, id);
  }

  @Post('chat/stream')
  @RequirePermission(PermissionCode.search)
  streamChat(
    @Body() dto: ChatStreamDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response, // 注意：接管响应，不要再 return JSON
  ) {
    return this.aiStreamService.streamChat(dto, user, res);
  }
}
