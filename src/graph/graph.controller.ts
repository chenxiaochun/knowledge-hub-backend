import { Controller, Get, Query } from '@nestjs/common';

import { GraphNodeHitDto } from './dto/graph-node-hit.dto';
import { GraphOverviewDto, GraphSearchQueryDto } from './dto/graph-search-query.dto';
import { GraphSubgraphResultDto } from './dto/graph-sub-search.dto';
import { GraphBuildService } from './graph-build.service';

@Controller('graph')
export class GraphController {
  constructor(private readonly graph: GraphBuildService) {}

  @Get('search')
  search(@Query() query: GraphSearchQueryDto): Promise<GraphNodeHitDto[]> {
    return this.graph.searchGraph(query.keyword, query.limit ?? 50);
  }

  @Get('search/subgraph')
  searchSubgraph(@Query() query: GraphSearchQueryDto): Promise<GraphSubgraphResultDto> {
    return this.graph.searchGraphSubgraph(query.keyword, query.limit ?? 50);
  }

  /** 全景：文档 / 实体 / 标签 + 统计，供前端力导向图 */
  @Get('overview')
  overview(@Query() query: GraphOverviewDto) {
    return this.graph.getOverview({
      keyword: query.keyword,
      entityType: query.entityType,
      from: query.from,
      to: query.to,
      docLimit: query.docLimit,
    });
  }
}
