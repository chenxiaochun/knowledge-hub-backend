import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/* 为什么要继承 OnModuleInit？
 * 1. 方便在模块初始化时创建上传目录
 */
@Injectable()
export class LocalStorageService implements OnModuleInit {
  private readonly logger = new Logger(LocalStorageService.name);
  private rootDir = 'uploads';

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    this.rootDir = this.config.get<string>('UPLOAD_DIR', 'uploads');
    await mkdir(join(this.rootDir, 'documents'), { recursive: true });
    this.logger.log(`本地上传目录: ${this.rootDir}`);
  }

  /** 返回可存进 DB 的相对路径，如 documents/uuid-name.md */
  async saveDocument(buffer: Buffer, originalName: string): Promise<string> {
    /**
     * 为什么要替换特殊字符？
     * 1. 避免路径中的特殊字符导致文件无法访问
     */
    const safe = originalName.replace(/[/\\?%*:|"<>]/g, '_');

    // 为什么使用随机 UUID？
    // 1. 避免文件名冲突
    const key = `documents/${randomUUID()}-${safe}`;

    // 为什么使用 join？
    // 1. 避免路径中的特殊字符导致文件无法访问
    const full = join(this.rootDir, key);
    await writeFile(full, buffer);
    return key;
  }
}
