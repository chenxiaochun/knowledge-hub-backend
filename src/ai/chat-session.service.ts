import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';

import { EntityManager } from 'typeorm';

import type { ChatSource } from './chat.types';

import { nextSnowflakeId } from '../common/snowflake-id';
import { CreateSessionDto, QuerySessionDto, UpdateSessionDto } from './dto/session.dto';
import { AiMessageEntity } from './entities/ai-message.entity';
import { AiSessionEntity } from './entities/ai-session.entity';

const DEFAULT_TITLE = '新对话';

@Injectable()
export class ChatSessionService {
  constructor(@InjectEntityManager() private readonly em: EntityManager) {}

  async pageMine(userId: string, query: QuerySessionDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [items, total] = await this.em.findAndCount(AiSessionEntity, {
      where: { userId },
      order: { updatedAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  async create(userId: string, dto: CreateSessionDto) {
    const title = dto.title?.trim() || DEFAULT_TITLE;
    const session = this.em.create(AiSessionEntity, {
      id: nextSnowflakeId(),
      userId,
      title: title.slice(0, 80),
    });
    return this.em.save(session);
  }

  async rename(userId: string, id: string, dto: UpdateSessionDto) {
    const session = await this.getOwned(userId, id);
    session.title = dto.title.trim().slice(0, 80);
    return this.em.save(session);
  }

  async remove(userId: string, id: string) {
    await this.getOwned(userId, id);
    // 即使库有 ON DELETE CASCADE，也显式删消息更清晰
    await this.em.delete(AiMessageEntity, { sessionId: id });
    await this.em.delete(AiSessionEntity, { id });
    return { message: '已删除' };
  }

  async listMessages(userId: string, sessionId: string) {
    await this.getOwned(userId, sessionId);
    return this.em.find(AiMessageEntity, {
      where: { sessionId },
      order: { createdAt: 'ASC', id: 'ASC' },
    });
  }

  /**
   * 问答落库：无 sessionId 则新建；标题仍为默认名时用首问覆盖。
   */
  async appendTurn(
    userId: string,
    sessionId: string | undefined,
    question: string,
    answer: string,
    sources: ChatSource[],
  ) {
    const session = sessionId
      ? await this.getOwned(userId, sessionId)
      : await this.create(userId, { title: titleFromQuestion(question) });

    if (session.title === DEFAULT_TITLE) {
      session.title = titleFromQuestion(question);
    }
    session.updatedAt = new Date();
    await this.em.save(session);

    const userMsg = this.em.create(AiMessageEntity, {
      id: nextSnowflakeId(),
      sessionId: session.id,
      role: 'user',
      content: question,
    });
    const assistantMsg = this.em.create(AiMessageEntity, {
      id: nextSnowflakeId(),
      sessionId: session.id,
      role: 'assistant',
      content: answer,
      sources: sources.length ? sources : null,
    });
    await this.em.save([userMsg, assistantMsg]);
    return session;
  }

  private async getOwned(userId: string, id: string) {
    const session = await this.em.findOne(AiSessionEntity, {
      where: { id, userId },
    });
    if (!session) {
      throw new NotFoundException('会话不存在');
    }
    return session;
  }
}

function titleFromQuestion(question: string) {
  const text = question.replace(/\s+/g, ' ').trim();
  if (!text) return DEFAULT_TITLE;
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}
