# Lesson 8 - Bidirectional flows (20 minutes)

**Goal:** you can make a server call back into the agent that called it - to borrow
its model, to ask its user, or to report progress - and you know how the 2026
revision changed the shape of that call.

## 8.1 The one-way picture

```
agent  --->  server
```

That covers 95% of MCP. But MCP is JSON-RPC, and JSON-RPC allows the other direction.

```
agent  --->  server  --->  agent
```

The server sends a **request** to the client. Three primitives do this. In the
2026-07-28 revision there is no way to do it directly - so all three change shape.
That is the real story of this lesson.

## 8.2 Sampling - borrow the client's model (era 1)

The server wants an LLM completion but has no model and no API key. The client has
both. So the server asks.

```ts
// server side
const result = await server.server.createMessage({
  systemPrompt: 'You are a precise technical summariser.',
  maxTokens: 400,
  messages: [{ role: 'user', content: { type: 'text', text: 'Summarise this note...' } }],
});

const summary = result.content.type === 'text' ? result.content.text : '...';
```

```ts
// client side
client.setRequestHandler(CreateMessageRequestSchema, async (req) => ({
  role: 'assistant',
  content: { type: 'text', text: await myModel.generate(req.params.messages) },
  model: 'my-model',
}));
```

The rule: **the client owns the model, the server owns the workflow.** A server that
samples is borrowing the host's budget, so the host must be able to refuse. The
capability handshake is where that refusal is expressed - a client that does not
declare `sampling` makes the server's `createMessage()` throw
`Client does not support sampling (required for sampling/createMessage)`.

**Live task.** Call the tool that samples:

```bash
npm run inspect -- http://localhost:3000/mcp --call draft_summary --args '{"noteId":"<id>"}'
```

The inspector prints `[SAMPLING] server asked the client to run a completion: ...`
and returns the canned completion. The server asked; the client answered.

## 8.3 Elicitation - ask the client's user (era 1)

```ts
const answer = await server.server.elicitInput({
  message: 'Delete note "MCP transports"? This cannot be undone.',
  requestedSchema: {
    type: 'object',
    properties: {
      confirm: { type: 'boolean', title: 'Delete this note', description: 'Yes, permanently delete' },
    },
    required: ['confirm'],
  },
});

if (answer.action === 'accept' && answer.content.confirm === true) { /* delete */ }
```

`requestedSchema` is **plain JSON Schema**, not zod, and it is limited to flat
primitive fields (string, number, boolean, enum). No nested objects, no arrays.

**Live task.**

```bash
npm run inspect -- http://localhost:3000/mcp --call delete_note --args '{"id":"<id>"}'
```

The inspector prints `[ELICITATION] server asked the user: Delete note ...`.

## 8.4 Progress - report on long work

```ts
const token = extra._meta?.progressToken;   // the client opted in
for (let i = 1; i <= steps; i++) {
  if (token !== undefined) {
    await extra.sendNotification({
      method: 'notifications/progress',
      params: { progressToken: token, progress: i, total: steps, message: `step ${i}` },
    });
  }
  await sleep(400);
}
```

Progress is a **notification**, so there is no reply. The client only sends a
`progressToken` if it wants progress, which is why you must check for it.

## 8.5 Roots - a hint, not a boundary

Roots let a client tell a server "here is the workspace I am working in":

```ts
// client side
client.setRequestHandler(ListRootsRequestSchema, async () => ({
  roots: [{ uri: 'file:///work/notes', name: 'notes workspace' }],
}));
```

It is the oldest of the four, and the 2026-07-28 revision **deprecates it**. The
reason is worth internalising, because it applies far beyond MCP:

> Roots never authorized the caller, never constrained the server process, and
> never created an operating-system sandbox. A folder path is a hint about where to
> look, not permission to look.

A client-supplied folder is attacker-controlled input. If your server treats it as a
boundary, it has a path traversal bug, not a roots bug.

**The replacement is three controls, and only the third is strong:**

1. **Authorization** - verify the authenticated principal may use that workspace.
2. **Containment** - normalize the target and verify it stays inside the boundary.
3. **OS isolation** - a process sandbox or jailed filesystem.

Containment is the one people get wrong. A string prefix check is not containment:

```
allowed:   file:///work/notes
attacker:  file:///work/notes-evil/secret.md     <- starts with the allowed string
traversal: file:///work/notes/%2e%2e/private.md  <- percent-encoded ..
```

So: percent-decode, normalize, compare **path components** (not the string), and
re-check containment immediately before any destructive act. On a real filesystem you
also have to think about symbolic links.

The 2026 migration path: `workspaceUri` or `directory` becomes an **explicit tool
argument**, or a resource URI for a targeted read, plus deployment configuration for
a fixed workspace, plus a process sandbox when escape must be technically prevented.
A legacy integration may still ask for roots inside an MRTR round, but it must not
issue a live reverse request, and it must never bypass server-side authorization.

## 8.6 Era 2 - MRTR: how a server asks without a session

The 2026 revision removes live server-to-client requests. A server may not send a
request while it is processing one. So it returns a **successful** result that says
"I need something from you".

```json
{"jsonrpc":"2.0","id":1,"result":{
  "resultType":"input_required",
  "inputRequests":{
    "pick_files":{
      "method":"sampling/createMessage",
      "params":{
        "messages":[{"role":"user","content":{"type":"text","text":"Choose three representative files and return a JSON array."}}],
        "systemPrompt":"Return only the requested value.",
        "modelPreferences":{"costPriority":0.8,"intelligencePriority":0.2},
        "maxTokens":400}
    }
  },
  "requestState":"opaque-integrity-protected-value"}}
```

Three things to notice:

1. **`input_required` is a success, not an error.** The JSON-RPC call succeeded. The
   *work* is not finished.
2. **`inputRequests` is a map, keyed by the server.** The key is the server's
   handle for that request; the client answers by key.
3. **The embedded request still names a method** - `sampling/createMessage` or
   `elicitation/create` - but it travels *inside the result*, not on the wire as a
   reverse request.

The client answers by **retrying the original call** with a fresh JSON-RPC id:

```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"summarize_repo",
  "arguments":{"audience":"developer"},
  "inputResponses":{
    "pick_files":{
      "role":"assistant",
      "content":{"type":"text","text":"[\"README.md\", \"server.py\"]"},
      "model":"host-model",
      "stopReason":"endTurn"}},
  "requestState":"opaque-integrity-protected-value",
  "_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28",
           "io.modelcontextprotocol/clientCapabilities":{"sampling":{}}}}}
```

Note what the retry does **not** do: it is not a session continuation. It repeats the
original method and the original arguments, and adds only this round's
`inputResponses`. The request id is new.

Multi-round work repeats the pattern - each round carries only that round's
responses, and everything validated so far moves into the next `requestState`:

```
id=1 -> input_required   (pick_files)
id=2 -> input_required   (summary)
id=3 -> complete
```

MRTR is allowed only on `tools/call`, `prompts/get` and `resources/read`. No other
method may return `input_required`.

### `requestState` is opaque and sealed

The client **must not parse it, must not modify it, and must echo the exact same
bytes**. The server seals it against:

- the authenticated principal
- the originating method
- a digest of the original arguments
- a short expiry
- the current phase
- the validated intermediate values

Use HMAC when the state need not be confidential; authenticated encryption when the
client must not inspect it. Reject the retry with `-32602` when the signature is
invalid, the value expired, the principal differs, or the arguments differ.

That last one matters: if the client changes `audience` between rounds, the sealed
state no longer verifies and the call is refused. The arguments are part of the
contract.

### The client's obligations

- verify the embedded request's method is covered by the **current** request's
  advertised capabilities - an earlier advertisement does not authorize a later
  request
- apply the approval policy and the model-selection policy
- display the requested model action when approval policy requires it
- validate every completion before treating it as a filename, URL or tool argument
- **cap the total number of rounds** so a loop cannot spend the user's money
- keep model output out of authorization decisions
- log the originating method and the input-request key, but not the prompt content

`modelPreferences` (`costPriority`, `speedPriority`, `intelligencePriority`) are
**hints**. They are not probabilities, they need not total one, and the client may
ignore them. Client model policy remains authoritative.

## Checkpoint

1. Sampling round trip works through the gateway.
2. Elicitation round trip works through the gateway.
3. Turning `allowSampling` off makes the sampling tool fail cleanly.

## Takeaway

- Sampling borrows the client's model; elicitation asks the client's user
- The capability handshake decides who may do what
- Roots were a hint, never a boundary - explicit scope plus real containment
- One upstream connection per agent session - because nothing else can route a callback
- In era 2 the callback becomes a result: `input_required`, then a retry with a new
  id and a sealed `requestState`
- Signed state prevents modification, not replay - you need a nonce store too

## Exercise

Add a `draft_summary` tool to the gateway itself (not the upstream) that samples the
agent directly. Then compare: which one controls the prompt - the gateway or the
upstream server?

Then, for era 2: design the `requestState` for a destructive `delete_note` tool.
What goes in it, what keys it, and how would a second gateway replica reject a
replayed retry?
