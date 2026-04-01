import { describe, it, expect } from "vitest";
import { BuildShipAgent } from "../src/core/agent";
import type { SessionId } from "../src/core/types";

describe("BuildShipAgent", () => {
  // ── Constructor ──────────────────────────────────────────────────────

  it("requires agentId", () => {
    expect(() => new BuildShipAgent({ agentId: "" })).toThrow("agentId is required");
  });

  it("stores agentId and accessKey", () => {
    const agent = new BuildShipAgent({ agentId: "abc", accessKey: "key123" });
    expect(agent._agentId).toBe("abc");
    expect(agent._accessKey).toBe("key123");
  });

  it("uses default baseUrl when not provided", () => {
    const agent = new BuildShipAgent({ agentId: "abc" });
    expect(agent._baseUrl).toBe("https://api.buildship.run");
  });

  it("uses custom baseUrl and strips trailing slash", () => {
    const agent = new BuildShipAgent({ agentId: "abc", baseUrl: "https://custom.api.com/" });
    expect(agent._baseUrl).toBe("https://custom.api.com");
  });

  // ── URL generation ──────────────────────────────────────────────────

  it("builds correct execute URL", () => {
    const agent = new BuildShipAgent({ agentId: "my-agent" });
    expect(agent._url).toBe("https://api.buildship.run/executeAgent/my-agent");
  });

  it("builds correct URL with custom baseUrl", () => {
    const agent = new BuildShipAgent({
      agentId: "my-agent",
      baseUrl: "https://custom.api.com",
    });
    expect(agent._url).toBe("https://custom.api.com/executeAgent/my-agent");
  });

  // ── Headers ─────────────────────────────────────────────────────────

  it("builds empty headers when no accessKey or sessionId", () => {
    const agent = new BuildShipAgent({ agentId: "abc" });
    expect(agent._buildHeaders()).toEqual({});
  });

  it("includes Authorization header when accessKey is set", () => {
    const agent = new BuildShipAgent({ agentId: "abc", accessKey: "key123" });
    const headers = agent._buildHeaders();
    expect(headers["Authorization"]).toBe("Bearer key123");
  });

  it("includes session ID header when provided", () => {
    const agent = new BuildShipAgent({ agentId: "abc" });
    const headers = agent._buildHeaders("sess_abc" as SessionId);
    expect(headers["X-BuildShip-Agent-Session-ID"]).toBe("sess_abc");
  });

  it("includes both Authorization and session ID headers", () => {
    const agent = new BuildShipAgent({ agentId: "abc", accessKey: "key123" });
    const headers = agent._buildHeaders("sess_abc" as SessionId);
    expect(headers["Authorization"]).toBe("Bearer key123");
    expect(headers["X-BuildShip-Agent-Session-ID"]).toBe("sess_abc");
  });

  // ── Client tools ────────────────────────────────────────────────────

  it("registers and retrieves a client tool", () => {
    const agent = new BuildShipAgent({ agentId: "abc" });
    agent.registerClientTool({
      name: "my_tool",
      description: "A test tool",
      parameters: { type: "object", properties: {} },
    });
    expect(agent._clientTools.has("my_tool")).toBe(true);
    expect(agent._clientTools.get("my_tool")?.description).toBe("A test tool");
  });

  it("throws when registering a tool without a name", () => {
    const agent = new BuildShipAgent({ agentId: "abc" });
    expect(() =>
      agent.registerClientTool({
        name: "",
        description: "No name",
        parameters: {},
      }),
    ).toThrow("tool.name is required");
  });

  it("unregisters a client tool", () => {
    const agent = new BuildShipAgent({ agentId: "abc" });
    agent.registerClientTool({
      name: "my_tool",
      description: "A tool",
      parameters: {},
    });
    expect(agent._clientTools.has("my_tool")).toBe(true);
    agent.unregisterClientTool("my_tool");
    expect(agent._clientTools.has("my_tool")).toBe(false);
  });

  // ── Session creation ────────────────────────────────────────────────

  it("creates a session with a given ID", () => {
    const agent = new BuildShipAgent({ agentId: "abc" });
    const session = agent.session("sess_abc");
    expect(session).toBeDefined();
    expect(session.getSessionId()).toBe("sess_abc");
  });

  it("throws when creating a session with empty ID", () => {
    const agent = new BuildShipAgent({ agentId: "abc" });
    expect(() => agent.session("")).toThrow("sessionId is required");
  });
});
