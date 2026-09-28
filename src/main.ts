import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { WebSocketServer } from 'ws';

import { AppModule } from './app.module';
import { TtsRelayService } from './speech/tts-relay.service';

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

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  const ttsRelay = app.get(TtsRelayService);
  const wss = new WebSocketServer({
    server: app.getHttpServer(),
    path: '/api/speech/tts/ws',
  });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    const sessionId = url.searchParams.get('sessionId') ?? undefined;
    const id = ttsRelay.registerClient(ws, sessionId);
    ws.on('close', () => ttsRelay.unregisterClient(id));
  });
}
bootstrap();
