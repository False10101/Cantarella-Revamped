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

class ConversationEventBroker {
  private readonly listeners = new Map<
    string,
    Set<ConversationEventListener>
  >();

  subscribe(
    conversationId: string,
    listener: ConversationEventListener,
  ): () => void {
    const listeners = this.listeners.get(conversationId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(conversationId, listeners);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(conversationId);
    };
  }

  publish(conversationId: string, event: ConversationEvent): void {
    for (const listener of this.listeners.get(conversationId) ?? []) {
      listener(event);
    }
  }
}

export const conversationEvents = new ConversationEventBroker();
