import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { NotesService } from '../notes/notes.service';

/**
 * Resources are the "nouns": read-only data the client can pull in.
 * Clients subscribe to `notifications/resources/updated` and can list templates.
 */
export function registerResources(server: McpServer, notes: NotesService) {
  server.registerResource(
    'all-notes',
    'notes://all',
    {
      title: 'All notes',
      description: 'Every workshop note as JSON.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(notes.list(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'note-by-id',
    new ResourceTemplate('notes://{id}', { list: undefined }),
    {
      title: 'Note by id',
      description: 'A single note, addressed by its id.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const id = String(variables.id);
      const note = notes.get(id);
      if (!note) {
        // An unknown URI is a protocol error, not an empty result. Returning
        // `No note <id>` as content would tell the model the note was deleted.
        throw new McpError(ErrorCode.InvalidParams, `Unknown or invalid resource URI`, { uri: uri.href });
      }
      return {
        contents: [
          { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(note, null, 2) },
        ],
      };
    },
  );

  server.registerResource(
    'workshop-schedule',
    'workshop://schedule',
    {
      title: 'Workshop schedule',
      description: 'The agenda of this workshop, so the agent can answer "what are we doing now?".',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(
            [
              { minutes: 10, topic: 'Setup check' },
              { minutes: 10, topic: 'What MCP is: roles, JSON-RPC, capabilities, the two protocol eras' },
              { minutes: 20, topic: 'Building the first NestJS MCP server' },
              { minutes: 20, topic: 'Transports: stdio vs Streamable HTTP, sessions vs stateless' },
              { minutes: 15, topic: 'Resources, templates, prompts, subscriptions' },
              { minutes: 15, topic: 'Consuming a third-party MCP server' },
              { minutes: 15, topic: 'Wiring it into Claude Code and Gemini CLI' },
              { minutes: 25, topic: 'Multi-agent gateway: policies, routing, audit' },
              { minutes: 20, topic: 'Bidirectional flows: sampling, elicitation, roots, MRTR' },
              { minutes: 10, topic: 'The 2026 extensions: async tasks and MCP Apps' },
              { minutes: 10, topic: 'Security, OAuth 2.1 and production' },
              { minutes: 10, topic: 'Capstone' },
            ],
            null,
            2,
          ),
        },
      ],
    }),
  );
}
