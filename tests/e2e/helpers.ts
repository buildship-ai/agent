import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StreamCallbacks } from "../../src/core/types";

/**
 * Load environment variables from `.env.tests` at the package root.
 */
export function loadEnv(): Record<string, string> {
  const envPath = resolve(import.meta.dirname, "../../.env.tests");
  let content: string;
  try {
    content = readFileSync(envPath, "utf-8");
  } catch {
    throw new Error(
      `Missing .env.tests — copy .env.tests.example and fill in your values.\n  Expected at: ${envPath}`,
    );
  }

  const env: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && value) env[key] = value;
  }

  if (!env.BUILDSHIP_AGENT_ID) {
    throw new Error("BUILDSHIP_AGENT_ID is not set in .env.tests");
  }

  return env;
}

/**
 * Create a set of stream callbacks that record events for assertions.
 */
export function createTestCallbacks(): {
  callbacks: StreamCallbacks;
  getFullText: () => string;
  getEvents: () => string[];
} {
  let fullText = "";
  const events: string[] = [];

  const callbacks: StreamCallbacks = {
    onText: (text) => {
      fullText += text;
    },
    onReasoning: (_delta, index) => {
      events.push(`reasoning[${index}]`);
    },
    onAgentHandoff: (agentName) => {
      events.push(`handoff:${agentName}`);
    },
    onToolStart: (toolName, toolType) => {
      events.push(`tool_start:${toolName}(${toolType})`);
    },
    onToolEnd: (toolName, _result, error) => {
      events.push(error ? `tool_error:${toolName}` : `tool_end:${toolName}`);
    },
    onComplete: () => {
      events.push("complete");
    },
    onError: (error) => {
      events.push(`error:${error.message}`);
    },
    onPaused: (toolName) => {
      events.push(`paused:${toolName}`);
    },
  };

  return {
    callbacks,
    getFullText: () => fullText,
    getEvents: () => events,
  };
}
