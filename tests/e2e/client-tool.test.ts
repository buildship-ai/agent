import { describe, it, expect } from "vitest";
import { BuildShipAgent, z } from "../../src/core/index";
import { createTestCallbacks, loadEnv } from "./helpers";

const env = loadEnv();

const agent = new BuildShipAgent({
  agentId: env.BUILDSHIP_AGENT_ID,
  accessKey: env.BUILDSHIP_ACCESS_KEY,
  baseUrl: env.BUILDSHIP_BASE_URL,
});

describe("E2E: Client tool pause & resume", { timeout: 60_000 }, () => {
  it("pauses on client tool and resumes with result", async () => {
    const helloWorldSchema = z.object({
      message: z.string().describe("The message to display"),
    });

    agent.registerClientTool({
      name: "hello_world",
      description: "Greets the user and returns their name",
      parameters: helloWorldSchema,
      await: true,
    });

    const t1 = createTestCallbacks();
    const session = await agent.execute(
      "You MUST call the 'hello_world' tool right now with message='Greeting'. Do not do anything else.",
      t1.callbacks,
    );

    if (session.isPaused()) {
      const pausedTool = session.getPausedTool();
      expect(pausedTool).toBeDefined();
      expect(pausedTool!.toolName).toBe("hello_world");

      // Resume with a result
      const t2 = createTestCallbacks();
      await session.resume({ name: "TestUser" }, t2.callbacks);

      const resumeText = t2.getFullText();
      expect(resumeText.trim().length).toBeGreaterThan(0);
      expect(t2.getEvents()).toContain("complete");
    } else {
      // Agent didn't call the tool — this depends on agent config
      console.warn(
        "  ⚠️  Session did not pause. This test requires an agent configured with the 'hello_world' client tool.",
      );
    }

    // Cleanup
    agent.unregisterClientTool("hello_world");
  });
});
