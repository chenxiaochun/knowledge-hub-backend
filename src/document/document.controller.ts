import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  Body,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth-user.interface';
import { DocumentService } from './document.service';
import { QueryDocumentDto } from './dto/query-document.dto';
import { UploadParseDto } from './dto/upload-parse.dto';

@Controller('document')
export class DocumentController {
  constructor(private readonly documentService: DocumentService) {}

  @Post('upload/parse')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  uploadAndParse(
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: UploadParseDto,
    @CurrentUser() user: AuthUser,
  ) {
    if (!file) {
      throw new BadRequestException('请上传文件（form-data 字段名: file）');
    }
    return this.documentService.uploadAndCreateDocument(file, meta, user);
  }

  /** 列表须在 :id 之前 */
  @Get()
  page(@Query() query: QueryDocumentDto) {
    return this.documentService.pageDocuments(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.documentService.getDetail(id);
  }
}
