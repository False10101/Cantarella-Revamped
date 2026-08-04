import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AccountService } from "../src/api/account/account.service.js";
import type { ConversationService } from "../src/api/conversations/conversation.service.js";
import type { MemoryService } from "../src/api/memories/memory.service.js";
import type { ReminderService } from "../src/api/reminders/reminder.service.js";
import type { ReminderSnapshot } from "../src/api/reminders/reminder.types.js";
import { createApiRouter } from "../src/api/router.js";
import { createApp } from "../src/app.js";

const reminderId = "cb565a17-0cbf-42fa-93cb-b67afab19c72";
const identity = {
  issuer: "https://cantarella.test.auth0.com/",
  subject: "google-oauth2|user-123",
};
const snapshot: ReminderSnapshot = {
  id: reminderId,
  title: "Submit the project proposal",
  timezone: "Asia/Bangkok",
  scheduledFor: "2026-08-05T03:00:00.000Z",
  recurrence: null,
  nextRunAt: "2026-08-05T03:00:00.000Z",
  status: "scheduled",
  lastFiredAt: null,
  createdAt: "2026-08-04T03:00:00.000Z",
  updatedAt: "2026-08-04T03:00:00.000Z",
};

const injectVerifiedToken: RequestHandler = (request, _response, next) => {
  request.auth = {
    header: { alg: "RS256" },
    payload: { iss: identity.issuer, sub: identity.subject },
    token: "test-token",
  };
  next();
};

function createTestService(): ReminderService {
  return {
    list: vi.fn().mockResolvedValue([snapshot]),
    create: vi.fn().mockResolvedValue(snapshot),
    update: vi.fn().mockResolvedValue({ ...snapshot, status: "paused" }),
    remove: vi.fn().mockResolvedValue({ ...snapshot, status: "cancelled" }),
  };
}

function createTestApp(reminderService: ReminderService) {
  return createApp({
    validateAccessToken: injectVerifiedToken,
    apiRouter: createApiRouter({
      reminderService,
      accountService: {} as AccountService,
      conversationService: {} as ConversationService,
      memoryService: {} as MemoryService,
    }),
  });
}

describe("reminder management API", () => {
  it("lists reminders using validated filters", async () => {
    const service = createTestService();
    const response = await request(createTestApp(service)).get(
      "/api/v1/reminders?status=scheduled&limit=25",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { reminders: [snapshot] } });
    expect(service.list).toHaveBeenCalledWith(identity, {
      status: "scheduled",
      limit: 25,
    });
  });

  it("creates a manually scheduled recurring reminder", async () => {
    const service = createTestService();
    const response = await request(createTestApp(service))
      .post("/api/v1/reminders")
      .send({
        title: snapshot.title,
        scheduledFor: snapshot.scheduledFor,
        recurrence: "weekly",
        clientRequestId: "c6767b78-5b9e-44ef-909e-79194a1ac9bf",
      });

    expect(response.status).toBe(201);
    expect(service.create).toHaveBeenCalledWith(identity, {
      title: snapshot.title,
      scheduledFor: snapshot.scheduledFor,
      recurrence: "weekly",
      clientRequestId: "c6767b78-5b9e-44ef-909e-79194a1ac9bf",
    });
  });

  it("pauses and deletes an owned reminder", async () => {
    const service = createTestService();
    const pause = await request(createTestApp(service))
      .patch(`/api/v1/reminders/${reminderId}`)
      .send({ status: "paused" });
    const remove = await request(createTestApp(service)).delete(
      `/api/v1/reminders/${reminderId}`,
    );

    expect(pause.status).toBe(200);
    expect(remove.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith(identity, reminderId, {
      status: "paused",
    });
    expect(service.remove).toHaveBeenCalledWith(identity, reminderId);
  });

  it("rejects invalid recurrence and reminder IDs", async () => {
    const service = createTestService();
    const recurrence = await request(createTestApp(service))
      .post("/api/v1/reminders")
      .send({
        title: snapshot.title,
        scheduledFor: snapshot.scheduledFor,
        recurrence: "sometimes",
      });
    const identifier = await request(createTestApp(service))
      .patch("/api/v1/reminders/not-a-uuid")
      .send({ status: "paused" });

    expect(recurrence.status).toBe(400);
    expect(identifier.status).toBe(400);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });
});
