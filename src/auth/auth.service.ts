import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { UserService } from '../user/user.service';
import { AuthUser } from './auth-user.interface';
import { LoginDto, RegisterDto, ResetPasswordDto, SendResetCodeDto } from './dto/auth.dto';
import { EmailActivationService } from './email-activation.service';
import { EmailService } from './email.service';
import { PasswordResetService } from './password-reset.service';

interface TokenPayload {
  sub: string;
  username: string;
  type: 'access' | 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly emailActivation: EmailActivationService,
    private readonly emailService: EmailService,
    private readonly passwordReset: PasswordResetService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  private accessExpires(): string {
    return this.config.get('JWT_ACCESS_EXPIRES', '2h');
  }

  private refreshExpires(): string {
    return this.config.get('JWT_REFRESH_EXPIRES', '7d');
  }

  /**
   * 把 JWT_ACCESS_EXPIRES（如 `2h` / `30m`）解析成秒数。
   * 登录响应里通常要返回 `expiresIn`（数字秒），方便前端倒计时刷新；
   * 而签发 token 时 JwtService 用的是字符串形式，所以单独做一次换算。
   * 格式无法解析时回退为 7200（2 小时）。
   */
  private accessExpiresSeconds(): number {
    const raw = this.accessExpires();
    const m = /^(\d+)([smhd])$/.exec(raw);
    if (!m) return 7200;
    const n = Number(m[1]);
    const u = m[2];
    if (u === 's') return n;
    if (u === 'm') return n * 60;
    if (u === 'h') return n * 3600;
    return n * 86400;
  }

  private requireEmailVerification(): boolean {
    return this.config.get<string>('REQUIRE_EMAIL_VERIFICATION', 'false') === 'true';
  }

  /**
   * 为指定用户签发 JWT。
   * - access：短有效期，带在 Authorization 头访问业务接口
   * - refresh：长有效期，仅用于换发新的 access（不能当业务凭证）
   * payload 里的 `type` 供 JwtStrategy 区分两种 token，避免 refresh 被误用。
   */
  private sign(user: AuthUser, type: 'access' | 'refresh'): string {
    const payload: TokenPayload = {
      sub: user.userId,
      username: user.username,
      type,
    };
    const expiresIn = type === 'access' ? this.accessExpires() : this.refreshExpires();
    return this.jwtService.sign(payload, {
      expiresIn: expiresIn as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
  }

  private buildLoginResult(user: AuthUser) {
    return {
      accessToken: this.sign(user, 'access'),
      refreshToken: this.sign(user, 'refresh'),
      tokenType: 'Bearer',
      expiresIn: this.accessExpiresSeconds(),
      userInfo: user,
    };
  }

  login(dto: LoginDto) {
    return this.userService.validateCredentials(dto.username, dto.password).then((user) => {
      if (!user) {
        throw new UnauthorizedException('用户名或密码错误');
      }
      return this.buildLoginResult(user);
    });
  }

  async register(dto: RegisterDto) {
    const result = await this.userService.register({
      ...dto,
      requireEmailVerification: this.requireEmailVerification(),
    });
    if (result.emailVerificationRequired && dto.email) {
      const token = await this.emailActivation.createToken(result.userId);
      try {
        await this.emailService.sendActivationEmail(dto.email, dto.username, token);
      } catch {
        await this.emailActivation.deleteByToken(token);
        throw new BadRequestException('激活邮件发送失败，请稍后再试');
      }
      return {
        userId: result.userId,
        message: '注册成功，请查收邮件激活账户',
        emailVerificationRequired: true,
      };
    }

    return {
      userId: result.userId,
      message: '注册成功，请登录',
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<TokenPayload>(refreshToken);
      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('无效的 refresh token');
      }
      const user = await this.userService.buildAuthUser(payload.sub);
      return this.buildLoginResult(user);
    } catch {
      throw new UnauthorizedException('refresh token 无效或已过期');
    }
  }

  async getMe(userId: string) {
    return this.userService.getUserVO(userId);
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const userId = await this.emailActivation.consumeToken(token);
    if (!userId) {
      throw new BadRequestException('激活链接无效或已过期');
    }
    const message = await this.userService.activateEmail(userId);
    return { message };
  }

  async sendResetCode(dto: SendResetCodeDto) {
    const left = await this.passwordReset.cooldownLeftMs(dto.email);
    if (left > 0) {
      throw new BadRequestException(`发送过于频繁，请 ${Math.ceil(left / 1000)} 秒后再试`);
    }
    const user = await this.userService.findByEmail(dto.email);
    // 用户不存在也返回成功文案，避免枚举邮箱
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.passwordReset.set(dto.email, code);
    if (user) {
      await this.emailService.sendResetCodeEmail(dto.email, user.username, code);
    }
    return { message: '若邮箱已注册，验证码已发送' };
  }

  async resetPasswordByEmail(dto: ResetPasswordDto) {
    const ok = await this.passwordReset.verify(dto.email, dto.code);
    if (!ok) throw new BadRequestException('验证码错误或已过期');
    await this.userService.resetPasswordByEmail(dto.email, dto.newPassword);
    await this.passwordReset.delete(dto.email);
    return { message: '密码已重置' };
  }
}
