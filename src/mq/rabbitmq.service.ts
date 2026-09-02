import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  KG_GRAPH_EXCHANGE,
  KG_GRAPH_QUEUE,
  KG_RK_BUILD_BY_IDS,
  KG_RK_DELETE,
  RAG_REINDEX_EXCHANGE,
  RAG_REINDEX_QUEUE,
  RAG_RK_BY_IDS,
  RAG_RK_DELETE,
  SEARCH_INDEX_EXCHANGE,
  SEARCH_INDEX_QUEUE,
  SEARCH_RK_DELETE,
  SEARCH_RK_INDEX,
} from './mq.constants';

export type MessageHandler = (msg: ConsumeMessage) => Promise<void> | void;

@Injectable()
export class RabbitMqService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMqService.name);
  private connection: AmqpConnectionManager | null = null;
  private channel: ChannelWrapper | null = null;
  private readonly enabled: boolean;
  private readonly handlers = new Map<string, MessageHandler>();

  constructor(private readonly config: ConfigService) {
    this.enabled = this.config.get<string>('RABBITMQ_ENABLED', 'true') !== 'false';
  }

  get isEnabled() {
    return this.enabled;
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('RabbitMQ 已禁用（RABBITMQ_ENABLED=false）');
      return;
    }

    const url = this.config.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672');
    const safeUrl = this.redactAmqpUrl(url);
    const timeoutMs = Number(this.config.get<string>('RABBITMQ_CONNECT_TIMEOUT_MS', '15000'));

    this.logger.log(`正在连接 RabbitMQ：${safeUrl}（超时 ${timeoutMs}ms）`);

    this.connection = amqp.connect([url]);
    this.connection.on('connect', (arg) => {
      const connectedUrl =
        typeof arg === 'object' && arg && 'url' in arg
          ? String((arg as { url?: string }).url ?? url)
          : url;
      this.logger.log(`RabbitMQ 已连接：${this.redactAmqpUrl(connectedUrl)}`);
    });
    this.connection.on('disconnect', (err) =>
      this.logger.warn(`RabbitMQ 断开：${this.errorMessage(err?.err ?? err)}`),
    );
    this.connection.on('connectFailed', (err) =>
      this.logger.error(
        `RabbitMQ 连接失败：${this.errorMessage(err?.err ?? err)}（url=${safeUrl}）`,
      ),
    );

    this.channel = this.connection.createChannel({
      json: true,
      setup: async (ch: ConfirmChannel) => {
        this.logger.log('RabbitMQ channel setup：声明拓扑并绑定消费者');
        await this.assertTopology(ch);
        await this.bindConsumers(ch);
      },
    });

    try {
      await Promise.race([
        this.channel.waitForConnect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(
              new Error(
                `RabbitMQ 连接超时（${timeoutMs}ms）：${safeUrl}。请检查服务是否启动、5672 是否被其他容器占用、账号密码是否正确`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
      this.logger.log('RabbitMQ channel 就绪');
    } catch (error) {
      const message = this.errorMessage(error);
      this.logger.error(`RabbitMQ 初始化失败：${message}`);
      await this.connection.close().catch(() => undefined);
      this.connection = null;
      this.channel = null;
      throw error;
    }
  }

  /** 日志里隐藏 AMQP 密码 */
  private redactAmqpUrl(url: string) {
    return url.replace(/\/\/([^:/@]+):([^@]+)@/, '//$1:***@');
  }

  private errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (
      typeof error === 'object' &&
      error &&
      'message' in error &&
      typeof (error as { message: unknown }).message === 'string'
    ) {
      return (error as { message: string }).message;
    }
    return String(error ?? 'unknown');
  }

  async onModuleDestroy() {
    await this.channel?.close();
    await this.connection?.close();
  }

  /** 注册队列消费者（在模块 init 前/后均可；连接就绪后生效） */
  registerHandler(queue: string, handler: MessageHandler) {
    this.handlers.set(queue, handler);
  }

  async publish(exchange: string, routingKey: string, payload: unknown): Promise<boolean> {
    if (!this.enabled || !this.channel) {
      this.logger.warn(`跳过发消息（MQ 不可用）：exchange=${exchange}, rk=${routingKey}`);
      return false;
    }

    try {
      await this.channel.publish(exchange, routingKey, payload, {
        contentType: 'application/json',
        persistent: true,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`发消息失败：exchange=${exchange}, rk=${routingKey}, error=${message}`);
      return false;
    }
  }

  private async assertTopology(ch: ConfirmChannel) {
    await ch.assertExchange(RAG_REINDEX_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(RAG_REINDEX_QUEUE, { durable: true });
    await ch.bindQueue(RAG_REINDEX_QUEUE, RAG_REINDEX_EXCHANGE, RAG_RK_BY_IDS);
    await ch.bindQueue(RAG_REINDEX_QUEUE, RAG_REINDEX_EXCHANGE, RAG_RK_DELETE);

    await ch.assertExchange(SEARCH_INDEX_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(SEARCH_INDEX_QUEUE, { durable: true });
    await ch.bindQueue(SEARCH_INDEX_QUEUE, SEARCH_INDEX_EXCHANGE, SEARCH_RK_INDEX);
    await ch.bindQueue(SEARCH_INDEX_QUEUE, SEARCH_INDEX_EXCHANGE, SEARCH_RK_DELETE);

    await ch.assertExchange(KG_GRAPH_EXCHANGE, 'topic', { durable: true });
    await ch.assertQueue(KG_GRAPH_QUEUE, { durable: true });
    await ch.bindQueue(KG_GRAPH_QUEUE, KG_GRAPH_EXCHANGE, KG_RK_BUILD_BY_IDS);
    await ch.bindQueue(KG_GRAPH_QUEUE, KG_GRAPH_EXCHANGE, KG_RK_DELETE);

    this.logger.log('RabbitMQ 拓扑已声明（RAG + Search + KG）');
  }

  private async bindConsumers(ch: ConfirmChannel) {
    for (const [queue, handler] of this.handlers.entries()) {
      await ch.consume(queue, async (msg) => {
        if (!msg) return;
        try {
          await handler(msg);
          ch.ack(msg);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.error(`消费失败 queue=${queue}: ${message}`);
          ch.nack(msg, false, false);
        }
      });
      this.logger.log(`已注册消费者：${queue}`);
    }
  }
}
