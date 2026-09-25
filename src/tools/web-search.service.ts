import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { tool } from '@langchain/core/tools';
import { z } from 'zod';

export interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
}

export interface WebSearchResult {
  query: string;
  items: WebSearchHit[];
  error?: string;
}

/** Bocha Web Search */
@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  public tool;

  constructor(private readonly config: ConfigService) {
    // 必须用箭头函数包一层：tool(this.search) 会丢 this，调用时 this.config 为 undefined
    this.tool = tool(async (input: { query: string; count?: number }) => this.search(input), {
      name: 'web_search',
      description:
        '联网搜索（Bocha）。知识库不足、需要最新公开信息（如天气、新闻）或外部资料时再调用。' +
        '不要用它替代知识库已有内容。',
      schema: z.object({
        query: z.string().min(1).describe('搜索关键词'),
        count: z.number().int().min(1).max(10).optional().describe('条数，默认 5'),
      }),
    });
  }

  async search({ query, count = 5 }: { query: string; count?: number }): Promise<WebSearchResult> {
    this.logger.log(`web_search 被调用：query=${query}, count=${count}`);

    const apiKey = this.config.get<string>('BOCHA_API_KEY');
    if (!apiKey) {
      return {
        query,
        items: [],
        error: '未配置 BOCHA_API_KEY，无法联网搜索',
      };
    }

    const response = await fetch(
      this.config.get<string>('BOCHA_API_URL') ?? 'https://api.bochaai.com/v1/web-search',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          freshness: 'noLimit',
          summary: true,
          count: Math.min(Math.max(count, 1), 10),
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text();
      this.logger.warn(`Bocha 搜索失败：status=${response.status}`);
      return {
        query,
        items: [],
        error: `搜索失败（${response.status}）${detail.slice(0, 120)}`,
      };
    }

    const json = (await response.json()) as {
      code?: number;
      msg?: string;
      data?: {
        webPages?: {
          value?: Array<{
            name?: string;
            url?: string;
            summary?: string;
            snippet?: string;
            siteName?: string;
          }>;
        };
      };
    };

    if (json.code !== 200 || !json.data) {
      return {
        query,
        items: [],
        error: json.msg ?? '搜索接口返回异常',
      };
    }

    const items = (json.data.webPages?.value ?? [])
      .filter((page) => page.url && page.name)
      .map((page) => ({
        title: page.name as string,
        url: page.url as string,
        snippet: (page.summary || page.snippet || '').trim(),
        siteName: page.siteName,
      }));

    return { query, items };
  }
}
