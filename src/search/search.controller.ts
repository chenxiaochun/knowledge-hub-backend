import { Controller, Get, Query } from '@nestjs/common';

import { RagService } from 'src/pipeline/rag.service';
import { SearchIndexService } from '../pipeline/search-index.service';
import { SearchDocumentsDto } from './dto/search.dto';
import { SearchDocumentsResultDto } from './dto/search-result.dto';
import { SemanticSearchHitDto } from './dto/semantic-hit.dto';
import { SemanticSearchDto } from './dto/semantic-search.dto';

@Controller('search')
export class SearchController {
  constructor(
    private readonly searchIndex: SearchIndexService,
    private readonly ragService: RagService,
  ) {}

  @Get()
  search(@Query() params: SearchDocumentsDto): Promise<SearchDocumentsResultDto> {
    return this.searchIndex.searchDocuments({
      keyword: params.keyword,
      page: params.page || 1,
      pageSize: params.pageSize || 10,
    });
  }

  @Get('semantic')
  semanticSearch(@Query() params: SemanticSearchDto): Promise<SemanticSearchHitDto[]> {
    return this.ragService.semanticSearch(params.query, params.topK ?? 5);
  }
}
