import { Logger } from '@nestjs/common';

import { PDFParse } from 'pdf-parse';

import { cleanMarkdown, toMarkdownTable } from '../utils/markdown.util';

const logger = new Logger('PdfParser');

/**
 * 图片上传回调：解析过程中抽出的图片字节，经此函数上传后返回可访问 URL。
 * 由调用方注入（例如上传到对象存储），本模块不关心具体存储实现。
 */
export type ImageUploader = (
  bytes: Buffer,
  fileName: string,
  contentType: string,
) => Promise<string>;

export interface ParsePdfOptions {
  /**
   * 若提供，则从 PDF 中提取图片、上传，并按页以 Markdown 图片语法写入结果。
   * 未提供时仅输出文本（及可选的表格附录）。
   */
  uploadImage?: ImageUploader;
  /**
   * 跳过宽或高小于该像素阈值的图片（多为装饰图标/噪点），默认 50。
   * 会同时传给 pdf-parse 的 imageThreshold，并在本地再过滤一次。
   */
  imageThreshold?: number;
}

/**
 * 将 PDF 解析为 Markdown。
 *
 * 整体流程：
 * 1. 按页提取文本；
 * 2. 若提供 uploadImage，则按页提取图片 → 上传 → 记下 URL；
 * 3. 按页拼装：先文本，再该页图片的 `![](url)`；
 * 4. 尝试提取表格；若正文里尚无 Markdown 表格，则追加到文末「检测到的表格」章节；
 * 5. 无论成败，在 finally 中销毁 parser，释放底层资源。
 *
 * 图片提取失败不会中断解析，会降级为仅文本；单张图片上传失败则跳过该张。
 */
export async function parsePdf(buffer: Buffer, options: ParsePdfOptions = {}): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  const threshold = options.imageThreshold ?? 50;

  try {
    // ---------- 1. 文本：按页取出 ----------
    const textResult = await parser.getText();
    const pageTexts = textResult?.pages ?? [];
    /** pageNumber → 该页已上传图片的 URL 列表（保持提取顺序） */
    const pageImageUrls = new Map<number, string[]>();

    // ---------- 2. 图片（可选）：提取 → 过滤小图 → 上传 ----------
    if (options.uploadImage) {
      try {
        const imageResult = await parser.getImage({
          imageThreshold: threshold,
          // 只要原始字节，不要 data URL，便于直接上传
          imageBuffer: true,
          imageDataUrl: false,
        });

        for (const page of imageResult?.pages ?? []) {
          const urls: string[] = [];
          let imgIdx = 0;
          for (const image of page.images ?? []) {
            // 二次过滤：pdf-parse 已按阈值筛过，这里再挡一遍异常尺寸
            if (
              (image.width > 0 && image.width < threshold) ||
              (image.height > 0 && image.height < threshold)
            ) {
              continue;
            }
            if (!image.data?.length) continue;

            // 根据文件头嗅探 MIME，决定扩展名（webp 也按 png 扩展名上传，contentType 仍为真实类型）
            const contentType = sniffImageContentType(image.data);
            const ext = contentType === 'image/jpeg' ? 'jpg' : 'png';
            const fileName = `pdf_img_p${page.pageNumber}_${imgIdx++}.${ext}`;
            try {
              const url = await options.uploadImage(Buffer.from(image.data), fileName, contentType);
              urls.push(url);
            } catch (err) {
              // 单张失败不影响同页其他图片与整份文档
              logger.warn(
                `PDF 图片上传失败: page=${page.pageNumber}, name=${image.name}, err=${err instanceof Error ? err.message : err}`,
              );
            }
          }
          if (urls.length) {
            pageImageUrls.set(page.pageNumber, urls);
          }
        }

        if (pageImageUrls.size > 0) {
          logger.log(
            `PDF 图片提取完成: ${[...pageImageUrls.values()].reduce((n, a) => n + a.length, 0)} 张`,
          );
        }
      } catch (err) {
        // 整批图片提取失败：降级为纯文本，不抛错
        logger.warn(`PDF 图片提取失败，继续仅文本: ${err instanceof Error ? err.message : err}`);
      }
    }

    // ---------- 3. 按页拼装 Markdown ----------
    // 有分页文本时：每页「文本 + 该页图片」，页与页之间空行分隔
    // 无分页信息时：退回全文 text，图片统一追加在后
    const parts: string[] = [];
    if (pageTexts.length > 0) {
      for (const page of pageTexts) {
        const text = (page.text ?? '').trim();
        if (text) parts.push(text);

        // page.num 与图片侧的 pageNumber 对应同一页码
        const urls = pageImageUrls.get(page.num) ?? [];
        for (const url of urls) {
          parts.push(`![](${url})`);
        }
        // 该页有内容时末尾加空串，join 后形成段落间距
        if (text || urls.length) parts.push('');
      }
    } else {
      const fallback = (textResult?.text ?? '').trim();
      if (fallback) parts.push(fallback);
      for (const urls of pageImageUrls.values()) {
        for (const url of urls) parts.push(`![](${url})`);
      }
    }

    let markdown = cleanMarkdown(parts.join('\n\n'));

    // ---------- 4. 表格（尽力而为）----------
    // 仅当正文中尚未出现 Markdown 表头分隔行（| ---）时才追加，避免与正文重复
    try {
      const tableResult = await parser.getTable();
      const pages = tableResult?.pages ?? [];
      if (pages.length > 0 && !markdown.includes('| ---')) {
        const tableParts: string[] = [];
        let tableIdx = 0;
        for (const page of pages) {
          for (const table of page.tables ?? []) {
            // pdf-parse 返回结构不固定，先归一成 string[][]
            const rows = normalizePdfTable(table);
            if (rows.length > 0) {
              tableIdx += 1;
              tableParts.push(`### 表格 ${tableIdx}\n\n${toMarkdownTable(rows)}`);
            }
          }
        }
        if (tableParts.length > 0) {
          markdown = cleanMarkdown(`${markdown}\n\n## 检测到的表格\n\n${tableParts.join('\n')}`);
        }
      }
    } catch {
      // 表格提取失败不影响主结果
    }

    return markdown;
  } finally {
    // 释放 pdf-parse / wasm 等底层资源，避免泄漏
    await parser.destroy();
  }
}

/**
 * 通过魔数（文件头字节）判断图片 MIME。
 * 识别失败时默认 image/png，保证上传侧总能拿到一个 contentType。
 */
function sniffImageContentType(data: Uint8Array): string {
  // JPEG: FF D8 FF
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47（即 \x89PNG）
  if (
    data.length >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47
  ) {
    return 'image/png';
  }
  // WebP: 以 RIFF 开头（完整格式还含 WEBP，这里只做粗判）
  if (
    data.length >= 4 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46
  ) {
    return 'image/webp';
  }
  return 'image/png';
}

/**
 * 将 pdf-parse getTable() 返回的多种可能结构，统一成二维字符串数组。
 *
 * 兼容形态：
 * - string[][]：已是行列结构；
 * - 嵌套数组：逐项递归再扁平合并；
 * - { rows } / { data }：取字段后继续递归。
 * 无法识别时返回空数组。
 */
function normalizePdfTable(raw: unknown): string[][] {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    // 首元素仍是数组 → 视为「行 → 单元格」
    if (Array.isArray(raw[0])) {
      return (raw as unknown[][]).map((row) => row.map((cell) => String(cell ?? '').trim()));
    }
    // 否则当作「多个表/多块」拼接
    const merged: string[][] = [];
    for (const item of raw) {
      merged.push(...normalizePdfTable(item));
    }
    return merged;
  }

  if (typeof raw === 'object' && raw !== null) {
    const obj = raw as { rows?: unknown; data?: unknown };
    if (obj.rows) return normalizePdfTable(obj.rows);
    if (obj.data) return normalizePdfTable(obj.data);
  }

  return [];
}
