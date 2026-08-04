import type { RecentContextMessage } from "../pipeline/message-order.js";

export const RECENT_RAW_MESSAGE_TARGET = 15;
export const SUMMARY_CHUNK_MESSAGE_TARGET = 15;

function sharesTurn(
  left: RecentContextMessage,
  right: RecentContextMessage,
): boolean {
  return left.turnId !== null && left.turnId === right.turnId;
}

export function recentRawStartIndex(
  messages: RecentContextMessage[],
  target = RECENT_RAW_MESSAGE_TARGET,
): number {
  let start = Math.max(0, messages.length - target);

  while (
    start > 0 &&
    messages[start] &&
    messages[start - 1] &&
    sharesTurn(messages[start - 1]!, messages[start]!)
  ) {
    start -= 1;
  }

  return start;
}

export function selectNextSummaryChunk<T extends RecentContextMessage>(
  orderedMessages: T[],
  summarizedThroughMessageId: string | null,
  input: {
    recentTarget?: number;
    chunkTarget?: number;
  } = {},
): T[] | null {
  const recentTarget = input.recentTarget ?? RECENT_RAW_MESSAGE_TARGET;
  const chunkTarget = input.chunkTarget ?? SUMMARY_CHUNK_MESSAGE_TARGET;
  const summarizedIndex = summarizedThroughMessageId
    ? orderedMessages.findIndex(
        (message) => message.id === summarizedThroughMessageId,
      )
    : -1;

  if (summarizedThroughMessageId && summarizedIndex === -1) {
    throw new Error("The latest summary cursor message is unavailable.");
  }

  const unsummarizedStart = summarizedIndex + 1;
  const eligibleEnd = recentRawStartIndex(orderedMessages, recentTarget);
  const eligible = orderedMessages.slice(unsummarizedStart, eligibleEnd);

  if (eligible.length < chunkTarget) return null;

  let endIndex = chunkTarget - 1;
  while (
    endIndex + 1 < eligible.length &&
    eligible[endIndex] &&
    eligible[endIndex + 1] &&
    sharesTurn(eligible[endIndex]!, eligible[endIndex + 1]!)
  ) {
    endIndex += 1;
  }

  return eligible.slice(0, endIndex + 1);
}
