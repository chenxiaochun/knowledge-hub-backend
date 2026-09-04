import { Controller, Get, Query } from '@nestjs/common';
import { SearchIndexService } from '../pipeline/search-index.service';
import { SearchDocumentsDto } from './dto/search.dto';

@Controller('search')
export class SearchController {
  constructor(private readonly searchIndex: SearchIndexService) {}

  @Get()
  search(@Query() params: SearchDocumentsDto) {
    return this.searchIndex.searchDocuments({
      keyword: params.keyword,
      page: params.page || 1,
      pageSize: params.pageSize || 10,
    });
  }
}
