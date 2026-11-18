# Lesson 2 - Your first NestJS MCP server (20 minutes)

**Goal:** you can add a tool, a resource and a prompt to a running NestJS app and
see the agent pick them up without a rebuild of your mental model.

## 2.1 What we are building

`apps/server` is a normal NestJS app. It has:

- a REST controller (`/api/notes`) - the "real" API
- an MCP endpoint (`/mcp`) - the same domain, exposed to agents
- a `NotesService` - the actual logic, shared by both

```
apps/server/src
  notes/notes.service.ts      <- the domain
  notes/notes.controller.ts   <- REST
  mcp/mcp.service.ts          <- MCP server + transport plumbing
  mcp/tools.ts                <- tools
  mcp/resources.ts            <- resources
  mcp/prompts.ts              <- prompts
  main.ts                     <- HTTP bootstrap
  stdio.ts                    <- stdio bootstrap
```

The MCP layer calls straight into `NotesService`. It does not call the REST API over
HTTP - that would be a distributed-systems problem you did not need.

## 2.2 The whole MCP server in one object

```ts
// apps/server/src/mcp/mcp.service.ts
const server = new McpServer(
  { name: 'workshop-notes', version: '1.0.0' },
  {
    capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
    instructions: 'Notes about the MCP workshop. Use list_notes/search_notes to read...',
  },
);

registerTools(server, this.notes);
registerResources(server, this.notes);
registerPrompts(server, this.notes);
```

Three things to notice:

1. **One server per session.** A session is a conversation with one client. Sharing
   one `McpServer` across sessions would share state you did not intend to share.
2. **`capabilities` is what you promise.** Only declare what you actually register.
3. **`instructions` is free text the client may show to the model.** Use it to explain
   when to use which tool.

## 2.3 Registering a tool

```ts
server.registerTool(
  'add',
  {
    title: 'Add two numbers',
    description: 'Adds two numbers and returns the sum.',
    inputSchema: { a: z.number(), b: z.number() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
);
```

Four parts, and each one matters:

| Part | Why it matters |
|---|---|
| `name` | the model's function name - keep it short and verb-first |
| `description` | the model reads this to decide whether to call it - write it for the model |
| `inputSchema` | a **zod raw shape** (`{ field: zodType }`, not `z.object({...})`) |
| `annotations` | hints the host can act on - `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` |

**Live task - add a tool.** In `apps/server/src/mcp/tools.ts`, after `add`, add:

```ts
server.registerTool(
  'count_words',
  {
    title: 'Count words',
    description: 'Counts the words in a piece of text.',
    inputSchema: { text: z.string().describe('The text to count') },
    annotations: { readOnlyHint: true },
  },
  async ({ text }) => text(String(text.trim().split(/\s+/).filter(Boolean).length)),
);
```

## 2.4 The result shape

A tool returns `CallToolResult`:

```ts
{ content: [{ type: 'text', text: '42' }] }          // success
{ content: [{ type: 'text', text: '...' }], isError: true }  // failure
```

`isError: true` is important: it tells the host "the model should read this and
adapt", as opposed to a protocol-level error which aborts the call. **Model-visible
errors should be `isError`, not exceptions.**

## 2.5 Resources - the nouns

```ts
server.registerResource(
  'all-notes',
  'notes://all',
  { title: 'All notes', mimeType: 'application/json' },
  async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(notes.list()) }],
  }),
);
```

And the templated version, for one-of-many:

```ts
server.registerResource(
  'note-by-id',
  new ResourceTemplate('notes://{id}', { list: undefined }),
  { title: 'Note by id' },
  async (uri, variables) => ({ contents: [{ uri: uri.href, text: '...' }] }),
);
```

Resources are read by the client and usually end up in the model's context. If the
data is large, a **resource template** plus a **tool** to query it is the better shape.

## 2.6 Prompts - the templates the user picks

```ts
server.registerPrompt(
  'summarize_note',
  {
    title: 'Summarise a note',
    description: 'Builds a request to summarise one of the workshop notes.',
    argsSchema: { noteId: z.string().describe('Id of the note to summarise') },
  },
  async ({ noteId }) => ({
    messages: [{ role: 'user', content: { type: 'text', text: '...' } }],
  }),
);
```

Prompts are **user-invoked**. The model never calls them on its own. The client
turns them into slash commands or menu entries.

## Checkpoint

```bash
npm run inspect -- http://localhost:3000/mcp
```

You should see:

```
tools (7):
  add [read-only] - ...
  count_words [read-only] - ...        <- yours
  ...
resources (2):
  notes://all - all-notes
  workshop://schedule - workshop-schedule
resource templates (1):
  notes://{id} - note-by-id
prompts (2):
  summarize_note - ...
  review_note - ...
```

## Takeaway

- `McpServer` + `registerTool` / `registerResource` / `registerPrompt`
- `inputSchema` is a zod **raw shape**
- `description` is part of the API, for the model
- `isError: true` for model-visible failures

## Exercise

Add a `tags` resource template `notes://tag/{tag}` that returns every note with
that tag, and register it in `apps/server/src/mcp/resources.ts`.
