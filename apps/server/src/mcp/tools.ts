import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { NotesService } from '../notes/notes.service';

const text = (value: string) => ({ content: [{ type: 'text' as const, text: value }] });
const failure = (value: string) => ({
  content: [{ type: 'text' as const, text: value }],
  isError: true,
});

/**
 * Tools are the "verbs" of an MCP server. The model picks them by name and
 * description, so both are part of the contract - write them for a reader,
 * not for a parser.
 */
export function registerTools(server: McpServer, notes: NotesService) {
  server.registerTool(
    'add',
    {
      title: 'Add two numbers',
      description: 'Adds two numbers and returns the sum. Useful as the smallest possible MCP tool.',
      inputSchema: { a: z.number(), b: z.number() },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ a, b }) => text(String(a + b)),
  );

  server.registerTool(
    'list_notes',
    {
      title: 'List notes',
      description: 'Returns every workshop note with its id, title, body and tags.',
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => text(JSON.stringify(notes.list(), null, 2)),
  );

  server.registerTool(
    'search_notes',
    {
      title: 'Search notes',
      description: 'Finds notes whose title, body or tags contain the query (case insensitive).',
      inputSchema: { query: z.string().min(1).describe('Text to look for') },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ query }) => text(JSON.stringify(notes.search(query), null, 2)),
  );

  server.registerTool(
    'create_note',
    {
      title: 'Create a note',
      description: 'Creates a new note and returns it, including the generated id.',
      inputSchema: {
        title: z.string().min(1),
        body: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const note = notes.create(args);
      return text(`Created note ${note.id}: ${note.title}`);
    },
  );

  server.registerTool(
    'delete_note',
    {
      title: 'Delete a note',
      description:
        'Deletes a note. If the connected client supports elicitation, the user is asked to confirm first; otherwise pass confirm=true.',
      inputSchema: {
        id: z.string().min(1),
        confirm: z.boolean().optional().describe('Required when the client cannot ask the user'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ id, confirm }) => {
      const note = notes.get(id);
      if (!note) return failure(`No note with id ${id}`);

      let approved = confirm === true;
      if (!approved) {
        try {
          const result = await server.server.elicitInput({
            message: `Delete note "${note.title}"? This cannot be undone.`,
            requestedSchema: {
              type: 'object',
              properties: {
                confirm: {
                  type: 'boolean',
                  title: 'Delete this note',
                  description: 'Yes, permanently delete the note',
                },
              },
              required: ['confirm'],
            },
          });
          approved = result.action === 'accept' && (result.content as any)?.confirm === true;
        } catch (err) {
          // Client does not support elicitation - fall back to the explicit argument.
          return failure(
            `Client cannot ask the user for confirmation (${(err as Error).message}). ` +
              'Call this tool again with confirm=true if the user agreed.',
          );
        }
      }

      if (!approved) return failure('Deletion cancelled by the user.');
      notes.remove(id);
      return text(`Deleted note ${id} (${note.title}).`);
    },
  );

  server.registerTool(
    'draft_summary',
    {
      title: 'Draft a summary using the client model',
      description:
        'Asks the connected client to run an LLM completion over a note (sampling). ' +
        'Proves the server can call back into the agent that called it.',
      inputSchema: {
        noteId: z.string().min(1),
        instructions: z.string().optional().describe('Extra guidance for the summariser'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ noteId, instructions }) => {
      const note = notes.get(noteId);
      if (!note) return failure(`No note with id ${noteId}`);

      try {
        const result = await server.server.createMessage({
          systemPrompt: 'You are a precise technical summariser. Answer with plain prose, no preamble.',
          maxTokens: 400,
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Summarise this note in two sentences.\n\nTitle: ${note.title}\n\n${note.body}${
                  instructions ? `\n\nAdditional instructions: ${instructions}` : ''
                }`,
              },
            },
          ],
        });

        const summary =
          result.content.type === 'text' ? result.content.text : JSON.stringify(result.content);
        return text(summary);
      } catch (err) {
        return failure(
          `Sampling unavailable (${(err as Error).message}). ` +
            'The client must advertise the sampling capability.',
        );
      }
    },
  );
}
