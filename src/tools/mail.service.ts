import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MailerService } from '@nestjs-modules/mailer';
import { tool } from 'langchain/tools';
import z from 'zod';

export type SendMailParams = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

/** 通用发信：只接收收件人、主题与正文，不含业务模板 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transport: string;
  private readonly from: string;
  public tool;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
  ) {
    this.transport = this.configService.get('MAIL_TRANSPORT') || 'log';
    this.from = this.configService.get('MAIL_FROM') || 'Knowledge Hub <noreply@example.com>';
    this.tool = tool(async (input: SendMailParams) => this.send(input), {
      name: 'mail',
      description: '发送邮件',
      schema: z.object({
        to: z.string().email().describe('收件人邮箱'),
        subject: z.string().describe('主题'),
        html: z.string().optional().describe('HTML 正文'),
      }),
    });
  }

  async send(params: SendMailParams): Promise<void> {
    this.logger.log(`发送邮件：to=${params.to} subject=${params.subject}`);
    await this.mailerService.sendMail({ ...params, from: this.from });
    this.logger.log(`邮件已提交 SMTP：to=${params.to}`);
  }
}
