import { BadRequestException } from '@nestjs/common';

import { HumanMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

const IMAGE_PROMPT =
  '你是文档数字化助手。请识别图片中的全部可见文字与表格结构，输出为 Markdown。' +
  '保留标题层级、列表；表格用 Markdown 表格。' +
  '若几乎没有文字，用一两句话客观描述图片内容。不要编造。';

export type ParseImageOptions = {
  buffer: Buffer;
  contentType: string;
  llm: ChatOpenAI;
};

export async function parseImage(options: ParseImageOptions): Promise<string> {
  const { buffer, contentType, llm } = options;

  const mime = contentType.startsWith('image/') ? contentType : sniffImageContentType(buffer);
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;

  let response;
  try {
    response = await llm.invoke([
      new HumanMessage({
        content: [
          { type: 'text', text: IMAGE_PROMPT },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      }),
    ]);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new BadRequestException(`图片解析失败：${detail}`);
  }

  const text =
    typeof response.content === 'string'
      ? response.content
      : Array.isArray(response.content)
        ? response.content
            .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
            .map((part) => part.text)
            .join('\n')
        : String(response.content);

  return text.trim();
}

function sniffImageContentType(data: Buffer): string {
  const bytes = data;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  return 'image/png';
}

export function imageContentTypeFromExtension(ext: string): string {
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}
