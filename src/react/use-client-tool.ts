import { useContext, useEffect, useState, useCallback, createElement } from "react";
import type { ZodSchema } from "zod";

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Infer the output type from a Zod schema's structural shape (`_zod.output`).
 * Falls back to `any` for raw JSON Schema objects or untyped parameters.
 * @internal
 */
type InferInput<T> = T extends { _zod: { output: infer O } } ? O : any;

export interface ClientToolRenderProps<T = any> {
  /** Parsed inputs from the agent. */
  inputs: T;
  /** Submit a result back to the agent (only available when `await: true`). */
  submit: (result: any) => void;
  /** Current status of this widget instance. */
  status: "pending" | "submitted" | "error";
  /** The persisted result from a previous submission (available after submit or on reload). */
  result?: any;
  /** Error message if the handler failed (only present when status is "error"). */
  error?: string;
}

export interface ClientToolConfig<TParams = any> {
  /** Tool name — must match the name the agent knows. */
  name: string;
  /** Description of what the tool does. */
  description: string;
  /**
   * Tool parameters — accepts a **Zod schema** or a raw JSON Schema object.
   * When a Zod schema is provided, `handler` and `render` inputs are
   * automatically typed — no explicit generic needed.
   *
   * @example
   * parameters: z.object({ question: z.string() })
   */
  parameters: TParams;
  /** If true, agent pauses and waits for the tool result before continuing. */
  await?: boolean;
  /**
   * Handler function for headless tools (no UI).
   * If `await: true`, the return value is sent back to the agent.
   * If `await: false`, runs as fire-and-forget.
   * Inputs are automatically typed when `parameters` is a Zod schema.
   */
  handler?: (inputs: InferInput<TParams>) => any | Promise<any>;
  /**
   * Render function for widget tools (with UI).
   * Receives `{ inputs, submit, status }`.
   * - `submit(result)` resumes the agent when `await: true`.
   * - `status` is `"pending"` until submitted, then `"submitted"`.
   * Inputs are automatically typed when `parameters` is a Zod schema.
   */
  render?: (props: ClientToolRenderProps<InferInput<TParams>>) => any;
  /**
   * If provided, this tool will only be available to the specified
   * server-side agents/subagents (by their BuildShip agent IDs).
   * When omitted, the tool is available to all agents.
   */
  targetAgentIds?: string[];
}

// ─── Context import (late-bound to avoid circular deps) ──────────────────────

// We import the context lazily from agent-context
import { AgentToolContext } from "./agent-context";

// ─── useClientTool hook ──────────────────────────────────────────────────────

/**
 * Register a client tool for a specific agent.
 *
 * @example
 * ```tsx
 * // Headless tool
 * useClientTool("agent-123", {
 *   name: "get_location",
 *   description: "Gets user location",
 *   parameters: z.object({}),
 *   handler: async () => {
 *     const pos = await getPosition();
 *     return { lat: pos.coords.latitude, lng: pos.coords.longitude };
 *   },
 * });
 *
 * // Widget tool with submission
 * useClientTool("agent-123", {
 *   name: "feedback_form",
 *   description: "Collects feedback",
 *   parameters: z.object({ question: z.string() }),
 *   await: true,
 *   render: ({ inputs, submit, status }) => (
 *     <form onSubmit={() => submit({ answer: "..." })}>
 *       <p>{inputs.question}</p>
 *       <button disabled={status !== "pending"}>Submit</button>
 *     </form>
 *   ),
 * });
 * ```
 */
export function useClientTool<TParams>(agentId: string, config: ClientToolConfig<TParams>): void {
  const context = useContext(AgentToolContext);

  if (!context) {
    throw new Error("useClientTool must be used within <AgentContextProvider>");
  }

  useEffect(() => {
    context.registerTool(agentId, config);
    return () => {
      context.unregisterTool(agentId, config.name);
    };
    // Note: consumers should memoize `config` to avoid unnecessary re-registrations.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, config.name, config.handler, config.render, config.parameters]);
}

// ─── ToolRenderer component ──────────────────────────────────────────────────

interface ToolRendererProps {
  /** The agent ID this tool belongs to. */
  agentId: string;
  /** The widget message part to render. */
  part: {
    toolName: string;
    callId: string;
    inputs: any;
    paused?: boolean;
    status?: "pending" | "submitted" | "error";
    result?: any;
    error?: string;
  };
}

/**
 * Renders a registered widget tool.
 * Looks up the tool by name from the registry and renders it with
 * the appropriate props (inputs, submit, status).
 *
 * @example
 * ```tsx
 * {message.parts?.map((part) => {
 *   if (part.type === "widget") {
 *     return <ToolRenderer key={part.callId} agentId="agent-123" part={part} />;
 *   }
 *   return <Markdown key={part.firstSequence}>{part.text}</Markdown>;
 * })}
 * ```
 */
export function ToolRenderer({ agentId, part }: ToolRendererProps) {
  const context = useContext(AgentToolContext);
  const [localStatus, setLocalStatus] = useState<"pending" | "submitted" | "error">(part.status || "pending");

  // Sync localStatus when part.status changes externally
  // (e.g., messages reloaded from session storage after resume)
  useEffect(() => {
    setLocalStatus(part.status || "pending");
  }, [part.status]);

  if (!context) {
    throw new Error("ToolRenderer must be used within <AgentContextProvider>");
  }

  const tool = context.getTool(agentId, part.toolName);

  const handleSubmit = useCallback(
    (result: any) => {
      if (localStatus === "submitted") return; // Prevent double-submission
      setLocalStatus("submitted");
      context.resumeTool(agentId, part.callId, result);
    },
    [agentId, part.callId, localStatus, context],
  );

  if (!tool?.render) {
    return null; // No registered render function for this tool
  }

  return tool.render({
    inputs: part.inputs,
    submit: part.paused ? handleSubmit : () => {},
    status: localStatus,
    result: part.result,
    error: part.error,
  });
}
