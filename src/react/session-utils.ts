import { useCallback, useMemo, useRef } from "react";
import { useThrottledCallback } from "use-debounce";

import type { Message, Session } from "./types";
import { TEMPORARY_SESSION_ID } from "./constants";

/**
 * Strip heavy `data` (base64/URL) from attachments before persisting to localStorage.
 * Keeps metadata (type, mimeType, filename) so the UI can still render file chips/icons.
 */
function sanitizeMessagesForStorage(messages: Array<Message>): Array<Message> {
  return messages.map((msg) => {
    if (!msg.attachments || msg.attachments.length === 0) return msg;
    return {
      ...msg,
      attachments: msg.attachments.map((att) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { data, ...metadata } = att;
        return metadata as typeof att;
      }),
    };
  });
}

export const useSessionUtils = (
  agentId: string,
  allSessions: Record<string, Record<string, Session>>,
  setAllSessions: (
    value:
      | Record<string, Record<string, Session>>
      | ((
          prev: Record<string, Record<string, Session>>,
        ) => Record<string, Record<string, Session>>),
  ) => void,
  currentSessionId: string,
  setCurrentSessionId: (sessionId: string) => void,
  messagesRef: React.MutableRefObject<Array<Message>>,
) => {
  const agentSessions = useMemo(() => allSessions[agentId] || {}, [agentId, allSessions]);

  // Ref that tracks currentSessionId immediately (not waiting for re-render).
  // Updated eagerly in onSessionId so syncSessionRef reads the right value
  // even between setCurrentSessionId() and the next render.
  const currentSessionIdRef = useRef(currentSessionId);
  currentSessionIdRef.current = currentSessionId;

  const syncSessionRef = useRef<(messages?: Array<Message>) => void>();
  const pendingSyncRef = useRef<Array<Message> | null>(null);
  const syncScheduledRef = useRef(false);

  // Throttle the actual setAllSessions write to avoid excessive localStorage updates.
  const throttledPersist = useThrottledCallback(
    (msgs: Array<Message>, sid: string) => {
      setAllSessions((prev) => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          [sid]: {
            ...prev[agentId]?.[sid],
            id: prev[agentId]?.[sid]?.id ?? sid,
            createdAt: prev[agentId]?.[sid]?.createdAt ?? Date.now(),
            messages: msgs,
            updatedAt: Date.now(),
          },
        },
      }));
    },
    1500,
    { leading: true },
  );

  syncSessionRef.current = (updatedMessages?: Array<Message>) => {
    const sid = currentSessionIdRef.current;
    if (!sid || sid === TEMPORARY_SESSION_ID) {
      return;
    }

    // Capture the latest messages to persist. Multiple calls within the same
    // render cycle will overwrite — only the last value matters.
    pendingSyncRef.current = sanitizeMessagesForStorage(updatedMessages ?? messagesRef.current);

    // Schedule a single microtask to flush. This moves setAllSessions out of
    // the React render phase, avoiding the "setState during render" warning.
    if (!syncScheduledRef.current) {
      syncScheduledRef.current = true;
      queueMicrotask(() => {
        syncScheduledRef.current = false;
        const msgs = pendingSyncRef.current;
        if (!msgs) return;
        pendingSyncRef.current = null;
        const flushSid = currentSessionIdRef.current;
        if (!flushSid || flushSid === TEMPORARY_SESSION_ID) return;

        throttledPersist(msgs, flushSid);
      });
    }
  };

  const getInitialSessionId = () => {
    const sessions = Object.values(agentSessions);
    if (sessions.length > 0) {
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
    }
    return TEMPORARY_SESSION_ID;
  };

  const switchSession = useCallback(
    (sessionId: string = TEMPORARY_SESSION_ID) => {
      setCurrentSessionId(sessionId);
    },
    [setCurrentSessionId],
  );

  const deleteSession = useCallback(
    (sessionId: string) => {
      if (!sessionId || sessionId === TEMPORARY_SESSION_ID) {
        return;
      }

      // Compute the next session ID before mutating state
      let nextSessionId: string | null = null;
      if (sessionId === currentSessionId) {
        const remaining = Object.values(agentSessions).filter((s) => s.id !== sessionId);
        if (remaining.length > 0) {
          nextSessionId = remaining.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
        } else {
          nextSessionId = TEMPORARY_SESSION_ID;
        }
      }

      setAllSessions((prev) => {
        const updatedAgentSessions = { ...prev[agentId] };
        delete updatedAgentSessions[sessionId];
        return {
          ...prev,
          [agentId]: updatedAgentSessions,
        };
      });

      // Switch session outside the updater to avoid cross-component setState
      if (nextSessionId !== null) {
        setCurrentSessionId(nextSessionId);
      }
    },
    [agentId, agentSessions, currentSessionId, setAllSessions, setCurrentSessionId],
  );

  const sessionsList = useMemo(
    () => Object.values(agentSessions).sort((a, b) => b.updatedAt - a.updatedAt),
    [agentSessions],
  );

  const createSessionFromResponse = (
    sessionId: string,
    sessionName: string,
    currentMessages: Array<Message>,
  ) => {
    setAllSessions((prev) => ({
      ...prev,
      [agentId]: {
        ...prev[agentId],
        [sessionId]: {
          id: sessionId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messages: sanitizeMessagesForStorage(currentMessages),
          name: sessionName,
        },
      },
    }));
  };

  return {
    agentSessions,
    /**
     * `syncSessionRef` is a throttled function. Calls made in between the 1000ms throttling period will be ignored.
     * The easiest way to make sure the function isn't ever called "out-of-order" is to ensure the messages list passed in as
     * argument is maintained synchronously (which is the case with the `messages` state in `useAgent`, and the `messagesRef` which
     * always stores an up-to-date `messages` value), so even if a call is skipped due to throttling, the next call will still contain
     * that missed change because the argument messages list will always be up-to-date.
     * */
    syncSessionRef,
    currentSessionIdRef,
    getInitialSessionId,
    switchSession,
    deleteSession,
    sessionsList,
    createSessionFromResponse,
  };
};
