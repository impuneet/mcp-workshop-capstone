import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { Note, NotesService } from './notes.service';

/**
 * Plain REST API over the same domain the MCP server exposes.
 * The point of the lesson: MCP does not replace your API, it wraps it.
 */
@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  @Get()
  list(): Note[] {
    return this.notes.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Note | { error: string } {
    return this.notes.get(id) ?? { error: `no note ${id}` };
  }

  @Post()
  create(@Body() body: { title: string; body?: string; tags?: string[] }): Note {
    return this.notes.create(body);
  }

  @Delete(':id')
  remove(@Param('id') id: string): { deleted: boolean } {
    return { deleted: this.notes.remove(id) };
  }
}
