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

  const syncSessionRef = useRef<(messages?: Array<Message>) => void>();

  syncSessionRef.current = useThrottledCallback(
    (updatedMessages?: Array<Message>) => {
      if (!currentSessionId || currentSessionId === TEMPORARY_SESSION_ID) {
        return;
      }

      const messagesToPersist = sanitizeMessagesForStorage(updatedMessages ?? messagesRef.current);

      setAllSessions((prev) => ({
        ...prev,
        [agentId]: {
          ...prev[agentId],
          [currentSessionId]: {
            ...prev[agentId]?.[currentSessionId],
            id: prev[agentId]?.[currentSessionId]?.id ?? currentSessionId,
            createdAt: prev[agentId]?.[currentSessionId]?.createdAt ?? Date.now(),
            messages: messagesToPersist,
            updatedAt: Date.now(),
          },
        },
      }));
    },
    1500,
    { leading: true },
  );

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

      setAllSessions((prev) => {
        const updatedAgentSessions = { ...prev[agentId] };
        delete updatedAgentSessions[sessionId];

        // If we're deleting the current session, switch to the most recent remaining one
        if (sessionId === currentSessionId) {
          const remainingSessions = Object.values(updatedAgentSessions);
          if (remainingSessions.length > 0) {
            const mostRecent = remainingSessions.sort((a, b) => b.updatedAt - a.updatedAt)[0];
            setCurrentSessionId(mostRecent.id);
          } else {
            setCurrentSessionId(TEMPORARY_SESSION_ID);
          }
        }

        return {
          ...prev,
          [agentId]: updatedAgentSessions,
        };
      });
    },
    [agentId, currentSessionId, setAllSessions, setCurrentSessionId],
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
    getInitialSessionId,
    switchSession,
    deleteSession,
    sessionsList,
    createSessionFromResponse,
  };
};
