import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { compare } from 'bcrypt';
import { InjectRepository } from '@nestjs/typeorm';
import { hash } from 'crypto';
import { Repository } from 'typeorm';
import { nextSnowflakeId } from '../common/snowflake-id';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { UserVO } from './vo/user.vo';
import { UserEntity } from './entities/user.entity';
import type { AuthUser } from '../auth/auth-user.interface';
import { RoleCode } from 'src/common/constant/roles';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity) private readonly userRepository: Repository<UserEntity>,
  ) {}

  /** 规范化角色列表（simple-array 空串可能变成 ['']） */
  private normalizeRoles(roleCodes?: string[] | null): string[] {
    const roles = (roleCodes ?? []).filter((r) => !!r);
    return roles.length ? roles : [RoleCode.USER];
  }

  async validateCredentials(username: string, password: string): Promise<AuthUser> {
    const user = await this.userRepository.findOne({
      where: { username, deleted: false },
    });
    if (!user) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    const ok = await compare(password, user.password);
    if (!ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }
    if (user.status !== 1) {
      throw new UnauthorizedException('用户已禁用');
    }
    return this.toAuthUser(user);
  }

  toVO(user: UserEntity): UserVO {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      realName: user.realName,
      avatar: user.avatar,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roleCodes: user.roleCodes,
    };
  }

  toAuthUser(user: UserEntity): AuthUser {
    return {
      userId: user.id,
      username: user.username,
      realName: user.realName,
      email: user.email,
      avatar: user.avatar,
      roles: this.normalizeRoles(user.roleCodes),
    };
  }

  async buildAuthUser(userId: string): Promise<AuthUser> {
    const user = await this.findByIdOrThrow(userId);
    if (user.status !== 1) {
      throw new UnauthorizedException('用户已禁用');
    }
    return this.toAuthUser(user);
  }

  async findByIdOrThrow(id: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({ where: { id, deleted: false } });
    if (!user) {
      throw new NotFoundException('用户不存在');
    }
    return user;
  }

  async createUser(dto: CreateUserDto): Promise<UserVO> {
    const exists = await this.userRepository.findOne({
      where: { username: dto.username, deleted: false },
    });
    if (exists) {
      throw new ConflictException('用户名已存在');
    }
    const user = this.userRepository.create({
      id: nextSnowflakeId(),
      username: dto.username,
      password: hash('sha256', dto.password, 'hex'),
      email: dto.email,
      realName: dto.realName,
      avatar: dto.avatar,
      status: dto.status || 1,
      deleted: false,
      roleCodes: this.normalizeRoles(dto.roleCodes),
    });
    const saved = await this.userRepository.save(user);
    return this.toVO(saved);
  }

  async register(dto: {
    username: string;
    password: string;
    email?: string;
    realName?: string;
  }): Promise<{
    userId: string;
    message: string;
  }> {
    const exists = await this.userRepository.findOne({
      where: { username: dto.username, deleted: false },
    });
    if (exists) {
      throw new ConflictException('用户名已存在');
    }
    const user = this.userRepository.create({
      id: nextSnowflakeId(),
      username: dto.username,
      password: hash('sha256', dto.password, 'hex'),
      email: dto.email,
      realName: dto.realName,
      deleted: false,
      status: 1,
      roleCodes: [RoleCode.USER],
    });
    const saved = await this.userRepository.save(user);
    return {
      userId: saved.id,
      message: '注册成功',
    };
  }

  async pageUsers(query: QueryUserDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 10;

    /** 为什么 createQueryBuilder 要传入一个别名？
     * 因为我们要查询的是用户表，所以我们要给用户表起一个别名，这样我们就可以在查询中使用这个别名了。
     * 比如我们查询用户表中的用户名，我们就可以使用 u.username 来查询。
     *
     * 从哪里知道我们要查询的是用户表了？
     * 从 UserEntity 中知道我们要查询的是用户表。
     */
    const qb = this.userRepository.createQueryBuilder('u').where('u.deleted = false');

    /**
     * 如果用户传入了关键词，则根据关键词查询用户。
     */
    if (query.keyword) {
      qb.andWhere('u.username LIKE :keyword OR u.email LIKE :keyword OR u.realName LIKE :keyword', {
        keyword: `%${query.keyword}%`,
      });
    }

    qb.orderBy('u.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();
    return {
      list: list.map(this.toVO),
      total,
      page,
      pageSize,
    };
  }

  async getUserVO(id: string): Promise<UserVO> {
    const user = await this.findByIdOrThrow(id);
    return user;
  }

  async updateUser(id: string, dto: UpdateUserDto) {
    const user = await this.findByIdOrThrow(id);
    if (dto.password) {
      user.password = hash('sha256', dto.password, 'hex');
    }
    if (dto.email !== undefined) {
      user.email = dto.email;
    }
    if (dto.realName !== undefined) {
      user.realName = dto.realName;
    }
    if (dto.avatar !== undefined) {
      user.avatar = dto.avatar;
    }
    if (dto.status !== undefined) {
      user.status = dto.status;
    }
    const saved = await this.userRepository.save(user);
    return this.toVO(saved);
  }

  async deleteUser(id: string) {
    const user = await this.findByIdOrThrow(id);
    user.deleted = true;
    const saved = await this.userRepository.save(user);
    return this.toVO(saved);
  }
}
