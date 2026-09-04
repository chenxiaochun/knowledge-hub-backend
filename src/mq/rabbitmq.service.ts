import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, { AmqpConnectionManager, ChannelWrapper } from 'amqp-connection-manager';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  SEARCH_INDEX_EXCHANGE,
  SEARCH_INDEX_QUEUE,
  SEARCH_RK_DELETE,
  SEARCH_RK_INDEX,
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

        // 创建队列, 持久化
        await channel.assertQueue(SEARCH_INDEX_QUEUE, { durable: true });

        // 绑定队列到交换器
        await channel.bindQueue(SEARCH_INDEX_QUEUE, SEARCH_INDEX_EXCHANGE, SEARCH_RK_INDEX);
        await channel.bindQueue(SEARCH_INDEX_QUEUE, SEARCH_INDEX_EXCHANGE, SEARCH_RK_DELETE);

        for (const [queue, handler] of this.handlers) {
          await channel.consume(queue, async (msg) => {
            if (!msg) {
              return;
            }
            try {
              await handler(msg);
              // 确认消息
              channel.ack(msg);
            } catch (error) {
              this.logger.error(`处理消息失败: ${error}`);
              // 拒绝消息, 不重试
              channel.nack(msg, false, false);
            } finally {
              channel.ack(msg);
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
