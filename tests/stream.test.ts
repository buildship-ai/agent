import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StreamOptions, SessionId, StreamEvent, ClientTool } from "../src/core/types";

/**
 * Helper: build a fake ReadableStream from a list of SSE event objects.
 * Each event is encoded as `data: <json>\n\n`.
 */
function buildSSEStream(
  events: Array<{ type: string; data: any; meta?: any }>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = events.map((event) => {
    const withMeta = { ...event, meta: event.meta || { executionId: "exec-1", sequence: 0 } };
    return encoder.encode(`data: ${JSON.stringify(withMeta)}\n\n`);
  });

  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(chunks[index++]);
      } else {
        controller.close();
      }
    },
  });
}

/** Helper: create a fake Response */
function fakeResponse(
  events: Array<{ type: string; data: any; meta?: any }>,
  headers: Record<string, string> = {},
  status = 200,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers(headers),
    body: buildSSEStream(events),
    text: async () => "Error body",
  } as any as Response;
}

/** Helper to build minimal StreamOptions */
function buildOptions(overrides: Partial<StreamOptions> = {}): StreamOptions {
  return {
    url: "https://api.buildship.run/executeAgent/test-agent",
    body: { stream: true, input: "Hello" },
    headers: {},
    callbacks: {},
    clientTools: new Map(),
    ...overrides,
  };
}

describe("executeStream", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockFetch(
    events: Array<{ type: string; data: any; meta?: any }>,
    headers: Record<string, string> = {},
    status = 200,
  ) {
    globalThis.fetch = vi.fn().mockResolvedValue(fakeResponse(events, headers, status));
  }

  // Lazy import so the module picks up our mocked fetch
  async function getExecuteStream() {
    const mod = await import("../src/core/stream");
    return mod.executeStream;
  }

  // ── Text deltas ───────────────────────────────────────────────────

  it("dispatches text_delta events to onText and accumulates fullText for onComplete", async () => {
    mockFetch([
      { type: "text_delta", data: "Hello " },
      { type: "text_delta", data: "world!" },
    ]);

    const chunks: string[] = [];
    let completedText = "";

    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: {
          onText: (text) => chunks.push(text),
          onComplete: (fullText) => {
            completedText = fullText;
          },
        },
      }),
    );

    expect(chunks).toEqual(["Hello ", "world!"]);
    expect(completedText).toBe("Hello world!");
  });

  // ── Event normalization ───────────────────────────────────────────

  it("normalizes llm_text_delta to text_delta", async () => {
    mockFetch([{ type: "llm_text_delta", data: "Normalized" }]);

    const events: StreamEvent[] = [];
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: { onEvent: (event) => events.push(event) },
      }),
    );

    expect(events[0].type).toBe("text_delta");
  });

  it("normalizes llm_reasoning_delta to reasoning_delta", async () => {
    mockFetch([{ type: "llm_reasoning_delta", data: { delta: "think...", index: 0 } }]);

    const events: StreamEvent[] = [];
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: { onEvent: (event) => events.push(event) },
      }),
    );

    expect(events[0].type).toBe("reasoning_delta");
  });

  // ── Event callbacks ───────────────────────────────────────────────

  it("dispatches reasoning_delta to onReasoning", async () => {
    mockFetch([{ type: "reasoning_delta", data: { delta: "thinking", index: 0 } }]);

    const reasoning: Array<{ delta: string; index: number }> = [];
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: {
          onReasoning: (delta, index) => reasoning.push({ delta, index }),
        },
      }),
    );

    expect(reasoning).toEqual([{ delta: "thinking", index: 0 }]);
  });

  it("dispatches agent_handoff to onAgentHandoff", async () => {
    mockFetch([{ type: "agent_handoff", data: { agentName: "SubAgent" } }]);

    const handoffs: string[] = [];
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: { onAgentHandoff: (name) => handoffs.push(name) },
      }),
    );

    expect(handoffs).toEqual(["SubAgent"]);
  });

  it("dispatches tool_call_start to onToolStart", async () => {
    mockFetch([
      {
        type: "tool_call_start",
        data: { callId: "c1", toolName: "search", toolType: "mcp" },
      },
    ]);

    const starts: Array<{ name: string; type: string }> = [];
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: {
          onToolStart: (name, type) => starts.push({ name, type }),
        },
      }),
    );

    expect(starts).toEqual([{ name: "search", type: "mcp" }]);
  });

  it("dispatches tool_call_end to onToolEnd", async () => {
    mockFetch([
      {
        type: "tool_call_end",
        data: {
          callId: "c1",
          toolName: "search",
          toolType: "mcp",
          result: { answer: 42 },
        },
      },
    ]);

    const ends: Array<{ name: string; result?: any; error?: string }> = [];
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: {
          onToolEnd: (name, result, error) => ends.push({ name, result, error }),
        },
      }),
    );

    expect(ends).toEqual([{ name: "search", result: { answer: 42 }, error: undefined }]);
  });

  it("calls onEvent for every event", async () => {
    mockFetch([
      { type: "text_delta", data: "Hi" },
      { type: "agent_handoff", data: { agentName: "Sub" } },
    ]);

    const allEvents: StreamEvent[] = [];
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: { onEvent: (event) => allEvents.push(event) },
      }),
    );

    expect(allEvents).toHaveLength(2);
    expect(allEvents[0].type).toBe("text_delta");
    expect(allEvents[1].type).toBe("agent_handoff");
  });

  // ── Session ID & Name extraction ──────────────────────────────────

  it("extracts session ID and name from response headers", async () => {
    mockFetch([{ type: "text_delta", data: "Hi" }], {
      "X-BuildShip-Agent-Session-ID": "sess_123",
      "X-BuildShip-Agent-Session-Name": "My Session",
    });

    let receivedSessionId = "";
    let receivedSessionName = "";
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        onSessionId: (id, name) => {
          receivedSessionId = id;
          receivedSessionName = name || "";
        },
      }),
    );

    expect(receivedSessionId).toBe("sess_123");
    expect(receivedSessionName).toBe("My Session");
  });

  it("extracts session ID without session name", async () => {
    mockFetch([{ type: "text_delta", data: "Hi" }], { "X-BuildShip-Agent-Session-ID": "sess_456" });

    let receivedSessionId = "";
    let receivedSessionName: string | undefined;
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        onSessionId: (id, name) => {
          receivedSessionId = id;
          receivedSessionName = name;
        },
      }),
    );

    expect(receivedSessionId).toBe("sess_456");
    expect(receivedSessionName).toBeUndefined();
  });

  // ── onResponse ────────────────────────────────────────────────────

  it("calls onResponse with the raw Response object", async () => {
    mockFetch([{ type: "text_delta", data: "Hi" }]);

    let receivedResponse: any = null;
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        onResponse: (resp) => {
          receivedResponse = resp;
        },
      }),
    );

    expect(receivedResponse).toBeDefined();
    expect(receivedResponse.ok).toBe(true);
  });

  // ── HTTP errors ───────────────────────────────────────────────────

  it("calls onError and throws on HTTP error status", async () => {
    mockFetch([], {}, 500);

    let errorReceived: Error | null = null;
    const executeStream = await getExecuteStream();
    await expect(
      executeStream(
        buildOptions({
          callbacks: {
            onError: (err) => {
              errorReceived = err;
            },
          },
        }),
      ),
    ).rejects.toThrow("HTTP 500");

    expect(errorReceived).toBeDefined();
    expect(errorReceived!.message).toContain("HTTP 500");
  });

  // ── Client tool: paused without handler → onPaused ────────────────

  it("calls onPaused for paused client tool without handler", async () => {
    let pausedInfo: any = null;
    let callbackPausedName = "";

    const clientTools = new Map<string, ClientTool>();
    clientTools.set("ask_user", {
      name: "ask_user",
      description: "Ask the user",
      parameters: {},
      await: true,
    });

    mockFetch([
      {
        type: "tool_call_start",
        data: {
          callId: "c1",
          toolName: "ask_user",
          toolType: "client",
          inputs: '{"question":"Continue?"}',
          paused: true,
        },
      },
    ]);

    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        clientTools,
        callbacks: {
          onPaused: (name) => {
            callbackPausedName = name;
          },
        },
        onPaused: (info) => {
          pausedInfo = info;
        },
      }),
    );

    expect(callbackPausedName).toBe("ask_user");
    expect(pausedInfo).toEqual({
      callId: "c1",
      toolName: "ask_user",
      args: { question: "Continue?" },
    });
  });

  // ── Client tool: paused with handler → auto-resume ────────────────

  it("auto-resumes paused client tool with handler", async () => {
    let autoResumeCallId = "";
    let autoResumeResult: any = null;

    const clientTools = new Map<string, ClientTool>();
    clientTools.set("confirm", {
      name: "confirm",
      description: "Confirm action",
      parameters: {},
      await: true,
      handler: async (args) => ({ confirmed: true, input: args }),
    });

    mockFetch([
      {
        type: "tool_call_start",
        data: {
          callId: "c2",
          toolName: "confirm",
          toolType: "client",
          inputs: '{"action":"deploy"}',
          paused: true,
        },
      },
    ]);

    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        clientTools,
        onAutoResume: async (callId, result) => {
          autoResumeCallId = callId;
          autoResumeResult = result;
        },
      }),
    );

    expect(autoResumeCallId).toBe("c2");
    expect(autoResumeResult).toEqual({
      confirmed: true,
      input: { action: "deploy" },
    });
  });

  // ── Deduplication of tool_call_start events ───────────────────────

  it("skips duplicate tool_call_start events with the same callId", async () => {
    let handlerCallCount = 0;

    const clientTools = new Map<string, ClientTool>();
    clientTools.set("add_color", {
      name: "add_color",
      description: "Add color",
      parameters: {},
      await: true,
      handler: async () => {
        handlerCallCount++;
        return "done";
      },
    });

    // Simulate server replaying the same tool_call_start event twice (same callId)
    mockFetch([
      {
        type: "tool_call_start",
        data: {
          callId: "dup-1",
          toolName: "add_color",
          toolType: "client",
          inputs: '{"hex":"#FF0000"}',
          paused: true,
        },
      },
      {
        type: "tool_call_start",
        data: {
          callId: "dup-1",
          toolName: "add_color",
          toolType: "client",
          inputs: '{"hex":"#FF0000"}',
          paused: true,
        },
      },
    ]);

    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        clientTools,
        onAutoResume: async () => {},
      }),
    );

    // Handler should only be called once — the duplicate is skipped
    expect(handlerCallCount).toBe(1);
  });

  it("skips tool_call_start for callIds already in processedCallIds", async () => {
    let handlerCallCount = 0;

    const clientTools = new Map<string, ClientTool>();
    clientTools.set("add_color", {
      name: "add_color",
      description: "Add color",
      parameters: {},
      await: true,
      handler: async () => {
        handlerCallCount++;
        return "done";
      },
    });

    // Pre-populate processedCallIds as if from a prior resume cycle
    const processedCallIds = new Set(["already-processed"]);

    mockFetch([
      {
        type: "tool_call_start",
        data: {
          callId: "already-processed",
          toolName: "add_color",
          toolType: "client",
          inputs: '{"hex":"#00FF00"}',
          paused: true,
        },
      },
    ]);

    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        clientTools,
        processedCallIds,
        onAutoResume: async () => {},
      }),
    );

    // Handler should NOT be called — callId was already processed in prior cycle
    expect(handlerCallCount).toBe(0);
  });

  // ── Client tool: paused with handler that throws → error event ─────

  it("synthesizes tool_call_end with error when handler throws", async () => {
    const events: StreamEvent[] = [];
    let pausedInfo: any = null;

    const clientTools = new Map<string, ClientTool>();
    clientTools.set("failing_tool", {
      name: "failing_tool",
      description: "A tool that fails",
      parameters: {},
      await: true,
      handler: async () => {
        throw new Error("Clone failed: permission denied");
      },
    });

    mockFetch([
      {
        type: "tool_call_start",
        data: {
          callId: "c-err",
          toolName: "failing_tool",
          toolType: "client",
          inputs: '{"projectId":"abc"}',
          paused: true,
        },
      },
    ]);

    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        clientTools,
        callbacks: {
          onEvent: (event) => events.push(event),
        },
        onPaused: (info) => {
          pausedInfo = info;
        },
      }),
    );

    // Should have emitted tool_call_end with error
    const endEvent = events.find(
      (e) => e.type === "tool_call_end" && (e as any).data.callId === "c-err",
    );
    expect(endEvent).toBeDefined();
    expect((endEvent as any).data.error).toBe("Clone failed: permission denied");
    expect((endEvent as any).data.toolType).toBe("client");

    // Should still call onPaused so user can decide what to do
    expect(pausedInfo).toBeDefined();
    expect(pausedInfo.callId).toBe("c-err");
  });

  // ── Client tool: fire-and-forget ──────────────────────────────────

  it("calls handler for fire-and-forget client tool (not paused)", async () => {
    let handlerCalled = false;

    const clientTools = new Map<string, ClientTool>();
    clientTools.set("log_event", {
      name: "log_event",
      description: "Log something",
      parameters: {},
      handler: () => {
        handlerCalled = true;
      },
    });

    mockFetch([
      {
        type: "tool_call_start",
        data: {
          callId: "c3",
          toolName: "log_event",
          toolType: "client",
          inputs: "{}",
          paused: false,
        },
      },
    ]);

    const executeStream = await getExecuteStream();
    await executeStream(buildOptions({ clientTools }));

    expect(handlerCalled).toBe(true);
  });

  // ── Client tool: unregistered paused tool → still calls onPaused ──

  it("calls onPaused for unregistered paused client tool", async () => {
    let pausedInfo: any = null;

    mockFetch([
      {
        type: "tool_call_start",
        data: {
          callId: "c4",
          toolName: "unknown_tool",
          toolType: "client",
          paused: true,
        },
      },
    ]);

    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        onPaused: (info) => {
          pausedInfo = info;
        },
      }),
    );

    expect(pausedInfo).toBeDefined();
    expect(pausedInfo.toolName).toBe("unknown_tool");
  });

  // ── Signal passthrough ────────────────────────────────────────────

  it("passes signal to fetch", async () => {
    const abortController = new AbortController();
    const fetchSpy = vi.fn().mockResolvedValue(fakeResponse([]));
    globalThis.fetch = fetchSpy;

    const executeStream = await getExecuteStream();
    await executeStream(buildOptions({ signal: abortController.signal }));

    expect(fetchSpy.mock.calls[0][1].signal).toBe(abortController.signal);
  });

  // ── Request body and headers ──────────────────────────────────────

  it("sends correct method, headers, and body", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(fakeResponse([]));
    globalThis.fetch = fetchSpy;

    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        headers: { Authorization: "Bearer test-key" },
        body: { stream: true, input: "Hello" },
      }),
    );

    const [calledUrl, calledOpts] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://api.buildship.run/executeAgent/test-agent");
    expect(calledOpts.method).toBe("POST");
    expect(calledOpts.headers["Content-Type"]).toBe("application/json");
    expect(calledOpts.headers["Accept"]).toBe("text/event-stream");
    expect(calledOpts.headers["Authorization"]).toBe("Bearer test-key");
    expect(JSON.parse(calledOpts.body)).toEqual({ stream: true, input: "Hello" });
  });

  // ── onComplete called even with empty stream ──────────────────────

  it("calls onComplete with empty text on empty stream", async () => {
    mockFetch([]);

    let completedText: string | undefined;
    const executeStream = await getExecuteStream();
    await executeStream(
      buildOptions({
        callbacks: {
          onComplete: (text) => {
            completedText = text;
          },
        },
      }),
    );

    expect(completedText).toBe("");
  });
});
