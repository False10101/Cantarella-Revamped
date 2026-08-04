import { randomUUID } from "node:crypto";

import { and, asc, eq, ne } from "drizzle-orm";
import { DateTime } from "luxon";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { database } from "../../db/client.js";
import {
  conversations,
  reminders,
  users,
  userSettings,
  type Reminder,
} from "../../db/schema.js";
import { HttpError } from "../../http/http-error.js";
import { nextReminderOccurrence } from "../../reminders/reminder-schedule.js";
import type {
  CreateReminderInput,
  ListRemindersQuery,
  ReminderRecurrence,
  ReminderSnapshot,
  UpdateReminderInput,
} from "./reminder.types.js";

export interface ReminderService {
  list(
    identity: AuthenticatedIdentity,
    query: ListRemindersQuery,
  ): Promise<ReminderSnapshot[]>;
  create(
    identity: AuthenticatedIdentity,
    input: CreateReminderInput,
  ): Promise<ReminderSnapshot>;
  update(
    identity: AuthenticatedIdentity,
    reminderId: string,
    input: UpdateReminderInput,
  ): Promise<ReminderSnapshot>;
  remove(
    identity: AuthenticatedIdentity,
    reminderId: string,
  ): Promise<ReminderSnapshot>;
}

function accountNotInitialized(): HttpError {
  return new HttpError(
    404,
    "ACCOUNT_NOT_INITIALIZED",
    "Complete the login bootstrap before accessing reminders.",
  );
}

function reminderNotFound(): HttpError {
  return new HttpError(404, "REMINDER_NOT_FOUND", "The reminder does not exist.");
}

function invalidSchedule(message: string): HttpError {
  return new HttpError(400, "INVALID_REMINDER_SCHEDULE", message);
}

function parsedFuture(
  input: {
    scheduledFor?: string | undefined;
    scheduledForLocal?: string | undefined;
  },
  timezone: string,
): Date {
  const parsed = input.scheduledForLocal
    ? DateTime.fromISO(input.scheduledForLocal, { zone: timezone })
    : DateTime.fromISO(input.scheduledFor ?? "", { setZone: true });
  if (!parsed.isValid) {
    throw invalidSchedule("The reminder date and time are invalid.");
  }
  const scheduledFor = parsed.toUTC().toJSDate();
  if (scheduledFor <= new Date()) {
    throw invalidSchedule("The reminder must be scheduled in the future.");
  }
  return scheduledFor;
}

function recurrenceValue(value: string | null): ReminderRecurrence {
  return value === "daily" || value === "weekly" || value === "monthly"
    ? value
    : null;
}

function toSnapshot(reminder: Reminder): ReminderSnapshot {
  return {
    id: reminder.id,
    title: reminder.title,
    timezone: reminder.timezone,
    scheduledFor: reminder.scheduledFor.toISOString(),
    recurrence: recurrenceValue(reminder.recurrenceRule),
    nextRunAt: reminder.nextRunAt?.toISOString() ?? null,
    status: reminder.status,
    lastFiredAt: reminder.lastFiredAt?.toISOString() ?? null,
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
  };
}

async function loadOwner(identity: AuthenticatedIdentity): Promise<{
  userId: string;
  conversationId: string;
  timezone: string;
}> {
  const [owner] = await database
    .select({
      userId: users.id,
      conversationId: conversations.id,
      timezone: userSettings.timezone,
    })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .innerJoin(conversations, eq(conversations.ownerUserId, users.id))
    .where(
      and(
        eq(users.authIssuer, identity.issuer),
        eq(users.authSubject, identity.subject),
      ),
    )
    .limit(1);

  if (!owner) throw accountNotInitialized();
  return owner;
}

export function createReminderService(): ReminderService {
  return {
    async list(identity, query) {
      const owner = await loadOwner(identity);
      const conditions = [
        eq(reminders.userId, owner.userId),
        ne(reminders.status, "cancelled"),
      ];
      if (query.status) conditions.push(eq(reminders.status, query.status));

      const records = await database
        .select()
        .from(reminders)
        .where(and(...conditions))
        .orderBy(asc(reminders.nextRunAt), asc(reminders.scheduledFor))
        .limit(query.limit);

      return records.map(toSnapshot);
    },

    async create(identity, input) {
      const owner = await loadOwner(identity);
      const scheduledFor = parsedFuture(input, owner.timezone);
      const creationKey = input.clientRequestId
        ? `manual:${input.clientRequestId}`
        : null;

      const [created] = await database
        .insert(reminders)
        .values({
          id: randomUUID(),
          userId: owner.userId,
          conversationId: owner.conversationId,
          title: input.title,
          originalRequest: null,
          timezone: owner.timezone,
          scheduledFor,
          recurrenceRule: input.recurrence,
          nextRunAt: scheduledFor,
          status: "scheduled",
          creationKey,
        })
        .onConflictDoNothing()
        .returning();

      if (created) return toSnapshot(created);

      if (!creationKey) {
        throw new HttpError(
          409,
          "REMINDER_ALREADY_EXISTS",
          "The reminder could not be created twice.",
        );
      }

      const [existing] = await database
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.userId, owner.userId),
            eq(reminders.creationKey, creationKey),
          ),
        )
        .limit(1);
      if (!existing) throw reminderNotFound();
      return toSnapshot(existing);
    },

    async update(identity, reminderId, input) {
      const owner = await loadOwner(identity);

      return database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(reminders)
          .where(
            and(
              eq(reminders.id, reminderId),
              eq(reminders.userId, owner.userId),
              ne(reminders.status, "cancelled"),
            ),
          )
          .limit(1)
          .for("update");
        if (!existing) throw reminderNotFound();

        const hasNewSchedule =
          input.scheduledFor !== undefined ||
          input.scheduledForLocal !== undefined;
        const scheduledFor = hasNewSchedule
          ? parsedFuture(input, existing.timezone)
          : existing.scheduledFor;
        const recurrence =
          input.recurrence === undefined
            ? recurrenceValue(existing.recurrenceRule)
            : input.recurrence;
        const status = input.status ?? existing.status;
        let nextRunAt = existing.nextRunAt;

        if (status === "paused" || status === "completed") {
          nextRunAt = null;
        } else if (scheduledFor > new Date()) {
          nextRunAt = scheduledFor;
        } else if (recurrence) {
          nextRunAt = nextReminderOccurrence(
            scheduledFor,
            recurrence,
            existing.timezone,
            new Date(),
          );
        } else {
          throw invalidSchedule(
            "Choose a new future time before resuming this reminder.",
          );
        }

        const now = new Date();
        const [updated] = await transaction
          .update(reminders)
          .set({
            title: input.title ?? existing.title,
            scheduledFor,
            recurrenceRule: recurrence,
            nextRunAt,
            status,
            updatedAt: now,
          })
          .where(eq(reminders.id, reminderId))
          .returning();
        if (!updated) throw reminderNotFound();

        return toSnapshot(updated);
      });
    },

    async remove(identity, reminderId) {
      const owner = await loadOwner(identity);

      return database.transaction(async (transaction) => {
        const [existing] = await transaction
          .select()
          .from(reminders)
          .where(
            and(
              eq(reminders.id, reminderId),
              eq(reminders.userId, owner.userId),
            ),
          )
          .limit(1)
          .for("update");
        if (!existing) throw reminderNotFound();

        const [deleted] = await transaction
          .delete(reminders)
          .where(
            and(
              eq(reminders.id, reminderId),
              eq(reminders.userId, owner.userId),
            ),
          )
          .returning();
        if (!deleted) throw reminderNotFound();

        return toSnapshot(deleted);
      });
    },
  };
}
