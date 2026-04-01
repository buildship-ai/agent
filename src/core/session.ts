import type {
  AgentInput,
  SessionId,
  StreamCallbacks,
  PausedToolInfo,
  ExecuteRequestBody,
  ExecuteOptions,
} from "./types";
import type { BuildShipAgent } from "./agent";
import { executeStream } from "./stream";
import { toJSONSchema, type ZodSchema } from "zod";

/**
 * Represents a conversation session with a BuildShip agent.
 *
 * Sessions maintain history across multiple turns and support
 * pause/resume for blocking client tools.
 */
export class AgentSession {
  /** @internal */ private _agent: BuildShipAgent;
  /** @internal */ private _sessionId: SessionId | undefined;
  /** @internal */ private _paused = false;
  /** @internal */ private _pausedToolInfo: PausedToolInfo | null = null;
  /** @internal */ private _abortController: AbortController | null = null;

  /** @internal */
  constructor(agent: BuildShipAgent, sessionId?: SessionId) {
    this._agent = agent;
    this._sessionId = sessionId;
  }

  // ─── Public API ────────────────────────────────────────────────────

  /**
   * Send a message in this session.
   *
   * @param message   - The message to send
   * @param callbacks - Event handlers for the stream
   * @param callbacks - Event handlers for the stream
   * @param options   - Optional settings like context, headers, or body
   * @returns This session (for chaining)
   */
  async execute(
    message: AgentInput,
    callbacks: StreamCallbacks,
    options?: ExecuteOptions,
  ): Promise<AgentSession> {
    this._paused = false;
    this._pausedToolInfo = null;

    const body: ExecuteRequestBody = {
      ...(options?.body || {}),
      input: message,
      stream: true,
    };

    // Attach context as top-level properties if provided
    if (options?.context) {
      Object.assign(body, { context: options.context });
    }

    // Include client tool definitions
    const clientToolDefs = this._getClientToolDefs();
    if (clientToolDefs.length > 0) {
      body.clientTools = clientToolDefs;
    }

    await this._run(body, callbacks, options);
    return this;
  }

  /**
   * Resume a paused session with a tool result.
   *
   * @param result    - The result to send back to the agent
   * @param callbacks - Event handlers for the resumed stream
   * @param options   - Optional settings like headers or body
   * @returns This session (for chaining)
   */
  async resume(
    result: any,
    callbacks: StreamCallbacks,
    options?: ExecuteOptions,
  ): Promise<AgentSession> {
    if (!this._paused || !this._pausedToolInfo) {
      throw new Error("AgentSession.resume(): session is not paused. Check isPaused() first.");
    }

    const body: ExecuteRequestBody = {
      ...(options?.body || {}),
      stream: true,
      toolCallResult: {
        callId: this._pausedToolInfo.callId,
        result,
      },
    };

    // Attach context if provided
    if (options?.context) {
      Object.assign(body, { context: options.context });
    }

    // Include client tool definitions for resume requests too
    const clientToolDefs = this._getClientToolDefs();
    if (clientToolDefs.length > 0) {
      body.clientTools = clientToolDefs;
    }

    this._paused = false;
    this._pausedToolInfo = null;

    await this._run(body, callbacks, options);
    return this;
  }

  /**
   * Resume a session with an explicit tool call ID and result.
   *
   * Unlike `resume()`, this does NOT require the session to be in a paused state,
   * making it suitable for external resume flows (e.g. React widget submissions)
   * where the session object may have been re-created.
   *
   * @param callId    - The tool call ID to resume
   * @param result    - The result to send back to the agent
   * @param callbacks - Event handlers for the resumed stream
   * @param options   - Optional settings like headers or body
   * @returns This session (for chaining)
   */
  async resumeWithCallId(
    callId: string,
    result: any,
    callbacks: StreamCallbacks,
    options?: ExecuteOptions,
  ): Promise<AgentSession> {
    const body: ExecuteRequestBody = {
      ...(options?.body || {}),
      stream: true,
      toolCallResult: { callId, result },
    };

    // Attach context if provided
    if (options?.context) {
      Object.assign(body, { context: options.context });
    }

    // Include client tool definitions for resume requests too
    const clientToolDefs = this._getClientToolDefs();
    if (clientToolDefs.length > 0) {
      body.clientTools = clientToolDefs;
    }

    // Clear any stale pause state
    this._paused = false;
    this._pausedToolInfo = null;

    await this._run(body, callbacks, options);
    return this;
  }

  /**
   * Check if this session is waiting for a tool result.
   */
  isPaused(): boolean {
    return this._paused;
  }

  /**
   * Get information about the paused tool call.
   * Returns `null` if the session is not paused.
   */
  getPausedTool(): PausedToolInfo | null {
    return this._pausedToolInfo;
  }

  /**
   * Get the session ID.
   * May be `undefined` if the session hasn't executed yet.
   */
  getSessionId(): SessionId {
    if (!this._sessionId) {
      throw new Error(
        "AgentSession.getSessionId(): session ID not yet available. Call execute() first.",
      );
    }
    return this._sessionId;
  }

  /**
   * Cancel the current streaming operation.
   */
  abort(): void {
    this._abortController?.abort();
    this._abortController = null;
  }

  // ─── Private helpers ───────────────────────────────────────────────

  /** @internal */
  private async _run(
    body: ExecuteRequestBody,
    callbacks: StreamCallbacks,
    options?: ExecuteOptions,
  ): Promise<void> {
    // Create a fresh abort controller for this run
    this._abortController = new AbortController();

    const baseHeaders = this._agent._buildHeaders(this._sessionId);
    const mergedHeaders = { ...baseHeaders, ...(options?.headers || {}) };

    await executeStream({
      url: this._agent._url,
      body,
      headers: mergedHeaders,
      callbacks,
      clientTools: this._agent._clientTools,
      signal: this._abortController.signal,

      onSessionId: (id, name) => {
        this._sessionId = id;
        options?.onSessionId?.(id, name);
      },

      onPaused: (info) => {
        this._paused = true;
        this._pausedToolInfo = info;
      },

      onAutoResume: async (callId, result) => {
        // Auto-resume: send the tool result back immediately
        const resumeBody: ExecuteRequestBody = {
          ...(options?.body || {}),
          stream: true,
          toolCallResult: { callId, result },
        };

        // Carry context forward from the original execute options
        if (options?.context) {
          Object.assign(resumeBody, { context: options.context });
        }

        const clientToolDefs = this._getClientToolDefs();
        if (clientToolDefs.length > 0) {
          resumeBody.clientTools = clientToolDefs;
        }

        await this._run(resumeBody, callbacks, options);
      },
    });
  }

  /** @internal */
  private _getClientToolDefs() {
    const defs: ExecuteRequestBody["clientTools"] = [];
    for (const tool of this._agent._clientTools.values()) {
      defs.push({
        name: tool.name,
        description: tool.description,
        parameters: resolveParameters(tool.parameters),
        await: tool.await,
        ...(tool.targetAgentIds && { targetAgentIds: tool.targetAgentIds }),
      });
    }
    return defs;
  }
}

/**
 * Convert tool parameters to a JSON Schema object.
 * - If it's a Zod schema, uses Zod's built-in `toJSONSchema` to convert.
 * - Always ensures `additionalProperties: false` is set (required by the backend).
 * - Always ensures `required` includes every key in `properties` (Gemini requirement).
 * @internal
 */
function resolveParameters(params: any): Record<string, any> {
  let schema: Record<string, any>;

  // Detect Zod schema: ZodType instances have a `_def` property
  if (params && typeof params === "object" && "_def" in params) {
    schema = toJSONSchema(params as ZodSchema) as Record<string, any>;
    // Remove $schema key if present
    delete schema.$schema;
  } else {
    schema = { ...params };
  }

  if (schema.type === "object") {
    // Backend requires additionalProperties: false
    schema.additionalProperties = false;

    // Gemini requires `required` to include every key in `properties`
    if (schema.properties) {
      schema.required = Object.keys(schema.properties);
    }
  }

  return schema;
}
