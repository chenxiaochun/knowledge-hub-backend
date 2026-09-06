import { Controller, Get, Query } from '@nestjs/common';
import { SearchIndexService } from '../pipeline/search-index.service';
import { SearchDocumentsDto } from './dto/search.dto';
import { SemanticSearchDto } from './dto/semantic-search.dto';
import { RagService } from 'src/pipeline/rag.service';

@Controller('search')
export class SearchController {
  constructor(
    private readonly searchIndex: SearchIndexService,
    private readonly ragService: RagService,
  ) {}

  @Get()
  search(@Query() params: SearchDocumentsDto) {
    return this.searchIndex.searchDocuments({
      keyword: params.keyword,
      page: params.page || 1,
      pageSize: params.pageSize || 10,
    });
  }

  @Get('semantic')
  semanticSearch(@Query() params: SemanticSearchDto) {
    return this.ragService.semanticSearch(params.query, params.topK ?? 5);
  }
}
