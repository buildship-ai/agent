import type {
  AgentConfig,
  AgentInput,
  ClientTool,
  ExecuteOptions,
  SessionId,
  StreamCallbacks,
} from "./types";
import { AgentSession } from "./session";

const DEFAULT_BASE_URL = "https://api.buildship.run";

/**
 * Main entry point for interacting with a BuildShip agent.
 *
 * @example
 * ```ts
 * import { BuildShipAgent } from "buildship-agent-sdk/core";
 *
 * const agent = new BuildShipAgent({
 *   agentId: "your-agent-id",
 *   accessKey: "your-access-key",
 * });
 *
 * const session = await agent.execute("Hello!", {
 *   onText: (text) => console.log(text),
 *   onComplete: (fullText) => console.log("Done!", fullText),
 * });
 * ```
 */
export class BuildShipAgent {
  /** @internal */ readonly _agentId: string;
  /** @internal */ readonly _accessKey?: string;
  /** @internal */ readonly _baseUrl: string;
  /** @internal */ readonly _clientTools = new Map<string, ClientTool>();

  constructor(config: AgentConfig) {
    if (!config.agentId) {
      throw new Error("BuildShipAgent: agentId is required");
    }
    this._agentId = config.agentId;
    this._accessKey = config.accessKey;
    this._baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
  }

  /**
   * The URL for the agent's execute endpoint.
   * @internal
   */
  get _url(): string {
    return `${this._baseUrl}/executeAgent/${this._agentId}`;
  }

  /**
   * Build the authorization / common headers.
   * @internal
   */
  _buildHeaders(sessionId?: SessionId): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this._accessKey) {
      headers["Authorization"] = `Bearer ${this._accessKey}`;
    }
    if (sessionId) {
      headers["X-BuildShip-Agent-Session-ID"] = sessionId;
    }
    return headers;
  }

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Start a new conversation.
   *
   * Creates a fresh session and sends the first message.
   *
   * @param message  - The message to send
   * @param callbacks - Event handlers for the stream
   * @param options   - Optional execution settings (context, headers, body, onSessionId)
   * @returns The new session
   */
  async execute(
    message: AgentInput,
    callbacks: StreamCallbacks,
    options?: ExecuteOptions,
  ): Promise<AgentSession> {
    const session = new AgentSession(this);
    await session.execute(message, callbacks, options);
    return session;
  }

  /**
   * Get an existing session by ID to continue a conversation.
   *
   * @param sessionId - The session ID from a previous conversation
   * @returns The session object
   */
  session(sessionId: SessionId | string): AgentSession {
    if (!sessionId) {
      throw new Error("BuildShipAgent.session(): sessionId is required");
    }
    return new AgentSession(this, sessionId as SessionId);
  }

  /**
   * Register a client-side tool that the agent can call.
   */
  registerClientTool(tool: ClientTool): void {
    if (!tool.name) {
      throw new Error("registerClientTool: tool.name is required");
    }
    this._clientTools.set(tool.name, tool);
  }

  /**
   * Remove a registered client tool.
   */
  unregisterClientTool(name: string): void {
    this._clientTools.delete(name);
  }
}
