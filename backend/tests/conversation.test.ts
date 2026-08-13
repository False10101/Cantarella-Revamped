import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AccountService } from "../src/api/account/account.service.js";
import {
  toMessageSnapshot,
  type ConversationService,
  type StoredMessage,
} from "../src/api/conversations/conversation.service.js";
import type {
  MessageSnapshot,
  PrimaryConversationSnapshot,
} from "../src/api/conversations/conversation.types.js";
import { createApiRouter } from "../src/api/router.js";
import { createApp } from "../src/app.js";

const conversationId = "9f17b984-8291-49de-8830-36c3094fcb30";
const messageId = "5919e43d-7615-4ad4-8d1f-38f56075fe9c";
const clientMessageId = "11376b4f-8d6f-4487-9951-c1d6fd732ab1";
const turnId = "2cafb281-a2b2-41c4-b6ee-b85fba970dbe";

const identity = {
  issuer: "https://cantarella.test.auth0.com/",
  subject: "google-oauth2|user-123",
};

const injectVerifiedToken: RequestHandler = (request, _response, next) => {
  request.auth = {
    header: { alg: "RS256" },
    payload: { iss: identity.issuer, sub: identity.subject },
    token: "test-token",
  };
  next();
};

const primaryConversation: PrimaryConversationSnapshot = {
  id: conversationId,
  title: "Cantarella",
  lastMessageAt: null,
  unreadCount: 0,
};

const storedMessage: MessageSnapshot = {
  id: messageId,
  turnId,
  clientMessageId,
  sender: "user",
  content: "yo",
  messageKind: "chat",
  source: "web",
  partIndex: null,
  status: "sent",
  replyToMessageId: null,
  createdAt: "2026-08-03T10:00:00.000Z",
};

const storedUserMessage: StoredMessage = {
  id: messageId,
  turnId,
  clientMessageId,
  role: "user",
  content: "yo",
  kind: "chat",
  origin: "web",
  partIndex: null,
  createdAt: new Date("2026-08-03T10:00:00.000Z"),
};

function createTestService(): ConversationService {
  return {
    assertOwnership: vi.fn().mockResolvedValue(undefined),
    getPrimary: vi.fn().mockResolvedValue(primaryConversation),
    getMessages: vi.fn().mockResolvedValue({
      messages: [storedMessage],
      nextCursor: null,
      hasMore: false,
    }),
    saveUserMessage: vi.fn().mockResolvedValue({
      message: storedMessage,
      turn: { id: turnId, status: "queued" },
    }),
  };
}

function createTestApp(conversationService: ConversationService) {
  return createApp({
    validateAccessToken: injectVerifiedToken,
    apiRouter: createApiRouter({
      conversationService,
      accountService: {} as AccountService,
    }),
  });
}

describe("primary conversation persistence API", () => {
  it("returns the authenticated user's permanent conversation", async () => {
    const conversationService = createTestService();
    const response = await request(createTestApp(conversationService)).get(
      "/api/v1/conversations/primary",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: primaryConversation });
    expect(conversationService.getPrimary).toHaveBeenCalledWith(identity);
  });

  it("returns chronological message history using a UUID cursor", async () => {
    const conversationService = createTestService();
    const response = await request(createTestApp(conversationService)).get(
      `/api/v1/conversations/${conversationId}/messages?before=${messageId}&limit=25`,
    );

    expect(response.status).toBe(200);
    expect(response.body.data.messages).toEqual([storedMessage]);
    expect(conversationService.getMessages).toHaveBeenCalledWith(
      identity,
      conversationId,
      { before: messageId, limit: 25 },
    );
  });

  it("rejects malformed history cursors before querying storage", async () => {
    const conversationService = createTestService();
    const response = await request(createTestApp(conversationService)).get(
      `/api/v1/conversations/${conversationId}/messages?before=not-a-uuid`,
    );

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_MESSAGE_HISTORY_QUERY");
    expect(conversationService.getMessages).not.toHaveBeenCalled();
  });

  it("stores a trimmed user message with a client idempotency key", async () => {
    const conversationService = createTestService();
    const response = await request(createTestApp(conversationService))
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .send({
        clientMessageId,
        content: "  yo  ",
        source: "web",
        replyToMessageId: null,
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      data: {
        message: storedMessage,
        turn: { id: turnId, status: "queued" },
      },
    });
    expect(conversationService.saveUserMessage).toHaveBeenCalledWith(
      identity,
      conversationId,
      {
        clientMessageId,
        content: "yo",
        source: "web",
        replyToMessageId: null,
      },
    );
  });

  it("rejects empty messages before querying storage", async () => {
    const conversationService = createTestService();
    const response = await request(createTestApp(conversationService))
      .post(`/api/v1/conversations/${conversationId}/messages`)
      .send({ clientMessageId, content: "   ", source: "web" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_MESSAGE");
    expect(conversationService.saveUserMessage).not.toHaveBeenCalled();
  });
});

describe("message delivery snapshots", () => {
  it("keeps a queued user message at one tick", () => {
    expect(
      toMessageSnapshot({ ...storedUserMessage, turnStatus: "queued" }).status,
    ).toBe("sent");
  });

  it.each(["thinking", "voicing", "completed"] as const)(
    "marks every batch message seen once its turn is %s",
    (turnStatus) => {
      expect(
        toMessageSnapshot({ ...storedUserMessage, turnStatus }).status,
      ).toBe("seen");
    },
  );

  it("preserves a visible failed status for a terminally failed turn", () => {
    expect(
      toMessageSnapshot({ ...storedUserMessage, turnStatus: "failed" }).status,
    ).toBe("failed");
  });
});
