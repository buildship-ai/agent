import { useCallback, useRef, useState, useEffect, useContext, useMemo } from "react";
import type { BuildShipAgent } from "../core/agent";
import type { AgentSession } from "../core/session";
import type { AgentInput, ContentPart, ImagePart, FilePart } from "../core/types";
import { DEFAULT_SESSION_NAME, TEMPORARY_SESSION_ID } from "./constants";
import { useSessionUtils } from "./session-utils";
import { useAgentGlobalState, AgentToolContext } from "./agent-context";
import type { Message } from "./types";
import { useClientToolHelpers } from "./client-tools";
import { buildStreamCallbacks } from "./stream-callbacks";
import type { RunOptions } from "./stream-callbacks";

export interface UseAgentOptions {
  textDeltaModifier?: (
    delta: string,
    fullText: string,
    meta: { executionId: string; sequence: number; agentId: string },
  ) => string;
  fullTextModifier?: (
    fullText: string,
    meta: { executionId: string; sequence: number; agentId: string },
  ) => string;
}

export default function useAgent(agent: BuildShipAgent, options?: UseAgentOptions) {
  const agentId = agent._agentId;

  const { allSessions, setAllSessions } = useAgentGlobalState();
  const toolContext = useContext(AgentToolContext);

  const [inProgress, setInProgress] = useState(false);
  const [messages, setMessages] = useState<Array<Message>>([]);
  const messagesRef = useRef<Array<Message>>([]);

  const [currentSessionId, setCurrentSessionId] = useState<string>(TEMPORARY_SESSION_ID);

  const sessionUtils = useSessionUtils(
    agentId,
    allSessions,
    setAllSessions,
    currentSessionId,
    setCurrentSessionId,
    messagesRef,
  );

  useEffect(() => {
    const initialSessionId = sessionUtils.getInitialSessionId();
    setCurrentSessionId(initialSessionId);
  }, [agentId]);



  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Reload messages from session storage only on session/agent switch
  useEffect(() => {
    if (inProgress) return;
    const session = sessionUtils.agentSessions[currentSessionId];
    if (session) {
      setMessages(session.messages);
    } else {
      setMessages([]);
    }
  }, [currentSessionId, agentId, sessionUtils.agentSessions, inProgress]);

  useEffect(() => {
    const syncRef = sessionUtils.syncSessionRef;
    const msgRef = messagesRef;
    return () => {
      if (msgRef.current.length > 0 && syncRef.current) {
        syncRef.current();
      }
    };
  }, [sessionUtils.syncSessionRef]);

  // Make a stable ref to avoid dependency cycles and redefinitions
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const lastRunOptionsRef = useRef<{
    context?: object;
    additionalHeaders?: Record<string, string>;
    additionalBody?: Record<string, unknown>;
  }>({});

  const { getClientToolsMap } = useClientToolHelpers(agentId, toolContext);

  const activeSessionRef = useRef<AgentSession | null>(null);

  const runAgent = useCallback(
    async (input: AgentInput | undefined, runOptions?: RunOptions) => {
      const isNewSession = !currentSessionId || currentSessionId === TEMPORARY_SESSION_ID;

      setInProgress(true);

      const deps = {
        agentId,
        currentSessionId,
        messagesRef,
        setMessages,
        setInProgress,
        syncSessionRef: sessionUtils.syncSessionRef,
        toolContext,
        textDeltaModifier: optionsRef.current?.textDeltaModifier,
        fullTextModifier: optionsRef.current?.fullTextModifier,
      };

      const callbacks = buildStreamCallbacks(deps);

      const executeOptions = {
        context: runOptions?.context,
        headers: runOptions?.additionalHeaders,
        body: runOptions?.additionalBody,
      };

      // Ensure React-registered tools are synced into the core agent's map
      const toolsMap = getClientToolsMap();
      for (const tool of toolsMap.values()) {
        agent.registerClientTool(tool);
      }

      // Merge legacy client tool definitions safely
      if (runOptions?.clientTools && runOptions.clientTools.length > 0) {
        executeOptions.body = {
          ...(executeOptions.body || {}),
          clientTools: [
            ...((executeOptions.body?.clientTools as any[]) || []),
            ...runOptions.clientTools,
          ],
        };
      }

      try {
        if (runOptions?.resumeToolCallId) {
          if (isNewSession) throw new Error("Cannot resume a tool call on a temporary session.");
          const session = agent.session(currentSessionId);
          activeSessionRef.current = session;
          await session.resumeWithCallId(
            runOptions.resumeToolCallId,
            runOptions.resumeToolResult,
            callbacks,
            executeOptions,
          );
        } else {
          if (isNewSession) {
            const extendedOptions = {
              ...executeOptions,
              onSessionId: (newSessionId: string, sessionName?: string) => {
                sessionUtils.createSessionFromResponse(
                  newSessionId,
                  sessionName || DEFAULT_SESSION_NAME,
                  messagesRef.current,
                );
                setCurrentSessionId(newSessionId);
              },
            };
            const session = await agent.execute(input || "", callbacks, extendedOptions);
            activeSessionRef.current = session;
          } else {
            const session = agent.session(currentSessionId);
            activeSessionRef.current = session;
            await session.execute(input || "", callbacks, executeOptions);
          }
        }
      } catch (error) {
        console.log("Agent execution failed", error);
        setInProgress(false);
        if (sessionUtils.syncSessionRef.current) {
          sessionUtils.syncSessionRef.current(messagesRef.current);
        }
        throw error;
      } finally {
        activeSessionRef.current = null;
      }
    },
    [currentSessionId, sessionUtils, agentId, toolContext, agent, getClientToolsMap],
  );

  const handleSend = useCallback(
    async (
      input: AgentInput,
      options?: {
        context?: object;
        skipUserMessage?: boolean;
        additionalHeaders?: Record<string, string>;
        additionalBody?: Record<string, unknown>;
      },
    ) => {
      // Extract text content and media attachments from AgentInput
      let displayText: string;
      let attachments: Array<ImagePart | FilePart> | undefined;

      if (typeof input === "string") {
        displayText = input;
      } else {
        // ContentPart[] — extract text parts for display, media for attachments
        const textParts: string[] = [];
        const mediaParts: Array<ImagePart | FilePart> = [];
        for (const part of input) {
          if (part.type === "text") {
            textParts.push(part.text);
          } else {
            mediaParts.push(part);
          }
        }
        displayText = textParts.join("\n");
        if (mediaParts.length > 0) attachments = mediaParts;
      }

      const userMessage: Message = {
        role: "user" as const,
        content: displayText,
        executionId: Date.now().toString(),
        ...(options?.context ? { context: options.context } : {}),
        ...(attachments ? { attachments } : {}),
      };

      if (!options?.skipUserMessage) {
        setMessages((prev) => {
          const updatedMessages = [...prev, userMessage];
          if (sessionUtils.syncSessionRef.current) {
            sessionUtils.syncSessionRef.current(updatedMessages);
          }
          return updatedMessages;
        });
      } else if (options?.context || attachments) {
        // skipUserMessage means the user message was already added via addOptimisticMessage
        // Patch context and attachments onto the existing last user message.
        setMessages((prev) => {
          const lastUserIdx = prev.findLastIndex((m) => m.role === "user");
          if (lastUserIdx === -1) return prev;
          const updatedMessages = [...prev];
          updatedMessages[lastUserIdx] = {
            ...updatedMessages[lastUserIdx],
            ...(options?.context ? { context: options.context as Record<string, any> } : {}),
            ...(attachments ? { attachments } : {}),
          };
          if (sessionUtils.syncSessionRef.current) {
            sessionUtils.syncSessionRef.current(updatedMessages);
          }
          return updatedMessages;
        });
      }

      const effectiveExecutionId = options?.skipUserMessage
        ? (messagesRef.current.findLast((m) => m.role === "user")?.executionId ??
          userMessage.executionId)
        : userMessage.executionId;

      // Track options so they can be re-applied during string continuations (like tool resumes)
      lastRunOptionsRef.current = {
        context: options?.context,
        additionalHeaders: options?.additionalHeaders,
        additionalBody: options?.additionalBody,
      };

      try {
        await runAgent(input, {
          ...options,
          optimisticExecutionId: effectiveExecutionId,
        });
      } catch (error) {
        if (!options?.skipUserMessage) {
          setMessages((prev) => {
            const updatedMessages = prev.some((m) => m === userMessage)
              ? prev
              : [...prev, userMessage];
            if (sessionUtils.syncSessionRef.current) {
              sessionUtils.syncSessionRef.current(updatedMessages);
            }
            return updatedMessages;
          });
        }
        throw error;
      }
    },
    [runAgent, sessionUtils.syncSessionRef],
  );

  const resumeTool = useCallback(
    async (callId: string, result: any) => {
      setMessages((prev) => {
        const updatedMessages = prev.map((msg) => {
          if (msg.parts) {
            const updatedParts = msg.parts.map((part) => {
              if (part.type === "widget" && part.callId === callId) {
                return { ...part, status: "submitted" as const, result };
              }
              return part;
            });
            return { ...msg, parts: updatedParts };
          }
          return msg;
        });
        if (sessionUtils.syncSessionRef.current) {
          sessionUtils.syncSessionRef.current(updatedMessages);
        }
        return updatedMessages;
      });

      const lastUserMessage = messagesRef.current.findLast((m) => m.role === "user");

      await runAgent(undefined, {
        resumeToolCallId: callId,
        resumeToolResult: result,
        ...lastRunOptionsRef.current,
        // Restore context from the persisted user message (survives page refresh)
        context: lastUserMessage?.context ?? lastRunOptionsRef.current.context,
      });
    },
    [runAgent, sessionUtils.syncSessionRef],
  );

  const addOptimisticMessage = useCallback(
    (input: AgentInput) => {
      // Extract display text and attachments from AgentInput
      let displayText: string;
      let attachments: Array<ImagePart | FilePart> | undefined;

      if (typeof input === "string") {
        displayText = input;
      } else {
        const textParts: string[] = [];
        const mediaParts: Array<ImagePart | FilePart> = [];
        for (const part of input) {
          if (part.type === "text") {
            textParts.push(part.text);
          } else {
            mediaParts.push(part);
          }
        }
        displayText = textParts.join("\n");
        if (mediaParts.length > 0) attachments = mediaParts;
      }

      const userMessage: Message = {
        role: "user" as const,
        content: displayText,
        executionId: Date.now().toString(),
        ...(attachments ? { attachments } : {}),
      };

      setMessages((prev) => {
        const updatedMessages = [...prev, userMessage];
        if (sessionUtils.syncSessionRef.current) {
          sessionUtils.syncSessionRef.current(updatedMessages);
        }
        return updatedMessages;
      });
    },
    [sessionUtils.syncSessionRef],
  );

  const abort = useCallback(() => {
    if (activeSessionRef.current) {
      activeSessionRef.current.abort();
    }
    setInProgress(false);
    if (sessionUtils.syncSessionRef.current) {
      sessionUtils.syncSessionRef.current(messagesRef.current);
    }
  }, [sessionUtils.syncSessionRef]);

  return {
    inProgress,
    messages,
    handleSend,
    resumeTool,
    addOptimisticMessage,
    abort,
    sessionId: currentSessionId,
    switchSession: sessionUtils.switchSession,
    deleteSession: sessionUtils.deleteSession,
    sessions: sessionUtils.sessionsList,
  };
}
