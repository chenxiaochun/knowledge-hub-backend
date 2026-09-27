import { Module } from '@nestjs/common';

import { AsrClientService } from './asr-client.service';
import { SpeechController } from './speech.controller';
import { SpeechService } from './speech.service';

@Module({
  controllers: [SpeechController],
  providers: [SpeechService, AsrClientService],
})
export class SpeechModule {}
