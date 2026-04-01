import type { ZodSchema } from "zod";

// ─── Stream Event Types (mirrors backend output.ts) ─────────────────────────

/**
 * Unified tool type discriminator.
 */
export type ToolType = "flow" | "node" | "mcp" | "client" | "builtin" | "agent";

export type StreamEventMeta = {
  executionId: string;
  sequence: number;
  timestamp?: number;
  agentId: string;
};

export type TextDeltaEvent = {
  type: "text_delta";
  data: string;
  meta: StreamEventMeta;
};

export type ReasoningDeltaEvent = {
  type: "reasoning_delta";
  data: { delta: string; index: number };
  meta: StreamEventMeta;
};

export type AgentHandoffEvent = {
  type: "agent_handoff";
  data: { agentName: string };
  meta: StreamEventMeta;
};

export type ToolCallStartEvent = {
  type: "tool_call_start";
  data: {
    callId: string;
    toolName: string;
    toolType: ToolType;
    inputs?: any;
    serverName?: string;
    paused?: boolean;
  };
  meta: StreamEventMeta;
};

export type ToolCallEndEvent = {
  type: "tool_call_end";
  data: {
    callId: string;
    toolName: string;
    toolType: ToolType;
    result?: any;
    error?: string;
    executionTime?: number;
  };
  meta: StreamEventMeta;
};

export type RunErrorEvent = {
  type: "run_error";
  data: {
    message: string;
    code?: string;
  };
  meta: StreamEventMeta;
};

export type StreamEvent =
  | TextDeltaEvent
  | ReasoningDeltaEvent
  | AgentHandoffEvent
  | ToolCallStartEvent
  | ToolCallEndEvent
  | RunErrorEvent;

// ─── Multimodal Input Types ──────────────────────────────────────────────────

/** A plain text content part. */
export type TextPart = { type: "text"; text: string };

/** An image content part. `data` can be an HTTP URL, data URL, or raw base64. */
export type ImagePart = { type: "image"; data: string; mimeType?: string };

/** A file content part. `data` can be an HTTP URL, data URL, or raw base64. */
export type FilePart = {
  type: "file";
  data: string;
  mimeType: string;
  filename?: string;
};

/** A single content part in a multimodal message. */
export type ContentPart = TextPart | ImagePart | FilePart;

/**
 * Agent input — either a plain string (backward compatible) or an array of
 * content parts for multimodal messages (text + images + files).
 */
export type AgentInput = string | ContentPart[];

// ─── SDK Public Types ────────────────────────────────────────────────────────

/** Branded session ID type. */
export type SessionId = string & { readonly __brand: unique symbol };

/** Configuration for the BuildShipAgent constructor. */
export interface AgentConfig {
  /** Your BuildShip agent ID. */
  agentId: string;
  /** Access key if your agent requires authentication. */
  accessKey?: string;
  /** Custom API base URL. Defaults to `https://api.buildship.run`. */
  baseUrl?: string;
}

/** Options for agent execution. */
export interface ExecuteOptions {
  /** Additional context variables for the prompt. */
  context?: Record<string, any>;
  /** Custom headers to include in the request. */
  headers?: Record<string, string>;
  /** Additional top-level properties to merge into the request body. */
  body?: Record<string, any>;
  /** Fired internally when session ID is extracted from response headers. */
  onSessionId?: (sessionId: string, sessionName?: string) => void;
}

/** Callbacks for streaming responses. */
export interface StreamCallbacks {
  /** Called for each text chunk from the agent. */
  onText?: (text: string) => void;
  /** Called for each reasoning chunk (models with chain-of-thought). */
  onReasoning?: (delta: string, index: number) => void;
  /** Called when control is handed off to a sub-agent. */
  onAgentHandoff?: (agentName: string) => void;
  /** Called when a tool execution starts. */
  onToolStart?: (toolName: string, toolType: ToolType) => void;
  /** Called when a tool execution completes. */
  onToolEnd?: (toolName: string, result?: any, error?: string) => void;
  /** Called when agent pauses for a blocking client tool. */
  onPaused?: (toolName: string, args: any) => void;
  /** Called when the stream completes successfully. */
  onComplete?: (fullText: string) => void;
  /** Called if an error occurs during streaming. */
  onError?: (error: Error) => void;
  /** Called for every stream event. Useful for advanced consumers (e.g. debug panels). */
  onEvent?: (event: StreamEvent) => void;
}

/** A client-side tool that the agent can invoke. */
export interface ClientTool {
  /** Tool name — must match the name the agent knows. */
  name: string;
  /** Description of what the tool does. */
  description: string;
  /**
   * Tool parameters — accepts a **Zod schema** or a raw JSON Schema object.
   *
   * @example
   * // Zod
   * parameters: z.object({ message: z.string() })
   *
   * // JSON Schema
   * parameters: { type: "object", properties: { message: { type: "string" } } }
   */
  parameters: ZodSchema | Record<string, any>;
  /** If true, agent pauses until result is provided. */
  await?: boolean;
  /** Handler function. If provided with `await: true`, auto-resumes. */
  handler?: (args: any) => any | Promise<any>;
  /** If provided, tool will only be available to these server-side agents/subagents. */
  targetAgentIds?: string[];
}

/** Information about a paused tool call. */
export interface PausedToolInfo {
  callId: string;
  toolName: string;
  args: any;
}

// ─── Internal request/response types ─────────────────────────────────────────

/** @internal Body sent to the /executeAgent endpoint. */
export interface ExecuteRequestBody {
  input?: AgentInput;
  stream: true;
  clientTools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, any>;
    await?: boolean;
    targetAgentIds?: string[];
  }>;
  toolCallResult?: {
    callId: string;
    result: any;
  };
}

/** @internal Options passed to the internal stream executor. */
export interface StreamOptions {
  url: string;
  body: ExecuteRequestBody;
  headers: Record<string, string>;
  callbacks: StreamCallbacks;
  clientTools: Map<string, ClientTool>;
  signal?: AbortSignal;
  /** Called when session ID is received from response headers. */
  onSessionId?: (sessionId: SessionId, sessionName?: string) => void;
  /** Called when paused tool info is detected. */
  onPaused?: (info: PausedToolInfo) => void;
  /** Called to auto-resume after a client tool handler completes. */
  onAutoResume?: (callId: string, result: any) => void;
  /** Called with the raw Response object after the HTTP request completes. */
  onResponse?: (response: Response) => void;
}
