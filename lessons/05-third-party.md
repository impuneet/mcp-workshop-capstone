# Lesson 5 - Consuming a third-party MCP server (15 minutes)

**Goal:** you can point your NestJS app at an MCP server that somebody else wrote
and call its tools as if they were your own functions.

## 4.1 The same SDK, the other direction

Everything in lesson 2 was server-side. The client side is the same package:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
```

## 4.2 Three lines to connect

```ts
const client = new Client(
  { name: 'workshop-gateway-workshop', version: '1.0.0' },
  { capabilities: { sampling: {}, elicitation: { form: {} } } },
);

await client.connect(new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp')));

const { tools } = await client.listTools();
const result = await client.callTool({ name: 'list_notes', arguments: {} });
```

Note the second argument: **the capabilities we are willing to accept from the
server**. `sampling: {}` means "you may call back and use my model". Leave it out and
the server's `createMessage()` will throw
`Client does not support sampling (required for sampling/createMessage)`.

## 4.3 Two flavours of third-party server

**Local, over stdio** - the client spawns it:

```ts
// apps/gateway/src/gateway/upstreams.ts
{
  id: 'files',
  label: 'Filesystem sandbox (third-party MCP server)',
  transport: 'stdio',
  command: require.resolve('@modelcontextprotocol/server-filesystem/dist/index.js'),
  args: [process.env.FILES_SANDBOX_DIR ?? SANDBOX_DIR],
}
```

`@modelcontextprotocol/server-filesystem` is the official reference server. It exposes
`read_file`, `write_file`, `list_directory`, `search_files` and friends, and it is
**sandboxed to the directory you give it**. That is the pattern to copy: a third-party
server that can only touch one folder is safe to hand to an agent.

**Remote, over HTTP** - one URL:

```bash
REMOTE_MCP_URL=https://mcp.deepwiki.com/mcp npm run gateway
```

Any Streamable HTTP MCP server works the same way. Try it with the gateway's health
endpoint:

```bash
curl -s http://localhost:3100/api/health
```

### What is the gateway and what is it doing on port 3100?

The gateway (`apps/gateway`) is a proxy and policy enforcement layer:
- **Double Role:** It acts as an **MCP server** towards agents (`:3100/mcp`) and as an **MCP client** towards backend servers (our NestJS workshop server on `:3000`, the third-party stdio filesystem server, or remote URLs).
- **Control Plane (`:3100/api/health`):** Probes connections to every configured upstream server and reports which tools are available before any agent can call them.
- **Why use it:** Instead of exposing raw servers directly to agents with uncontrolled privileges, the gateway provides centralized policy enforcement (read-only mode, tool allow/deny lists), sandboxing, rate-limiting, and an audit trail.

## 4.4 Proxying: turning upstream tools into your own

The gateway renames every upstream tool to `upstream__<server>__<tool>`:

```ts
const name = `upstream__${connection.recipe.id}__${tool.name}`;
```

Why rename at all?

- **No collisions.** Two servers can both have a `search` tool.
- **The client can read the provenance.** `upstream__files__read_file` says where the
  tool came from, which helps the model and helps you audit.
- **You can rewrite the description.** The gateway is the right place to strip
  dangerous advice out of an upstream's tool description.

## 4.5 Do not forward raw tools blindly

When you proxy a tool, forward its `inputSchema` - but decide what you do with its
`annotations` and `description`:

```ts
tools.push({
  name,
  title: `${connection.recipe.label}: ${tool.title ?? tool.name}`,
  description: tool.description,                     // <- rewrite this if you must
  inputSchema: tool.inputSchema as Tool['inputSchema'],
  annotations: tool.annotations as Tool['annotations'],
});
```

`annotations.readOnlyHint` is what lets the gateway enforce a read-only agent. If an
upstream omits it, the gateway cannot tell a read tool from a write tool. Assume
unknown means "writes" in a policy check - see `checkPolicy` in
`apps/gateway/src/gateway/gateway.service.ts`.

## Checkpoint

```bash
curl -s http://localhost:3100/api/health
```

Expect both upstreams listed:

```json
{"status":"ok","upstreams":[
  {"id":"workshop","transport":"http","connected":true,"tools":["add","list_notes",...]},
  {"id":"files","transport":"stdio","connected":true,"tools":["read_file","write_file",...]}
]}
```

And the tools the gateway exposes:

```bash
npm run inspect -- http://localhost:3100/mcp
```

`upstream__files__read_file` should be there.

## Takeaway

- One SDK, both directions: `McpServer` to serve, `Client` to consume
- Declare the capabilities you accept from a server
- Rename proxied tools so provenance survives
- Sandboxed third-party servers are the safe kind

## Exercise

Add a second stdio upstream - any official MCP server from
<https://github.com/modelcontextprotocol/servers> - using the same recipe shape in
`upstreams.ts`, then give it its own policy entry.
