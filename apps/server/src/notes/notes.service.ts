import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
}

@Injectable()
export class NotesService {
  private readonly notes = new Map<string, Note>();

  constructor() {
    this.seed();
  }

  list(): Note[] {
    return [...this.notes.values()];
  }

  get(id: string): Note | undefined {
    return this.notes.get(id);
  }

  search(query: string): Note[] {
    const q = query.toLowerCase();
    return this.list().filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }

  create(input: { title: string; body?: string; tags?: string[] }): Note {
    const note: Note = {
      id: randomUUID().slice(0, 8),
      title: input.title,
      body: input.body ?? '',
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
    };
    this.notes.set(note.id, note);
    return note;
  }

  remove(id: string): boolean {
    return this.notes.delete(id);
  }

  private seed() {
    for (const note of [
      {
        title: 'MCP transports',
        body: 'stdio for local processes, Streamable HTTP for remote servers. Streamable HTTP replaces the older HTTP+SSE transport.',
        tags: ['mcp', 'transport'],
      },
      {
        title: 'Sampling is server to client',
        body: 'A server can ask the connected client to run an LLM completion. The client owns the model and the user, the server only owns the workflow.',
        tags: ['mcp', 'sampling'],
      },
      {
        title: 'Elicitation is asking the human',
        body: 'Elicitation is a server-initiated form request that the client renders to the user. Never use it for secrets the user should not type.',
        tags: ['mcp', 'elicitation'],
      },
    ]) {
      this.create(note);
    }
  }
}
