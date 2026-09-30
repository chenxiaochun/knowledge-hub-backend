import { Module } from '@nestjs/common';
import { AiCanvasService } from './ai-canvas.service';
import { AiCanvasController } from './ai-canvas.controller';

@Module({
  controllers: [AiCanvasController],
  providers: [AiCanvasService],
})
export class AiCanvasModule {}
