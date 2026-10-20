import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MailerModule } from '@nestjs-modules/mailer';

import { AiCanvasModule } from './ai-canvas/ai-canvas.module';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { typeormEntities } from './database/typeorm.entities';
import { DocumentModule } from './document/document.module';
import { GraphModule } from './graph/graph.module';
import { RedisModule } from './redis/redis.module';
import { SearchModule } from './search/search.module';
import { SpeechModule } from './speech/speech.module';
import { StorageModule } from './storage/storage.module';
import { TeamModule } from './team/team.module';
import { ToolsModule } from './tools/tools.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('POSTGRES_HOST'),
        port: config.get('POSTGRES_PORT'),
        username: config.get('POSTGRES_USER'),
        password: config.get('POSTGRES_PASSWORD'),
        database: config.get('POSTGRES_DB'),
        entities: typeormEntities,
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        // 默认关闭；本地可设 TYPEORM_SYNCHRONIZE=true，生产务必 false + migration
        synchronize: config.get<string>('TYPEORM_SYNCHRONIZE', 'false') === 'true',
      }),
    }),
    UserModule,
    AuthModule,
    DocumentModule,
    StorageModule,
    SearchModule,
    GraphModule,
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('MONGO_URI'),
      }),
    }),
    TeamModule,
    RedisModule,
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        transport: {
          host: configService.get<string>('MAIL_HOST'),
          port: Number(configService.get<string>('MAIL_PORT')),
          secure: configService.get<string>('MAIL_SECURE') === 'true',
          auth: {
            user: configService.get<string>('MAIL_USER'),
            pass: configService.get<string>('MAIL_PASS'),
          },
        },
        defaults: {
          from: configService.get<string>('MAIL_FROM'),
        },
      }),
    }),
    AiModule,
    ToolsModule,
    SpeechModule,
    EventEmitterModule.forRoot({
      maxListeners: 20,
    }),
    AiCanvasModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
