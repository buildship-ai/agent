import type { MessagePart } from "../types";

/**
 * Updates a list of message parts with a new part,
 * appending it and merging with the previous part if both are contiguous text deltas.
 * Parts are kept in arrival order (no sorting) since events stream chronologically.
 */
export function updateAgentMessageParts(parts: MessagePart[], newPart: MessagePart): MessagePart[] {
  const last = parts[parts.length - 1];

  // Merge contiguous text deltas
  const canMerge =
    last?.type === "text" &&
    newPart.type === "text" &&
    newPart.firstSequence === last.lastSequence + 1;

  if (canMerge) {
    return [
      ...parts.slice(0, -1),
      {
        ...last,
        text: last.text + newPart.text,
        lastSequence: newPart.lastSequence,
      },
    ];
  }

  return [...parts, newPart];
}
