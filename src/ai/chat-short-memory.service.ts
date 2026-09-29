import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  AIMessage,
  HumanMessage,
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
} from '@langchain/core/messages';

import { RedisService } from '../redis/redis.service';
import { isWorkingMessage } from './chat-memory.util';

@Injectable()
export class ChatShortMemoryService {
  private readonly logger = new Logger(ChatShortMemoryService.name);
  private readonly ttlSeconds: number;
  private readonly maxMessages: number;
  private readonly keyPrefix: string;

  constructor(
    config: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.ttlSeconds = Number(config.get('CHAT_SHORT_MEMORY_TTL_SECONDS', 86400));
    this.maxMessages = Number(config.get('CHAT_SHORT_MEMORY_MAX_MESSAGES', 20));
    this.keyPrefix = config.get('CHAT_SHORT_MEMORY_KEY_PREFIX', 'kh:chat');
  }

  get windowSize() {
    return this.maxMessages;
  }

  /** 命中返回消息；key 不存在或 Redis 故障返回 null */
  async tryLoad(userId: string, sessionId: string): Promise<BaseMessage[] | null> {
    try {
      const raw = await this.redisService.get(this.key(userId, sessionId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      return mapStoredMessagesToChatMessages(parsed).filter(isWorkingMessage);
    } catch (error) {
      this.logger.warn(
        `短期记忆 Redis 读取失败，改走数据库：${error instanceof Error ? error.message : error}`,
      );
      return null;
    }
  }

  /**
   * 保存消息,如果消息数超过最大消息数，则截取最后最大消息数的消息
   * @param userId - 用户 ID
   * @param sessionId - 会话 ID
   * @param messages - 消息
   */
  async save(userId: string, sessionId: string, messages: BaseMessage[]): Promise<void> {
    const working = messages.filter(isWorkingMessage).slice(-this.maxMessages);
    try {
      const payload = JSON.stringify(mapChatMessagesToStoredMessages(working));
      await this.redisService.set(this.key(userId, sessionId), payload, this.ttlSeconds);
    } catch (error) {
      this.logger.warn(
        `短期记忆 Redis 写入失败：${error instanceof Error ? error.message : error}`,
      );
    }
  }

  /**
   * 添加一轮对话
   * @param userId - 用户 ID
   * @param sessionId - 会话 ID
   * @param history - 历史消息
   * @param question - 问题
   * @param answer - 答案
   */
  async appendTurn(
    userId: string,
    sessionId: string,
    history: BaseMessage[],
    question: string,
    answer: string,
  ): Promise<void> {
    await this.save(userId, sessionId, [
      ...history,
      new HumanMessage(question),
      new AIMessage(answer),
    ]);
  }

  /**
   * 清除一轮对话
   * @param userId - 用户 ID
   * @param sessionId
   * @returns
   */
  async clear(userId: string, sessionId: string): Promise<void> {
    try {
      await this.redisService.del(this.key(userId, sessionId));
    } catch (error) {
      this.logger.warn(
        `短期记忆 Redis 删除失败：${error instanceof Error ? error.message : error}`,
      );
    }
  }

  private key(userId: string, sessionId: string) {
    return `${this.keyPrefix}:${userId}:${sessionId}:messages`;
  }
}
