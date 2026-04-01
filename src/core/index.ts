// ─── Classes ─────────────────────────────────────────────────────────────────
export { BuildShipAgent } from "./agent";
export { AgentSession } from "./session";

// ─── Stream executor ─────────────────────────────────────────────────────────
export { executeStream } from "./stream";

// ─── Zod (re-exported for convenience) ───────────────────────────────────────
export { z, toJSONSchema } from "zod";
export type { ZodSchema } from "zod";

// ─── Types ───────────────────────────────────────────────────────────────────
export type {
  AgentConfig,
  AgentInput,
  SessionId,
  ToolType,
  StreamCallbacks,
  StreamOptions,
  ExecuteRequestBody,
  ClientTool,
  PausedToolInfo,
  // Multimodal input types
  ContentPart,
  TextPart,
  ImagePart,
  FilePart,
  // Stream event types (for advanced consumers)
  StreamEvent,
  StreamEventMeta,
  TextDeltaEvent,
  ReasoningDeltaEvent,
  AgentHandoffEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  RunErrorEvent,
} from "./types";
