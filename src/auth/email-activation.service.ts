import { Injectable } from '@nestjs/common';

import { randomBytes } from 'crypto';

const TTL_MS = 24 * 3600 * 1000;

@Injectable()
export class EmailActivationService {
  /**
   * 按令牌索引
   */
  private readonly byToken = new Map<
    string,
    {
      userId: string;
      expireAt: number;
    }
  >();

  private readonly byUser = new Map<string, string>();

  /**
   * 创建激活令牌
   * @param userId 用户ID
   * @returns 激活令牌
   */
  async createToken(userId: string): Promise<string> {
    const old = this.byUser.get(userId);
    if (old) {
      this.byToken.delete(old);
      this.byUser.delete(userId);
    }
    const token = randomBytes(32).toString('hex');
    const expireAt = Date.now() + TTL_MS;
    this.byToken.set(token, { userId, expireAt });
    this.byUser.set(userId, token);
    return token;
  }

  /**
   * 消费激活令牌
   * @param token 激活令牌
   * @returns 用户ID
   */
  async consumeToken(token: string): Promise<string | null> {
    const row = this.byToken.get(token);
    if (!row) return null;
    this.byToken.delete(token);
    this.byUser.delete(row.userId);
    if (Date.now() > row.expireAt) return null;
    return row.userId;
  }

  /**
   * 删除激活令牌
   * @param token 激活令牌
   */
  async deleteByToken(token: string): Promise<void> {
    const row = this.byToken.get(token);
    this.byToken.delete(token);
    if (row) this.byUser.delete(row.userId);
  }
}
