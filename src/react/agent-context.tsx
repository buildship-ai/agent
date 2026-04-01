import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  useEffect,
  useMemo,
  ReactNode,
} from "react";
import useAgent, { type UseAgentOptions } from "./use-agent";
import { BuildShipAgent } from "../core/agent";
import type { AgentInput } from "../core/types";
import type { Message, Session } from "./types";
import type { ClientToolConfig } from "./use-client-tool";
import { useSyncedLocalStorage } from "./utils/use-synced-local-storage";
import { AGENT_SESSIONS_KEY } from "./constants";

export interface AgentRunner {
  messages: Message[];
  inProgress: boolean;
  sessionId: string;
  sessions: Session[];
  handleSend: (
    input: AgentInput,
    options?: {
      context?: Record<string, unknown>;
      skipUserMessage?: boolean;
      additionalHeaders?: Record<string, string>;
      additionalBody?: Record<string, unknown>;
    },
  ) => Promise<void>;
  resumeTool: (callId: string, result: any) => Promise<void>;
  switchSession: (sessionId?: string) => void;
  deleteSession: (sessionId: string) => void;
  addOptimisticMessage: (input: AgentInput) => void;
  abort: () => void;
}

// ─── Tool Registry Context ──────────────────────────────────────────────────

export interface AgentToolContextValue {
  registerTool: (agentId: string, config: ClientToolConfig) => void;
  unregisterTool: (agentId: string, toolName: string) => void;
  getTool: (agentId: string, toolName: string) => ClientToolConfig | undefined;
  getToolsForAgent: (agentId: string) => ClientToolConfig[];
  resumeTool: (agentId: string, callId: string, result: any) => void;
}

export const AgentToolContext = createContext<AgentToolContextValue | null>(null);

// ─── Agent Context ──────────────────────────────────────────────────────────

interface AgentContextValue {
  initializeAgent: (
    agentId: string,
    agentUrl: string,
    accessKey?: string,
    options?: UseAgentOptions,
  ) => void;
  registerRunner: (agentId: string, runner: AgentRunner) => void;
  getRunner: (agentId: string) => AgentRunner | null;
  // Global state provided to useAgent hooks
  allSessions: Record<string, Record<string, Session>>;
  setAllSessions: (
    value:
      | Record<string, Record<string, Session>>
      | ((
          prev: Record<string, Record<string, Session>>,
        ) => Record<string, Record<string, Session>>),
  ) => void;
}

const AgentContext = createContext<AgentContextValue | null>(null);

export function AgentContextProvider({ children }: { children: ReactNode }) {
  const activeAgentsRef = useRef<
    Map<string, { agentUrl: string; accessKey?: string; options?: UseAgentOptions }>
  >(new Map());
  const runnersRef = useRef<Map<string, AgentRunner>>(new Map());
  const listenersRef = useRef<Map<string, Set<() => void>>>(new Map());

  // Tool registry: agentId -> Map<toolName, ClientToolConfig>
  const toolRegistryRef = useRef<Map<string, Map<string, ClientToolConfig>>>(new Map());

  const [, forceUpdate] = useState({});

  // Global Sync State managed here to be shared
  const [allSessions, setAllSessions] = useSyncedLocalStorage<
    Record<string, Record<string, Session>>
  >(AGENT_SESSIONS_KEY, {});

  const initializeAgent = useCallback(
    (agentId: string, agentUrl: string, accessKey?: string, options?: UseAgentOptions) => {
      const existing = activeAgentsRef.current.get(agentId);

      if (!existing) {
        activeAgentsRef.current.set(agentId, { agentUrl, accessKey, options });
        forceUpdate({});
      } else if (existing.agentUrl !== agentUrl || existing.accessKey !== accessKey) {
        activeAgentsRef.current.set(agentId, { agentUrl, accessKey, options });
        forceUpdate({});
      } else if (options) {
        // Always update options ref (e.g. textDeltaModifier) without triggering re-render
        existing.options = options;
      }
    },
    [],
  );

  const registerRunner = useCallback((agentId: string, runner: AgentRunner) => {
    runnersRef.current.set(agentId, runner);
    // Notify listeners for this agentId
    const listeners = listenersRef.current.get(agentId);
    if (listeners) {
      listeners.forEach((callback) => callback());
    }
  }, []);

  const getRunner = useCallback((agentId: string) => {
    return runnersRef.current.get(agentId) || null;
  }, []);

  // ─── Tool registry methods ─────────────────────────────────────────

  const registerTool = useCallback((agentId: string, config: ClientToolConfig) => {
    if (!toolRegistryRef.current.has(agentId)) {
      toolRegistryRef.current.set(agentId, new Map());
    }
    toolRegistryRef.current.get(agentId)!.set(config.name, config);
  }, []);

  const unregisterTool = useCallback((agentId: string, toolName: string) => {
    toolRegistryRef.current.get(agentId)?.delete(toolName);
  }, []);

  const getTool = useCallback((agentId: string, toolName: string) => {
    return toolRegistryRef.current.get(agentId)?.get(toolName);
  }, []);

  const getToolsForAgent = useCallback((agentId: string) => {
    const toolMap = toolRegistryRef.current.get(agentId);
    return toolMap ? Array.from(toolMap.values()) : [];
  }, []);

  const resumeToolFromContext = useCallback((agentId: string, callId: string, result: any) => {
    const runner = runnersRef.current.get(agentId);
    if (runner) {
      runner.resumeTool(callId, result);
    } else {
      console.warn(`Cannot resume tool: no runner found for agent "${agentId}"`);
    }
  }, []);

  // ─── Context values ────────────────────────────────────────────────

  const agentContextValue = useMemo(
    () => ({
      initializeAgent,
      registerRunner,
      getRunner,
      allSessions,
      setAllSessions,
      runnersRef,
      listenersRef,
    }),
    [
      initializeAgent,
      registerRunner,
      getRunner,
      allSessions,
      setAllSessions,
    ],
  );

  const toolContextValue = useMemo(
    () => ({
      registerTool,
      unregisterTool,
      getTool,
      getToolsForAgent,
      resumeTool: resumeToolFromContext,
    }),
    [registerTool, unregisterTool, getTool, getToolsForAgent, resumeToolFromContext],
  );

  return (
    <AgentContext.Provider value={agentContextValue}>
      <AgentToolContext.Provider value={toolContextValue}>
        {children}
        {Array.from(activeAgentsRef.current.entries()).map(
          ([agentId, { agentUrl, accessKey, options }]) => (
            <AgentRunnerInstance
              key={agentId}
              agentId={agentId}
              agentUrl={agentUrl}
              accessKey={accessKey}
              options={options}
            />
          ),
        )}
      </AgentToolContext.Provider>
    </AgentContext.Provider>
  );
}

function AgentRunnerInstance({
  agentId,
  agentUrl,
  accessKey,
  options,
}: {
  agentId: string;
  agentUrl: string;
  accessKey?: string;
  options?: UseAgentOptions;
}) {
  const agent = useMemo(
    () => new BuildShipAgent({ agentId, baseUrl: agentUrl, accessKey }),
    [agentId, agentUrl, accessKey],
  );
  // Use a ref for options to avoid re-renders when function references change
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const agentRunner = useAgent(agent, optionsRef.current);
  const context = useContext(AgentContext);

  useEffect(() => {
    if (context) {
      context.registerRunner(agentId, agentRunner);
    }
  }, [agentId, agentRunner, context]);

  if (!context) return null;

  return null;
}

export function useAgentContext(
  agentId: string,
  agentUrl: string,
  accessKey?: string,
  options?: UseAgentOptions,
): AgentRunner {
  const context = useContext(AgentContext);

  if (!context) {
    throw new Error("useAgentContext must be used within AgentContextProvider");
  }

  const { initializeAgent, getRunner, listenersRef } = context as AgentContextValue & {
    listenersRef: React.MutableRefObject<Map<string, Set<() => void>>>;
  };

  // Use a ref for options so function identity changes don't trigger re-renders
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    initializeAgent(agentId, agentUrl, accessKey, optionsRef.current);
  }, [agentId, agentUrl, accessKey, initializeAgent]);

  // Reactive subscription to runner updates
  const [runner, setRunner] = useState<AgentRunner | null>(() => getRunner(agentId));

  useEffect(() => {
    // Current runner state
    const currentRunner = getRunner(agentId);
    if (currentRunner !== runner) {
      setRunner(currentRunner);
    }

    // Subscribe to future updates
    const callback = () => {
      setRunner(getRunner(agentId));
    };

    if (!listenersRef.current.has(agentId)) {
      listenersRef.current.set(agentId, new Set());
    }
    listenersRef.current.get(agentId)?.add(callback);

    return () => {
      listenersRef.current.get(agentId)?.delete(callback);
    };
  }, [agentId, getRunner]);

  const placeholder = useMemo(
    () => ({
      messages: [],
      inProgress: false,
      sessionId: "",
      sessions: [],
      handleSend: async () => {},
      resumeTool: async () => {},
      switchSession: () => {},
      deleteSession: () => {},
      addOptimisticMessage: () => {},
      abort: () => {},
    }),
    [],
  );

  return runner || placeholder;
}

// Hook to access the global state for use-agent
export function useAgentGlobalState() {
  const context = useContext(AgentContext);
  if (!context) {
    throw new Error("useAgentGlobalState must be used within AgentContextProvider");
  }
  return {
    allSessions: context.allSessions,
    setAllSessions: context.setAllSessions,
  };
}
