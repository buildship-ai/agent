import { useCallback, useContext } from "react";
import { toJSONSchema, type ZodSchema } from "zod";

import type { ExecuteRequestBody, ClientTool } from "../core/types";
import type { AgentToolContextValue } from "./agent-context";
import { cleanSchema } from "./utils/schema";

/**
 * Resolve parameters — accepts Zod schema or plain JSON Schema object.
 */
export function resolveParameters(params: any): Record<string, any> {
  let schema: Record<string, any>;

  // Detect Zod schema: ZodType instances have a `_def` property
  if (params && typeof params === "object" && "_def" in params) {
    schema = toJSONSchema(params as ZodSchema) as Record<string, any>;
    delete schema.$schema;
  } else {
    schema = cleanSchema(params) as Record<string, any>;
  }

  // Gemini requires additionalProperties: false and required to include every key
  if (schema.type === "object") {
    schema.additionalProperties = false;
    if (schema.properties) {
      schema.required = Object.keys(schema.properties);
    }
  }

  return schema;
}

/**
 * Build the ClientTool map from ALL registered tools (handlers + widgets).
 * These are registered into the core agent's _clientTools so that
 * session._getClientToolDefs() can send their definitions to the server.
 * The core stream.ts handles tools without handlers correctly
 * (pauses for user interaction, or silently skips fire-and-forget).
 * Widget rendering is handled separately via onEvent → handleClientToolCall
 * in stream-callbacks.ts.
 */
export function useClientToolHelpers(agentId: string, toolContext: AgentToolContextValue | null) {
  const getClientToolsMap = useCallback((): Map<string, ClientTool> => {
    if (!toolContext) return new Map();
    const tools = toolContext.getToolsForAgent(agentId);
    const map = new Map<string, ClientTool>();

    for (const tool of tools) {
      map.set(tool.name, {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        await: tool.await,
        handler: tool.handler,
        ...(tool.targetAgentIds && { targetAgentIds: tool.targetAgentIds }),
      });
    }

    return map;
  }, [agentId, toolContext]);

  /**
   * Build client tool definitions for the request body.
   * Includes ALL registered tools (handlers + widgets).
   */
  const getClientToolDefs = useCallback((): ExecuteRequestBody["clientTools"] => {
    if (!toolContext) return [];
    const tools = toolContext.getToolsForAgent(agentId);

    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: resolveParameters(tool.parameters),
      await: tool.await,
      ...(tool.targetAgentIds && { targetAgentIds: tool.targetAgentIds }),
    }));
  }, [agentId, toolContext]);

  return { getClientToolsMap, getClientToolDefs };
}
