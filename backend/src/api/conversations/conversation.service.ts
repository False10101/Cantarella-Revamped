import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  isNull,
  lt,
  or,
} from "drizzle-orm";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { getEnvironment } from "../../config/env.js";
import { database } from "../../db/client.js";
import {
  conversations,
  inputBatchMessages,
  inputBatches,
  jobs,
  messages,
  turns,
  users,
} from "../../db/schema.js";
import { HttpError } from "../../http/http-error.js";
import { orderRecentContextMessages } from "../../pipeline/message-order.js";
import type {
  MessageHistoryPage,
  MessageSnapshot,
  PrimaryConversationSnapshot,
  SaveMessageResult,
  SendMessageInput,
} from "./conversation.types.js";

export interface ConversationService {
  assertOwnership(
    identity: AuthenticatedIdentity,
    conversationId: string,
  ): Promise<void>;
  getPrimary(
    identity: AuthenticatedIdentity,
  ): Promise<PrimaryConversationSnapshot>;
  getMessages(
    identity: AuthenticatedIdentity,
    conversationId: string,
    options: { before: string | undefined; limit: number },
  ): Promise<MessageHistoryPage>;
  saveUserMessage(
    identity: AuthenticatedIdentity,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<SaveMessageResult>;
}

export type StoredMessage = {
  id: string;
  turnId: string | null;
  clientMessageId: string | null;
  role: "user" | "assistant" | "system";
  content: string;
  kind: "chat" | "reminder";
  origin: "web" | "android" | "ios" | "system";
  partIndex: number | null;
  createdAt: Date;
  turnStatus?:
    | "queued"
    | "thinking"
    | "voicing"
    | "completed"
    | "failed"
    | "cancelled"
    | null;
};

const messageSelection = {
  id: messages.id,
  turnId: messages.turnId,
  clientMessageId: messages.clientMessageId,
  role: messages.role,
  content: messages.content,
  kind: messages.kind,
  origin: messages.origin,
  partIndex: messages.partIndex,
  createdAt: messages.createdAt,
};

const historyMessageSelection = {
  ...messageSelection,
  turnStatus: turns.status,
};

export function toMessageSnapshot(message: StoredMessage): MessageSnapshot {
  const wasSeen =
    message.turnStatus === "thinking" ||
    message.turnStatus === "voicing" ||
    message.turnStatus === "completed" ||
    message.turnStatus === "failed";

  return {
    id: message.id,
    turnId: message.turnId,
    clientMessageId: message.clientMessageId,
    sender: message.role,
    content: message.content,
    messageKind: message.kind,
    source: message.origin,
    partIndex: message.partIndex,
    status:
      message.role === "user" ? (wasSeen ? "seen" : "sent") : "delivered",
    replyToMessageId: null,
    createdAt: message.createdAt.toISOString(),
  };
}

function conversationNotFound(): HttpError {
  return new HttpError(
    404,
    "CONVERSATION_NOT_FOUND",
    "The conversation does not exist.",
  );
}

function accountNotInitialized(): HttpError {
  return new HttpError(
    404,
    "ACCOUNT_NOT_INITIALIZED",
    "Complete the login bootstrap before accessing this account.",
  );
}

export function createConversationService(): ConversationService {
  return {
    async assertOwnership(identity, conversationId) {
      const [ownedConversation] = await database
        .select({ id: conversations.id })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.ownerUserId))
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(users.authIssuer, identity.issuer),
            eq(users.authSubject, identity.subject),
          ),
        )
        .limit(1);

      if (!ownedConversation) throw conversationNotFound();
    },

    async getPrimary(identity) {
      const [conversation] = await database
        .select({
          id: conversations.id,
          lastMessageAt: conversations.lastMessageAt,
        })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.ownerUserId))
        .where(
          and(
            eq(users.authIssuer, identity.issuer),
            eq(users.authSubject, identity.subject),
          ),
        )
        .limit(1);

      if (!conversation) {
        throw accountNotInitialized();
      }

      return {
        id: conversation.id,
        title: "Cantarella",
        lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
        unreadCount: 0,
      };
    },

    async getMessages(identity, conversationId, options) {
      const [ownedConversation] = await database
        .select({ id: conversations.id })
        .from(conversations)
        .innerJoin(users, eq(users.id, conversations.ownerUserId))
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(users.authIssuer, identity.issuer),
            eq(users.authSubject, identity.subject),
          ),
        )
        .limit(1);

      if (!ownedConversation) {
        throw conversationNotFound();
      }

      let cursor: { id: string; createdAt: Date } | undefined;

      if (options.before) {
        [cursor] = await database
          .select({ id: messages.id, createdAt: messages.createdAt })
          .from(messages)
          .where(
            and(
              eq(messages.id, options.before),
              eq(messages.conversationId, conversationId),
              isNull(messages.deletedAt),
            ),
          )
          .limit(1);

        if (!cursor) {
          throw new HttpError(
            400,
            "INVALID_MESSAGE_CURSOR",
            "The message cursor is invalid for this conversation.",
          );
        }
      }

      const cursorCondition = cursor
        ? or(
            lt(messages.createdAt, cursor.createdAt),
            and(
              eq(messages.createdAt, cursor.createdAt),
              lt(messages.id, cursor.id),
            ),
          )
        : undefined;

      const records = await database
        .select(historyMessageSelection)
        .from(messages)
        .leftJoin(turns, eq(turns.id, messages.turnId))
        .where(
          and(
            eq(messages.conversationId, conversationId),
            isNull(messages.deletedAt),
            cursorCondition,
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(options.limit + 1);

      const hasMore = records.length > options.limit;
      const page = records.slice(0, options.limit);
      const oldestMessage = page.at(-1);

      return {
        messages: orderRecentContextMessages(page)
          .map(toMessageSnapshot),
        nextCursor: hasMore ? (oldestMessage?.id ?? null) : null,
        hasMore,
      };
    },

    async saveUserMessage(identity, conversationId, input) {
      return database.transaction(async (transaction) => {
        const [ownedConversation] = await transaction
          .select({ id: conversations.id })
          .from(conversations)
          .innerJoin(users, eq(users.id, conversations.ownerUserId))
          .where(
            and(
              eq(conversations.id, conversationId),
              eq(users.authIssuer, identity.issuer),
              eq(users.authSubject, identity.subject),
            ),
          )
          .limit(1);

        if (!ownedConversation) {
          throw conversationNotFound();
        }

        await transaction
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.id, conversationId))
          .for("update");

        const [createdMessage] = await transaction
          .insert(messages)
          .values({
            id: randomUUID(),
            conversationId,
            role: "user",
            kind: "chat",
            origin: input.source,
            content: input.content,
            clientMessageId: input.clientMessageId,
          })
          .onConflictDoNothing()
          .returning(messageSelection);

        let storedMessage = createdMessage;

        if (storedMessage) {
          await transaction
            .update(conversations)
            .set({
              lastMessageAt: storedMessage.createdAt,
              updatedAt: storedMessage.createdAt,
            })
            .where(eq(conversations.id, conversationId));
        } else {
          [storedMessage] = await transaction
            .select(messageSelection)
            .from(messages)
            .where(
              and(
                eq(messages.conversationId, conversationId),
                eq(messages.clientMessageId, input.clientMessageId),
                isNull(messages.deletedAt),
              ),
            )
            .orderBy(asc(messages.createdAt))
            .limit(1);

          if (!storedMessage) {
            throw new HttpError(
              500,
              "MESSAGE_SAVE_FAILED",
              "The message could not be saved.",
              true,
            );
          }

          if (
            storedMessage.role !== "user" ||
            storedMessage.content !== input.content ||
            storedMessage.origin !== input.source
          ) {
            throw new HttpError(
              409,
              "CLIENT_MESSAGE_ID_REUSED",
              "The client message ID was already used for different content.",
            );
          }
        }

        const [existingAssignment] = await transaction
          .select({ turnId: turns.id, turnStatus: turns.status })
          .from(inputBatchMessages)
          .innerJoin(turns, eq(turns.inputBatchId, inputBatchMessages.batchId))
          .where(eq(inputBatchMessages.messageId, storedMessage.id))
          .limit(1);

        if (existingAssignment) {
          return {
            message: toMessageSnapshot({
              ...storedMessage,
              turnId: existingAssignment.turnId,
              turnStatus: existingAssignment.turnStatus,
            }),
            turn: {
              id: existingAssignment.turnId,
              status: existingAssignment.turnStatus,
            },
          };
        }

        const environment = getEnvironment();
        const now = new Date();
        const settleAt = new Date(now.getTime() + environment.MESSAGE_SETTLE_MS);
        const [collectingBatch] = await transaction
          .select({ id: inputBatches.id })
          .from(inputBatches)
          .where(
            and(
              eq(inputBatches.conversationId, conversationId),
              eq(inputBatches.status, "collecting"),
            ),
          )
          .orderBy(desc(inputBatches.createdAt))
          .limit(1);

        let turn: { id: string; status: "queued" };

        if (collectingBatch) {
          const [lastPosition] = await transaction
            .select({ position: inputBatchMessages.position })
            .from(inputBatchMessages)
            .where(eq(inputBatchMessages.batchId, collectingBatch.id))
            .orderBy(desc(inputBatchMessages.position))
            .limit(1);

          await transaction.insert(inputBatchMessages).values({
            batchId: collectingBatch.id,
            messageId: storedMessage.id,
            position: (lastPosition?.position ?? -1) + 1,
          });

          await transaction
            .update(inputBatches)
            .set({ settleAt, updatedAt: now })
            .where(eq(inputBatches.id, collectingBatch.id));

          const [existingTurn] = await transaction
            .select({ id: turns.id, status: turns.status })
            .from(turns)
            .where(eq(turns.inputBatchId, collectingBatch.id))
            .orderBy(asc(turns.attemptNumber))
            .limit(1);

          if (!existingTurn || existingTurn.status !== "queued") {
            throw new HttpError(
              500,
              "TURN_BATCH_INVALID",
              "The collecting message batch has no queued turn.",
              true,
            );
          }

          turn = { id: existingTurn.id, status: "queued" };

          await transaction
            .update(jobs)
            .set({ runAt: settleAt, updatedAt: now })
            .where(eq(jobs.dedupeKey, `generate-turn:${turn.id}`));
        } else {
          const batchId = randomUUID();
          const turnId = randomUUID();

          await transaction.insert(inputBatches).values({
            id: batchId,
            conversationId,
            status: "collecting",
            settleAt,
          });

          await transaction.insert(inputBatchMessages).values({
            batchId,
            messageId: storedMessage.id,
            position: 0,
          });

          await transaction.insert(turns).values({
            id: turnId,
            conversationId,
            inputBatchId: batchId,
            status: "queued",
            attemptNumber: 1,
          });

          await transaction.insert(jobs).values({
            id: randomUUID(),
            kind: "generate_turn",
            payload: { turnId },
            status: "pending",
            runAt: settleAt,
            maxAttempts: 3,
            dedupeKey: `generate-turn:${turnId}`,
          });

          turn = { id: turnId, status: "queued" };
        }

        await transaction
          .update(messages)
          .set({ turnId: turn.id })
          .where(eq(messages.id, storedMessage.id));

        return {
          message: toMessageSnapshot({ ...storedMessage, turnId: turn.id }),
          turn,
        };
      });
    },
  };
}
