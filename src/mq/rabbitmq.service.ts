import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  SEARCH_INDEX_EXCHANGE,
  SEARCH_INDEX_QUEUE,
  SEARCH_RK_DELETE,
  SEARCH_RK_INDEX,
  RAG_REINDEX_EXCHANGE,
  RAG_REINDEX_QUEUE,
  RAG_RK_BY_IDS,
  RAG_RK_DELETE,
  KG_GRAPH_EXCHANGE,
  KG_GRAPH_QUEUE,
  KG_RK_BUILD_BY_IDS,
  KG_RK_DELETE,
} from './mq.constant';

export type MessageHandler = (msg: ConsumeMessage) => Promise<void> | void;

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: AmqpConnectionManager | null = null;
  private channel: ChannelWrapper | null = null;
  private readonly enabled: boolean;
  private readonly handlers: Map<string, MessageHandler> = new Map();

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get('RABBITMQ_ENABLED', 'true') !== 'false';
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  registerHandler(queue: string, handler: MessageHandler) {
    this.handlers.set(queue, handler);
  }

  async onModuleInit() {
    if (!this.isEnabled) {
      this.logger.log('RabbitMQ 已禁用');
    }

    const url = this.configService.get('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672');
    this.connection = amqp.connect(url);

    this.channel = this.connection.createChannel({
      json: true,
      setup: async (channel: ConfirmChannel) => {
        // 创建交换器, 持久化
        await channel.assertExchange(SEARCH_INDEX_EXCHANGE, 'topic', { durable: true });
        await channel.assertExchange(RAG_REINDEX_EXCHANGE, 'topic', { durable: true });
        await channel.assertExchange(KG_GRAPH_EXCHANGE, 'topic', { durable: true });

        // 创建队列, 持久化
        await channel.assertQueue(SEARCH_INDEX_QUEUE, { durable: true });
        await channel.assertQueue(RAG_REINDEX_QUEUE, { durable: true });
        await channel.assertQueue(KG_GRAPH_QUEUE, { durable: true });

        // 绑定队列到交换器
        await channel.bindQueue(SEARCH_INDEX_QUEUE, SEARCH_INDEX_EXCHANGE, SEARCH_RK_INDEX);
        await channel.bindQueue(SEARCH_INDEX_QUEUE, SEARCH_INDEX_EXCHANGE, SEARCH_RK_DELETE);
        await channel.bindQueue(RAG_REINDEX_QUEUE, RAG_REINDEX_EXCHANGE, RAG_RK_BY_IDS);
        await channel.bindQueue(RAG_REINDEX_QUEUE, RAG_REINDEX_EXCHANGE, RAG_RK_DELETE);
        await channel.bindQueue(KG_GRAPH_QUEUE, KG_GRAPH_EXCHANGE, KG_RK_BUILD_BY_IDS);
        await channel.bindQueue(KG_GRAPH_QUEUE, KG_GRAPH_EXCHANGE, KG_RK_DELETE);

        for (const [queue, handler] of this.handlers) {
          await channel.consume(queue, async (msg) => {
            if (!msg) {
              return;
            }
            try {
              await handler(msg);
              // 处理成功：确认并出队
              try {
                channel.ack(msg);
              } catch (ackErr) {
                this.logger.error(`ack 失败（channel 可能已关闭）: ${ackErr}`);
              }
            } catch (error) {
              this.logger.error(`处理消息失败: ${error}`);
              try {
                // 拒绝且不重回队列，避免毒消息死循环
                channel.nack(msg, false, false);
              } catch (nackErr) {
                // channel 已断时 nack 也会抛，只记日志，避免二次打挂进程
                this.logger.error(`nack 失败（channel 可能已关闭）: ${nackErr}`);
              }
            }
          });
        }
      },
    });
    await this.channel.waitForConnect();
  }

  async publish(exchange: string, routingKey: string, message: any) {
    if (!this.isEnabled || !this.channel) {
      this.logger.warn('RabbitMQ 未启用或通道未创建');
      return false;
    }

    try {
      await this.channel.publish(exchange, routingKey, message, {
        persistent: true,
        contentType: 'application/json',
      });
      return true;
    } catch (error) {
      this.logger.error(`发布消息失败: ${error}`);
      return false;
    }
  }

  async onModuleDestroy() {
    await this.channel?.close();
    await this.connection?.close();
  }
}
