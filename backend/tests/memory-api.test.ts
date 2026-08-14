import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AccountService } from "../src/api/account/account.service.js";
import type { ConversationService } from "../src/api/conversations/conversation.service.js";
import type { MemoryService } from "../src/api/memories/memory.service.js";
import type { MemorySnapshot } from "../src/api/memories/memory.types.js";
import { createApiRouter } from "../src/api/router.js";
import { createApp } from "../src/app.js";

const memoryId = "5919e43d-7615-4ad4-8d1f-38f56075fe9c";
const identity = {
  issuer: "https://cantarella.test.auth0.com/",
  subject: "google-oauth2|user-123",
};
const snapshot: MemorySnapshot = {
  id: memoryId,
  type: "profile",
  topic: "personal",
  subject: null,
  content: "User studies at KMUTT.",
  importance: 0.9,
  confidence: 1,
  status: "active",
  expiresAt: null,
  lastReinforcedAt: "2026-08-04T00:00:00.000Z",
  createdAt: "2026-08-04T00:00:00.000Z",
  updatedAt: "2026-08-04T00:00:00.000Z",
};

const injectVerifiedToken: RequestHandler = (request, _response, next) => {
  request.auth = {
    header: { alg: "RS256" },
    payload: { iss: identity.issuer, sub: identity.subject },
    token: "test-token",
  };
  next();
};

function createTestService(): MemoryService {
  return {
    list: vi.fn().mockResolvedValue([snapshot]),
    create: vi.fn().mockResolvedValue(snapshot),
    update: vi.fn().mockResolvedValue(snapshot),
    remove: vi.fn().mockResolvedValue({ ...snapshot, status: "deleted" }),
  };
}

function createTestApp(memoryService: MemoryService) {
  return createApp({
    validateAccessToken: injectVerifiedToken,
    apiRouter: createApiRouter({
      memoryService,
      accountService: {} as AccountService,
      conversationService: {} as ConversationService,
    }),
  });
}

describe("memory management API", () => {
  it("lists active memories with validated filters", async () => {
    const service = createTestService();
    const response = await request(createTestApp(service)).get(
      "/api/v1/memories?type=profile&search=KMUTT&limit=25",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { memories: [snapshot] } });
    expect(service.list).toHaveBeenCalledWith(identity, {
      type: "profile",
      status: "active",
      search: "KMUTT",
      limit: 25,
    });
  });

  it("creates a user-confirmed memory", async () => {
    const service = createTestService();
    const response = await request(createTestApp(service))
      .post("/api/v1/memories")
      .send({ content: snapshot.content, type: "profile" });

    expect(response.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(identity, {
      content: snapshot.content,
      type: "profile",
      topic: "other",
      subject: null,
      importance: 0.7,
      expiresAt: null,
    });
  });

  it("rejects a situation without an expiry", async () => {
    const service = createTestService();
    const response = await request(createTestApp(service))
      .post("/api/v1/memories")
      .send({ content: "User is preparing for finals.", type: "situation" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_MEMORY");
    expect(service.create).not.toHaveBeenCalled();
  });

  it("updates and deletes a memory by UUID", async () => {
    const service = createTestService();
    const updateResponse = await request(createTestApp(service))
      .patch(`/api/v1/memories/${memoryId}`)
      .send({ content: "User is a fourth-year student at KMUTT." });
    const deleteResponse = await request(createTestApp(service)).delete(
      `/api/v1/memories/${memoryId}`,
    );

    expect(updateResponse.status).toBe(200);
    expect(deleteResponse.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(identity, memoryId, {
      content: "User is a fourth-year student at KMUTT.",
    });
    expect(service.remove).toHaveBeenCalledWith(identity, memoryId);
  });

  it("rejects invalid memory IDs before calling the service", async () => {
    const service = createTestService();
    const response = await request(createTestApp(service))
      .patch("/api/v1/memories/not-a-uuid")
      .send({ content: "Still valid content." });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_MEMORY_ID");
    expect(service.update).not.toHaveBeenCalled();
  });
});
