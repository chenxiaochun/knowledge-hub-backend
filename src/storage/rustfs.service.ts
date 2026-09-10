import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname } from 'path';

export interface UploadBytesOptions {
  fileName: string;
  contentType: string;
  /** 对象 key 前缀，默认 documents */
  prefix?: string;
}

@Injectable()
export class RustfsService implements OnModuleInit {
  private readonly logger = new Logger(RustfsService.name);
  private client!: S3Client;
  private bucket: string = '';
  private publicBaseUrl: string = '';

  constructor(private readonly configService: ConfigService) {
    this.client = new S3Client({
      region: this.configService.get('AWS_REGION'),
    });
  }

  async onModuleInit() {
    const endpoint = this.configService.get<string>('RUSTFS_ENDPOINT') ?? '';
    const accessKey = this.configService.get<string>('RUSTFS_ACCESS_KEY') ?? '';
    const secretKey = this.configService.get<string>('RUSTFS_SECRET_KEY') ?? '';
    const region = this.configService.get<string>('RUSTFS_REGION') ?? '';

    this.bucket = this.configService.get<string>('RUSTFS_BUCKET')!;
    this.publicBaseUrl =
      (this.configService.get<string>('RUSTFS_PUBLIC_URL') || endpoint)?.replace(/\/$/, '') ?? '';

    this.client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: true,
    });

    this.logger.log(
      `RustFS 已配置: endpoint=${endpoint}, bucket=${this.bucket}, public=${this.publicBaseUrl}`,
    );

    void this.ensureBucket().catch((err) => {
      this.logger.warn(
        `RustFS 初始化 bucket 失败（首次上传时会重试）: ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  /** 上传字节，返回可访问 URL：{publicBase}/{bucket}/{key} */
  async uploadBytes(bytes: Buffer | Uint8Array, options: UploadBytesOptions): Promise<string> {
    if (!this.client) {
      throw new ServiceUnavailableException('RustFS 未初始化');
    }

    await this.ensureBucket();
    // 处理前缀, 去掉前后多余的斜杠
    // 为什么要处理前缀？因为前缀可能会包含非法字符，比如斜杠
    const prefix = (options.prefix ?? 'documents').replace(/^\/+|\/+$/g, '');
    // 根据文件名和 contentType 猜测文件扩展名
    const ext = extname(options.fileName) || this.guessExt(options.contentType);
    // 对文件名进行安全处理，避免包含非法字符
    const safeBase = this.sanitizeBaseName(options.fileName);
    const key = `${prefix}/${this.formatDatePath()}/${safeBase}-${randomUUID()}${ext}`;
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: options.contentType,
        ContentLength: body.length,
      }),
    );

    const url = `${this.publicBaseUrl}/${this.bucket}/${key}`;
    this.logger.log(`RustFS 上传成功: key=${key}, size=${body.length}, url=${url}`);
    return url;
  }

  private async ensureBucket(): Promise<void> {
    if (!this.client) return;

    try {
      // 检查 bucket 是否存在
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // bucket 不存在则创建
    }

    try {
      // 创建 bucket
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`RustFS bucket 已创建: ${this.bucket}`);
    } catch (err) {
      // 并发创建时可能已存在
      const message = err instanceof Error ? err.message : String(err);
      if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists|already exists/i.test(message)) {
        throw err;
      }
    }
  }

  formatDatePath(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }

  sanitizeBaseName(fileName: string): string {
    const base = fileName.replace(/\.[^.]+$/, '') || 'file';
    return base.replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 64);
  }

  guessExt(contentType: string): string {
    switch (contentType) {
      case 'image/png':
        return '.png';
      case 'image/jpeg':
        return '.jpg';
      case 'image/webp':
        return '.webp';
      case 'application/pdf':
        return '.pdf';
      default:
        return '';
    }
  }
}
