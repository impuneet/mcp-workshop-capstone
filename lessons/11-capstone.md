# Lesson 11 - Capstone (10 minutes)

**Goal:** you leave with a plan, not just notes.

## The brief

Build an MCP server for a domain you actually work in, and put it behind the
gateway.

Requirements:

1. **Three tools**, at least one of which is a write and one of which is read-only.
   Annotate them properly.
2. **One resource** and **one resource template** over the same data.
3. **One prompt** the user can invoke.
4. **A resource your server does not own** - a third-party server, or an existing
   REST API you wrapped.
5. **A policy** that gives a second agent less than the first: no writes, no
   sampling, and a rate limit.
6. **A decision you can defend**: stdio or HTTP, and why.
7. **One paragraph on the 2026-07-28 revision**: for each of your primitives, say
   what changes when the session goes away - which of your calls becomes an
   `input_required` round trip, which of your resource URIs needs a cache scope,
   and what your auth story looks like with a pinned issuer and a bound audience.

## Where to put it

```
apps/server/src/mcp/tools.ts        <- your tools
apps/server/src/mcp/resources.ts    <- your resources
apps/server/src/mcp/prompts.ts      <- your prompts
apps/server/src/notes/              <- your domain, replace the notes one
```

Or start a third app:

```bash
mkdir -p apps/my-server/src
cp apps/server/tsconfig.json apps/my-server/tsconfig.json
```

and add it to the `workspaces` array in the root `package.json`.

## The checklist

```bash
# 1. your tools are visible and described
npm run inspect -- http://localhost:3000/mcp

# 2. your write tool is actually blocked for the read-only agent
npm run inspect -- http://localhost:3100/mcp --agent-id gemini-cli --call upstream__workshop__create_note

# 3. your server works over both transports
npm run inspect -- --stdio npm run start:stdio -w @workshop/server

# 4. the whole thing still passes
npm run smoke
```

## The questions to answer out loud

1. Which transport, and what breaks if you switch?
2. Where does the trust boundary sit - the host, the gateway, or your server?
3. What is your server's most dangerous tool, and what stops an agent from calling it
   when it should not?
4. If a third party ships a new version of their server with a new tool, what happens
   in your gateway? (Hint: `notifications/tools/list_changed` - and your gateway
   should forward it. Does yours?)
5. What would you need to add before putting this in front of a real team?
6. Which of your tools would survive the move to a stateless protocol, and which one
   needs an `input_required` round trip first?

## Optional stretch

- Make the gateway forward `notifications/tools/list_changed` when an upstream
  changes its tool list. `UpstreamService` already listens for it via the SDK's
  `setNotificationHandler`.
- Add an OAuth-protected remote upstream.
- Write the policies to a JSON file and load them at boot, so they are versioned.

## Where to go next

- The spec: <https://modelcontextprotocol.io/specification>
- The SDK and examples: <https://github.com/modelcontextprotocol/typescript-sdk>
- Reference servers: <https://github.com/modelcontextprotocol/servers>
- Claude Code MCP docs: <https://code.claude.com/docs/en/mcp>
- Gemini CLI MCP docs: <https://geminicli.com/docs/tools/mcp-server/>
