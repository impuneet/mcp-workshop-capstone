import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'node:crypto';
import { AuditService } from './audit';
import { AgentPolicy, matches, PolicyService } from './policies';
import { UpstreamConnection, UpstreamService, UpstreamTool } from './upstreams';

interface Session {
  id: string;
  server: Server;
  transport: StreamableHTTPServerTransport;
  /** Agent identity seen for this session. */
  agentId: string;
  /** One connection per upstream server, scoped to this agent. */
  upstreams: Map<string, UpstreamConnection>;
}

const NATIVE_TOOLS: Tool[] = [
  {
    name: 'whoami',
    description:
      'Returns the agent identity the gateway sees for this session, the policy applied to it and what that policy allows.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_upstreams',
    description: 'Lists the MCP servers this gateway fronts, with their transport and tools.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'audit_tail',
    description: 'Returns the most recent tool calls the gateway handled, for every agent.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'How many entries (default 20)' } },
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'simulate_slow_task',
    description:
      'Runs a slow task and streams progress notifications back to the agent while it runs.',
    inputSchema: {
      type: 'object',
      properties: { steps: { type: 'number', description: 'How many steps (default 3)' } },
    },
    annotations: { readOnlyHint: true },
  },
];

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /disregard\s+(the\s+)?(system|previous)\s+prompt/i,
  /you\s+are\s+now\s+/i,
  /reveal\s+(your|the)\s+(system\s+)?prompt/i,
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class GatewayService implements OnModuleDestroy {
  private readonly logger = new Logger(GatewayService.name);
  private readonly sessions = new Map<string, Session>();
  private readonly callTimes = new Map<string, number[]>();

  constructor(
    private readonly upstreams: UpstreamService,
    private readonly policies: PolicyService,
    private readonly audit: AuditService,
  ) {}

  mountHttp(expressApp: any) {
    const bySession = (req: any) => {
      const id = req.headers['mcp-session-id'] as string | undefined;
      return id ? this.sessions.get(id) : undefined;
    };

    expressApp.post('/mcp', async (req: any, res: any) => {
      const session = bySession(req) ?? (await this.createSession());
      try {
        await session.transport.handleRequest(req, res, req.body);
      } catch (err) {
        this.logger.error(`MCP request failed: ${(err as Error).message}`);
        if (!res.headersSent) res.status(500).json({ error: (err as Error).message });
      }
    });

    expressApp.get('/mcp', async (req: any, res: any) => {
      const session = bySession(req);
      if (!session) {
        res.status(400).json({ error: 'Missing or invalid mcp-session-id header' });
        return;
      }
      await session.transport.handleRequest(req, res);
    });

    expressApp.delete('/mcp', async (req: any, res: any) => {
      const session = bySession(req);
      if (!session) {
        res.status(404).json({ error: 'Unknown session' });
        return;
      }
      await session.transport.handleRequest(req, res);
    });
  }

  async onModuleDestroy() {
    for (const session of this.sessions.values()) {
      for (const connection of session.upstreams.values()) {
        await connection.client.close().catch(() => undefined);
      }
      await session.transport.close().catch(() => undefined);
    }
    this.sessions.clear();
  }

  // ---------------------------------------------------------------- sessions

  private async createSession(): Promise<Session> {
    const server = new Server(
      { name: 'workshop-gateway', version: '1.0.0' },
      {
        capabilities: { tools: { listChanged: true }, logging: {} },
        instructions:
          'This gateway fronts other MCP servers. Tools are named upstream__<server>__<tool>. ' +
          'Use whoami to see which agent you are and what you are allowed to do.',
      },
    );

    const session: Session = {
      id: randomUUID(),
      server,
      transport: undefined as any,
      agentId: 'unknown-agent',
      upstreams: new Map(),
    };

    // The callbacks an upstream server can use to reach back into this agent.
    const hooks = {
      sampling: async (params: any) => {
        const policy = this.policies.for(session.agentId);
        if (!policy.allowSampling) {
          throw new Error(`Sampling is disabled for agent "${session.agentId}".`);
        }
        return await server.createMessage({
          messages: params.messages,
          systemPrompt: params.systemPrompt,
          maxTokens: params.maxTokens ?? 500,
          includeContext: 'none',
        });
      },
      elicitation: async (params: any) => {
        const policy = this.policies.for(session.agentId);
        if (!policy.allowElicitation) {
          throw new Error(`Elicitation is disabled for agent "${session.agentId}".`);
        }
        return await server.elicitInput({
          message: params.message,
          requestedSchema: params.requestedSchema,
          mode: 'form',
        } as any);
      },
    };

    server.setRequestHandler(ListToolsRequestSchema, async (_req, extra) => {
      this.resolveAgentId(session, server, extra);
      return { tools: this.toolsFor(session) };
    });

    server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
      this.resolveAgentId(session, server, extra);
      return this.handleToolCall(
        req.params.name,
        (req.params.arguments ?? {}) as Record<string, unknown>,
        session,
        extra,
      );
    });

    let transport!: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, session);
        this.logger.log(`agent session opened: ${sessionId}`);
      },
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId);
        this.logger.log(`agent session closed: ${sessionId}`);
      },
    });
    session.transport = transport;

    server.connect(transport);

    // One upstream connection per agent session. Isolating them is what makes
    // the callbacks above unambiguous.
    await Promise.all(
      this.upstreams.recipes.map(async (recipe) => {
        const connection = await this.upstreams.connect(recipe, hooks);
        session.upstreams.set(recipe.id, connection);
      }),
    );

    return session;
  }

  /**
   * Agent identity: the `x-agent-id` header if the client sends one,
   * otherwise the client name from the MCP handshake.
   */
  private resolveAgentId(session: Session, server: Server, extra: any) {
    const header = extra?.requestInfo?.headers?.['x-agent-id'];
    const raw =
      (typeof header === 'string' && header.trim()) ||
      server.getClientVersion()?.name?.trim() ||
      session.agentId;
    session.agentId = raw.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  }

  // ------------------------------------------------------------------ tools

  private toolsFor(session: Session): Tool[] {
    const policy = this.policies.for(session.agentId);
    const tools: Tool[] = [...NATIVE_TOOLS];

    for (const connection of session.upstreams.values()) {
      if (!matches(policy.allowedUpstreams, connection.recipe.id)) continue;

      for (const tool of connection.tools) {
        const name = this.proxyName(connection.recipe.id, tool.name);
        if (!matches(policy.allowedTools, name)) continue;
        if (matches(policy.denyTools, name)) continue;
        if (policy.readOnly && tool.annotations?.readOnlyHint !== true) continue;

        tools.push({
          name,
          title: `${connection.recipe.label}: ${tool.title ?? tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema as Tool['inputSchema'],
          annotations: tool.annotations as Tool['annotations'],
        });
      }
    }

    return tools;
  }

  private proxyName(upstreamId: string, toolName: string) {
    return `upstream__${upstreamId}__${toolName}`;
  }

  private parseProxyName(name: string): { upstreamId: string; toolName: string } | undefined {
    if (!name.startsWith('upstream__')) return undefined;
    const rest = name.slice('upstream__'.length);
    const separator = rest.indexOf('__');
    if (separator === -1) return undefined;
    return { upstreamId: rest.slice(0, separator), toolName: rest.slice(separator + 2) };
  }

  // ------------------------------------------------------------- tool calls

  private async handleToolCall(
    name: string,
    args: Record<string, unknown>,
    session: Session,
    extra: any,
  ) {
    const agentId = session.agentId;
    const policy = this.policies.for(agentId);
    const started = Date.now();

    if (NATIVE_TOOLS.some((t) => t.name === name)) {
      const result = await this.handleNativeTool(name, args, session, policy, extra);
      this.audit.record({
        ts: new Date().toISOString(),
        agentId,
        tool: name,
        outcome: 'ok',
        ms: Date.now() - started,
      });
      return result;
    }

    const parsed = this.parseProxyName(name);
    if (!parsed) return this.error(`Unknown tool "${name}".`);

    const connection = session.upstreams.get(parsed.upstreamId);
    const tool = connection?.tools.find((t) => t.name === parsed.toolName);
    if (!connection || !tool) {
      return this.error(
        `Upstream "${parsed.upstreamId}" or tool "${parsed.toolName}" is not available.`,
      );
    }

    const denial = this.checkPolicy(policy, parsed.upstreamId, name, tool.annotations, args);
    if (denial) {
      this.audit.record({
        ts: new Date().toISOString(),
        agentId,
        tool: name,
        upstream: parsed.upstreamId,
        outcome: 'denied',
        ms: Date.now() - started,
        detail: denial,
      });
      return this.error(denial);
    }

    if (!this.allowCall(agentId, policy.maxCallsPerMinute)) {
      const detail = `Rate limit of ${policy.maxCallsPerMinute} calls/minute exceeded for agent "${agentId}".`;
      this.audit.record({
        ts: new Date().toISOString(),
        agentId,
        tool: name,
        upstream: parsed.upstreamId,
        outcome: 'denied',
        ms: Date.now() - started,
        detail,
      });
      return this.error(detail);
    }

    try {
      const result = await connection.client.callTool(
        { name: parsed.toolName, arguments: args },
        undefined,
        { timeout: 30_000 },
      );

      this.audit.record({
        ts: new Date().toISOString(),
        agentId,
        tool: name,
        upstream: parsed.upstreamId,
        outcome: 'ok',
        ms: Date.now() - started,
      });
      return result;
    } catch (err) {
      const detail = (err as Error).message;
      this.audit.record({
        ts: new Date().toISOString(),
        agentId,
        tool: name,
        upstream: parsed.upstreamId,
        outcome: 'error',
        ms: Date.now() - started,
        detail,
      });
      return this.error(detail);
    }
  }

  private checkPolicy(
    policy: AgentPolicy,
    upstreamId: string,
    toolName: string,
    annotations: UpstreamTool['annotations'],
    args: Record<string, unknown>,
  ): string | undefined {
    if (!matches(policy.allowedUpstreams, upstreamId)) {
      return `Agent "${policy.agentId}" may not use upstream "${upstreamId}".`;
    }
    if (matches(policy.denyTools, toolName)) {
      return `Tool "${toolName}" is denied for agent "${policy.agentId}".`;
    }
    if (!matches(policy.allowedTools, toolName)) {
      return `Tool "${toolName}" is not allowed for agent "${policy.agentId}".`;
    }
    if (policy.readOnly && annotations?.readOnlyHint !== true) {
      return `Agent "${policy.agentId}" is read-only and "${toolName}" writes.`;
    }
    if (policy.blockPromptInjection) {
      for (const value of Object.values(args)) {
        if (typeof value !== 'string') continue;
        if (INJECTION_PATTERNS.some((p) => p.test(value))) {
          return `Tool "${toolName}" was blocked: the arguments look like a prompt injection.`;
        }
      }
    }
    return undefined;
  }

  private allowCall(agentId: string, maxPerMinute: number): boolean {
    const now = Date.now();
    const recent = (this.callTimes.get(agentId) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= maxPerMinute) {
      this.callTimes.set(agentId, recent);
      return false;
    }
    recent.push(now);
    this.callTimes.set(agentId, recent);
    return true;
  }

  // --------------------------------------------------------- native tools

  private async handleNativeTool(
    name: string,
    args: Record<string, unknown>,
    session: Session,
    policy: AgentPolicy,
    extra: any,
  ) {
    switch (name) {
      case 'whoami':
        return this.text(
          JSON.stringify(
            {
              agentId: session.agentId,
              policy,
              visibleUpstreams: [...session.upstreams.keys()].filter((id) =>
                matches(policy.allowedUpstreams, id),
              ),
              visibleTools: this.toolsFor(session).map((t) => t.name),
            },
            null,
            2,
          ),
        );

      case 'list_upstreams':
        return this.text(
          JSON.stringify(
            [...session.upstreams.values()].map((c) => ({
              id: c.recipe.id,
              label: c.recipe.label,
              transport: c.recipe.transport,
              target: c.recipe.url ?? [c.recipe.command, ...(c.recipe.args ?? [])].join(' '),
              connected: c.connected,
              error: c.error,
              tools: c.tools.map((t) => t.name),
            })),
            null,
            2,
          ),
        );

      case 'audit_tail': {
        const limit = Number(args.limit ?? 20);
        return this.text(JSON.stringify(this.audit.tail(limit), null, 2));
      }

      case 'simulate_slow_task': {
        const steps = Math.max(1, Math.min(20, Number(args.steps ?? 3)));
        const token = extra?._meta?.progressToken;
        for (let i = 1; i <= steps; i++) {
          if (token !== undefined && token !== null) {
            await extra
              .sendNotification({
                method: 'notifications/progress',
                params: { progressToken: token, progress: i, total: steps, message: `step ${i}` },
              })
              .catch(() => undefined);
          }
          await sleep(400);
        }
        return this.text(`Finished ${steps} steps.`);
      }

      default:
        return this.error(`Unknown native tool "${name}".`);
    }
  }

  private text(value: string) {
    return { content: [{ type: 'text' as const, text: value }] };
  }

  private error(value: string) {
    return { content: [{ type: 'text' as const, text: value }], isError: true };
  }
}
