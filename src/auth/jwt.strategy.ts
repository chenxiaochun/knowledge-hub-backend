import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UserService } from '../user/user.service';

/** access token 解码后的载荷结构（签发 JWT 时写入的字段） */
interface JwtPayload {
  sub: string; // 用户 ID
  username: string;
  type: 'access' | 'refresh'; // 区分 access / refresh，避免混用
}

/**
 * Passport JWT 策略：拦截带 Bearer Token 的请求，完成验签与用户还原。
 * Guard（如 AuthGuard('jwt')）触发后会走这里：
 * 1. 从 Authorization 头取出 token
 * 2. 用 JWT_SECRET 验签并检查是否过期
 * 3. 调用 validate()，返回值会挂到 request.user，供 @CurrentUser() 使用
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly userService: UserService,
  ) {
    super({
      // 只认 Header：Authorization: Bearer <token>
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // false：过期 token 直接拒绝
      ignoreExpiration: false,
      // 验签密钥，需与签发 token 时一致
      secretOrKey: config.get<string>('JWT_SECRET', 'dev-secret-change-me'),
    });
  }

  /**
   * 验签成功后的业务校验：只接受 access token，并按 sub 查库还原 AuthUser。
   * 返回值即 request.user；抛错则整次请求 401。
   */
  async validate(payload: JwtPayload) {
    // refresh token 不能用来访问业务接口
    if (payload.type !== 'access') {
      throw new UnauthorizedException('无效的 access token');
    }
    // 按用户 ID 查库：禁用用户也会在这里被拦下
    return this.userService.buildAuthUser(payload.sub);
  }
}
