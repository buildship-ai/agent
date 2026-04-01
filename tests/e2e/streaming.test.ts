import { describe, it, expect } from "vitest";
import { BuildShipAgent } from "../../src/core/index";
import { createTestCallbacks, loadEnv } from "./helpers";

const env = loadEnv();

const agent = new BuildShipAgent({
  agentId: env.BUILDSHIP_AGENT_ID,
  accessKey: env.BUILDSHIP_ACCESS_KEY,
  baseUrl: env.BUILDSHIP_BASE_URL,
});

describe("E2E: Streaming", { timeout: 30_000 }, () => {
  it("creates a new session and streams text", async () => {
    const t = createTestCallbacks();

    const session = await agent.execute("Say hello in exactly 5 words.", t.callbacks);

    const sessionId = session.getSessionId();
    expect(sessionId).toBeDefined();
    expect(sessionId.length).toBeGreaterThan(0);

    const text = t.getFullText();
    expect(text.trim().length).toBeGreaterThan(0);

    expect(t.getEvents()).toContain("complete");
  });
});
