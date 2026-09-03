import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../user/user.service';
import { AuthUser } from './auth-user.interface';
import { LoginDto, RegisterDto } from './dto/auth.dto';

interface TokenPayload {
  sub: string;
  username: string;
  type: 'access' | 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
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
    return await this.userService.register(dto);
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
}
