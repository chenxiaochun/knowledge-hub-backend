/**
 * 将 TXT / MD 解析为文本。
 *
 * 不做结构转换：按 UTF-8 原样读出，后续由调用方直接当作 Markdown/纯文本使用。
 */
export function parsePlainText(buffer: Buffer): string {
  return buffer.toString('utf8');
}
