import { Module } from '@nestjs/common';

import { ToolsModule } from '../tools/tools.module';
import { SpeechController } from './speech.controller';
import { SpeechService } from './speech.service';

@Module({
  imports: [ToolsModule],
  controllers: [SpeechController],
  providers: [SpeechService],
})
export class SpeechModule {}
