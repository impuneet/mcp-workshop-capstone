# Lesson 0 - Setup check (10 minutes)

**Goal:** everyone leaves this room with a working toolchain and two running servers.

## 0.1 Verify the toolchain

```bash
node -v          # needs v20 or newer
npm -v
claude --version # or: gemini --version
```

## 0.2 Install and build

```bash
npm install
npm run build    # type-checks both apps
```

If `npm install` warns about `EBADENGINE` for `@angular-devkit/schematics`, ignore it -
that package belongs to `nest generate`, which this workshop does not use.

## 0.3 Start the two apps

```bash
npm run server:http     # terminal 1
npm run gateway         # terminal 2
```

The gateway needs the workshop server to be up first. It prints one line per upstream:

```
upstream "workshop" connected with 6 tools
upstream "files" connected with 11 tools
```

If `files` fails, the package did not install. Skip it for now -
`DISABLE_FILES_UPSTREAM=1 npm run gateway` runs without it.

## 0.4 Checkpoint

```bash
curl -s http://localhost:3000/api/notes        # our REST API
npm run inspect -- http://localhost:3000/mcp    # our MCP server
curl -s http://localhost:3100/api/health        # the gateway
```

You should see six tools: `add`, `list_notes`, `search_notes`, `create_note`,
`delete_note`, `draft_summary`.

**Checkpoint:** `inspect` prints `connected to workshop-notes v1.0.0` and a list of tools.

## 0.5 The one command that checks everything

```bash
npm run smoke
```

It boots both apps in-process, connects a client, lists tools, calls a tool,
runs a sampling round trip and asserts the audit trail. If this passes, your
environment is good and you can skip the manual checks.

> The individual checks in this workshop have been run and pass against this repo.
> The `smoke` script bundles them and has **not** been executed in this
> environment - run it yourself before you teach from this deck, and if it fails
> fall back to the manual checks in 0.4.

## Takeaway

Two apps, two ports, one protocol. Everything from here is a variation on that.

## Exercise

Change `PORT=3000` to `PORT=4000` in one terminal and watch the gateway lose its
upstream. Then set `WORKSHOP_MCP_URL=http://localhost:4000/mcp` on the gateway and
watch it come back.
