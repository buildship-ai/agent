import type {
  StreamCallbacks,
  StreamEvent,
  TextDeltaEvent,
  ToolCallStartEvent,
} from "../core/types";

import type { AgentToolContextValue } from "./agent-context";
import type { Message, MessagePart } from "./types";
import { tryParseJSON } from "./utils/schema";
import { updateAgentMessageParts } from "./utils/message";

// ── Types ──────────────────────────────────────────────────────────────

export type RunOptions = {
  context?: object;
  additionalHeaders?: Record<string, string>;
  additionalBody?: Record<string, unknown>;
  optimisticExecutionId?: string;
  /** @deprecated Use `useClientTool` hook instead. */
  clientTools?: Array<{
    name: string;
    description: string;
    parameters: unknown;
    await?: boolean;
  }>;
  // Resume params
  resumeToolCallId?: string;
  resumeToolResult?: any;
};

export type StreamDeps = {
  agentId: string;
  currentSessionId: string;
  messagesRef: React.MutableRefObject<Array<Message>>;
  setMessages: React.Dispatch<React.SetStateAction<Array<Message>>>;
  setInProgress: React.Dispatch<React.SetStateAction<boolean>>;
  syncSessionRef: React.MutableRefObject<((messages?: Array<Message>) => void) | undefined>;
  toolContext: AgentToolContextValue | null;
  textDeltaModifier?: (
    delta: string,
    fullText: string,
    meta: { executionId: string; sequence: number; agentId: string },
  ) => string;
  fullTextModifier?: (
    fullText: string,
    meta: { executionId: string; sequence: number; agentId: string },
  ) => string;
};

// ── Build callbacks ────────────────────────────────────────────────────

/**
 * Build the StreamCallbacks object from dependencies.
 * Keeps event-handling logic out of the main hook.
 */
export function buildStreamCallbacks(deps: StreamDeps): StreamCallbacks {
  const {
    setMessages,
    setInProgress,
    syncSessionRef,
    messagesRef,
    toolContext,
    agentId,
    textDeltaModifier,
    fullTextModifier,
  } = deps;

  return {
    onComplete: () => {
      console.log("Agent closed");
      setInProgress(false);
      // NOTE: Don't sync here — each event handler already syncs with
      // the correct messages inside its setMessages callback. Syncing
      // here with messagesRef.current would overwrite with stale data
      // (e.g. missing a run_error part that was just added).
    },
    onError: (error: Error) => {
      console.log("Agent error", error);
      setInProgress(false);
    },
    onEvent: (event: StreamEvent) => {
      if (event.type === "text_delta") {
        handleTextDelta(
          event,
          setMessages,
          syncSessionRef,
          textDeltaModifier,
          fullTextModifier,
          agentId,
        );
      } else if (event.type === "tool_call_start") {
        // Always create a tool_call part for the debug panel
        handleToolCallStart(event, setMessages, syncSessionRef);
        // Additionally create a widget part for client tools with a render function
        if (event.data.toolType === "client") {
          handleClientToolCall(event, setMessages, syncSessionRef, toolContext, agentId);
        }
      } else if (event.type === "tool_call_end") {
        handleToolCallEnd(event, setMessages, syncSessionRef);
      } else if (event.type === "reasoning_delta") {
        handleReasoningDelta(event, setMessages, syncSessionRef);
      } else if (event.type === "agent_handoff") {
        handleAgentHandoff(event, setMessages, syncSessionRef);
      } else if (event.type === "run_error") {
        handleRunError(event, setMessages, syncSessionRef);
      }
    },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Ensure we have a trailing agent message to append parts to.
 * Returns [updatedMessages, agentMessage].
 */
function ensureAgentMessage(prev: Message[], executionId: string): [Message[], Message] {
  const last = prev[prev.length - 1];
  if (last?.role === "agent") {
    return [prev, last];
  }
  const newMsg: Message = {
    role: "agent" as const,
    content: "",
    parts: [],
    executionId,
  };
  return [[...prev, newMsg], newMsg];
}

/**
 * Replace the last agent message with an updated copy.
 */
function replaceLastAgent(prev: Message[], updated: Message): Message[] {
  return [...prev.slice(0, -1), updated];
}

// ── Event handlers (private) ───────────────────────────────────────────

function handleTextDelta(
  event: TextDeltaEvent,
  setMessages: React.Dispatch<React.SetStateAction<Array<Message>>>,
  syncSessionRef: React.MutableRefObject<((messages?: Array<Message>) => void) | undefined>,
  modifier:
    | ((
        delta: string,
        fullText: string,
        meta: { executionId: string; sequence: number; agentId: string },
      ) => string)
    | undefined,
  fullTextModifier:
    | ((
        fullText: string,
        meta: { executionId: string; sequence: number; agentId: string },
      ) => string)
    | undefined,
  agentId: string,
) {
  const sequence = event.meta.sequence;
  const originalText = event.data;
  const eventExecutionId = event.meta.executionId;

  setMessages((prev) => {
    const lastMessage = prev[prev.length - 1];
    const meta = {
      executionId: eventExecutionId,
      sequence,
      agentId: event.meta.agentId || agentId,
    };

    // Calculate the modified text delta using the full text accumulation so far
    let text = originalText;
    if (modifier) {
      // Get raw full text from the last text part's _rawContent, or fall back to content
      const lastTextPart =
        lastMessage?.role === "agent"
          ? lastMessage.parts?.findLast(
              (p): p is Extract<MessagePart, { type: "text" }> => p.type === "text",
            )
          : undefined;
      const currentFullText = lastTextPart?._rawText ?? lastTextPart?.text ?? "";
      text = modifier(originalText, currentFullText, meta);
    }

    const newPart: MessagePart = {
      type: "text",
      text,
      firstSequence: sequence,
      lastSequence: sequence,
    };

    let updatedMessages: Message[];

    if (lastMessage?.role === "agent") {
      // Get raw accumulated text from the last text part
      const lastTextPart = lastMessage.parts?.findLast(
        (p): p is Extract<MessagePart, { type: "text" }> => p.type === "text",
      );
      const prevRaw = lastTextPart?._rawText ?? lastTextPart?.text ?? "";
      const rawText = prevRaw + text;
      let updatedParts = updateAgentMessageParts(lastMessage.parts || [], newPart);

      // If fullTextModifier is set, replace content AND collapse text parts
      let displayContent = rawText;
      if (fullTextModifier) {
        displayContent = fullTextModifier(rawText, meta);
        // Collapse all text parts into a single part with the modified full text
        const textParts = updatedParts.filter(
          (p): p is Extract<MessagePart, { type: "text" }> => p.type === "text",
        );
        const nonTextParts = updatedParts.filter((p) => p.type !== "text");
        const modifiedTextPart: MessagePart = {
          type: "text",
          text: displayContent,
          _rawText: rawText,
          firstSequence: textParts[0]?.firstSequence ?? sequence,
          lastSequence: textParts[textParts.length - 1]?.lastSequence ?? sequence,
        };
        updatedParts = [...nonTextParts, modifiedTextPart];
      }

      const updatedMessage: Message = {
        ...lastMessage,
        content: displayContent,
        parts: updatedParts,
      };
      updatedMessages = [...prev.slice(0, -1), updatedMessage];
    } else {
      let displayContent = text;
      let parts: MessagePart[] = [newPart];

      if (fullTextModifier) {
        displayContent = fullTextModifier(text, meta);
        parts = [
          {
            type: "text",
            text: displayContent,
            _rawText: text,
            firstSequence: sequence,
            lastSequence: sequence,
          },
        ];
      }

      const updatedMessage: Message = {
        role: "agent" as const,
        content: displayContent,
        parts,
        executionId: eventExecutionId,
      };
      updatedMessages = [...prev, updatedMessage];
    }

    if (syncSessionRef.current) {
      syncSessionRef.current(updatedMessages);
    }

    return updatedMessages;
  });
}

function handleClientToolCall(
  event: ToolCallStartEvent,
  setMessages: React.Dispatch<React.SetStateAction<Array<Message>>>,
  syncSessionRef: React.MutableRefObject<((messages?: Array<Message>) => void) | undefined>,
  toolContext: AgentToolContextValue | null,
  agentId: string,
) {
  // Only create widget for tools with a registered render function
  const tool = toolContext?.getTool(agentId, event.data.toolName);
  if (!tool?.render) return;

  setMessages((prev) => {
    const lastMessage = prev[prev.length - 1];
    const newPart: MessagePart = {
      type: "widget",
      toolName: event.data.toolName,
      callId: event.data.callId,
      inputs: tryParseJSON(event.data.inputs),
      sequence: event.meta.sequence,
      paused: event.data.paused,
      status: "pending",
    };

    let updatedMessages: Message[];

    if (lastMessage?.role === "agent") {
      const updatedMessage: Message = {
        ...lastMessage,
        parts: updateAgentMessageParts(lastMessage.parts || [], newPart),
      };
      updatedMessages = [...prev.slice(0, -1), updatedMessage];
    } else {
      const updatedMessage: Message = {
        role: "agent" as const,
        content: "",
        parts: [newPart],
        executionId: event.meta.executionId,
      };
      updatedMessages = [...prev, updatedMessage];
    }

    if (syncSessionRef.current) {
      syncSessionRef.current(updatedMessages);
    }

    return updatedMessages;
  });
}

function handleToolCallStart(
  event: StreamEvent & { type: "tool_call_start" },
  setMessages: React.Dispatch<React.SetStateAction<Array<Message>>>,
  syncSessionRef: React.MutableRefObject<((messages?: Array<Message>) => void) | undefined>,
) {
  const { callId, toolName, toolType, inputs, serverName } = event.data;

  setMessages((prev) => {
    const [msgs, agentMsg] = ensureAgentMessage(prev, event.meta.executionId);

    const newPart: MessagePart = {
      type: "tool_call",
      toolName,
      callId,
      toolType,
      status: "progress",
      inputs,
      serverName,
      sequence: event.meta.sequence,
    };

    const updated: Message = {
      ...agentMsg,
      parts: [...(agentMsg.parts || []), newPart],
    };

    const updatedMessages = replaceLastAgent(msgs, updated);
    if (syncSessionRef.current) syncSessionRef.current(updatedMessages);
    return updatedMessages;
  });
}

function handleToolCallEnd(
  event: StreamEvent & { type: "tool_call_end" },
  setMessages: React.Dispatch<React.SetStateAction<Array<Message>>>,
  syncSessionRef: React.MutableRefObject<((messages?: Array<Message>) => void) | undefined>,
) {
  const { callId, result, error } = event.data;

  setMessages((prev) => {
    const last = prev[prev.length - 1];
    if (last?.role !== "agent" || !last.parts) return prev;

    const updatedParts = [...last.parts];
    // Find the matching tool_call part and update it
    for (let i = updatedParts.length - 1; i >= 0; i--) {
      const part = updatedParts[i];
      if (part.type === "tool_call" && part.callId === callId) {
        updatedParts[i] = {
          ...part,
          status: error ? "error" : "complete",
          output: result,
          error,
        };
        break;
      }
    }

    // When a client tool has both handler and render, the handler auto-executes
    // and updates the result/error into the widget.
    for (let i = updatedParts.length - 1; i >= 0; i--) {
      const part = updatedParts[i];
      if (part.type === "widget" && part.callId === callId) {
        updatedParts[i] = {
          ...part,
          status: error ? "error" : "submitted",
          ...(result !== undefined ? { result } : {}),
          ...(error ? { error } : {}),
        };
        break;
      }
    }

    const updated: Message = { ...last, parts: updatedParts };
    const updatedMessages = replaceLastAgent(prev, updated);
    if (syncSessionRef.current) syncSessionRef.current(updatedMessages);
    return updatedMessages;
  });
}

function handleReasoningDelta(
  event: StreamEvent & { type: "reasoning_delta" },
  setMessages: React.Dispatch<React.SetStateAction<Array<Message>>>,
  syncSessionRef: React.MutableRefObject<((messages?: Array<Message>) => void) | undefined>,
) {
  const { delta, index } = event.data;

  setMessages((prev) => {
    const [msgs, agentMsg] = ensureAgentMessage(prev, event.meta.executionId);
    const parts = [...(agentMsg.parts || [])];

    // Find the last reasoning part with this index
    let existingIdx = -1;
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (p.type === "reasoning" && p.index === index) {
        existingIdx = i;
        break;
      }
    }

    if (existingIdx === -1) {
      // No existing reasoning part — append a new one
      parts.push({ type: "reasoning", reasoning: delta, index, sequence: event.meta.sequence });
    } else {
      // Check if there are any non-reasoning parts after the existing one.
      // If so, the model produced new reasoning AFTER tool calls, so we
      // should append a new entry to preserve chronological order.
      const hasInterleavedItems = parts.slice(existingIdx + 1).some((p) => p.type !== "reasoning");

      if (hasInterleavedItems) {
        parts.push({ type: "reasoning", reasoning: delta, index, sequence: event.meta.sequence });
      } else {
        const existing = parts[existingIdx] as Extract<MessagePart, { type: "reasoning" }>;
        parts[existingIdx] = {
          ...existing,
          reasoning: existing.reasoning + delta,
        };
      }
    }

    const updated: Message = { ...agentMsg, parts };
    const updatedMessages = replaceLastAgent(msgs, updated);
    if (syncSessionRef.current) syncSessionRef.current(updatedMessages);
    return updatedMessages;
  });
}

function handleAgentHandoff(
  event: StreamEvent & { type: "agent_handoff" },
  setMessages: React.Dispatch<React.SetStateAction<Array<Message>>>,
  syncSessionRef: React.MutableRefObject<((messages?: Array<Message>) => void) | undefined>,
) {
  setMessages((prev) => {
    const [msgs, agentMsg] = ensureAgentMessage(prev, event.meta.executionId);

    const newPart: MessagePart = {
      type: "handoff",
      agentName: event.data.agentName,
      sequence: event.meta.sequence,
    };

    const updated: Message = {
      ...agentMsg,
      parts: [...(agentMsg.parts || []), newPart],
    };

    const updatedMessages = replaceLastAgent(msgs, updated);
    if (syncSessionRef.current) syncSessionRef.current(updatedMessages);
    return updatedMessages;
  });
}

function handleRunError(
  event: StreamEvent & { type: "run_error" },
  setMessages: React.Dispatch<React.SetStateAction<Array<Message>>>,
  syncSessionRef: React.MutableRefObject<((messages?: Array<Message>) => void) | undefined>,
) {
  setMessages((prev) => {
    const [msgs, agentMsg] = ensureAgentMessage(prev, event.meta.executionId);

    const newPart: MessagePart = {
      type: "run_error",
      message: event.data.message,
      code: event.data.code,
      sequence: event.meta.sequence,
    };

    const updated: Message = {
      ...agentMsg,
      parts: [...(agentMsg.parts || []), newPart],
    };

    const updatedMessages = replaceLastAgent(msgs, updated);
    if (syncSessionRef.current) syncSessionRef.current(updatedMessages);
    return updatedMessages;
  });
}
