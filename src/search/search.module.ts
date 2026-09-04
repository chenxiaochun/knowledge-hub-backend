import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { SearchController } from './search.controller';

@Module({
  imports: [PipelineModule],
  controllers: [SearchController],
})
export class SearchModule {}
