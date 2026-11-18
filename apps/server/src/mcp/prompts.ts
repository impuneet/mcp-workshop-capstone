import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NotesService } from '../notes/notes.service';

/**
 * Prompts are user-invoked templates the client can offer as a slash command
 * or menu entry. They are not automatically sent to the model.
 */
export function registerPrompts(server: McpServer, notes: NotesService) {
  server.registerPrompt(
    'summarize_note',
    {
      title: 'Summarise a note',
      description: 'Builds a request to summarise one of the workshop notes.',
      argsSchema: { noteId: z.string().describe('Id of the note to summarise') },
    },
    async ({ noteId }) => {
      const note = notes.get(noteId);
      const title = note?.title ?? noteId;
      const body = note?.body ?? '(note not found)';

      return {
        description: `Summarise the note "${title}"`,
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Summarise this note in at most three bullet points.\n\nTitle: ${title}\n\n${body}`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'review_note',
    {
      title: 'Review a note',
      description: 'Asks for a critical review of a note.',
      argsSchema: {
        noteId: z.string().describe('Id of the note to review'),
        focus: z.string().optional().describe('What to focus on'),
      },
    },
    async ({ noteId, focus }) => {
      const note = notes.get(noteId);
      return {
        description: `Review the note "${note?.title ?? noteId}"`,
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Review this note and list what is wrong or unclear.\n\n${
                focus ? `Focus on: ${focus}\n\n` : ''
              }Title: ${note?.title ?? noteId}\n\n${note?.body ?? '(note not found)'}`,
            },
          },
        ],
      };
    },
  );
}
