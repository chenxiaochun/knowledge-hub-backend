import { Controller, Get, Post, Body, Put, Param, Delete, Query } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { QueryUserDto } from './dto/query-user.dto';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { RoleCode } from 'src/common/constant/roles';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('page')
  @Roles(RoleCode.ADMIN)
  pageUsers(@Query() query: QueryUserDto) {
    return this.userService.pageUsers(query);
  }

  @Get(':id')
  @Roles(RoleCode.ADMIN)
  getUser(@Param('id') id: string) {
    return this.userService.getUserVO(id);
  }

  @Post()
  @Roles(RoleCode.ADMIN)
  createUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.createUser(createUserDto);
  }

  @Post('register')
  @Roles(RoleCode.ADMIN)
  register(
    @Body() registerDto: { username: string; password: string; email?: string; realName?: string },
  ) {
    return this.userService.register(registerDto);
  }

  @Put(':id')
  @Roles(RoleCode.ADMIN)
  updateUser(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.updateUser(id, updateUserDto);
  }

  @Delete(':id')
  @Roles(RoleCode.ADMIN)
  removeUser(@Param('id') id: string) {
    return this.userService.deleteUser(id);
  }
}
