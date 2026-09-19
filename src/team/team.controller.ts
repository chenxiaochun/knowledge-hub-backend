import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleCode } from '../common/constant/roles';
import { CreateTeamDto, QueryTeamDto, UpdateTeamDto } from './dto/team.dto';
import { TeamService } from './team.service';

@Controller('teams')
export class TeamController {
  constructor(private readonly teamService: TeamService) {}

  @Post()
  @Roles(RoleCode.ADMIN)
  create(@Body() dto: CreateTeamDto) {
    return this.teamService.create(dto);
  }

  @Put(':id')
  @Roles(RoleCode.ADMIN)
  update(@Param('id') id: string, @Body() dto: UpdateTeamDto) {
    return this.teamService.update(id, dto);
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  delete(@Param('id') id: string) {
    return this.teamService.delete(id);
  }

  @Get('page')
  @Roles(RoleCode.ADMIN)
  page(@Query() query: QueryTeamDto) {
    return this.teamService.page(query);
  }

  @Public()
  @Get('tree')
  getTree(@Query('rootOnly') rootOnly?: string) {
    return this.teamService.getTree(rootOnly === 'true');
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN)
  getDetail(@Param('id') id: string) {
    return this.teamService.getDetail(id);
  }
}
