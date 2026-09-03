import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
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

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
