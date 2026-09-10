import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { RustfsService } from '../../storage/rustfs.service';
import { parseDocx } from './parsers/docx.parser';
import { parsePdf } from './parsers/pdf.parser';
import { parsePlainText } from './parsers/plain-text.parser';
import { parsePptx } from './parsers/pptx.parser';
import { parseXlsx } from './parsers/xlsx.parser';
import { getExtension } from './utils/markdown.util';

const SUPPORTED = new Set(['txt', 'md', 'docx', 'pdf', 'pptx', 'xlsx']);

export interface ParseInput {
  originalname: string;
  buffer: Buffer;
  size: number;
}

@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  constructor(private readonly rustfsService: RustfsService) {}

  getExtension(filename: string): string {
    return getExtension(filename).replace(/^\./, '').toLowerCase();
  }

  isSupported(ext: string): boolean {
    return SUPPORTED.has(ext);
  }

  supportedList(): string {
    return [...SUPPORTED].join(',');
  }

  async parse(file: ParseInput): Promise<string> {
    const extension = this.getExtension(file.originalname);
    if (!this.isSupported(extension)) {
      throw new BadRequestException(
        `不支持的文件格式: ${extension || '(无扩展名)'}，本课支持: ${this.supportedList()}`,
      );
    }
    if (!file.buffer?.length) {
      throw new BadRequestException('文件内容为空');
    }
    const start = Date.now();
    let result: string;

    switch (extension) {
      case 'docx':
        result = await parseDocx(file.buffer);
        break;
      case 'pdf':
        result = await parsePdf(file.buffer, {
          uploadImage: (bytes, fileName, contentType) =>
            this.rustfsService.uploadBytes(bytes, {
              fileName,
              contentType,
              prefix: 'pdf-images',
            }),
        });
        break;
      case 'pptx':
        result = await parsePptx(file.buffer);
        break;
      case 'xlsx':
        result = await this.parseXlsxWithFallback(file.buffer);
        break;
      case 'txt':
      case 'md':
        result = parsePlainText(file.buffer);
        break;
      default:
        throw new BadRequestException(`不支持的文件格式: ${extension}`);
    }

    this.logger.log(
      `文件解析完成: name=${file.originalname}, format=${extension}, chars=${result.length}, elapsed=${Date.now() - start}ms`,
    );
    if (!result?.trim()) {
      throw new BadRequestException('文件解析结果为空，请确认文件包含可提取的文本内容');
    }
    return result;
  }

  private async parseXlsxWithFallback(buffer: Buffer): Promise<string> {
    try {
      return await parseXlsx(buffer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`XLSX(exceljs) 失败，降级 officeparser: ${message}`);
      const { parseOffice } = await import('officeparser');
      const ast = await parseOffice(buffer, { fileType: 'xlsx' });
      const { value } = await ast.to('md');
      return value ?? '';
    }
  }
}
