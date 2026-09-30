import { PartialType } from '@nestjs/swagger';
import { CreateAiCanvaDto } from './create-ai-canva.dto';

export class UpdateAiCanvaDto extends PartialType(CreateAiCanvaDto) {}
