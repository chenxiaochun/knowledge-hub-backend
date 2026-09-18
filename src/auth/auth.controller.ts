import { Body, Controller, Get, Post, Query } from '@nestjs/common';

import type { AuthUser } from './auth-user.interface';

import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  ResetPasswordDto,
  SendResetCodeDto,
} from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Public()
  @Get('verify-email')
  verifyEmail(@Query('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Public()
  @Post('password/reset/send-code')
  sendResetCode(@Body() dto: SendResetCodeDto) {
    return this.authService.sendResetCode(dto);
  }

  @Public()
  @Post('password/reset')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPasswordByEmail(dto);
  }

  @Post('logout')
  logout() {
    return { message: '已退出登录' };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.authService.getMe(user.userId);
  }
}
