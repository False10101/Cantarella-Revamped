import { Router, type Request } from "express";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { httpError, type HttpError } from "../../http/http-error.js";
import type { ReminderService } from "./reminder.service.js";
import {
  createReminderInputSchema,
  listRemindersQuerySchema,
  reminderIdSchema,
  updateReminderInputSchema,
} from "./reminder.types.js";

function authenticatedIdentity(request: Request): AuthenticatedIdentity {
  if (!request.identity) {
    throw httpError(401, "UNAUTHORIZED", "Authentication required.");
  }
  return request.identity;
}

function reminderId(value: string): string {
  const parsed = reminderIdSchema.safeParse(value);
  if (!parsed.success) {
    throw httpError(400, "INVALID_REMINDER_ID", "The reminder ID is invalid.");
  }
  return parsed.data;
}

export function createReminderRouter(reminderService: ReminderService): Router {
  const router = Router();

  router.get("/reminders", async (request, response) => {
    const query = listRemindersQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw httpError(
        400,
        "INVALID_REMINDER_QUERY",
        "The reminder query is invalid.",
      );
    }
    const records = await reminderService.list(
      authenticatedIdentity(request),
      query.data,
    );
    response.status(200).json({ data: { reminders: records } });
  });

  router.post("/reminders", async (request, response) => {
    const input = createReminderInputSchema.safeParse(request.body);
    if (!input.success) {
      throw httpError(400, "INVALID_REMINDER", "The reminder is invalid.");
    }
    const reminder = await reminderService.create(
      authenticatedIdentity(request),
      input.data,
    );
    response.status(201).json({ data: { reminder } });
  });

  router.patch("/reminders/:reminderId", async (request, response) => {
    const input = updateReminderInputSchema.safeParse(request.body);
    if (!input.success) {
      throw httpError(400, "INVALID_REMINDER", "The reminder is invalid.");
    }
    const reminder = await reminderService.update(
      authenticatedIdentity(request),
      reminderId(request.params.reminderId),
      input.data,
    );
    response.status(200).json({ data: { reminder } });
  });

  router.delete("/reminders/:reminderId", async (request, response) => {
    const reminder = await reminderService.remove(
      authenticatedIdentity(request),
      reminderId(request.params.reminderId),
    );
    response.status(200).json({ data: { reminder } });
  });

  return router;
}
