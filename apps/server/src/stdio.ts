import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { McpService } from './mcp/mcp.service';

/**
 * stdio transport: the client spawns this process and talks JSON-RPC over
 * stdin/stdout. Anything written to stdout corrupts the stream, so the Nest
 * logger is disabled.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  await app.get(McpService).runStdio();
}

main();
