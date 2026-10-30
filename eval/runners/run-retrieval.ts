/**
 * L2 检索 Hit@k：调用 HybridRetrievalService.retrieve，
 * 检查 top-k 拼接文本是否覆盖 must_retrieve_keywords。
 * 需要 Elasticsearch + 已索引语料；依赖 Nest ApplicationContext。
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

import { AppModule } from '../../src/app.module';
import { HybridRetrievalService } from '../../src/ai/hybrid-retrieval.service';
import {
  hitAtK,
  summarizeRetrievalResults,
  type RetrievalCaseResult,
} from '../lib/metrics';

config({ path: resolve(process.cwd(), '.env') });

type RetrievalLine = {
  id: string;
  question: string;
  query?: string;
  must_retrieve_keywords: string[];
  topK?: number;
  skip?: boolean;
  /** 默认 true；负例可标 false，期望检索不命中这些词 */
  expectHit?: boolean;
};

async function main() {
  const lines = readFileSync('eval/datasets/retrieval-v1.jsonl', 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RetrievalLine);

  let app: INestApplicationContext;
  try {
    app = await NestFactory.createApplicationContext(AppModule, {
      logger: ['error', 'warn'],
    });
  } catch (err) {
    console.error(
      '[eval:retrieval] Nest ApplicationContext 启动失败（需 ES/Postgres 等）：',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  }

  const retrieval = app.get(HybridRetrievalService);
  const rows: RetrievalCaseResult[] = [];

  try {
    for (const item of lines) {
      if (item.skip) continue;
      const topK = item.topK ?? 5;
      const q = (item.query ?? item.question).trim();
      const keywords = item.must_retrieve_keywords ?? [];
      const expectHit = item.expectHit !== false;

      let hits;
      try {
        hits = await retrieval.retrieve(q, topK);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`${item.id}\tERROR\t${msg}`);
        rows.push({
          id: item.id,
          hit: false,
          keywords,
          missing: keywords,
          hitCount: 0,
          topK,
        });
        continue;
      }

      const blob = hits
        .map((h) => `${h.documentTitle}\n${h.content}`)
        .join('\n');
      const covered = hitAtK(blob, keywords);
      const missing = keywords.filter(
        (kw) => !blob.toLowerCase().includes(kw.trim().toLowerCase()),
      );
      // expectHit=true → 需要 covered；expectHit=false → 需要 !covered（负例）
      const ok = expectHit ? covered : !covered;

      rows.push({
        id: item.id,
        hit: ok,
        keywords,
        missing: expectHit ? missing : covered ? keywords : [],
        hitCount: hits.length,
        topK,
      });
      console.log(
        `${item.id}\texpectHit=${expectHit}\tcovered=${covered}\thits=${hits.length}\t${
          ok ? 'OK' : 'FAIL'
        }${missing.length && expectHit ? `\tmissing=${missing.join(',')}` : ''}`,
      );
    }
  } finally {
    await app.close();
  }

  const summary = summarizeRetrievalResults(rows);
  mkdirSync('eval/reports', { recursive: true });
  const out = `eval/reports/retrieval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(
    out,
    JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }, null, 2),
  );
  console.log(`\nhitAtK=${(summary.hitAtK * 100).toFixed(1)}% (${summary.total} cases)`);
  console.log(`report: ${out}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
