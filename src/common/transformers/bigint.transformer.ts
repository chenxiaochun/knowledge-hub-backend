import { ValueTransformer } from 'typeorm';

/**
 * Postgres BIGINT ↔ JS string
 * 雪花 ID 超过 Number 安全整数范围，必须用字符串。
 */
export const bigintTransformer: ValueTransformer = {
  to: (v) => v,
  from: (v) => (v == null ? v : String(v)),
};
