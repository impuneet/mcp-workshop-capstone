# Lesson 3 - Transports: stdio vs Streamable HTTP (20 minutes)

**Goal:** you can pick a transport for a real deployment and debug session bugs.

## 3.1 The two transports you will meet

| | stdio | Streamable HTTP |
|---|---|---|
| Who starts it | the client spawns the process | the client connects to a URL |
| Wire | stdin/stdout, one JSON-RPC per line | HTTP POST + optional SSE response |
| Multi-user | no - one process, one client | yes - one server, many sessions |
| Auth | none (the process is the trust boundary) | HTTP headers, OAuth 2.1 |
| Deploy | on the user's machine | anywhere |
| Latency | lowest | one network hop |

There was an older "HTTP + SSE" transport. Streamable HTTP **replaced** it - one
endpoint, `POST` for messages, `GET` for the server-to-client stream, `DELETE` to end
a session. Do not write new code against the old transport.

## 3.2 stdio in our server

```ts
// apps/server/src/mcp/mcp.service.ts
async runStdio(): Promise<void> {
  const server = this.buildServer();
  await server.connect(new StdioServerTransport());
}
```

```ts
// apps/server/src/stdio.ts
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
await app.get(McpService).runStdio();
```

**The one rule that breaks everything:** stdout is the JSON-RPC channel. Nothing else
may write to it.

- `logger: false` on the Nest context - a single `console.log` corrupts the stream
- `console.log` in your own code is a bug in a stdio server
- write logs to `stderr` instead

Check your own code for `console.log`:

```bash
grep -rn "console.log" apps/server/src
```

The contract

When the MCP client (Claude Code, Gemini CLI, etc.) spawns your process, it treats the two streams as dedicated pipes:

Stream	Owned by	Contains
stdin	Client → Server	JSON-RPC requests
stdout	Server → Client	JSON-RPC responses only
stderr	Server → anywhere	Logs, debug — client ignores it


What breaks and why
1. logger: false in stdio.ts (line 12)
ts
// stdio.ts
const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

Without this, NestJS logs things like:

[Nest] LOG  [NestFactory] Starting Nest application...
[Nest] LOG  [InstanceLoader] AppModule dependencies initialized

straight to stdout. The client's JSON parser receives:

[Nest] LOG  [NestFactory] Starting Nest application...
{"jsonrpc":"2.0","id":1,"result":{...}}

The first line is not JSON → parse error → connection dead.

2. this.logger in McpService is safe only in HTTP mode
ts
// mcp.service.ts line 23
private readonly logger = new Logger(McpService.name);

In HTTP mode (main.ts / Express), Logger writes to stdout and that's fine — stdout is just your terminal. But if you ever call runStdio() without logger: false, those this.logger.log(...) calls on lines 107/110 would corrupt the stream mid-session when a client opens or closes a connection.

3. Any console.log in your tool/service code is a live bug
ts
// notes.service.ts — if you ever add this during debugging:
console.log('Creating note:', input);  // 💥 corrupts the JSON-RPC stream

The only one allowed is in `main.ts`, the HTTP entry point, which never runs under
stdio.

## 3.3 Streamable HTTP in our server

```ts
mountHttp(expressApp: any) {
  expressApp.post('/mcp', async (req, res) => {
    const session = this.sessions.get(req.headers['mcp-session-id']) ?? this.createHttpSession();
    await session.transport.handleRequest(req, res, req.body);
  });
  expressApp.get('/mcp', ...);      // server -> client notification stream
  expressApp.delete('/mcp', ...);   // end the session
}
```

Three implementation details that matter:

**a) The body parser.** Nest parses JSON by default; the MCP transport wants the raw
body. That is why `main.ts` uses:

```ts
const app = await NestFactory.create(AppModule, { bodyParser: false });
app.use(json({ limit: '4mb' }));
```

**b) One transport per session.** `StreamableHTTPServerTransport` is stateful. Two
clients cannot share one. So the server keeps a map:

```ts
private readonly sessions = new Map<string, HttpSession>();

private createHttpSession(): HttpSession {
  const server = this.buildServer();          // a fresh McpServer per session
  let transport!: StreamableHTTPServerTransport;
  transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => this.sessions.set(id, { server, transport }),
    onsessionclosed: (id) => this.sessions.delete(id),
  });
  server.connect(transport);
  return { server, transport };
}
```

**c) The session header.** After `initialize`, the server returns an
`mcp-session-id` header. The client sends it back on every later request. A request
without it is rejected - that is the spec working, not a bug.

## 3.4 Stateless mode (era 1)

```ts
new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
```

No session id, no session state, every request independent. Use it when you run
behind a load balancer that does not stick sessions to one instance, or behind
serverless functions.

The cost: no server-initiated messages (lesson 8) and no resumability.

**Trade-off:** stateful gives you sampling, elicitation and SSE; stateless gives you
horizontal scale. You cannot have both without sticky sessions.

## 3.5 Era 2 - the stateless Streamable HTTP (`2026-07-28`)

The 2026 revision does not make stateless mode optional. It **is** the protocol.

**POST-only.** `GET /mcp` and `DELETE /mcp` return `405`. There is no standalone
event stream and no session to terminate. The only way to receive a stream is to
open a POST and leave *its* response open as SSE.

**No session id.** `Mcp-Session-Id` is neither issued nor echoed. A request is
complete in itself.

**Mirrored routing headers.** Every modern POST carries headers that must agree
with the JSON-RPC body:

```http
POST /mcp HTTP/1.1
Content-Type: application/json
MCP-Protocol-Version: 2026-07-28
Mcp-Method: tools/call
Mcp-Name: add
```

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
  "name":"add","arguments":{"a":2,"b":40},
  "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
           "io.modelcontextprotocol/clientInfo":{"name":"c","version":"1.0.0"}}}}
```

The body must match the headers exactly:

- `MCP-Protocol-Version` == `params._meta["io.modelcontextprotocol/protocolVersion"]`
- `Mcp-Method` == the JSON-RPC `method`
- `Mcp-Name` == `params.name` (or `params.uri`, or `params.taskId`)

A name that is unsafe or non-ASCII travels in a sentinel form: `=?base64?{...}?=`.

**The error map**, and this is the part worth memorising:

| Situation | Code | HTTP |
|---|---|---|
| header and body disagree | `-32020` | 400 |
| client lacks a required capability | `-32021` | 400 |
| unsupported protocol version | `-32022` | 400 |
| unknown method | `-32601` | 404 |
| invalid params | `-32602` | 400 |
| rejected `Origin` | - | 403 |

`-32022` names both sides:

```json
{"supported":["2026-07-28"],"requested":"2025-03-26"}
```

**Validation order matters:** JSON-RPC shape first, then routing-header comparison,
then protocol-version support. A request that is malformed in two ways reports the
malformed shape.

**Notifications.** An envelope with no JSON-RPC `id` is a notification. It gets no
JSON-RPC response; the HTTP adapter answers `202 Accepted` with an empty body. An
error can never produce a notification response body.

### Why the protocol moved

The stateful design had one persistent problem: **the session was a place to hide
state that should have been explicit.** Every extra piece of session state is
another thing a load balancer has to be told about, another thing that breaks
horizontal scale, and another thing that has to be migrated when the protocol
changes.

The stateless design makes each request self-describing:

```
era 1:  POST /mcp  + header mcp-session-id  + server-side session table
era 2:  POST /mcp  + full metadata in _meta  + no server state
```

The cost is real: no server-initiated requests on a shared stream, so sampling and
elicitation had to change shape too. That is lesson 8.

## 3.6 Local development, remote deployment

The pattern most teams land on:

- **develop** with stdio - the client starts your server, no ports, no CORS
- **ship** with Streamable HTTP - one deployment, many clients, real auth

Both transports can serve the *same* `McpServer`. Ours does: `buildServer()` is
called by `runStdio()` and by `createHttpSession()`.

## Checkpoint

```bash
# HTTP
npm run inspect -- http://localhost:3000/mcp

# stdio - the client spawns the server
npm run inspect -- --stdio npm run start:stdio -w @workshop/server
```

Both print the same six tools. The stdio one shows no server startup logs - proof
that nothing polluted stdout.

## Takeaway

- stdio for local, HTTP for remote, same server object
- stdout is sacred under stdio
- one transport per session, keyed by `mcp-session-id` (era 1)
- era 2 is POST-only, stateless, and self-describing: version, method and name ride
  in mirrored headers, and the body must agree with them
- stateful vs stateless is a real trade-off, and the protocol has chosen

## Exercise

Add a `GET /mcp/health` style check: log the number of open sessions on every
`tools/list` call. Where would you put it, and what would you name the log line?

Then answer: in the 2026 revision, where does that log line go? (There is no session
to count - and that is the point.)
