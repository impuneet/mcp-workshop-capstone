import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { NotesService } from '../notes/notes.service';
import { registerPrompts } from './prompts';
import { registerResources } from './resources';
import { registerTools } from './tools';

/**
 * ============================================================================
 * STUDY GUIDE & ARCHITECTURE OVERVIEW: MCP SERVICE
 * ============================================================================
 *
 */

/**
 * Represents an active client session connected over Streamable HTTP.
 *
 * Why pair an McpServer with a Transport per session?
 * In stateful MCP (Era 1), the protocol handshake (`initialize`) establishes client-specific
 * capabilities, roots, and protocol versions. By dedicating an McpServer instance
 * to each session, we guarantee that one client's state or LLM context cannot leak into
 * another client's session.
 */
interface HttpSession {
  /** The isolated MCP protocol server instance for this client session. */
  server: McpServer;
  /** The HTTP transport handling network serialization and SSE for this session. */
  transport: StreamableHTTPServerTransport;
}

@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);

  /**
   * In-memory registry of active HTTP sessions.
   * Key:   Session ID (UUID generated during transport initialization)
   * Value: HttpSession containing the server and transport pair
   */
  private readonly sessions = new Map<string, HttpSession>();

  constructor(private readonly notes: NotesService) {}

  /**
   * --------------------------------------------------------------------------
   * 1. SERVER FACTORY: buildServer()
   * --------------------------------------------------------------------------
   * Constructs and configures a fresh McpServer instance.
   *
   * Every server declares:
   * - Server Metadata (`name`, `version`): Identifies the server to connecting clients.
   * - Capabilities: A contractual promise of which protocol features this server supports:
   *     - `tools`: Callable functions that perform actions or calculations.
   *     - `resources`: Read-only data URIs (e.g., `notes://all`, `notes://{id}`).
   *     - `prompts`: User- or host-invoked prompt templates for common workflows.
   *     - `logging`: Allows the server to emit structured protocol log messages to the client.
   * - Instructions: Freeform natural language guidance delivered to the client model during
   *   initialization. This primes the LLM on what the server is for and how to use its tools.
   *
   * Notice that the underlying domain service (`NotesService`) is passed to the modular
   * registration functions (`registerTools`, `registerResources`, `registerPrompts`).
   * This keeps domain logic separate from protocol wiring.
   */
  buildServer(): McpServer {
    const server = new McpServer(
      {
        name: 'workshop-notes',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
          logging: {},
        },
        instructions:
          'Notes about the MCP workshop. Use list_notes/search_notes to read, create_note to add, delete_note to remove.',
      },
    );

    // Register all verbs (tools), nouns (resources), and templates (prompts)
    registerTools(server, this.notes);
    registerResources(server, this.notes);
    registerPrompts(server, this.notes);

    return server;
  }

  /**
   * --------------------------------------------------------------------------
   * 2. STREAMABLE HTTP TRANSPORT: mountHttp()
   * --------------------------------------------------------------------------
   * Mounts the MCP HTTP endpoints directly onto the underlying Express application instance.
   *
   * Why mount directly on Express instead of using a standard NestJS Controller?
   * ----------------------------------------------------------------------------
   * Standard NestJS controllers parse request bodies upfront and structure responses
   * according to decorators. However, Streamable HTTP is a specialized protocol:
   *  - It handles raw JSON-RPC payloads in POST requests.
   *  - It opens persistent Server-Sent Events (SSE) connections in GET requests.
   *  - It handles session headers (`mcp-session-id`) and raw stream piping.
   * Delegating directly to the MCP SDK's `transport.handleRequest(req, res)` gives
   * the SDK full control over headers, chunked streaming, and lifecycle management.
   *
   * The three HTTP endpoints conform to the Streamable HTTP specification:
   *  1. POST   /mcp : Client sends JSON-RPC requests (handshake, tool calls, etc.)
   *  2. GET    /mcp : Opens server-to-client SSE stream for notifications & sampling
   *  3. DELETE /mcp : Client explicitly terminates the session
   */
  mountHttp(expressApp: any) {
    /** Helper to lookup an existing session by reading the `mcp-session-id` header. */
    const bySession = (req: any): HttpSession | undefined => {
      const id = req.headers['mcp-session-id'] as string | undefined;
      return id ? this.sessions.get(id) : undefined;
    };

    /**
     * POST /mcp: Primary JSON-RPC interaction endpoint.
     * - If the client doesn't provide an `mcp-session-id` header (e.g. during initialization),
     *   a new session is automatically created.
     * - Subsequent requests pass the session ID to reuse the same session state.
     */
    expressApp.post('/mcp', async (req: any, res: any) => {
      const existing = bySession(req);
      const session = existing ?? this.createHttpSession();

      try {
        await session.transport.handleRequest(req, res, req.body);
      } catch (err) {
        this.logger.error(`MCP request failed: ${(err as Error).message}`);
        if (!res.headersSent) {
          res.status(500).json({ error: (err as Error).message });
        }
      }
    });

    /**
     * GET /mcp: Establishes a persistent Server-Sent Events (SSE) channel.
     * This reverse stream allows the server to send asynchronous notifications to the client,
     * including:
     *  - Resource updates (e.g., `notifications/resources/updated`)
     *  - LLM Sampling requests (server asking the client to run a prompt via `draft_summary`)
     *  - Elicitation requests (server asking the user to confirm via `delete_note`)
     */
    expressApp.get('/mcp', async (req: any, res: any) => {
      const session = bySession(req);
      if (!session) {
        res.status(400).json({ error: 'Missing or invalid mcp-session-id header' });
        return;
      }
      await session.transport.handleRequest(req, res);
    });

    /**
     * DELETE /mcp: Session termination endpoint.
     * Closes the session and frees transport/server resources when the client is done.
     */
    expressApp.delete('/mcp', async (req: any, res: any) => {
      const session = bySession(req);
      if (!session) {
        res.status(404).json({ error: 'Unknown session' });
        return;
      }
      await session.transport.handleRequest(req, res);
    });
  }

  /**
   * --------------------------------------------------------------------------
   * 3. STDIO TRANSPORT: runStdio()
   * --------------------------------------------------------------------------
   * Starts the MCP server using Standard Input/Output (stdio).
   * Used when running via CLI: `npm run start:stdio` or configured in client configs
   * (such as Claude Code's config or Gemini CLI).
   *
   * THE GOLDEN RULE OF STDIO SERVERS:
   * ----------------------------------
   * In stdio mode, standard output (`process.stdout`) is strictly reserved for JSON-RPC
   * protocol frames (one JSON object per line).
   * - NEVER use `console.log()` in a stdio server: it injects raw text into stdout,
   *   causing JSON parse errors in the client and crashing the connection!
   * - If logging is needed during stdio execution, send output to `process.stderr`
   *   or configure NestJS with `{ logger: false }`.
   */
  async runStdio(): Promise<void> {
    const server = this.buildServer();
    await server.connect(new StdioServerTransport());
  }

  /**
   * --------------------------------------------------------------------------
   * 4. SESSION LIFECYCLE MANAGEMENT: createHttpSession()
   * --------------------------------------------------------------------------
   * Creates a dedicated McpServer and StreamableHTTPServerTransport pair for a
   * newly connected HTTP client.
   *
   * Configures lifecycle hooks:
   * - `sessionIdGenerator`: Generates a unique UUID identifying this session.
   * - `onsessioninitialized`: Triggered when the client completes the initial handshake;
   *   registers the session in `this.sessions`.
   * - `onsessionclosed`: Triggered when the client disconnects or deletes the session;
   *   cleans up the session from memory to prevent leaks.
   */
  private createHttpSession(): HttpSession {
    const server = this.buildServer();
    let transport!: StreamableHTTPServerTransport;

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        this.sessions.set(sessionId, { server, transport });
        this.logger.log(`MCP session opened: ${sessionId}`);
      },
      onsessionclosed: (sessionId) => {
        this.sessions.delete(sessionId);
        this.logger.log(`MCP session closed: ${sessionId}`);
      },
    });

    // Binds the transport adapter to the protocol engine
    server.connect(transport);
    return { server, transport };
  }

  /**
   * --------------------------------------------------------------------------
   * 5. CLEANUP HOOK: onModuleDestroy()
   * --------------------------------------------------------------------------
   * NestJS lifecycle hook triggered when the application is shutting down.
   * Ensures all active client transport connections are cleanly closed and
   * all sessions are evicted from memory.
   */
  async onModuleDestroy() {
    for (const session of this.sessions.values()) {
      await session.transport.close();
    }
    this.sessions.clear();
  }
}
