import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StreamCallbacks, ClientTool, SessionId } from "../src/core/types";

// Mock the stream module so we can capture executeStream calls
vi.mock("../src/core/stream", () => ({
  executeStream: vi.fn(),
}));

import { executeStream } from "../src/core/stream";
import { BuildShipAgent } from "../src/core/agent";
import { AgentSession } from "../src/core/session";

const mockedExecuteStream = vi.mocked(executeStream);

describe("AgentSession", () => {
  let agent: BuildShipAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new BuildShipAgent({ agentId: "test-agent", accessKey: "key123" });

    // Default mock: simulate successful stream with session ID
    mockedExecuteStream.mockImplementation(async (options) => {
      options.onSessionId?.("sess_auto" as SessionId);
      options.callbacks.onComplete?.("Hello!");
    });
  });

  // ── execute ───────────────────────────────────────────────────────

  it("sends correct body with input and stream:true", async () => {
    const session = new AgentSession(agent);
    const callbacks: StreamCallbacks = {};

    await session.execute("Hello", callbacks);

    expect(mockedExecuteStream).toHaveBeenCalledOnce();
    const opts = mockedExecuteStream.mock.calls[0][0];
    expect(opts.body.input).toBe("Hello");
    expect(opts.body.stream).toBe(true);
  });

  it("includes context as top-level properties in body", async () => {
    const session = new AgentSession(agent);
    await session.execute("Hi", {}, { context: { userId: "u1" } });

    const opts = mockedExecuteStream.mock.calls[0][0];
    expect((opts.body as any).context.userId).toBe("u1");
  });

  it("sends correct URL", async () => {
    const session = new AgentSession(agent);
    await session.execute("Hi", {});

    const opts = mockedExecuteStream.mock.calls[0][0];
    expect(opts.url).toBe("https://api.buildship.run/executeAgent/test-agent");
  });

  it("includes Authorization header", async () => {
    const session = new AgentSession(agent);
    await session.execute("Hi", {});

    const opts = mockedExecuteStream.mock.calls[0][0];
    expect(opts.headers["Authorization"]).toBe("Bearer key123");
  });

  it("stores session ID from onSessionId callback", async () => {
    const session = new AgentSession(agent);
    await session.execute("Hi", {});

    expect(session.getSessionId()).toBe("sess_auto");
  });

  // ── Session ID ────────────────────────────────────────────────────

  it("throws when getting session ID before execute", () => {
    const session = new AgentSession(agent);
    expect(() => session.getSessionId()).toThrow("session ID not yet available");
  });

  it("uses pre-set session ID in headers", async () => {
    const session = new AgentSession(agent, "sess_existing" as SessionId);
    await session.execute("Hi", {});

    const opts = mockedExecuteStream.mock.calls[0][0];
    expect(opts.headers["X-BuildShip-Agent-Session-ID"]).toBe("sess_existing");
  });

  // ── Pause / Resume ────────────────────────────────────────────────

  it("is not paused initially", () => {
    const session = new AgentSession(agent);
    expect(session.isPaused()).toBe(false);
    expect(session.getPausedTool()).toBeNull();
  });

  it("becomes paused when onPaused is called during stream", async () => {
    mockedExecuteStream.mockImplementation(async (options) => {
      options.onSessionId?.("sess_1" as SessionId);
      options.onPaused?.({
        callId: "call_1",
        toolName: "ask_user",
        args: { question: "Continue?" },
      });
    });

    const session = new AgentSession(agent);
    await session.execute("Hi", {});

    expect(session.isPaused()).toBe(true);
    expect(session.getPausedTool()).toEqual({
      callId: "call_1",
      toolName: "ask_user",
      args: { question: "Continue?" },
    });
  });

  it("resume sends toolCallResult in body", async () => {
    // First execute → pause
    mockedExecuteStream.mockImplementationOnce(async (options) => {
      options.onSessionId?.("sess_1" as SessionId);
      options.onPaused?.({
        callId: "call_1",
        toolName: "ask_user",
        args: {},
      });
    });

    const session = new AgentSession(agent);
    await session.execute("Hi", {});
    expect(session.isPaused()).toBe(true);

    // Resume
    mockedExecuteStream.mockImplementationOnce(async (options) => {
      options.callbacks.onComplete?.("Resumed!");
    });

    await session.resume({ confirmed: true }, {});

    const opts = mockedExecuteStream.mock.calls[1][0];
    expect(opts.body.toolCallResult).toEqual({
      callId: "call_1",
      result: { confirmed: true },
    });
  });

  it("resume throws if not paused", async () => {
    const session = new AgentSession(agent);
    await expect(session.resume("result", {})).rejects.toThrow("session is not paused");
  });

  it("clears paused state after resume", async () => {
    mockedExecuteStream.mockImplementationOnce(async (options) => {
      options.onSessionId?.("sess_1" as SessionId);
      options.onPaused?.({
        callId: "call_1",
        toolName: "ask_user",
        args: {},
      });
    });

    const session = new AgentSession(agent);
    await session.execute("Hi", {});

    mockedExecuteStream.mockImplementationOnce(async () => {});

    await session.resume("yes", {});

    expect(session.isPaused()).toBe(false);
    expect(session.getPausedTool()).toBeNull();
  });

  // ── Client tool definitions ───────────────────────────────────────

  it("includes client tool definitions in request body", async () => {
    agent.registerClientTool({
      name: "my_tool",
      description: "A tool",
      parameters: { type: "object", properties: { x: { type: "string" } } },
      await: true,
    });

    const session = new AgentSession(agent);
    await session.execute("Hi", {});

    const opts = mockedExecuteStream.mock.calls[0][0];
    expect(opts.body.clientTools).toBeDefined();
    expect(opts.body.clientTools).toHaveLength(1);
    expect(opts.body.clientTools![0].name).toBe("my_tool");
    expect(opts.body.clientTools![0].await).toBe(true);
  });

  it("includes client tool defs in resume request too", async () => {
    agent.registerClientTool({
      name: "my_tool",
      description: "A tool",
      parameters: { type: "object", properties: {} },
    });

    mockedExecuteStream.mockImplementationOnce(async (options) => {
      options.onSessionId?.("sess_1" as SessionId);
      options.onPaused?.({
        callId: "call_1",
        toolName: "ask",
        args: {},
      });
    });

    const session = new AgentSession(agent);
    await session.execute("Hi", {});

    mockedExecuteStream.mockImplementationOnce(async () => {});

    await session.resume("yes", {});

    const opts = mockedExecuteStream.mock.calls[1][0];
    expect(opts.body.clientTools).toBeDefined();
    expect(opts.body.clientTools).toHaveLength(1);
  });

  // ── resumeWithCallId ───────────────────────────────────────────────

  it("resumeWithCallId sends toolCallResult without requiring paused state", async () => {
    const session = new AgentSession(agent, "sess_existing" as SessionId);
    // Session is NOT paused — this is the key scenario (React layer creates fresh sessions)
    expect(session.isPaused()).toBe(false);

    mockedExecuteStream.mockImplementationOnce(async (options) => {
      options.callbacks.onComplete?.("Resumed!");
    });

    await session.resumeWithCallId("call_widget_1", { answer: "Yes" }, {});

    const opts = mockedExecuteStream.mock.calls[0][0];
    expect(opts.body.toolCallResult).toEqual({
      callId: "call_widget_1",
      result: { answer: "Yes" },
    });
    expect(opts.body.stream).toBe(true);
  });

  it("resumeWithCallId includes client tool defs", async () => {
    agent.registerClientTool({
      name: "widget_tool",
      description: "A widget",
      parameters: { type: "object", properties: {} },
      await: true,
    });

    const session = new AgentSession(agent, "sess_existing" as SessionId);

    mockedExecuteStream.mockImplementationOnce(async () => {});

    await session.resumeWithCallId("call_w1", { done: true }, {});

    const opts = mockedExecuteStream.mock.calls[0][0];
    expect(opts.body.clientTools).toBeDefined();
    expect(opts.body.clientTools).toHaveLength(1);
    expect(opts.body.clientTools![0].name).toBe("widget_tool");
  });

  // ── Abort ─────────────────────────────────────────────────────────

  it("abort does not throw when no active stream", () => {
    const session = new AgentSession(agent);
    expect(() => session.abort()).not.toThrow();
  });

  // ── Auto-resume ───────────────────────────────────────────────────

  it("calls onAutoResume which triggers a recursive _run (resume) call", async () => {
    mockedExecuteStream
      .mockImplementationOnce(async (options) => {
        options.onSessionId?.("sess_1" as SessionId);
        // Simulate auto-resume callback
        await options.onAutoResume?.("call_auto", { confirmed: true });
      })
      .mockImplementationOnce(async (options) => {
        // Second call is the auto-resume
        options.callbacks.onComplete?.("Resumed after auto!");
      });

    agent.registerClientTool({
      name: "auto_tool",
      description: "Auto",
      parameters: {},
      await: true,
      handler: async () => ({ ok: true }),
    });

    const session = new AgentSession(agent);
    await session.execute("Hi", {});

    // Should have been called twice (initial + auto-resume)
    expect(mockedExecuteStream).toHaveBeenCalledTimes(2);

    const resumeOpts = mockedExecuteStream.mock.calls[1][0];
    expect(resumeOpts.body.toolCallResult).toEqual({
      callId: "call_auto",
      result: { confirmed: true },
    });
  });
});
