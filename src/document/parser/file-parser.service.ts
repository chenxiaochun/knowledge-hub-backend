import { BadRequestException, Injectable } from '@nestjs/common';
import { extname } from 'path';

const SUPPORTED = new Set(['txt', 'md']);

export interface ParseInput {
  originalname: string;
  buffer: Buffer;
}

@Injectable()
export class FileParserService {
  getExtension(filename: string): string {
    return extname(filename).replace(/^\./, '').toLowerCase();
  }

  isSupported(ext: string): boolean {
    return SUPPORTED.has(ext);
  }

  supportedList(): string {
    return [...SUPPORTED].join(', ');
  }

  async parse(file: ParseInput): Promise<string> {
    const ext = this.getExtension(file.originalname);
    if (!this.isSupported(ext)) {
      throw new BadRequestException(
        `不支持的文件格式: ${ext || '(无扩展名)'}，本课支持: ${this.supportedList()}`,
      );
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('文件内容为空');
    }
    return file.buffer.toString('utf8');
  }
}
