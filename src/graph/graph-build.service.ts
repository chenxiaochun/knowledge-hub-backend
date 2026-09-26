import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { InjectRepository } from '@nestjs/typeorm';

import { Model } from 'mongoose';
import neo4j, { Driver } from 'neo4j-driver';
import { In, Repository } from 'typeorm';

import type { GraphNodeHitDto } from './dto/graph-node-hit.dto';
import type {
  GraphSubgraphEdgeDto,
  GraphSubgraphNodeDto,
  GraphSubgraphResultDto,
} from './dto/graph-sub-search.dto';

import { DocumentStatus } from '../document/document-status';
import { DocumentEntity } from '../document/entities/document.entity';
import {
  DocumentContent,
  DocumentContentDocument,
} from '../document/schemas/document-content.schema';
import { ChunkingService } from '../pipeline/chunking.service';
import { ExtractionService } from './extraction.service';

@Injectable()
export class GraphBuildService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GraphBuildService.name);
  private driver: Driver | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly chunking: ChunkingService,
    private readonly extraction: ExtractionService,

    @InjectRepository(DocumentEntity)
    private readonly docRepo: Repository<DocumentEntity>,

    @InjectModel(DocumentContent.name)
    private readonly contentModel: Model<DocumentContentDocument>,
  ) {}

  async onModuleInit() {
    if (this.config.get('NEO4J_ENABLED', 'true') === 'false') return;
    const uri = this.config.get('NEO4J_URI');
    this.driver = neo4j.driver(
      uri,
      neo4j.auth.basic(this.config.get('NEO4J_USER')!, this.config.get('NEO4J_PASSWORD')!),
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

  /** 供 MQ Consumer：按文档 ID 读库后构建图谱 */
  async buildByDocIds(documentIds: string[]) {
    for (const id of documentIds) {
      try {
        await this.buildByDocId(id);
      } catch (error) {
        this.logger.error(`KG 构建失败 documentId=${id}: ${error}`);
      }
    }
  }

  async deleteByDocIds(documentIds: string[]) {
    for (const id of documentIds) {
      try {
        await this.deleteForDocument(id);
      } catch (error) {
        this.logger.error(`KG 删除失败 documentId=${id}: ${error}`);
      }
    }
  }

  async buildByDocId(documentId: string) {
    const doc = await this.docRepo.findOne({ where: { id: documentId, deleted: false } });
    if (!doc) {
      this.logger.warn(`文档不存在，跳过 KG：documentId=${documentId}`);
      return;
    }
    const contentDoc = await this.contentModel.findOne({ documentId, deleted: false }).lean();
    const content = contentDoc?.content?.trim() ?? '';
    if (!content) {
      this.logger.warn(`正文为空，跳过 KG：documentId=${documentId}`);
      return;
    }
    await this.buildForDocument({
      id: doc.id,
      title: doc.title,
      content,
      summary: contentDoc?.contentSummary?.trim() || content.slice(0, 200),
      categoryId: '',
      tags: doc.tags ?? '',
      authorId: doc.authorId ?? '',
      status: doc.status,
    });
  }

  async deleteForDocument(documentId: string) {
    if (!this.driver) return;
    const session = this.driver.session();
    try {
      // ① 删文档 + 下属 chunk（DETACH 拆掉相连边）
      await session.run(
        `MATCH (d:KnowledgeDocument {id: $id})
         OPTIONAL MATCH (d)-[:HAS_CHUNK]->(c:DocumentChunk)
        DETACH DELETE c, d`,
        { id: documentId },
      );
      // ② 孤儿实体：没有任何 chunk MENTIONS 它
      await session.run(
        `MATCH (e:KnowledgeEntity)
         WHERE NOT (e)<-[:MENTIONS]-()
         DETACH DELETE e`,
      );
      this.logger.log(`KG 图谱已删除：documentId=${documentId}`);
    } finally {
      await session.close();
    }
  }

  async buildForDocument(doc: {
    id: string;
    title: string;
    content: string;
    summary: string;
    categoryId: string;
    tags: string;
    authorId: string;
    status: DocumentStatus;
  }) {
    if (!this.driver) {
      this.logger.warn(`Neo4j 未连接，跳过 KG 构建：documentId=${doc.id}`);
      return;
    }
    await this.deleteForDocument(doc.id);
    const session = this.driver.session();
    try {
      const now = new Date().toISOString();
      await session.run(
        `MERGE (d:KnowledgeDocument {id: $id}) SET d.title = $title, d.summary = $summary, d.categoryId = $categoryId,
        d.authorId = $authorId, d.status = $status, d.tags = $tags,
        d.updatedAt = $now, d.createdAt = coalesce(d.createdAt, $now)`,
        {
          id: doc.id,
          title: doc.title,
          summary: doc.summary ?? '',
          categoryId: doc.categoryId ?? '',
          authorId: doc.authorId ?? '',
          status: doc.status,
          tags: doc.tags ?? '',
          now,
        },
      );
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

  async searchGraph(keyword: string, limit = 50): Promise<GraphNodeHitDto[]> {
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
        labels: r.get('labels') as string[],
        props: r.get('props') as Record<string, unknown>,
      }));
    } finally {
      await session.close();
    }
  }

  async searchGraphSubgraph(keyword: string, limit = 50): Promise<GraphSubgraphResultDto> {
    if (!this.driver) return { nodes: [], edges: [] };
    const kw = keyword.trim();
    if (!kw) return { nodes: [], edges: [] };

    const cap = Math.min(Math.max(limit, 1), 100);
    const session = this.driver.session();
    try {
      // ① 命中节点（与 searchGraph 条件一致，可逐步扩展到 Chunk）
      const nodeRes = await session.run(
        `MATCH (n)
         WHERE (n:KnowledgeEntity OR n:KnowledgeDocument)
           AND toLower(coalesce(n.name, n.title, '')) CONTAINS toLower($kw)
         RETURN labels(n) AS labels, properties(n) AS props
         LIMIT $limit`,
        { kw, limit: neo4j.int(cap) },
      );

      const hits = nodeRes.records.map((r) => ({
        labels: r.get('labels') as string[],
        props: r.get('props') as Record<string, unknown>,
      }));
      if (hits.length === 0) return { nodes: [], edges: [] };

      const nodes: GraphSubgraphNodeDto[] = hits.map((h) => {
        const label = h.labels[0] ?? 'Unknown';
        const id = this.nodeKey(h.labels, h.props);
        const name = String(h.props.title ?? h.props.name ?? id);
        return {
          id,
          name,
          label,
          type: (h.props.type as string) ?? null,
          documentId: label === 'KnowledgeDocument' ? String(h.props.id ?? '') : undefined,
        };
      });

      const entityNames = hits
        .filter((h) => h.labels.includes('KnowledgeEntity'))
        .map((h) => String(h.props.name ?? ''))
        .filter(Boolean);

      const idByEntityName = new Map(
        nodes.filter((n) => n.label === 'KnowledgeEntity').map((n) => [n.name, n.id]),
      );

      const edges: GraphSubgraphEdgeDto[] = [];

      // ② 实体间 RELATED_TO（只取命中集合内部的边，避免边爆炸）
      if (entityNames.length >= 2) {
        const relRes = await session.run(
          `MATCH (a:KnowledgeEntity)-[r:RELATED_TO]->(b:KnowledgeEntity)
           WHERE a.name IN $names AND b.name IN $names
           RETURN a.name AS sourceName, b.name AS targetName,
                  coalesce(r.relation, r.type, 'RELATED_TO') AS relation,
                  r.weight AS weight`,
          { names: entityNames },
        );
        for (const rec of relRes.records) {
          const source = idByEntityName.get(rec.get('sourceName') as string);
          const target = idByEntityName.get(rec.get('targetName') as string);
          if (!source || !target) continue;
          edges.push({
            source,
            target,
            relation: (rec.get('relation') as string) ?? 'RELATED_TO',
            weight: this.toNumber(rec.get('weight'), 0.5),
          });
        }
      }

      // ③ 文档 → 实体 MENTIONS（1 跳，让文档节点也连上实体）
      const docIds = hits
        .filter((h) => h.labels.includes('KnowledgeDocument'))
        .map((h) => String(h.props.id ?? ''))
        .filter(Boolean);

      if (docIds.length > 0 && entityNames.length > 0) {
        const mentionRes = await session.run(
          `MATCH (d:KnowledgeDocument)-[:HAS_CHUNK]->(:DocumentChunk)-[:MENTIONS]->(e:KnowledgeEntity)
           WHERE d.id IN $docIds AND e.name IN $entityNames
           RETURN DISTINCT d.id AS docId, e.name AS entityName`,
          { docIds, entityNames },
        );
        for (const rec of mentionRes.records) {
          const source = `doc:${rec.get('docId') as string}`;
          const target = idByEntityName.get(rec.get('entityName') as string);
          if (!target) continue;
          edges.push({ source, target, relation: 'MENTIONS' });
        }
      }

      return { nodes, edges };
    } finally {
      await session.close();
    }
  }

  /**
   * 全景图：文档 + 被提及实体 + 标签，不含 chunk（块太碎，不适合画布）。
   * 文档→实体 为「提及」，实体→实体 为 RELATED_TO 上的 relation，文档→标签 为「标注」。
   */
  async getOverview(params: {
    keyword?: string;
    entityType?: string;
    from?: string;
    to?: string;
    docLimit?: number;
  }) {
    const empty = {
      nodes: [] as Array<{
        id: string;
        name: string;
        kind: 'document' | 'entity' | 'tag';
        type?: string | null;
        documentId?: string | null;
        updatedAt?: string | null;
        description?: string | null;
      }>,
      edges: [] as Array<{
        source: string;
        target: string;
        relation: string;
        kind: 'mentions' | 'related' | 'tagged';
      }>,
      stats: {
        nodeCount: 0,
        edgeCount: 0,
        documentCount: 0,
        entityCount: 0,
        tagCount: 0,
        mentionCount: 0,
        relatedCount: 0,
        entityTypes: [] as Array<{ type: string; count: number }>,
      },
      topEntities: [] as Array<{ name: string; type: string | null; degree: number }>,
      recentNodes: [] as Array<{
        id: string;
        name: string;
        kind: string;
        updatedAt: string | null;
        fileExt: string | null;
      }>,
      entityTypes: [] as string[],
    };

    if (!this.driver) {
      this.logger.warn('跳过图谱全景（Neo4j 不可用）');
      return empty;
    }

    const kw = params.keyword?.trim() ?? '';
    const entityType = params.entityType?.trim() || null;
    const from = params.from?.trim() || null;
    const to = params.to?.trim() || null;
    const docLimit = Math.min(Math.max(params.docLimit ?? 24, 1), 80);
    const session = this.driver.session();

    try {
      // 全库统计：文档数、实体数、RELATED_TO 边数、MENTIONS 提及次数（分段 WITH 避免笛卡尔积）
      const statsResult = await session.run(
        `
          OPTIONAL MATCH (d:KnowledgeDocument)
          WITH count(d) AS documentCount
          OPTIONAL MATCH (e:KnowledgeEntity)
          WITH documentCount, count(e) AS entityCount
          OPTIONAL MATCH ()-[rel:RELATED_TO]->()
          WITH documentCount, entityCount, count(rel) AS relatedCount
          OPTIONAL MATCH (:KnowledgeDocument)-[:HAS_CHUNK]->(:DocumentChunk)-[:MENTIONS]->(e0:KnowledgeEntity)
          RETURN documentCount, entityCount, relatedCount, count(e0) AS mentionCount
          `,
      );
      const statsRow = statsResult.records[0];
      const documentCount = this.toNumber(statsRow?.get('documentCount'), 0);
      const entityCount = this.toNumber(statsRow?.get('entityCount'), 0);
      const relatedCount = this.toNumber(statsRow?.get('relatedCount'), 0);
      const mentionCount = this.toNumber(statsRow?.get('mentionCount'), 0);

      // 按实体 type 分组计数，供前端筛选
      const typeRows = await session.run(
        `
          MATCH (e:KnowledgeEntity)
          WHERE e.type IS NOT NULL AND e.type <> ''
          RETURN e.type AS type, count(*) AS count
          ORDER BY count DESC
          `,
      );
      const entityTypes = typeRows.records.map((record) => ({
        type: String(record.get('type')),
        count: this.toNumber(record.get('count'), 0),
      }));

      // 被文档块 MENTIONS 最多的 5 个实体（degree = 提及次数）
      const topRows = await session.run(
        `
          MATCH (e:KnowledgeEntity)<-[:MENTIONS]-(:DocumentChunk)
          RETURN e.name AS name, e.type AS type, count(*) AS degree
          ORDER BY degree DESC
          LIMIT 5
          `,
      );
      const topEntities = topRows.records.map((record) => ({
        name: String(record.get('name')),
        type: (record.get('type') as string) ?? null,
        degree: this.toNumber(record.get('degree'), 0),
      }));

      // 最近更新的 8 篇文档（不受 keyword / 时间 / 类型过滤）
      const recentRows = await session.run(
        `
          MATCH (d:KnowledgeDocument)
          RETURN d.id AS id, d.title AS name, d.updatedAt AS updatedAt
          ORDER BY d.updatedAt DESC
          LIMIT 8
          `,
      );
      const recentNodes = recentRows.records.map((record) => ({
        id: `doc:${record.get('id') as string}`,
        name: String(record.get('name') ?? ''),
        kind: 'document',
        updatedAt: (record.get('updatedAt') as string) ?? null,
        fileExt: null as string | null,
      }));

      const recentDocIds = recentNodes.map((node) => node.id.replace(/^doc:/, ''));
      if (recentDocIds.length > 0) {
        const recentDocs = await this.docRepo.find({
          where: { id: In(recentDocIds), deleted: false },
          select: { id: true, fileExt: true },
        });
        const fileExtById = new Map(recentDocs.map((doc) => [doc.id, doc.fileExt ?? null]));
        for (const node of recentNodes) {
          node.fileExt = fileExtById.get(node.id.replace(/^doc:/, '')) ?? null;
        }
      }

      // 主查询：按标题/摘要/标签 + 时间筛文档，LIMIT 后挂上 MENTIONS 实体（可按 entityType 再筛）
      const docRows = await session.run(
        `
          MATCH (d:KnowledgeDocument)
          WHERE ($kw = '' OR toLower(coalesce(d.title, '')) CONTAINS toLower($kw)
                OR toLower(coalesce(d.summary, '')) CONTAINS toLower($kw)
                OR toLower(coalesce(d.tags, '')) CONTAINS toLower($kw))
            AND ($from IS NULL OR d.updatedAt >= $from)
            AND ($to IS NULL OR d.updatedAt <= $to)
          WITH d ORDER BY d.updatedAt DESC LIMIT $docLimit
          OPTIONAL MATCH (d)-[:HAS_CHUNK]->(:DocumentChunk)-[:MENTIONS]->(e:KnowledgeEntity)
          WHERE $entityType IS NULL OR e.type = $entityType
          RETURN d.id AS docId, d.title AS docTitle, d.summary AS summary,
                 d.tags AS tags, d.updatedAt AS updatedAt,
                 collect(DISTINCT CASE WHEN e IS NULL THEN NULL ELSE {
                   name: e.name, type: e.type, description: e.description
                 } END) AS entities
          `,
        {
          kw,
          entityType,
          from,
          to,
          docLimit: neo4j.int(docLimit),
        },
      );

      const docRecords = [...docRows.records];

      // 关键词命中实体但标题未命中时，把提及该实体的文档补进来
      if (kw) {
        const extra = await session.run(
          `
            MATCH (e:KnowledgeEntity)<-[:MENTIONS]-(:DocumentChunk)<-[:HAS_CHUNK]-(d:KnowledgeDocument)
            WHERE toLower(coalesce(e.name, '')) CONTAINS toLower($kw)
               OR toLower(coalesce(e.description, '')) CONTAINS toLower($kw)
            WITH DISTINCT d
            WHERE ($from IS NULL OR d.updatedAt >= $from)
              AND ($to IS NULL OR d.updatedAt <= $to)
            OPTIONAL MATCH (d)-[:HAS_CHUNK]->(:DocumentChunk)-[:MENTIONS]->(e2:KnowledgeEntity)
            WHERE $entityType IS NULL OR e2.type = $entityType
            RETURN d.id AS docId, d.title AS docTitle, d.summary AS summary,
                   d.tags AS tags, d.updatedAt AS updatedAt,
                   collect(DISTINCT CASE WHEN e2 IS NULL THEN NULL ELSE {
                     name: e2.name, type: e2.type, description: e2.description
                   } END) AS entities
            LIMIT $docLimit
            `,
          { kw, entityType, from, to, docLimit: neo4j.int(docLimit) },
        );
        const seen = new Set(docRecords.map((r) => String(r.get('docId'))));
        for (const record of extra.records) {
          const id = String(record.get('docId'));
          if (!seen.has(id)) docRecords.push(record);
        }
      }

      const nodeMap = new Map<
        string,
        {
          id: string;
          name: string;
          kind: 'document' | 'entity' | 'tag';
          type?: string | null;
          documentId?: string | null;
          updatedAt?: string | null;
          description?: string | null;
        }
      >();
      const edgeMap = new Map<
        string,
        {
          source: string;
          target: string;
          relation: string;
          kind: 'mentions' | 'related' | 'tagged';
        }
      >();
      const entityNames = new Set<string>();

      const addEdge = (
        source: string,
        target: string,
        relation: string,
        kind: 'mentions' | 'related' | 'tagged',
      ) => {
        const key = `${kind}|${source}|${target}|${relation}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source, target, relation, kind });
        }
      };

      const splitTags = (raw: unknown) =>
        String(raw ?? '')
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean);

      for (const record of docRecords) {
        const docId = String(record.get('docId'));
        const docNodeId = `doc:${docId}`;
        nodeMap.set(docNodeId, {
          id: docNodeId,
          name: String(record.get('docTitle') ?? ''),
          kind: 'document',
          type: 'DOCUMENT',
          documentId: docId,
          updatedAt: (record.get('updatedAt') as string) ?? null,
          description: (record.get('summary') as string) ?? null,
        });
        for (const tag of splitTags(record.get('tags'))) {
          const tagId = `tag:${tag}`;
          nodeMap.set(tagId, {
            id: tagId,
            name: tag,
            kind: 'tag',
            type: 'TAG',
          });
          addEdge(docNodeId, tagId, '标注', 'tagged');
        }
        const entities = record.get('entities') as Array<{
          name?: string;
          type?: string;
          description?: string;
        } | null>;
        for (const entity of entities ?? []) {
          if (!entity?.name) continue;
          const entityId = `entity:${entity.name}`;
          entityNames.add(entity.name);
          nodeMap.set(entityId, {
            id: entityId,
            name: entity.name,
            kind: 'entity',
            type: entity.type ?? 'CONCEPT',
            description: entity.description ?? null,
          });
          addEdge(docNodeId, entityId, '提及', 'mentions');
        }
      }

      if (entityNames.size > 0) {
        // 只取当前画布上实体之间的 RELATED_TO，避免拉全库关系
        const relatedRows = await session.run(
          `
            MATCH (a:KnowledgeEntity)-[r:RELATED_TO]->(b:KnowledgeEntity)
            WHERE a.name IN $names AND b.name IN $names
            RETURN a.name AS source, b.name AS target,
                   r.relation AS relation, r.weight AS weight
            LIMIT 400
            `,
          { names: [...entityNames] },
        );
        for (const record of relatedRows.records) {
          const source = `entity:${record.get('source') as string}`;
          const target = `entity:${record.get('target') as string}`;
          const relation = (record.get('relation') as string) || '关联';
          addEdge(source, target, relation, 'related');
        }
      }

      const nodes = [...nodeMap.values()];
      const edges = [...edgeMap.values()];
      const tagCount = nodes.filter((n) => n.kind === 'tag').length;

      return {
        nodes,
        edges,
        stats: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          documentCount,
          entityCount,
          tagCount,
          mentionCount,
          relatedCount,
          entityTypes,
        },
        topEntities,
        recentNodes,
        entityTypes: entityTypes.map((t) => t.type),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`图谱全景查询失败：${message}`);
      return empty;
    } finally {
      await session.close();
    }
  }

  private nodeKey(labels: string[], props: Record<string, unknown>): string {
    const primary = labels[0] ?? 'Unknown';
    if (primary === 'KnowledgeDocument') return `doc:${String(props.id ?? '')}`;
    if (primary === 'KnowledgeEntity') return `entity:${String(props.name ?? '')}`;
    return `${primary}:${String(props.id ?? props.name ?? '')}`;
  }

  private toNumber(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (neo4j.isInt(value)) return value.toNumber();
    return fallback;
  }
}
