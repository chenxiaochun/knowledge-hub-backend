import {
  CreateBucketCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { extname } from 'path';

export interface UploadBytesOptions {
  fileName: string;
  contentType: string;
  /** 对象 key 前缀，默认 documents */
  prefix?: string;
}

/** RustFS 文件存储（S3 兼容） */
@Injectable()
export class RustfsService implements OnModuleInit {
  private readonly logger = new Logger(RustfsService.name);
  private client: S3Client | null = null;
  private enabled = false;
  private bucket = '';
  private publicBaseUrl = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    this.enabled = this.config.get<string>('RUSTFS_ENABLED', 'true').toLowerCase() !== 'false';

    if (!this.enabled) {
      this.logger.warn('RustFS 已禁用（RUSTFS_ENABLED=false），文件上传将跳过');
      return;
    }

    const endpoint = this.config.get<string>('RUSTFS_ENDPOINT', 'http://localhost:9000');
    const accessKey = this.config.get<string>('RUSTFS_ACCESS_KEY', 'rustfsadmin');
    const secretKey = this.config.get<string>('RUSTFS_SECRET_KEY', 'rustfsadmin');
    const region = this.config.get<string>('RUSTFS_REGION', 'us-east-1');
    this.bucket = this.config.get<string>('RUSTFS_BUCKET', 'knowledge-hub');
    this.publicBaseUrl = (this.config.get<string>('RUSTFS_PUBLIC_URL') || endpoint).replace(
      /\/$/,
      '',
    );

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

  isEnabled(): boolean {
    return this.enabled && this.client != null;
  }

  /** 上传字节，返回可访问 URL：{publicBase}/{bucket}/{key} */
  async uploadBytes(bytes: Buffer | Uint8Array, options: UploadBytesOptions): Promise<string> {
    if (!this.isEnabled() || !this.client) {
      throw new ServiceUnavailableException('RustFS 未启用或未配置，无法上传文件');
    }

    await this.ensureBucket();

    const prefix = (options.prefix ?? 'documents').replace(/^\/+|\/+$/g, '');
    const ext = extname(options.fileName) || guessExt(options.contentType);
    const safeBase = sanitizeBaseName(options.fileName);
    const key = `${prefix}/${formatDatePath()}/${safeBase}-${randomUUID()}${ext}`;
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
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      return;
    } catch {
      // bucket 不存在则创建
    }

    try {
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
}

function formatDatePath(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}/${m}/${day}`;
}

function sanitizeBaseName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '') || 'file';
  return base.replace(/[^\w\u4e00-\u9fff.-]+/g, '_').slice(0, 64);
}

function guessExt(contentType: string): string {
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
