import { Controller, Get, Query } from '@nestjs/common';
import { GraphBuildService } from './graph-build.service';

// graph.controller.ts
@Controller('graph')
export class GraphController {
  constructor(private readonly graph: GraphBuildService) {}

  @Get('search')
  search(@Query('keyword') keyword: string, @Query('limit') limit?: string) {
    return this.graph.searchGraph(keyword, limit ? Number(limit) : 50);
  }
}
