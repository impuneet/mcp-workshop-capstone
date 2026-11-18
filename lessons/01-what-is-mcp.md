# Lesson 1 - What MCP is (10 minutes)

**Goal:** you can explain the MCP model to a colleague in two minutes, and you know
which parts of it you will actually use.

## 1.1 The three roles

```
        +-----------------+          +-------------------+
        |   MCP Host      |          |   MCP Server      |
        | (Claude Code,   |          | (your NestJS app, |
        |  Gemini CLI,    |  <--->  |  the filesystem   |
        |  your own app)  |  MCP    |  server)          |
        +-----------------+          +-------------------+
                 |                            ^
                 |   +-------------------+     |
                 +-->|   MCP Client     |-----+
                     | (one per server)  |
                     +-------------------+
```

- **Host** - the app the human talks to. Claude Code, Gemini CLI, VS Code, your own agent.
  The host owns the model, the user and the permissions.
- **Client** - one per server, living inside the host. The client speaks MCP; the host
  never does.
- **Server** - a process that exposes tools, resources and prompts. It can be local
  (stdio) or remote (HTTP).

The rule that trips everyone up: **the client is on the model's side, the server is on
the data's side.** "Client" does not mean "the app you are building".

## 1.2 It is JSON-RPC 2.0

Every MCP message is a JSON-RPC 2.0 message over one transport.

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add","arguments":{"a":2,"b":40}}}
```

Three shapes:

| Shape | Direction | Example |
|---|---|---|
| Request | client -> server | `tools/call`, `resources/read` |
| Response | server -> client | `{"result": {...}}` or `{"error": {...}}` |
| Notification | either way, no reply | `notifications/message`, `notifications/progress` |

The exception that makes MCP richer than plain RPC: **a server can send requests to
the client too** (sampling, elicitation). We spend lesson 8 on that - and on how the
2026 revision changes the answer.

## 1.3 The lifecycle - and the two eras

**Era 1 (what this repo runs, SDK 1.32.2, protocol `2025-11-25`):**

```
client -> server   initialize    {protocolVersion, capabilities, clientInfo}
server -> client   result        {protocolVersion, capabilities, serverInfo}
client -> server   notifications/initialized
...                tools/list, tools/call, resources/read, prompts/get ...
client -> server   DELETE /mcp   (terminate the session, HTTP transport only)
```

**Era 2 (`2026-07-28`): no session at all.** `initialize` and
`notifications/initialized` are gone, `Mcp-Session-Id` is never issued, and every
request carries its own metadata:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call",
 "params":{"name":"add","arguments":{"a":2,"b":40},
  "_meta":{
    "io.modelcontextprotocol/protocolVersion":"2026-07-28",
    "io.modelcontextprotocol/clientCapabilities":{"sampling":{}},
    "io.modelcontextprotocol/clientInfo":{"name":"lesson-client","version":"1.0.0"}}}}
```

Discovery moves from a handshake to a plain method:

```
client -> server   server/discover
server -> client   {resultType:"complete", supportedVersions:["2026-07-28"],
                    capabilities:{...}, ttlMs, cacheScope}
```

**Both eras negotiate capabilities.** The client declares what it can do
(`sampling`, `elicitation`, `roots`, `extensions`), the server declares what it
offers (`tools`, `resources`, `prompts`, `logging`). Neither side may use a
capability the other did not declare - you will hit that as a runtime error in
lesson 8 if you forget.

**Which era should you build against?** The one your clients speak today. Claude
Code and Gemini CLI at the time of writing speak era 1, and the SDK in this repo
implements era 1. Era 2 is where the protocol is going, and the rest of this
workshop points at it wherever the shape changed - lesson 3 (transports and
sessions), lesson 4 (cache hints and subscriptions), lesson 8 (bidirectional), and
lessons 9-10 (extensions and auth).

The compatibility rule the reference material gives: `-32020`, `-32021` and `-32022`
prove the peer is modern and forbid silently downgrading. `-32601` permits a legacy
probe only for an explicitly allowlisted peer.

## 1.4 The three primitives

| Primitive | Who decides to use it | Model sees it as |
|---|---|---|
| **Tool** | the model | a function it can call |
| **Resource** | the client / the user | context it can read (usually attached) |
| **Prompt** | the user | a template offered as a slash command |

Plus the newer server-driven ones:

| Primitive | Direction | Use for |
|---|---|---|
| **Sampling** | server -> client -> model | the server borrows the client's model |
| **Elicitation** | server -> client -> user | the server asks the user a question |
| **Roots** | client -> server | "here is what I am allowed to touch" - *deprecated in 2026-07-28, see lesson 8* |
| **Progress** | server -> client | "step 3 of 10" |

Roots is worth calling out now: it sounds like a security boundary and it is not.
It was a **workspace hint**. It never authorized the caller, never constrained the
server process, and never created an OS sandbox. The 2026 revision deprecates it in
favour of an explicit scope argument plus real containment. Lesson 8 shows the
replacement.

## 1.5 When NOT to use MCP

MCP is a good fit when:

- you want an LLM to use your API **and** the API is useful to people too
- you want to reuse one integration across many hosts
- you want the host to own auth, cost and approvals

MCP is a bad fit when:

- the app already has a great SDK and the model only needs one function - just write the tool
- you need to expose a huge dataset - the model will not read it; expose queries instead
- you are moving a workflow that has nothing to do with the user or the model

**Rule of thumb:** if you would not put it behind an HTTP API, do not put it behind MCP.

## Checkpoint

Answer out loud, without looking:

1. Which side owns the API key - host or server?
2. A tool is called by the model. A resource is read by whom?
3. Your server wants the client's model. Which primitive?
4. Your server wants to ask the user a question. Which primitive?

<details><summary>Answers</summary>

1. The **host**. The server only ever sees the host's requests. This is why an MCP
   server rarely holds secrets and why the host's approval UI matters.
2. The **client**, on the model's behalf - resources are context, not actions.
3. **Sampling**.
4. **Elicitation**.
</details>

## Takeaway

MCP is JSON-RPC with a capability handshake, three primitives, and the unusual
ability for the server to call back.

## Exercise

Open `apps/server/src/mcp/tools.ts` and point at the line that makes `delete_note`
destructive, and the line that makes it ask the user first.
