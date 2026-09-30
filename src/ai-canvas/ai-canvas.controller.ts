import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';

import { AiCanvasService } from './ai-canvas.service';
import { CreateAiCanvaDto } from './dto/create-ai-canva.dto';
import { UpdateAiCanvaDto } from './dto/update-ai-canva.dto';

@Controller('ai-canvas')
export class AiCanvasController {
  constructor(private readonly aiCanvasService: AiCanvasService) {}
}
