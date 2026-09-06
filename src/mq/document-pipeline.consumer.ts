import { Injectable, Logger } from '@nestjs/common';
import { ConsumeMessage } from 'amqplib';
import { SearchIndexService } from '../pipeline/search-index.service';
import { SEARCH_INDEX_QUEUE, RAG_REINDEX_QUEUE, KG_GRAPH_QUEUE } from './mq.constant';
import { KgBuildMessage, ReindexMessage, SearchIndexMessage } from './messages/pipeline.messages';
import { RabbitMQService } from './rabbitmq.service';
import { RagService } from '../pipeline/rag.service';
import { GraphBuildService } from '../pipeline/graph-build.service';

/** 消费 Search / RAG / KG 三类队列消息 */
@Injectable()
export class DocumentPipelineConsumer {
  private readonly logger = new Logger(DocumentPipelineConsumer.name);

  constructor(
    private readonly rabbit: RabbitMQService,
    private readonly searchIndex: SearchIndexService,
    private readonly ragService: RagService,
    private readonly graphBuildService: GraphBuildService,
  ) {
    this.rabbit.registerHandler(SEARCH_INDEX_QUEUE, (msg) => this.handleSearch(msg));
    this.rabbit.registerHandler(RAG_REINDEX_QUEUE, (msg) => this.handleRagReindex(msg));
    this.rabbit.registerHandler(KG_GRAPH_QUEUE, (msg) => this.handleKgBuild(msg));
  }

  private async handleSearch(msg: ConsumeMessage) {
    const body = JSON.parse(msg.content.toString('utf8')) as SearchIndexMessage;
    this.logger.log(
      `[Search] type=${body.type}, taskId=${body.taskId}, documentId=${body.documentId}`,
    );

    if (body.type === 'INDEX') {
      await this.searchIndex.indexFromDocumentId(body.documentId);
    } else if (body.type === 'DELETE') {
      await this.searchIndex.deleteDocument(body.documentId);
    }
  }

  private async handleRagReindex(msg: ConsumeMessage) {
    const body = JSON.parse(msg.content.toString('utf8')) as ReindexMessage;
    this.logger.log(
      `[RAG] type=${body.type}, taskId=${body.taskId}, documentIds=${body.documentIds}`,
    );
    if (body.type === 'BY_DOC_IDS') {
      await this.ragService.reindexByIds(body.documentIds);
    } else if (body.type === 'DELETE_BY_DOC_IDS') {
      await this.ragService.deleteByDocIds(body.documentIds);
    }
  }

  private async handleKgBuild(msg: ConsumeMessage) {
    const body = JSON.parse(msg.content.toString('utf8')) as KgBuildMessage;
    this.logger.log(
      `[KG] type=${body.type}, taskId=${body.taskId}, documentIds=${body.documentIds}`,
    );
    if (body.type === 'BY_DOC_IDS') {
      await this.graphBuildService.buildByDocIds(body.documentIds);
    } else if (body.type === 'DELETE_BY_DOC_IDS') {
      await this.graphBuildService.deleteByDocIds(body.documentIds);
    }
  }
}
