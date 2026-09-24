import type { AuthUser } from 'src/auth/auth-user.interface';

import { Controller, Post, Body, Param, Delete, Patch, Get } from '@nestjs/common';

import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { RequirePermission } from 'src/auth/decorators/require-permission.decorator';
import { PermissionCode } from 'src/common/constant/permissions';

import { AiChatService } from './ai-chat.service';
import { ChatSessionService } from './chat-session.service';
import { ChatDto } from './dto/chat.dto';
import { RagSearchDto } from './dto/rag-search.dto';
import { CreateSessionDto } from './dto/session.dto';
import { UpdateSessionDto } from './dto/session.dto';
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
  search(@Body() dto: RagSearchDto) {
    return this.retrieval.retrieve(dto.query.trim(), dto.topK ?? 5);
  }

  @Post('ai/chat')
  @RequirePermission(PermissionCode.search)
  chat(@Body() dto: ChatDto, @CurrentUser() user?: AuthUser) {
    return this.aiChat.chat(dto.content, dto.topK ?? 5, user, dto.sessionId);
  }

  @Post('ai/sessions')
  @RequirePermission(PermissionCode.search)
  createSession(@Body() dto: CreateSessionDto, @CurrentUser() user: AuthUser) {
    return this.sessions.create(user.userId, dto);
  }

  // 静态段 messages 在 :id 之后没关系；注意不要用会吞掉 sessions 的路由
  @Get('ai/sessions/:id/messages')
  @RequirePermission(PermissionCode.search)
  listMessages(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.listMessages(user.userId, id);
  }

  @Patch('ai/sessions/:id')
  @RequirePermission(PermissionCode.search)
  renameSession(
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sessions.rename(user.userId, id, dto);
  }

  @Delete('ai/sessions/:id')
  @RequirePermission(PermissionCode.search)
  removeSession(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.sessions.remove(user.userId, id);
  }
}
