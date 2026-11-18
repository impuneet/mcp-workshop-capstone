import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';
import { McpService } from './mcp/mcp.service';

async function bootstrap() {
  // bodyParser:false so we control body parsing and can hand the parsed body
  // to the MCP transport instead of Nest's JSON parser.
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: '4mb' }));
  app.setGlobalPrefix('api');

  const mcp = app.get(McpService);
  mcp.mountHttp(app.getHttpAdapter().getInstance());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  console.log(`[workshop-server] REST  http://localhost:${port}/api/notes`);
  console.log(`[workshop-server] MCP   http://localhost:${port}/mcp`);
}

bootstrap();
