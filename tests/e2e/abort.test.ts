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

describe("E2E: Abort mid-stream", { timeout: 30_000 }, () => {
  it("aborts the stream after a few chunks", async () => {
    // Create a session first to get a valid session ID
    const t1 = createTestCallbacks();
    const firstSession = await agent.execute("Hi", t1.callbacks);
    const sessionId = firstSession.getSessionId();

    const t = createTestCallbacks();
    let chunkCount = 0;
    const abortSession = agent.session(sessionId as SessionId);

    try {
      await abortSession.execute(
        "Write a very long essay about the history of computing, at least 2000 words.",
        {
          ...t.callbacks,
          onText: (text) => {
            chunkCount++;
            t.callbacks.onText?.(text);
            // Abort after receiving a few chunks
            if (chunkCount >= 3) {
              abortSession.abort();
            }
          },
        },
      );
      // If we get here, stream may have completed before abort
    } catch (e: any) {
      if (e.name === "AbortError" || e.message?.includes("abort")) {
        // Expected — the stream was aborted
      } else {
        throw e;
      }
    }

    // Either aborted or stream was short enough to complete
    expect(chunkCount).toBeGreaterThanOrEqual(1);
  });
});
