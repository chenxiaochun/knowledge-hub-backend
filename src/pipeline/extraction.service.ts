import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BaseLanguageModelInput } from '@langchain/core/language_models/base';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Runnable } from '@langchain/core/runnables';
import { ChatOpenAI } from '@langchain/openai';
import {
  buildExtractionSystemPrompt,
  kgExtractionResultSchema,
  KgExtractionLlmOutput,
  normalizeEntityType,
  normalizeRelationType,
} from './kg-extraction.schema';

/** source -[relation]-> target（对齐 origin） */
export interface ExtractionResult {
  entities: {
    name: string;
    type: string;
    description?: string;
    aliases?: string[];
  }[];
  relations: {
    source: string;
    target: string;
    relation: string;
    weight?: number;
  }[];
}

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly maxEntities: number;
  private readonly maxRelations: number;
  private readonly structuredLlm: Runnable<BaseLanguageModelInput, KgExtractionLlmOutput> = null!;

  constructor(private readonly configService: ConfigService) {
    this.maxEntities = this.configService.getOrThrow<number>('KG_MAX_ENTITIES');
    this.maxRelations = this.configService.getOrThrow<number>('KG_MAX_RELATIONS');

    const apiKey = this.configService.get('OPENAI_API_KEY');
    if (!apiKey) {
      this.logger.error('OPENAI_API_KEY is not set');
      return;
    }

    const baseUrl = this.configService.get('OPENAI_BASE_URL');
    if (!baseUrl) {
      this.logger.error('OPENAI_BASE_URL is not set');
      return;
    }

    const model = this.configService.get('MODEL_NAME');
    const timeout = Number(this.configService.getOrThrow<number>('KG_LLM_TIMEOUT_MS'));

    const llm = new ChatOpenAI({
      apiKey,
      model,
      temperature: 0.1,
      timeout: Number.isFinite(timeout) ? timeout : 60000,
      maxRetries: 3,
      useResponsesApi: false,
      configuration: {
        baseURL: baseUrl,
      },
    });

    this.structuredLlm = llm.withStructuredOutput(kgExtractionResultSchema, {
      name: 'extract_knowledge_graph',
    });

    this.logger.log('ExtractionService initialized successfully');
  }

  async extract(
    content: string,
    heading: string | null,
    documentTitle = '',
  ): Promise<ExtractionResult> {
    if (!content.trim()) {
      return {
        entities: [],
        relations: [],
      };
    }
    if (this.structuredLlm) {
      try {
        return await this.extractByLlm(content, heading, documentTitle);
      } catch (error) {
        this.logger.error(`Failed to extract knowledge graph: ${error}`);
        return {
          entities: [],
          relations: [],
        };
      }
    }
    return {
      entities: [],
      relations: [],
    };
  }

  async extractByLlm(
    content: string,
    heading: string | null,
    documentTitle = '',
  ): Promise<ExtractionResult> {
    if (!this.structuredLlm) {
      throw new Error('Structured LLM is not initialized');
    }

    const system = buildExtractionSystemPrompt(this.maxEntities, this.maxRelations);
    const user = `文档标题：${documentTitle}\n章节：${heading}\n文档内容：${content.slice(0, 1000)}`;

    const started = Date.now();
    const parsed = await this.structuredLlm.invoke([
      new SystemMessage(system),
      new HumanMessage(user),
    ]);

    this.logger.log(
      `KG LLM 抽取完成：elapsed=${Date.now() - started}ms, entities=${parsed.entities?.length ?? 0}`,
    );
    return this.toExtractionResult(parsed);
  }

  async toExtractionResult(parsed: KgExtractionLlmOutput): Promise<ExtractionResult> {
    const entityNames = new Set<string>();
    const entities: ExtractionResult['entities'] = [];

    for (const e of (parsed.entities ?? []).slice(0, this.maxEntities)) {
      const name = e.name.trim();
      if (!name) continue;
      entityNames.add(name);
      entities.push({
        name,
        type: normalizeEntityType(e.type),
        description: e.description?.trim(),
        aliases: (e.aliases ?? []).map((a) => String(a).trim()).filter(Boolean), // 兼容 number 类型, 字符串类型转换
      });
    }

    const relations: ExtractionResult['relations'] = [];
    for (const r of (parsed.relations ?? []).slice(0, this.maxRelations)) {
      const source = r.source.trim();
      const target = r.target.trim();
      if (!source || !target) continue;

      relations.push({
        source,
        target,
        relation: normalizeRelationType(r.relation),
      });
    }

    return { entities, relations };
  }
}
