import { randomUUID } from "node:crypto";

import { and, asc, eq, ne } from "drizzle-orm";
import { DateTime } from "luxon";

import type { ReminderSnapshot } from "../api/reminders/reminder.types.js";
import { database } from "../db/client.js";
import { reminderDeliveries, reminders } from "../db/schema.js";
import type { ReminderAction } from "../models/thought.js";
import { nextReminderOccurrence } from "./reminder-schedule.js";

export type InvalidReminderActionError = Error;

export function invalidReminderAction(
  message: string,
): InvalidReminderActionError {
  const error = new Error(message);
  error.name = "InvalidReminderActionError";
  return error;
}

export function isInvalidReminderActionError(
  error: unknown,
): error is InvalidReminderActionError {
  return error instanceof Error && error.name === "InvalidReminderActionError";
}

export function resolveReminderActionTime(
  action: ReminderAction,
  timezone: string,
  referenceAt: Date,
): Date {
  if (action.operation !== "create" && action.operation !== "reschedule") {
    throw invalidReminderAction(
      "This reminder operation does not contain a schedule.",
    );
  }
  if (action.scheduleKind === null) {
    throw invalidReminderAction("The reminder time is missing.");
  }

  let scheduledFor: Date;

  if (action.scheduleKind === "after") {
    const amount = action.delayAmount;
    const unit = action.delayUnit;
    if (amount === null || unit === null) {
      throw invalidReminderAction("The relative reminder is incomplete.");
    }
    const unitMillis =
      unit === "minutes"
        ? 60_000
        : unit === "hours"
          ? 60 * 60_000
          : 24 * 60 * 60_000;
    scheduledFor = new Date(referenceAt.getTime() + amount * unitMillis);
  } else {
    if (action.localDateTime === null) {
      throw invalidReminderAction("The reminder time is missing.");
    }
    const local = DateTime.fromISO(action.localDateTime, { zone: timezone });
    if (!local.isValid) {
      throw invalidReminderAction("The reminder time is invalid.");
    }
    scheduledFor = local.toUTC().toJSDate();
  }

  if (scheduledFor <= referenceAt) {
    throw invalidReminderAction("The reminder time is not in the future.");
  }
  if (scheduledFor.getTime() - referenceAt.getTime() > 366 * 24 * 60 * 60_000) {
    throw invalidReminderAction(
      "Chat reminders cannot be scheduled more than one year ahead.",
    );
  }

  return scheduledFor;
}

function snapshot(reminder: typeof reminders.$inferSelect): ReminderSnapshot {
  return {
    id: reminder.id,
    title: reminder.title,
    timezone: reminder.timezone,
    scheduledFor: reminder.scheduledFor.toISOString(),
    recurrence:
      reminder.recurrenceRule === "daily" ||
      reminder.recurrenceRule === "weekly" ||
      reminder.recurrenceRule === "monthly"
        ? reminder.recurrenceRule
        : null,
    nextRunAt: reminder.nextRunAt?.toISOString() ?? null,
    status: reminder.status,
    lastFiredAt: reminder.lastFiredAt?.toISOString() ?? null,
    createdAt: reminder.createdAt.toISOString(),
    updatedAt: reminder.updatedAt.toISOString(),
  };
}

export interface ReminderActionResult {
  primaryReminder: ReminderSnapshot | null;
  reminders: ReminderSnapshot[];
}

function recurrenceValue(value: string | null): ReminderSnapshot["recurrence"] {
  return value === "daily" || value === "weekly" || value === "monthly"
    ? value
    : null;
}

function changedRecurrence(
  action: ReminderAction,
  existing: ReminderSnapshot["recurrence"],
): ReminderSnapshot["recurrence"] {
  if (action.recurrence === "unchanged") return existing;
  return action.recurrence === "none" ? null : action.recurrence;
}

export async function executeReminderAction(input: {
  action: ReminderAction;
  turnId: string;
  userId: string;
  conversationId: string;
  sourceMessageId: string;
  originalRequest: string;
  timezone: string;
  referenceAt: Date;
}): Promise<ReminderActionResult> {
  if (input.action.operation === "list") {
    const stored = await database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, input.userId),
          eq(reminders.conversationId, input.conversationId),
          ne(reminders.status, "cancelled"),
        ),
      )
      .orderBy(asc(reminders.nextRunAt), asc(reminders.scheduledFor))
      .limit(20);
    const records = stored.map(snapshot);
    return {
      primaryReminder: null,
      reminders: records,
    };
  }

  if (input.action.operation !== "create") {
    const reminderId = input.action.targetReminderRef;
    if (!reminderId) {
      throw invalidReminderAction(
        "The reminder action has no resolved target.",
      );
    }

    const record = await database.transaction(async (transaction) => {
      const [existing] = await transaction
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.id, reminderId),
            eq(reminders.userId, input.userId),
            eq(reminders.conversationId, input.conversationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!existing) {
        throw invalidReminderAction(
          "The selected reminder no longer exists.",
        );
      }

      if (input.action.operation === "delete") {
        const [deleted] = await transaction
          .delete(reminders)
          .where(
            and(
              eq(reminders.id, reminderId),
              eq(reminders.userId, input.userId),
              eq(reminders.conversationId, input.conversationId),
            ),
          )
          .returning();
        if (!deleted) {
          throw invalidReminderAction(
            "The selected reminder could not be deleted.",
          );
        }
        return {
          record: deleted,
          effectiveAction: {
            ...input.action,
            operation: "delete" as const,
          },
        };
      }

      if (existing.status === "cancelled") {
        throw invalidReminderAction(
          "The selected reminder is already cancelled.",
        );
      }

      const now = new Date();
      let title = existing.title;
      let scheduledFor = existing.scheduledFor;
      let recurrence = recurrenceValue(existing.recurrenceRule);
      let status: ReminderSnapshot["status"] = existing.status;
      let nextRunAt = existing.nextRunAt;

      if (input.action.operation === "update") {
        title = input.action.title ?? title;
        recurrence = changedRecurrence(input.action, recurrence);
        if (status === "scheduled") {
          if (scheduledFor > now) {
            nextRunAt = scheduledFor;
          } else if (recurrence) {
            nextRunAt = nextReminderOccurrence(
              scheduledFor,
              recurrence,
              existing.timezone,
              now,
            );
          } else {
            status = "completed";
            nextRunAt = null;
          }
        }
      } else if (input.action.operation === "reschedule") {
        title = input.action.title ?? title;
        scheduledFor = resolveReminderActionTime(
          input.action,
          input.timezone,
          input.referenceAt,
        );
        recurrence = changedRecurrence(input.action, recurrence);
        status = "scheduled";
        nextRunAt = scheduledFor;
      } else if (input.action.operation === "pause") {
        status = "paused";
        nextRunAt = null;
      } else if (input.action.operation === "resume") {
        status = "scheduled";
        if (scheduledFor > now) {
          nextRunAt = scheduledFor;
        } else if (recurrence) {
          nextRunAt = nextReminderOccurrence(
            scheduledFor,
            recurrence,
            existing.timezone,
            now,
          );
        } else {
          throw invalidReminderAction(
            "The reminder needs a new future time before it can resume.",
          );
        }
      } else if (input.action.operation === "cancel") {
        status = "cancelled";
        nextRunAt = null;
      }

      if (
        input.action.operation === "pause" ||
        input.action.operation === "cancel" ||
        input.action.operation === "reschedule"
      ) {
        await transaction
          .update(reminderDeliveries)
          .set({ status: "cancelled", updatedAt: now })
          .where(
            and(
              eq(reminderDeliveries.reminderId, reminderId),
              eq(reminderDeliveries.status, "pending"),
            ),
          );
      }

      const [updated] = await transaction
        .update(reminders)
        .set({
          title,
          scheduledFor,
          recurrenceRule: recurrence,
          status,
          nextRunAt,
          pendingDeleteConfirmationTurnId: null,
          updatedAt: now,
        })
        .where(eq(reminders.id, reminderId))
        .returning();
      if (!updated) {
        throw invalidReminderAction(
          "The selected reminder could not be updated.",
        );
      }
      return { record: updated, effectiveAction: input.action };
    });

    const reminder = snapshot(record.record);
    return {
      primaryReminder: reminder,
      reminders: [reminder],
    };
  }

  const creationKey = `chat:${input.turnId}`;
  if (!input.action.title || input.action.recurrence === "unchanged") {
    throw invalidReminderAction(
      "The create reminder action is incomplete.",
    );
  }
  const scheduledFor = resolveReminderActionTime(
    input.action,
    input.timezone,
    input.referenceAt,
  );
  const [created] = await database
    .insert(reminders)
    .values({
      id: randomUUID(),
      userId: input.userId,
      conversationId: input.conversationId,
      title: input.action.title,
      originalRequest: input.originalRequest,
      timezone: input.timezone,
      scheduledFor,
      recurrenceRule:
        input.action.recurrence === "none" ? null : input.action.recurrence,
      nextRunAt: scheduledFor,
      status: "scheduled",
      sourceMessageId: input.sourceMessageId,
      creationKey,
    })
    .onConflictDoNothing()
    .returning();

  let stored = created;
  if (!stored) {
    [stored] = await database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, input.userId),
          eq(reminders.creationKey, creationKey),
        ),
      )
      .limit(1);
  }
  if (!stored) throw new Error("The chat reminder could not be persisted.");

  const reminder = snapshot(stored);
  return {
    primaryReminder: reminder,
    reminders: [reminder],
  };
}
