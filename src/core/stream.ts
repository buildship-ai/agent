import type { StreamEvent, StreamOptions, SessionId } from "./types";

/** Safely parse a value as JSON if it's a string, otherwise return as-is. */
function tryParseJSON(value: unknown): any {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Fatal error — will NOT be retried.
 */
class FatalStreamError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "FatalStreamError";
  }
}

/**
 * Opens an SSE connection to the BuildShip agent endpoint using native
 * `fetch` + `ReadableStream`, parses events, and dispatches to the
 * appropriate callbacks.
 *
 * Zero runtime dependencies — works in both browser and Node.js.
 *
 * @internal
 */
export async function executeStream(options: StreamOptions): Promise<void> {
  const {
    url,
    body,
    headers,
    callbacks,
    clientTools,
    signal,
    onSessionId,
    onPaused,
    onAutoResume,
    onResponse,
  } = options;

  let fullText = "";

  // Track pending auto-resume operations so we don't call onComplete prematurely
  const pendingAutoResumes: Promise<{ callId: string; result: unknown } | null>[] = [];

  // ── Make the request ────────────────────────────────────────────────
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });

  // ── Extract session ID and name from response headers ──────────────
  const sessionId = response.headers.get("X-BuildShip-Agent-Session-ID");
  if (sessionId && onSessionId) {
    const sessionName = response.headers.get("X-BuildShip-Agent-Session-Name") || undefined;
    onSessionId(sessionId as SessionId, sessionName);
  }

  // Expose the raw Response object
  onResponse?.(response);

  // ── Handle HTTP errors ─────────────────────────────────────────────
  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    const error = new FatalStreamError(
      `HTTP ${response.status}: ${errorBody || response.statusText}`,
      response.status,
    );
    callbacks.onError?.(error);
    throw error;
  }

  // ── Read the SSE stream ────────────────────────────────────────────
  if (!response.body) {
    callbacks.onComplete?.(fullText);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by double newlines
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const part of parts) {
        const trimmedPart = part.trim();
        if (!trimmedPart) continue;

        // Extract the data field from SSE format
        let jsonStr = "";
        for (const line of trimmedPart.split("\n")) {
          if (line.startsWith("data: ")) {
            jsonStr += line.slice(6);
          } else if (line.startsWith("data:")) {
            jsonStr += line.slice(5);
          }
        }

        jsonStr = jsonStr.trim();
        if (!jsonStr) continue;

        let raw: any;
        try {
          raw = JSON.parse(jsonStr);
        } catch {
          // Skip malformed events
          continue;
        }

        // Normalize backend event type names (llm_text_delta → text_delta, etc.)
        const streamEvent = normalizeEvent(raw) as StreamEvent;

        handleEvent(
          streamEvent,
          fullText,
          callbacks,
          clientTools,
          onPaused,
          onAutoResume,
          pendingAutoResumes,
        );

        // Accumulate text
        if (streamEvent.type === "text_delta") {
          fullText += streamEvent.data;
        }
      }
    }

    // Process any remaining data in buffer
    if (buffer.trim()) {
      let jsonStr = "";
      for (const line of buffer.trim().split("\n")) {
        if (line.startsWith("data: ")) {
          jsonStr += line.slice(6);
        } else if (line.startsWith("data:")) {
          jsonStr += line.slice(5);
        }
      }

      jsonStr = jsonStr.trim();
      if (jsonStr) {
        try {
          const raw = JSON.parse(jsonStr);
          const streamEvent = normalizeEvent(raw) as StreamEvent;
          handleEvent(
            streamEvent,
            fullText,
            callbacks,
            clientTools,
            onPaused,
            onAutoResume,
            pendingAutoResumes,
          );
          if (streamEvent.type === "text_delta") {
            fullText += streamEvent.data;
          }
        } catch {
          // Skip malformed trailing data
        }
      }
    }
  } catch (err) {
    // AbortError — re-throw
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }

    const error = err instanceof Error ? err : new Error(String(err));
    callbacks.onError?.(error);
    throw error;
  }

  // Wait for any pending auto-resume handlers before signaling completion
  if (pendingAutoResumes.length > 0) {
    const handlerResults = await Promise.allSettled(pendingAutoResumes);
    for (const settled of handlerResults) {
      if (settled.status === "fulfilled" && settled.value) {
        const { callId, result } = settled.value;
        await onAutoResume?.(callId, result);
      }
    }
  }

  callbacks.onComplete?.(fullText);
}

/**
 * Normalize backend event type names.
 * The backend sends `llm_text_delta` / `llm_reasoning_delta` but the SDK
 * exposes them as `text_delta` / `reasoning_delta`.
 * @internal
 */
function normalizeEvent(raw: any): any {
  const typeMap: Record<string, string> = {
    llm_text_delta: "text_delta",
    llm_reasoning_delta: "reasoning_delta",
  };
  if (raw && typeof raw.type === "string" && typeMap[raw.type]) {
    raw.type = typeMap[raw.type];
  }
  return raw;
}

/**
 * Dispatch a parsed stream event to the appropriate callbacks.
 * @internal
 */
function handleEvent(
  event: StreamEvent,
  _fullText: string,
  callbacks: StreamOptions["callbacks"],
  clientTools: StreamOptions["clientTools"],
  onPaused: StreamOptions["onPaused"],
  onAutoResume: StreamOptions["onAutoResume"],
  pendingAutoResumes: Promise<{ callId: string; result: unknown } | null>[],
): void {
  // Notify raw event consumers
  callbacks.onEvent?.(event);

  switch (event.type) {
    case "text_delta": {
      callbacks.onText?.(event.data);
      break;
    }

    case "reasoning_delta": {
      callbacks.onReasoning?.(event.data.delta, event.data.index);
      break;
    }

    case "agent_handoff": {
      callbacks.onAgentHandoff?.(event.data.agentName);
      break;
    }

    case "tool_call_start": {
      const { callId, toolName, toolType, inputs: rawInputs, paused } = event.data;
      // Backend sends toolCall.arguments as a JSON string — parse it
      const inputs = tryParseJSON(rawInputs);

      // Notify callback
      callbacks.onToolStart?.(toolName, toolType);

      // Handle client tools
      if (toolType === "client") {
        const tool = clientTools.get(toolName);
        if (tool) {
          if (paused && tool.handler) {
            // Blocking tool with handler → auto-execute and resume
            const handlerPromise = (async (): Promise<{
              callId: string;
              result: unknown;
            } | null> => {
              try {
                const result = await tool.handler!(inputs);

                // Synthesize a tool_call_end event for local observers (like debug panels)
                // since the backend only emits for server-side executed tools
                callbacks.onEvent?.({
                  type: "tool_call_end",
                  data: {
                    callId,
                    toolName,
                    toolType: "client",
                    result,
                  },
                  meta: event.meta,
                });

                return { callId, result };
              } catch (handlerError) {
                // Synthesize a tool_call_end with error so widget can show error state
                callbacks.onEvent?.({
                  type: "tool_call_end",
                  data: {
                    callId,
                    toolName,
                    toolType: "client",
                    error: handlerError instanceof Error ? handlerError.message : String(handlerError),
                  },
                  meta: event.meta,
                });

                // If handler fails, still call onPaused so user can decide
                callbacks.onPaused?.(toolName, inputs);
                onPaused?.({ callId, toolName, args: inputs });
                return null;
              }
            })();
            pendingAutoResumes.push(handlerPromise);
          } else if (paused) {
            // Blocking tool without handler → pause for user
            callbacks.onPaused?.(toolName, inputs);
            onPaused?.({ callId, toolName, args: inputs });
          } else if (tool.handler) {
            // Fire-and-forget tool with handler
            try {
              const result = tool.handler(inputs);
              // Synthesize tool_call_end so debug panels can mark it complete
              callbacks.onEvent?.({
                type: "tool_call_end",
                data: { callId, toolName, toolType: "client", result },
                meta: event.meta,
              });
            } catch {
              // Swallow errors on fire-and-forget
              callbacks.onEvent?.({
                type: "tool_call_end",
                data: { callId, toolName, toolType: "client" },
                meta: event.meta,
              });
            }
          } else {
            // Client tool with no handler and not paused (render-only widget, no-op)
            callbacks.onEvent?.({
              type: "tool_call_end",
              data: { callId, toolName, toolType: "client" },
              meta: event.meta,
            });
          }
        } else if (paused) {
          // No registered tool but paused — notify user
          callbacks.onPaused?.(toolName, inputs);
          onPaused?.({ callId, toolName, args: inputs });
        }
      }
      break;
    }

    case "tool_call_end": {
      const { toolName, result, error } = event.data;
      callbacks.onToolEnd?.(toolName, result, error);
      break;
    }

    case "run_error": {
      const { message, code } = event.data;
      const error = new Error(message);
      if (code != null) (error as any).code = code;
      callbacks.onError?.(error);
      break;
    }
  }
}
