import { Injectable } from '@nestjs/common';

export const RESET_CODE_TTL_MS = 10 * 60 * 1000;
export const RESET_CODE_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class PasswordResetService {
  private readonly store = new Map<string, { code: string; expireAt: number; setAt: number }>();

  private key(email: string) {
    return email.trim().toLowerCase();
  }

  async set(email: string, code: string): Promise<void> {
    const k = this.key(email);
    this.store.set(k, {
      code,
      expireAt: Date.now() + RESET_CODE_TTL_MS,
      setAt: Date.now(),
    });
  }

  async getTtlMs(email: string): Promise<number> {
    const row = this.store.get(this.key(email));
    if (!row) return -2;
    return Math.max(0, row.expireAt - Date.now());
  }

  /** 距上次发送不足冷却则返回剩余 ms，否则 0 */
  async cooldownLeftMs(email: string): Promise<number> {
    const row = this.store.get(this.key(email));
    if (!row) return 0;
    const left = RESET_CODE_COOLDOWN_MS - (Date.now() - row.setAt);
    return left > 0 ? left : 0;
  }

  async verify(email: string, code: string): Promise<boolean> {
    const row = this.store.get(this.key(email));
    if (!row || Date.now() > row.expireAt) return false;
    return row.code === code;
  }

  async delete(email: string): Promise<void> {
    this.store.delete(this.key(email));
  }
}
