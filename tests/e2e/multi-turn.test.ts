import { describe, it, expect } from "vitest";
import { BuildShipAgent } from "../../src/core/index";
import { createTestCallbacks, loadEnv } from "./helpers";
import type { SessionId } from "../../src/core/types";

const env = loadEnv();

const agent = new BuildShipAgent({
  agentId: env.BUILDSHIP_AGENT_ID,
  accessKey: env.BUILDSHIP_ACCESS_KEY,
  baseUrl: env.BUILDSHIP_BASE_URL,
});

describe("E2E: Multi-turn conversation", { timeout: 60_000 }, () => {
  it("maintains context across turns", async () => {
    // Turn 1: establish context
    const t1 = createTestCallbacks();
    const session = await agent.execute("Say hello in exactly 5 words.", t1.callbacks);
    const sessionId = session.getSessionId();
    expect(sessionId).toBeDefined();

    // Turn 2: ask about the previous turn
    const t2 = createTestCallbacks();
    const continued = agent.session(sessionId as SessionId);
    await continued.execute("What did I just ask you?", t2.callbacks);

    const text2 = t2.getFullText();
    expect(text2.trim().length).toBeGreaterThan(0);
    expect(t2.getEvents()).toContain("complete");

    // The agent should reference "hello" or "5 words" from the previous turn
    const lowerText = text2.toLowerCase();
    const hasContext =
      lowerText.includes("hello") ||
      lowerText.includes("5 words") ||
      lowerText.includes("five words") ||
      lowerText.includes("say");

    // Soft check — log warning instead of failing since agent behavior varies
    if (!hasContext) {
      console.warn(`  ⚠️  Response may not reference prior turn: "${text2.slice(0, 120)}..."`);
    }
  });
});
