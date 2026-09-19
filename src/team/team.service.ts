import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { nextSnowflakeId } from '../common/snowflake-id';
import { CreateTeamDto, QueryTeamDto, UpdateTeamDto } from './dto/team.dto';
import { TeamEntity } from './entities/team.entity';

@Injectable()
export class TeamService {
  constructor(@InjectRepository(TeamEntity) private teamRepository: Repository<TeamEntity>) {}

  private async findByIdOrThrow(id: string) {
    const team = await this.teamRepository.findOne({
      where: { id, deleted: false },
    });
    if (!team) throw new NotFoundException('团队不存在');
    return team;
  }

  async create(dto: CreateTeamDto) {
    const team = this.teamRepository.create({
      id: nextSnowflakeId(),
      teamName: dto.teamName,
      teamCode: dto.teamCode ?? null,
      description: dto.description ?? null,
      parentId: dto.parentId ?? '0',
      sort: dto.sort ?? 0,
      status: dto.status ?? 1,
      deleted: false,
    });
    return this.teamRepository.save(team);
  }

  async update(id: string, dto: UpdateTeamDto) {
    const team = await this.findByIdOrThrow(id);
    if (dto.teamName !== undefined) team.teamName = dto.teamName;
    if (dto.teamCode !== undefined) team.teamCode = dto.teamCode;
    if (dto.description !== undefined) team.description = dto.description;
    if (dto.parentId !== undefined) {
      if (dto.parentId === id) {
        throw new BadRequestException('父团队不能是自己');
      }
      team.parentId = dto.parentId;
    }
    if (dto.sort !== undefined) team.sort = dto.sort;
    if (dto.status !== undefined) team.status = dto.status;
    return this.teamRepository.save(team);
  }

  async delete(id: string) {
    const team = await this.findByIdOrThrow(id);
    const childCount = await this.teamRepository.count({
      where: { parentId: id, deleted: false },
    });
    if (childCount > 0) {
      throw new BadRequestException('存在子团队，无法删除');
    }
    team.deleted = true;
    await this.teamRepository.save(team);
    return { message: '删除成功' };
  }

  async getDetail(id: string) {
    return this.findByIdOrThrow(id);
  }

  /** 分页查询团队
   * @param query 查询条件
   * @returns 分页数据
   * @description 查询条件：团队名称、团队编码、状态
   */
  async page(query: QueryTeamDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const qb = this.teamRepository.createQueryBuilder('t').where('t.deleted = false');
    if (query.keyword?.trim()) {
      qb.andWhere('(t.team_name ILIKE :kw OR t.team_code ILIKE :kw)', {
        kw: `%${query.keyword.trim()}%`,
      });
    }
    if (query.status !== undefined) {
      qb.andWhere('t.status = :status', { status: query.status });
    }
    qb.orderBy('t.sort', 'ASC')
      .addOrderBy('t.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);
    const [items, total] = await qb.getManyAndCount();
    return { items, total, page, pageSize };
  }

  /** 获取团队树
   * @param rootOnly 是否只获取根节点
   * @returns 团队树
   * @description 获取团队树，根节点为 parentId 为 0 的团队
   */
  async getTree(rootOnly = false) {
    const teams = await this.teamRepository.find({
      where: { deleted: false, status: 1 },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    const build = (parentId: string): unknown[] =>
      teams
        .filter((t) => t.parentId === parentId)
        .map((t) => ({
          ...t,
          children: rootOnly ? [] : build(t.id),
        }));
    const roots = teams.filter((t) => !t.parentId || t.parentId === '0');
    return rootOnly ? roots : roots.map((t) => ({ ...t, children: build(t.id) }));
  }
}
