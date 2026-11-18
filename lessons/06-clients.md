# Lesson 6 - Claude Code and Gemini CLI (15 minutes)

**Goal:** your own MCP server is live inside a real coding agent, and you know the
exact config difference between the two clients.

## 5.1 Claude Code

**Project scope** - a `.mcp.json` in the repo root. It is already there:

```json
{
  "mcpServers": {
    "workshop-notes": {
      "type": "stdio",
      "command": "npm",
      "args": ["run", "start:stdio", "-w", "@workshop/server"]
    },
    "workshop-notes-http": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    },
    "workshop-gateway": {
      "type": "http",
      "url": "http://localhost:3100/mcp"
    }
  }
}
```

Two rules that bite:

1. A URL entry **must** have a `"type"`. Claude Code treats a typeless entry as stdio
   and skips it with a configuration error.
2. `"streamable-http"` is accepted as an alias for `"http"`.

**Live task.** Start Claude Code in this directory:

```bash
claude
```

Then:

```
/mcp
```

You should see `workshop-notes`, `workshop-notes-http` and `workshop-gateway`. Project
scoped servers usually ask for approval the first time.

**CLI equivalents** (useful when you do not own the repo):

```bash
claude mcp add --transport http workshop-notes http://localhost:3000/mcp
claude mcp add --transport stdio local-files -- node node_modules/@modelcontextprotocol/server-filesystem/dist/index.js ./sandbox
claude mcp add --transport http notion https://mcp.notion.com/mcp --scope project
```

Scopes: `local` (default, just you), `project` (committed, shared with the team),
`user` (all your projects).

## 5.2 Gemini CLI

**Project scope** - `.gemini/settings.json`. It is already there too.

The difference that matters: Gemini CLI uses **`httpUrl`** for Streamable HTTP and
**`url`** for the legacy SSE transport. There is no `sseUrl`.

```json
{
  "mcpServers": {
    "workshop-notes": {
      "httpUrl": "http://localhost:3000/mcp",
      "timeout": 30000
    },
    "files": {
      "command": "node",
      "args": ["node_modules/@modelcontextprotocol/server-filesystem/dist/index.js", "./sandbox"],
      "trust": true
    }
  },
  "mcp": {
    "allowed": ["workshop-notes", "workshop-gateway", "files"]
  }
}
```

Notes:

- `command` + `args` + optional `env` and `cwd` = stdio
- `httpUrl` = Streamable HTTP, `url` = SSE
- `timeout` is in **milliseconds** and defaults to 600000 (ten minutes)
- `trust: true` skips the confirmation prompt for that server
- `includeTools` / `excludeTools` filter tools **on the client side** - useful when you
  want to hide a tool from one agent without changing the server

**Live task.**

```bash
gemini
```

Then run `/mcp` inside Gemini CLI to see the connected servers, and try a prompt:

```
list the workshop notes using the workshop-notes server
```

## 5.3 Side by side

| | Claude Code | Gemini CLI |
|---|---|---|
| file | `.mcp.json` | `.gemini/settings.json` |
| stdio | `type: "stdio"`, `command`, `args`, `env` | `command`, `args`, `env`, `cwd` |
| Streamable HTTP | `type: "http"`, `url`, `headers` | `httpUrl`, `headers` |
| legacy SSE | - | `url` |
| tool filter | per-invocation approval | `includeTools` / `excludeTools` |
| inspect | `/mcp` | `/mcp` |

The portable subset is: `command` + `args` for stdio, and a URL key for HTTP. Get
those right and both clients work.

## 5.4 Which one should the workshop use?

Both. The point of the gateway in lesson 7 is that the **same** gateway serves both
agents, and each one gets a different policy:

```bash
npm run inspect -- http://localhost:3100/mcp --agent-id claude-code
npm run inspect -- http://localhost:3100/mcp --agent-id gemini-cli
```

Claude Code sees 10 tools, Gemini CLI sees 8 - the two write tools are filtered out
of Gemini's list entirely.

## Checkpoint

1. `/mcp` in Claude Code lists `workshop-notes`.
2. In Claude Code, ask: *"use the workshop-notes server to list the notes"* - the
   model calls `list_notes`.
3. In Gemini CLI, `/mcp` lists `workshop-notes`.

## Takeaway

- Claude Code wants `type`; Gemini CLI wants `httpUrl` for HTTP
- Both support stdio with `command` + `args`
- The gateway makes the agent identity explicit, so you can give the two clients
  different permissions

## Exercise

Add `excludeTools` to the Gemini config so `mcp__workshop-gateway__upstream__workshop__delete_note`
is hidden from Gemini, and confirm with `/mcp` inside Gemini CLI.
