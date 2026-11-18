import { Injectable, Logger } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CreateMessageRequestSchema, ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import * as path from 'node:path';

export interface UpstreamTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; [k: string]: unknown };
}

export interface UpstreamRecipe {
  id: string;
  label: string;
  transport: 'http' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
}

export interface UpstreamConnection {
  recipe: UpstreamRecipe;
  client: Client;
  tools: UpstreamTool[];
  connected: boolean;
  error?: string;
}

/**
 * How an upstream server is allowed to call back into the agent session
 * that triggered the current tool call.
 */
export interface UpstreamHooks {
  sampling: (params: any) => Promise<any>;
  elicitation: (params: any) => Promise<any>;
}

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const SANDBOX_DIR = path.join(REPO_ROOT, 'sandbox');

/**
 * The gateway is an MCP *client* towards the servers it fronts.
 *
 * Connections are made per agent session, not shared. That is what makes the
 * bidirectional flows correct: when an upstream server calls back with a
 * sampling or elicitation request, the connection it arrives on already
 * belongs to exactly one agent.
 */
@Injectable()
export class UpstreamService {
  private readonly logger = new Logger(UpstreamService.name);
  readonly recipes: UpstreamRecipe[] = [];

  constructor() {
    this.recipes.push({
      id: 'workshop',
      label: 'Workshop notes (our own NestJS server)',
      transport: 'http',
      url: process.env.WORKSHOP_MCP_URL ?? 'http://localhost:3000/mcp',
    });

    // Third-party server, spawned as a child process over stdio.
    // DISABLE_FILES_UPSTREAM=1 skips it (e.g. when the package is not installed).
    if (process.env.DISABLE_FILES_UPSTREAM !== '1') {
      this.recipes.push({
        id: 'files',
        label: 'Filesystem sandbox (third-party MCP server)',
        transport: 'stdio',
        command: require.resolve('@modelcontextprotocol/server-filesystem/dist/index.js'),
        args: [process.env.FILES_SANDBOX_DIR ?? SANDBOX_DIR],
      });
    }

    // Any other third-party server, e.g. https://mcp.deepwiki.com/mcp
    if (process.env.REMOTE_MCP_URL) {
      this.recipes.push({
        id: 'remote',
        label: 'Third-party remote server',
        transport: 'http',
        url: process.env.REMOTE_MCP_URL,
      });
    }
  }

  /** Opens a new connection to an upstream server. */
  async connect(recipe: UpstreamRecipe, hooks: UpstreamHooks): Promise<UpstreamConnection> {
    const connection: UpstreamConnection = {
      recipe,
      client: this.createClient(recipe, hooks),
      tools: [],
      connected: false,
    };

    try {
      await connection.client.connect(this.transportFor(recipe));
      const { tools } = await connection.client.listTools();
      connection.tools = tools as unknown as UpstreamTool[];
      connection.connected = true;
      this.logger.log(`upstream "${recipe.id}" connected with ${connection.tools.length} tools`);
    } catch (err) {
      connection.error = (err as Error).message;
      this.logger.warn(`upstream "${recipe.id}" failed: ${connection.error}`);
    }

    return connection;
  }

  /** Short-lived connection used by the health endpoint. */
  async probe(recipe: UpstreamRecipe) {
    const connection = await this.connect(recipe, {
      sampling: async () => {
        throw new Error('probe connection does not accept callbacks');
      },
      elicitation: async () => {
        throw new Error('probe connection does not accept callbacks');
      },
    });
    await connection.client.close().catch(() => undefined);
    return {
      id: recipe.id,
      label: recipe.label,
      transport: recipe.transport,
      target: recipe.url ?? [recipe.command, ...(recipe.args ?? [])].join(' '),
      connected: connection.connected,
      error: connection.error,
      tools: connection.tools.map((t) => t.name),
    };
  }

  private createClient(recipe: UpstreamRecipe, hooks: UpstreamHooks): Client {
    // We advertise sampling and elicitation so upstream servers are allowed to
    // call back into us. The model and the human live in the agent, not here.
    const client = new Client(
      { name: `workshop-gateway-${recipe.id}`, version: '1.0.0' },
      { capabilities: { sampling: {}, elicitation: { form: {} } } },
    );

    client.setRequestHandler(CreateMessageRequestSchema, async (req) => hooks.sampling(req.params));
    client.setRequestHandler(ElicitRequestSchema, async (req) => hooks.elicitation(req.params));

    return client;
  }

  private transportFor(recipe: UpstreamRecipe): Transport {
    if (recipe.transport === 'stdio') {
      return new StdioClientTransport({ command: recipe.command!, args: recipe.args ?? [] });
    }
    return new StreamableHTTPClientTransport(new URL(recipe.url!));
  }
}
