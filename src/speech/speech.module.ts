import { Module } from '@nestjs/common';

import { ToolsModule } from '../tools/tools.module';
import { SpeechController } from './speech.controller';
import { SpeechService } from './speech.service';
import { TtsRelayService } from './tts-relay.service';
import { TtsStreamPublisher } from './tts-stream.publisher';
import { TtsOneShotService } from './tts-one-shot.service';
import { TtsWebSocketService } from './tts-websocket.service';

@Module({
  imports: [ToolsModule],
  controllers: [SpeechController],
  providers: [
    SpeechService,
    TtsRelayService,
    TtsStreamPublisher,
    TtsOneShotService,
    TtsWebSocketService,
  ],
  exports: [TtsRelayService, TtsStreamPublisher],
})
export class SpeechModule {}
