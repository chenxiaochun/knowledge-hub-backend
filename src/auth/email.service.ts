import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transport!: string;
  private publicUrl!: string;
  private from!: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailerService: MailerService,
  ) {
    this.transport = this.configService.get('MAIL_TRANSPORT') || 'log';
    this.publicUrl = this.configService.get('APP_PUBLIC_URL') || 'http://localhost:3000';
    this.from = this.configService.get('MAIL_FROM') || 'Knowledge Hub <noreply@example.com>';
  }

  async sendActivationEmail(email: string, username: string, token: string): Promise<void> {
    const link = `${this.publicUrl}/auth/verify-email?token=${token}`;
    const subject = '激活您的知识库账户';
    const text = `您好 ${username}，请点击链接激活（24h 内有效）：\n${link}`;
    const html = `
      <p>您好 <strong>${username}</strong>，</p>
      <p>请点击链接激活（24h 内有效）：</p>
      <p><a href="${link}">${link}</a></p>
    `;
    await this.dispatch(email, subject, text, html);
  }

  async sendResetCodeEmail(email: string, username: string, code: string): Promise<void> {
    const subject = '密码重置验证码';
    const text = `您好 ${username}，验证码：${code}，10 分钟内有效。`;
    const html = `<p>验证码：<b style="font-size:24px">${code}</b></p>`;
    await this.dispatch(email, subject, text, html);
  }

  private async dispatch(to: string, subject: string, text: string, html: string) {
    if (this.transport === 'smtp' && this.mailerService) {
      await this.mailerService.sendMail({ to, from: this.from, subject, text, html });
      return;
    }
    this.logger.log(`[mail:log] to=${to} subject=${subject}\n${text}`);
  }
}
