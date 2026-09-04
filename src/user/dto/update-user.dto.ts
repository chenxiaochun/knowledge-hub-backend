import { IsArray, IsEmail, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  realName?: string;

  @IsOptional()
  @IsString()
  avatar?: string;

  @IsOptional()
  @IsInt()
  status?: number;

  /** 角色编码，如 ROLE_ADMIN / ROLE_USER / ROLE_REVIEWER */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleCodes?: string[];
}
