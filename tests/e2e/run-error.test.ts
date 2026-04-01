import { describe, it, expect } from "vitest";
import { BuildShipAgent } from "../../src/core/index";
import { createTestCallbacks, loadEnv } from "./helpers";

const env = loadEnv();

const agent = new BuildShipAgent({
  agentId: env.BUILDSHIP_AGENT_ID,
  accessKey: env.BUILDSHIP_ACCESS_KEY,
  baseUrl: env.BUILDSHIP_BASE_URL,
});

describe("E2E: Run error on broken payload", { timeout: 30_000 }, () => {
  it("receives run_error when sending invalid client tool definition", async () => {
    // Register a broken client tool — missing 'description' field
    agent.registerClientTool({
      name: "hello_world",
      description: "", // empty description
      parameters: {}, // empty parameters
      await: true,
    });

    const t = createTestCallbacks();

    // Send a request that forces the agent to use the broken tool
    const session = await agent.execute(
      "You MUST call the 'hello_world' tool right now. Do not do anything else.",
      t.callbacks,
    );

    const events = t.getEvents();

    const hasError = events.some((e) => e.startsWith("error:"));

    console.log("  Events:", events);
    console.log("  Text:", t.getFullText().slice(0, 200));

    // A broken client tool schema must trigger a run error
    expect(hasError).toBe(true);

    // Cleanup
    agent.unregisterClientTool("hello_world");
  });
});
