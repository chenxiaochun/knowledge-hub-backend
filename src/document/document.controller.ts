import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import { Roles } from 'src/auth/decorators/roles.decorator';
import { RoleCode } from 'src/common/constant/roles';

import type { AuthUser } from '../auth/auth-user.interface';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DocumentReviewService } from './document-review.service';
import { DocumentService } from './document.service';
import { QueryDocumentDto } from './dto/query-document.dto';
import { UpdateDocumentDto } from './dto/update-document.dto';
import { UploadParseDto } from './dto/upload-parse.dto';

@Controller('document')
export class DocumentController {
  constructor(
    private readonly documentService: DocumentService,
    private readonly reviewService: DocumentReviewService,
  ) {}

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

  /** 静态路径须在 :id 之前 */
  @Get()
  page(@Query() query: QueryDocumentDto) {
    return this.documentService.pageDocuments(query);
  }

  @Get('reviews/pending')
  @Roles(RoleCode.ADMIN, RoleCode.REVIEWER)
  listPending() {
    return this.reviewService.listPending();
  }

  @Put('reviews/:reviewId/approve')
  @Roles(RoleCode.ADMIN, RoleCode.REVIEWER)
  approve(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { comment?: string },
  ) {
    return this.reviewService.approveReview(reviewId, user, body?.comment ?? '');
  }

  @Put('reviews/:reviewId/reject')
  @Roles(RoleCode.ADMIN, RoleCode.REVIEWER)
  reject(
    @Param('reviewId') reviewId: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { comment: string },
  ) {
    return this.reviewService.rejectReview(reviewId, user, body.comment);
  }

  @Put(':id/submit-review')
  submitReview(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reviewService.submitForReview(id, user);
  }

  @Put(':id/archive')
  @Roles(RoleCode.ADMIN)
  archive(@Param('id') id: string) {
    return this.documentService.archive(id);
  }

  @Put(':id/save-as-draft')
  saveAsDraft(@Param('id') id: string) {
    return this.documentService.saveAsDraft(id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDocumentDto) {
    return this.documentService.updateDocument(id, dto);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.documentService.getDetail(id);
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.documentService.remove(id, user);
  }
}
