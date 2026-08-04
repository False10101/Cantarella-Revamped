import { z } from "zod";

export const conversationIdSchema = z.string().uuid();

export const messageHistoryQuerySchema = z.object({
  before: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const sendMessageInputSchema = z
  .object({
    clientMessageId: z.string().uuid(),
    content: z.string().trim().min(1).max(10_000),
    source: z.enum(["web", "android", "ios"]).default("web"),
    replyToMessageId: z.null().optional(),
  })
  .strict();

export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export interface PrimaryConversationSnapshot {
  id: string;
  title: "Cantarella";
  lastMessageAt: string | null;
  unreadCount: 0;
}

export interface MessageSnapshot {
  id: string;
  turnId: string | null;
  clientMessageId: string | null;
  sender: "user" | "assistant" | "system";
  content: string;
  messageKind: "chat" | "reminder";
  source: "web" | "android" | "ios" | "system";
  partIndex: number | null;
  status: "sent" | "seen" | "delivered";
  replyToMessageId: null;
  createdAt: string;
}

export interface MessageHistoryPage {
  messages: MessageSnapshot[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TurnSnapshot {
  id: string;
  status: "queued" | "thinking" | "voicing" | "completed" | "failed" | "cancelled";
}

export interface SaveMessageResult {
  message: MessageSnapshot;
  turn: TurnSnapshot;
}
