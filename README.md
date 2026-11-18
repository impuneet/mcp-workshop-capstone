# MCP Tools Workshop - 3 hours, hands-on

Build MCP servers in **NestJS**, wire **third-party MCP servers** into **Claude Code**
and **Gemini CLI**, then run a **multi-agent gateway** that puts every agent behind a
policy, an audit trail and a controlled bidirectional channel.

Everything in this repo is runnable. Every lesson ends with a checkpoint you can
verify from the terminal.

---

## The 3 hours

| # | Lesson | Minutes | You will |
|---|--------|---------|----------|
| 0 | [Setup check](lessons/00-setup.md) | 10 | Verify your toolchain, start both apps |
| 1 | [What MCP is](lessons/01-what-is-mcp.md) | 10 | Explain host/client/server, JSON-RPC, capabilities |
| 2 | [Your first NestJS MCP server](lessons/02-first-server.md) | 20 | Ship a server with tools, resources and prompts |
| 3 | [Transports](lessons/03-transports.md) | 20 | Choose stdio vs Streamable HTTP; sessions vs stateless |
| 4 | [Resources and prompts](lessons/04-resources-and-prompts.md) | 15 | URI contracts, templates, subscriptions, cache hints |
| 5 | [Third-party servers](lessons/05-third-party.md) | 15 | Consume the official filesystem server from NestJS |
| 6 | [Claude Code and Gemini CLI](lessons/06-clients.md) | 15 | Connect both agents, including our own server |
| 7 | [Multi-agent gateway](lessons/07-gateway.md) | 25 | Route several agents through one policy layer |
| 8 | [Bidirectional flows](lessons/08-bidirectional.md) | 20 | Sampling, elicitation, roots, MRTR |
| 9 | [Tasks and MCP Apps](lessons/09-tasks-and-apps.md) | 10 | The 2026 extensions: durable work and interactive HTML |
| 10 | [Security, auth and production](lessons/10-auth-and-production.md) | 10 | Poisoning, injection, OAuth 2.1 + PKCE, audience binding |
| 11 | [Capstone](lessons/11-capstone.md) | 10 | Extend it and defend your choices |

Total: **180 minutes**, plus breaks.

---

## Two protocol eras - read this first

MCP has two shapes in play, and this workshop teaches both.

| | **Era 1** (this repo) | **Era 2** (`2026-07-28`) |
|---|---|---|
| Handshake | `initialize` / `notifications/initialized` | `server/discover` |
| Session | `Mcp-Session-Id`, one transport per session | none - every request is self-describing |
| Streamable HTTP | `POST` + `GET` (SSE) + `DELETE` | `POST` only; `GET`/`DELETE` return `405` |
| Server -> client | live reverse requests (sampling, elicitation) | `input_required` result + client retry |
| Change delivery | `resources/subscribe` | `subscriptions/listen` |
| Cache hints | none | `ttlMs`, `cacheScope` |
| Extensions | - | `io.modelcontextprotocol/tasks`, `.../ui` |

**The code in this repo is Era 1**, because the installed SDK is `1.32.2` and the
agents you will plug into - Claude Code and Gemini CLI - speak Era 1 today. The
lessons mark every place where Era 2 differs, with the wire shapes, so you can
build for the version your clients will speak next.

Lessons 9 and 10 are entirely about Era 2 (the extensions and the production auth
profile) and are read-only - there is no code to run.

---

## Prerequisites

- Node.js 20+ (this repo was built on 24)
- Claude Code (`claude`) or Gemini CLI (`gemini`) - either one is enough for lesson 6
- No API keys needed. No cloud account. Nothing leaves your machine.

```bash
npm install          # installs all workspaces
```

> The install pulls `@modelcontextprotocol/server-filesystem`, the official third-party
> MCP server used in lessons 5 and 7. It is a local stdio server with no network access.

---

## The two apps

```
apps/server    your own MCP server (NestJS)  -> http://localhost:3000/mcp
apps/gateway   multi-agent gateway (NestJS)  -> http://localhost:3100/mcp
scripts/       inspect-mcp.ts, smoke.ts
sandbox/       the only directory the filesystem server may touch
```

### Start everything

```bash
npm run server:http     # terminal 1 - our MCP server on :3000
npm run gateway         # terminal 2 - the gateway on :3100
```

### Check it works

```bash
npm run smoke                                   # end-to-end self-test
npm run inspect -- http://localhost:3000/mcp    # list tools of any MCP server
```

### Ports and environment variables

| Variable | Default | Meaning |
|---|---|---|
| `PORT` (server) | `3000` | Port of the workshop server |
| `PORT` (gateway) | `3100` | Port of the gateway |
| `WORKSHOP_MCP_URL` | `http://localhost:3000/mcp` | Where the gateway finds our server |
| `REMOTE_MCP_URL` | unset | Extra third-party server, e.g. `https://mcp.deepwiki.com/mcp` |
| `DISABLE_FILES_UPSTREAM` | unset | `1` skips the filesystem upstream |
| `FILES_SANDBOX_DIR` | `./sandbox` | Directory the filesystem server may access |

> **If port 3000 is already taken**, something else on the machine owns it. Either
> stop that process, or run on another port and point the gateway at it:
> `PORT=3200 npm run server:http` and
> `WORKSHOP_MCP_URL=http://localhost:3200/mcp PORT=3300 npm run gateway`.

---

## Lesson map

```
lessons/
  00-setup.md             toolchain check, run both apps
  01-what-is-mcp.md       the model, and the two protocol eras
  02-first-server.md      build the server
  03-transports.md        stdio vs Streamable HTTP, sessions vs stateless
  04-resources-and-prompts.md   URI contracts, templates, subscriptions, cache hints
  05-third-party.md       consume an existing MCP server
  06-clients.md           Claude Code + Gemini CLI
  07-gateway.md           multi-agent gateway and policies
  08-bidirectional.md     sampling, elicitation, roots, MRTR
  09-tasks-and-apps.md    the 2026 extensions
  10-auth-and-production.md  guardrails and OAuth 2.1
  11-capstone.md          build on top
```

Every lesson follows the same shape: **Goal -> Live task -> Checkpoint -> Takeaway -> Exercise.**

---

## The slide deck

| File | What it is |
|---|---|
| `slides/mcp-workshop.pptx` | 22 slides, generated from the twelve lessons |
| `slides/mcp-workshop.ipynb` | A Colab notebook that builds the same deck in the cloud |
| `scripts/build_slides.py` | The builder - the lesson content lives in its `LESSONS` table |
| `scripts/build_notebook.py` | Regenerates the notebook from the builder |

```bash
npm run slides      # rebuild slides/mcp-workshop.pptx
npm run notebook    # rebuild slides/mcp-workshop.ipynb
```

To work on the deck without a local Python install, open
`slides/mcp-workshop.ipynb` at [notebook.google.com](https://notebook.google.com)
and run the cells. It writes the `.pptx`, checks it against the lesson table
(180 minutes, every lesson present), and downloads it. Upload that file to Drive
and **Open with -> Google Slides** to get an editable deck - the theme uses only
Trebuchet MS, Arial and Courier New, all of which Google Slides has.

---

## What is verified and what is not

Verified by running it in this repo:

- The NestJS MCP server over **Streamable HTTP** (`/mcp`) and over **stdio**
- Tool, resource, resource-template and prompt listing
- Resource reads, including the `-32602` error for an unknown URI
- The gateway proxying upstream tools with per-agent tool filtering
  (10 tools for `claude-code`, 8 for the read-only `gemini-cli`)
- **Sampling** round trip: agent -> gateway -> upstream server -> gateway -> agent
- **Elicitation** round trip: the upstream asks the agent's user to confirm
- Policy denial (read-only agent) and the audit trail recording it

Not verified here:

- The `@modelcontextprotocol/server-filesystem` upstream actually spawning.
  The code path is identical to the HTTP upstream, but run lesson 5 yourself to see it.
- `npm run smoke` - the script is written and covers the checks above, but it
  has not been executed in this environment. Run it before you teach from this repo.
- Everything in **Era 2**. Lessons 3, 4, 8, 9 and 10 describe the `2026-07-28`
  wire format from the specification. There is no Era 2 implementation in this repo,
  and Claude Code / Gemini CLI cannot connect to one yet.

---

## Handy commands

```bash
npm run inspect -- http://localhost:3000/mcp                       # list everything
npm run inspect -- http://localhost:3000/mcp --call list_notes     # call a tool
npm run inspect -- http://localhost:3000/mcp --resource notes://all # read a resource
npm run inspect -- http://localhost:3000/mcp --prompt summarize_note --args '{"noteId":"x"}'
npm run inspect -- http://localhost:3100/mcp --agent-id gemini-cli  # act as one agent
npm run inspect -- --stdio npm run start:stdio -w @workshop/server  # stdio transport
curl -s http://localhost:3100/api/health                           # gateway status
curl -s http://localhost:3100/api/policies                         # current policies
curl -s http://localhost:3100/api/audit                            # audit trail
curl -sX PATCH http://localhost:3100/api/policies/gemini-cli \
  -H 'content-type: application/json' -d '{"readOnly":false}'      # change policy live
```

---

## References

- [Model Context Protocol (MCP) Official Documentation](https://modelcontextprotocol.io)
- [Official TypeScript SDK Repository (`@modelcontextprotocol/sdk`)](https://github.com/modelcontextprotocol/typescript-sdk)
- [AI Engineering from Scratch - MCP Cheatsheet](https://github.com/rohitg00/ai-engineering-from-scratch/blob/main/cheatsheets/mcp.md)
