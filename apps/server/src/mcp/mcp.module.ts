import { Module } from '@nestjs/common';
import { NotesModule } from '../notes/notes.module';
import { McpService } from './mcp.service';

@Module({
  imports: [NotesModule],
  providers: [McpService],
  exports: [McpService],
})
export class McpModule {}
