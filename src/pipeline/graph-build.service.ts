import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import neo4j, { Driver } from 'neo4j-driver';
import { ChunkingService } from './chunking.service';
import { ExtractionService } from './extraction.service';

@Injectable()
export class GraphBuildService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphBuildService.name);
  private driver: Driver | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly chunking: ChunkingService,
    private readonly extraction: ExtractionService,
  ) {}

  async onModuleInit() {
    if (this.config.get('NEO4J_ENABLED', 'true') === 'false') return;
    const uri = this.config.get('NEO4J_URI', 'bolt://localhost:7687');
    this.driver = neo4j.driver(
      uri,
      neo4j.auth.basic(
        this.config.get('NEO4J_USER', 'neo4j'),
        this.config.get('NEO4J_PASSWORD', '12345678'),
      ),
    );
    try {
      await this.driver.verifyConnectivity();
      this.logger.log(`Neo4j 已连接：${uri}`);
    } catch (e) {
      this.logger.warn(`Neo4j 不可用：${e instanceof Error ? e.message : e}`);
      await this.driver.close();
      this.driver = null;
    }
  }

  async onModuleDestroy() {
    await this.driver?.close();
  }

  async deleteForDocument(documentId: string) {
    if (!this.driver) return;
    const session = this.driver.session();
    try {
      await session.run(
        `MATCH (d:KnowledgeDocument {id: $id})
         OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:DocumentChunk)
         OPTIONAL MATCH (c)-[:MENTIONS]->(e)
         DETACH DELETE d, c`,
        { id: documentId },
      );
    } finally {
      await session.close();
    }
  }

  async buildForDocument(doc: { id: string; title: string; content: string }) {
    if (!this.driver) return;
    await this.deleteForDocument(doc.id);
    const session = this.driver.session();
    try {
      await session.run(`MERGE (d:KnowledgeDocument {id: $id}) SET d.title = $title`, {
        id: doc.id,
        title: doc.title,
      });
      const chunks = this.chunking.chunk({
        content: doc.content,
        documentId: doc.id,
        documentTitle: doc.title,
      });
      for (const ch of chunks) {
        await session.run(
          `MATCH (d:KnowledgeDocument {id: $docId})
           MERGE (c:DocumentChunk {id: $cid})
           SET c.content = $content, c.idx = $idx
           MERGE (d)-[:HAS_CHUNK]->(c)`,
          {
            docId: doc.id,
            cid: ch.chunkId,
            content: ch.content.slice(0, 500),
            idx: ch.chunkIndex,
          },
        );
        const { entities, relations } = await this.extraction.extract(ch.content, null, doc.title);
        for (const e of entities) {
          await session.run(
            `MATCH (c:DocumentChunk {id: $cid})
             MERGE (en:KnowledgeEntity {name: $name})
             SET en.type = $type
             MERGE (c)-[:MENTIONS]->(en)`,
            { cid: ch.chunkId, name: e.name, type: e.type },
          );
        }
        for (const r of relations) {
          await session.run(
            `MATCH (a:KnowledgeEntity {name: $from})
             MATCH (b:KnowledgeEntity {name: $to})
             MERGE (a)-[rel:RELATED_TO]->(b)
             SET rel.type = $type`,
            { from: r.source, to: r.target, type: r.relation },
          );
        }
      }
      this.logger.log(`KG 构建完成：documentId=${doc.id}, chunks=${chunks.length}`);
    } finally {
      await session.close();
    }
  }

  async searchGraph(keyword: string, limit = 50) {
    if (!this.driver) return [];
    const session = this.driver.session();
    try {
      const res = await session.run(
        `MATCH (n)
         WHERE (n:KnowledgeEntity OR n:KnowledgeDocument)
           AND toLower(coalesce(n.name, n.title, '')) CONTAINS toLower($kw)
         RETURN labels(n) AS labels, properties(n) AS props
         LIMIT $limit`,
        { kw: keyword, limit: neo4j.int(limit) },
      );
      return res.records.map((r) => ({
        labels: r.get('labels'),
        props: r.get('props'),
      }));
    } finally {
      await session.close();
    }
  }
}
