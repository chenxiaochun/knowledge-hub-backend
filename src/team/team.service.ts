import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { nextSnowflakeId } from '../common/snowflake-id';
import { CreateTeamDto, QueryTeamDto, UpdateTeamDto } from './dto/team.dto';
import { TeamEntity } from './entities/team.entity';

@Injectable()
export class TeamService {
  constructor(@InjectRepository(TeamEntity) private teamRepository: Repository<TeamEntity>) {}

  create(createTeamDto: CreateTeamDto) {
    return 'This action adds a new team';
  }

  findAll() {
    return `This action returns all team`;
  }

  findOne(id: number) {
    return `This action returns a #${id} team`;
  }

  update(id: number, updateTeamDto: UpdateTeamDto) {
    return `This action updates a #${id} team`;
  }

  remove(id: number) {
    return `This action removes a #${id} team`;
  }
}
