import type { MessageSnapshot } from "../api/conversations/conversation.types.js";

export type ConversationEvent =
  | {
      type: "turn.status";
      data: {
        turnId: string;
        status: "thinking" | "voicing";
      };
    }
  | {
      type: "typing.started" | "typing.stopped";
      data: {
        conversationId: string;
        sender: "assistant";
      };
    }
  | {
      type: "message.created";
      data: { message: MessageSnapshot };
    }
  | {
      type: "turn.completed";
      data: { turnId: string };
    }
  | {
      type: "turn.failed";
      data: {
        turnId: string;
        code: string;
        message: string;
        retryable: boolean;
      };
    };

type ConversationEventListener = (event: ConversationEvent) => void;

const listenersByConversation = new Map<
  string,
  Set<ConversationEventListener>
>();

function subscribe(
  conversationId: string,
  listener: ConversationEventListener,
): () => void {
  const listeners = listenersByConversation.get(conversationId) ?? new Set();
  listeners.add(listener);
  listenersByConversation.set(conversationId, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByConversation.delete(conversationId);
  };
}

function publish(conversationId: string, event: ConversationEvent): void {
  for (const listener of listenersByConversation.get(conversationId) ?? []) {
    listener(event);
  }
}

export const conversationEvents = { subscribe, publish };
