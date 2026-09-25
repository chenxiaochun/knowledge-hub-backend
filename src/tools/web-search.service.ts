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
    this.tool = tool(this.search, {
      name: 'web_search',
      description: '搜索互联网上的信息',
      schema: z.object({
        query: z.string().describe('搜索关键词'),
        count: z.number().describe('搜索结果数量').optional(),
      }),
    });
  }

  async search({ query, count = 5 }: { query: string; count?: number }): Promise<WebSearchResult> {
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
