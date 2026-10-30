/**
 * L2 检索评测：
 * - 关键词 Hit@k
 * - 文档级 Hit@k（must_doc_ids / must_title_contains）
 * - gradeHits 切题率（与线上一致）
 * 需要 Elasticsearch + 已索引语料；Nest ApplicationContext。
 */
import 'reflect-metadata';
import { config } from 'dotenv';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

import { AppModule } from '../../src/app.module';
import { ChatQueryRewriteService } from '../../src/ai/chat-query-rewrite.service';
import { HybridRetrievalService } from '../../src/ai/hybrid-retrieval.service';
import {
  docHitAtK,
  hitAtK,
  summarizeRetrievalResults,
  titleHitAtK,
  type RetrievalCaseResult,
} from '../lib/metrics';

config({ path: resolve(process.cwd(), '.env') });

type RetrievalLine = {
  id: string;
  question: string;
  query?: string;
  must_retrieve_keywords?: string[];
  must_doc_ids?: string[];
  must_title_contains?: string[];
  topK?: number;
  skip?: boolean;
  /** @deprecated 使用 expectKeywordHit */
  expectHit?: boolean;
  expectKeywordHit?: boolean;
  expectDocHit?: boolean;
  expectTitleHit?: boolean;
  expectGradeOk?: boolean;
  /** 默认 true；负例可关 */
  runGrade?: boolean;
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
  const rewrite = app.get(ChatQueryRewriteService);
  const rows: RetrievalCaseResult[] = [];

  try {
    for (const item of lines) {
      if (item.skip) continue;
      const topK = item.topK ?? 5;
      const q = (item.query ?? item.question).trim();
      const keywords = item.must_retrieve_keywords ?? [];
      const mustDocIds = item.must_doc_ids ?? [];
      const mustTitles = item.must_title_contains ?? [];
      const expectKeywordHit = item.expectKeywordHit ?? item.expectHit ?? true;
      const expectDocHit = item.expectDocHit ?? true;
      const expectTitleHit = item.expectTitleHit ?? true;
      const expectGradeOk = item.expectGradeOk ?? true;
      const runGrade = item.runGrade !== false;

      let hits;
      try {
        hits = await retrieval.retrieve(q, topK);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`${item.id}\tERROR\t${msg}`);
        rows.push({
          id: item.id,
          ok: false,
          keywordOk: keywords.length ? false : null,
          docOk: mustDocIds.length ? false : null,
          titleOk: mustTitles.length ? false : null,
          gradeOk: runGrade ? false : null,
          keywords,
          missingKeywords: keywords,
          mustDocIds,
          hitDocIds: [],
          hitCount: 0,
          topK,
        });
        continue;
      }

      const blob = hits.map((h) => `${h.documentTitle}\n${h.content}`).join('\n');
      const hitDocIds = hits.map((h) => String(h.documentId));
      const titles = hits.map((h) => h.documentTitle ?? '');

      let keywordOk: boolean | null = null;
      let missingKeywords: string[] = [];
      if (keywords.length) {
        const covered = hitAtK(blob, keywords);
        missingKeywords = keywords.filter(
          (kw) => !blob.toLowerCase().includes(kw.trim().toLowerCase()),
        );
        keywordOk = expectKeywordHit ? covered : !covered;
      }

      let docOk: boolean | null = null;
      if (mustDocIds.length) {
        const covered = docHitAtK(hitDocIds, mustDocIds);
        docOk = expectDocHit ? covered : !covered;
      }

      let titleOk: boolean | null = null;
      if (mustTitles.length) {
        const covered = titleHitAtK(titles, mustTitles);
        titleOk = expectTitleHit ? covered : !covered;
      }

      let gradeOk: boolean | null = null;
      let gradeReason: string | undefined;
      if (runGrade) {
        const grade = await rewrite.gradeHits(item.question, hits);
        gradeOk = grade.ok === expectGradeOk;
        gradeReason = `${grade.reason}:${grade.text}`;
      }

      const checks = [keywordOk, docOk, titleOk, gradeOk].filter((v) => v !== null);
      const ok = checks.length === 0 ? true : checks.every(Boolean);

      rows.push({
        id: item.id,
        ok,
        keywordOk,
        docOk,
        titleOk,
        gradeOk,
        gradeReason,
        keywords,
        missingKeywords: expectKeywordHit ? missingKeywords : [],
        mustDocIds,
        hitDocIds,
        hitCount: hits.length,
        topK,
      });

      const flags = [
        keywordOk === null ? null : `kw=${keywordOk}`,
        docOk === null ? null : `doc=${docOk}`,
        titleOk === null ? null : `title=${titleOk}`,
        gradeOk === null ? null : `grade=${gradeOk}`,
      ]
        .filter(Boolean)
        .join(' ');
      console.log(
        `${item.id}\thits=${hits.length}\t${flags}\t${ok ? 'OK' : 'FAIL'}${
          gradeReason ? `\t${gradeReason}` : ''
        }`,
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
  const pct = (n: number | null) => (n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`);
  console.log(
    `\noverall=${pct(summary.overallAccuracy)} ` +
      `keywordHit@k=${pct(summary.keywordHitAtK)} ` +
      `docHit@k=${pct(summary.docHitAtK)} ` +
      `titleHit@k=${pct(summary.titleHitAtK)} ` +
      `gradeAccuracy=${pct(summary.gradeAccuracy)} ` +
      `(${summary.total} cases)`,
  );
  console.log(`report: ${out}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
