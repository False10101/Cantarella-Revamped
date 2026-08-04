import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";

import type { ReminderSnapshot } from "../api/reminders/reminder.types.js";
import { database } from "../db/client.js";
import { reminders } from "../db/schema.js";
import type { ReminderAction, Thought } from "../models/thought.js";

export class InvalidReminderActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidReminderActionError";
  }
}

export function resolveReminderActionTime(
  action: ReminderAction,
  timezone: string,
  referenceAt: Date,
): Date {
  let scheduledFor: Date;

  if (action.scheduleKind === "after") {
    const amount = action.delayAmount;
    const unit = action.delayUnit;
    if (amount === null || unit === null) {
      throw new InvalidReminderActionError("The relative reminder is incomplete.");
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
      throw new InvalidReminderActionError("The reminder time is missing.");
    }
    const local = DateTime.fromISO(action.localDateTime, { zone: timezone });
    if (!local.isValid) {
      throw new InvalidReminderActionError("The reminder time is invalid.");
    }
    scheduledFor = local.toUTC().toJSDate();
  }

  if (scheduledFor <= referenceAt) {
    throw new InvalidReminderActionError("The reminder time is not in the future.");
  }
  if (scheduledFor.getTime() - referenceAt.getTime() > 366 * 24 * 60 * 60_000) {
    throw new InvalidReminderActionError(
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

function confirmationBrief(reminder: ReminderSnapshot): Thought {
  return {
    messageMode: "help",
    contextRelation: "standalone",
    replyPoints: [`The reminder to ${reminder.title} was saved successfully.`],
    question: null,
    reminderAction: null,
  };
}

export interface ReminderActionResult {
  reminder: ReminderSnapshot;
  voiceBrief: Thought;
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
  const creationKey = `chat:${input.turnId}`;
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
      recurrenceRule: input.action.recurrence,
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
  return { reminder, voiceBrief: confirmationBrief(reminder) };
}
