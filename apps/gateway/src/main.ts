import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { GatewayService } from './gateway/gateway.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '4mb' }));
  app.setGlobalPrefix('api');

  const gateway = app.get(GatewayService);
  gateway.mountHttp(app.getHttpAdapter().getInstance());

  const port = Number(process.env.PORT ?? 3100);
  await app.listen(port);

  console.log(`[workshop-gateway] MCP   http://localhost:${port}/mcp`);
  console.log(`[workshop-gateway] CTRL  http://localhost:${port}/api/health`);
}

bootstrap();
