# Lesson 7 - The multi-agent gateway (25 minutes)

**Goal:** you can run several agents through one MCP server and control, per agent,
which tools exist, which calls succeed, how fast they may call, and who did what.

## 6.1 Why a gateway at all

Give each agent direct access to each MCP server and you get this:

```
Claude Code --> workshop-notes
Gemini CLI  --> workshop-notes      both can delete every note
Cursor      --> files               both can read your whole disk
```

Give them a gateway instead:

```
Claude Code --> gateway --> workshop-notes
Gemini CLI  --> gateway --> files
Cursor      --> gateway --> deepwiki
```

Now there is exactly one place where permissions live.

**The gateway is an MCP server to the agents and an MCP client to the real servers.**
That double role is the whole trick, and it is why it can police the boundary.

## 6.2 What you can control

This is the list the lesson is built around.

| Control | Where | Effect |
|---|---|---|
| Which upstreams an agent may reach | `allowedUpstreams` | `upstream__files__*` disappears from the list |
| Which tools an agent may call | `allowedTools` | allow-list by exact name or `prefix*` |
| Which tools are banned outright | `denyTools` | wins over the allow-list |
| Read-only mode | `readOnly` | only tools with `readOnlyHint: true` are exposed |
| Sampling on/off | `allowSampling` | the server may not borrow this agent's model |
| Elicitation on/off | `allowElicitation` | the server may not ask this agent's user |
| Rate limit | `maxCallsPerMinute` | sliding window, per agent |
| Prompt-injection filter | `blockPromptInjection` | arguments are scanned before the call |
| Audit trail | always on | every call: agent, tool, upstream, outcome, duration |
| Live changes | `PATCH /api/policies/:agentId` | no restart, no redeploy |

## 6.3 Identity: who is calling?

Two sources, in order of trust:

1. **`x-agent-id` header** on the HTTP request
2. **the client name from the MCP handshake** - `clientInfo.name`

```ts
private resolveAgentId(session: Session, server: Server, extra: any) {
  const header = extra?.requestInfo?.headers?.['x-agent-id'];
  const raw =
    (typeof header === 'string' && header.trim()) ||
    server.getClientVersion()?.name?.trim() ||
    session.agentId;
  session.agentId = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}
```

The header is trivially spoofable, so treat it as a **label, not an authentication
mechanism**. Real authentication belongs in front of the gateway (lesson 10).

Claude Code sends `clientInfo.name = "claude-code"`, Gemini CLI sends
`"gemini-cli"` - so even without the header you get sensible identities.

## 6.4 Policies

```ts
export interface AgentPolicy {
  agentId: string;
  allowedUpstreams: string[];
  allowedTools: string[];
  denyTools: string[];
  readOnly: boolean;
  allowSampling: boolean;
  allowElicitation: boolean;
  maxCallsPerMinute: number;
  blockPromptInjection: boolean;
}
```

Shipped policies in `apps/gateway/src/gateway/policies.ts`:

| agentId | what it is for |
|---|---|
| `*` | the default for unknown agents |
| `claude-code` | full access, sampling and elicitation allowed |
| `gemini-cli` | `readOnly: true` - write tools are not even listed |
| `readonly` | read-only **and** no sampling |
| `no-sampling` | everything except server-initiated sampling |

Pattern matching:

```ts
export function matches(patterns: string[], value: string): boolean {
  return patterns.some(
    (p) => p === '*' || p === value || (p.endsWith('*') && value.startsWith(p.slice(0, -1))),
  );
}
```

## 6.5 Two layers of enforcement

The important detail: **hiding a tool from the list is not the same as refusing the
call.** A model can still hallucinate or replay a tool name it saw earlier.

```ts
// layer 1 - the tool list is filtered per agent
if (policy.readOnly && tool.annotations?.readOnlyHint !== true) continue;

// layer 2 - the call itself is checked
const denial = this.checkPolicy(policy, parsed.upstreamId, name, tool.annotations, args);
if (denial) { this.audit.record({ ..., outcome: 'denied' }); return this.error(denial); }
```

Layer 2 is the one that matters for security. Layer 1 is for usability.

## 6.6 Live task - change a policy while the agents are running

```bash
curl -s http://localhost:3100/api/policies
curl -sX PATCH http://localhost:3100/api/policies/gemini-cli \
  -H 'content-type: application/json' \
  -d '{"readOnly":false,"maxCallsPerMinute":5}'
```

Now re-run the inspector as Gemini:

```bash
npm run inspect -- http://localhost:3100/mcp --agent-id gemini-cli
```

The two write tools are back in the list. No restart.

And the audit trail:

```bash
curl -s "http://localhost:3100/api/audit?limit=10"
```

```json
[{"ts":"...","agentId":"gemini-cli","tool":"upstream__workshop__create_note",
  "upstream":"workshop","outcome":"denied","ms":0,
  "detail":"Agent \"gemini-cli\" is read-only and \"upstream__workshop__create_note\" writes."}]
```

## 6.7 The routing layer

The gateway renames tools to `upstream__<server>__<tool>` and remembers the mapping.

```ts
private proxyName(upstreamId: string, toolName: string) {
  return `upstream__${upstreamId}__${toolName}`;
}
```

When a call comes in, the gateway splits the name, finds the connection, checks the
policy, and forwards the *original* tool name to the upstream.

## 6.8 The cost of a gateway

Be honest about the trade-offs:

- **One upstream connection per agent session.** In lesson 8 you will see why.
  The price is one connection (and for stdio upstreams, one child process) per agent.
- **Latency** - every call is now two hops.
- **A single point of failure** for every agent.
- **Descriptions can drift** if the upstream changes its tools.

## Checkpoint

1. Two agents, one gateway, different tool lists - demonstrated above.
2. A denied call shows up in the audit trail with `outcome: "denied"`.
3. A policy change takes effect without a restart.

## Takeaway

- The gateway is an MCP server to agents and an MCP client to real servers
- Identity comes from the header or the handshake - it is a label, not auth
- Filter the tool list for usability, enforce on the call for safety
- Policies are data, changeable at runtime

## Exercise

Give `gemini-cli` a policy that allows `files` but not `workshop`:

```bash
curl -sX PATCH http://localhost:3100/api/policies/gemini-cli \
  -H 'content-type: application/json' \
  -d '{"allowedUpstreams":["files"],"readOnly":false}'
```

Then confirm the workshop tools vanish from Gemini's list.
