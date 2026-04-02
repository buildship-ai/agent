import type { ToolType, ImagePart, FilePart } from "../core/types";

export type { ToolType } from "../core/types";
export type { AgentInput, ContentPart, TextPart, ImagePart, FilePart } from "../core/types";

export type WidgetExecutionItem = {
  toolName: string;
  callId: string;
  inputs: any;
};

export type ClientToolDefinition = {
  name: string;
  description: string;
  parameters: unknown;
  await?: boolean;
};

export type MessagePart = {
  /** The agent that produced this part. */
  agentId?: string;
} & (
  | {
      type: "text";
      text: string;
      firstSequence: number;
      lastSequence: number;
      _rawText?: string;
    }
  | {
      type: "widget";
      toolName: string;
      callId: string;
      inputs: any;
      sequence: number;
      paused?: boolean;
      status?: "pending" | "submitted" | "error";
      /** Persisted result from a tool submission (handler or widget submit). */
      result?: any;
      /** Error message if the handler failed. */
      error?: string;
    }
  | {
      type: "tool_call";
      toolName: string;
      callId: string;
      toolType: ToolType;
      status: "progress" | "complete" | "error";
      inputs?: unknown;
      output?: unknown;
      error?: string;
      serverName?: string;
      sequence: number;
    }
  | {
      type: "reasoning";
      reasoning: string;
      index?: number;
      sequence: number;
    }
  | {
      type: "handoff";
      agentName: string;
      sequence: number;
    }
  | {
      type: "run_error";
      message: string;
      code?: string;
      sequence: number;
    }
);

export type Message = {
  role: "user" | "agent";
  content: string;
  parts?: Array<MessagePart>;
  executionId?: string;
  /** Context passed with this message, persisted for use on resume. */
  context?: Record<string, any>;
  /** Multimodal attachments for user messages (images, files). */
  attachments?: Array<ImagePart | FilePart>;
};

export type Session = {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Array<Message>;
  name?: string;
};

export type ToolConfig = {
  name: string;
  description: string;
  schema: unknown;
  await?: boolean;
};
