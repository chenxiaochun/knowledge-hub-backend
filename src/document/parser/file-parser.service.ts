import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RustfsService } from '../../storage/rustfs.service';
import { parseDocx } from './parsers/docx.parser';
import { parsePdf } from './parsers/pdf.parser';
import { parsePlainText } from './parsers/plain-text.parser';
import { parsePptx } from './parsers/pptx.parser';
import { parseXlsx } from './parsers/xlsx.parser';
import { getExtension } from './utils/markdown.util';

/** 支持解析的文件扩展名 */
const SUPPORTED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'md']);

export interface ParseInput {
  originalname: string;
  buffer: Buffer;
  size?: number;
}

/**
 * 文件 → Markdown 解析服务。
 *
 * 按扩展名分发到各 parser；PDF 在对象存储可用时注入图片上传回调。
 * 解析结果为空或格式不支持时抛 BadRequestException。
 */
@Injectable()
export class FileParserService {
  private readonly logger = new Logger(FileParserService.name);

  constructor(private readonly rustfs: RustfsService) {}

  /** 是否为已支持的扩展名（大小写不敏感） */
  isSupported(extension: string): boolean {
    return SUPPORTED_EXTENSIONS.has(extension?.toLowerCase());
  }

  /** 逗号分隔的支持格式列表，用于错误提示 */
  supportedList(): string {
    return [...SUPPORTED_EXTENSIONS].join(', ');
  }

  /**
   * 将上传文件解析为 Markdown 字符串。
   *
   * - pdf：可选提取图片并上传到 rustfs（`pdf-images/` 前缀）
   * - xlsx：exceljs 优先，失败降级 officeparser（见 parseXlsxWithFallback）
   * - pptx / docx / txt / md：直接调用对应 parser
   */
  async parse(file: ParseInput): Promise<string> {
    const extension = getExtension(file.originalname);

    if (!this.isSupported(extension)) {
      throw new BadRequestException(
        `不支持的文件格式: ${extension || '(无扩展名)'}，支持的格式: ${this.supportedList()}`,
      );
    }

    if (!file.buffer?.length) {
      throw new BadRequestException('文件内容为空，无法解析');
    }

    const start = Date.now();
    let result: string;

    switch (extension) {
      case 'docx':
        result = await parseDocx(file.buffer);
        break;
      case 'pdf':
        result = await parsePdf(file.buffer, {
          // 存储未启用时不传 uploadImage，PDF 仅输出文本/表格
          uploadImage: this.rustfs.isEnabled()
            ? (bytes, fileName, contentType) =>
                this.rustfs.uploadBytes(bytes, {
                  fileName,
                  contentType,
                  prefix: 'pdf-images',
                })
            : undefined,
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

    const elapsed = Date.now() - start;
    this.logger.log(
      `文件解析完成: name=${file.originalname}, format=${extension}, chars=${result.length}, elapsed=${elapsed}ms`,
    );

    if (!result?.trim()) {
      throw new BadRequestException('文件解析结果为空，请确认文件包含可提取的文本内容');
    }

    return result;
  }

  /**
   * XLSX：exceljs 优先（结构化表格 Markdown）；
   * 失败时降级 officeparser AST → md，保证兼容异常/损坏文件。
   */
  private async parseXlsxWithFallback(buffer: Buffer): Promise<string> {
    try {
      const start = Date.now();
      const result = await parseXlsx(buffer);
      this.logger.log(
        `XLSX(exceljs) 解析成功: chars=${result.length}, elapsed=${Date.now() - start}ms`,
      );
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`XLSX(exceljs) 解析失败，降级 officeparser: ${message}`);
      const { parseOffice } = await import('officeparser');
      const ast = await parseOffice(buffer, { fileType: 'xlsx' });
      const { value } = await ast.to('md');
      return value ?? '';
    }
  }
}
