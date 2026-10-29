import { resolve } from 'node:path';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { config as loadEnv } from 'dotenv';

import { AppModule } from './app.module';
import {
  registerLangfuse,
  shutdownLangfuse,
} from './observability/langfuse';

// registerLangfuse 早于 ConfigModule，须先注入 .env
loadEnv({ path: resolve(process.cwd(), '.env') });

async function bootstrap() {
  await registerLangfuse();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Knowledge Hub API')
      .setDescription('Knowledge Hub 后端接口文档')
      .setVersion('0.0.1')
      .addBearerAuth()
      .build();
    // pnpm 下 @nestjs/common 可能出现双份类型身份，运行时无影响
    const document = SwaggerModule.createDocument(app as never, config);
    SwaggerModule.setup('docs', app as never, document);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  // Single shutdown path: no enableShutdownHooks() (avoids double app.close).
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await app.close();
    await shutdownLangfuse();
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}
bootstrap();
