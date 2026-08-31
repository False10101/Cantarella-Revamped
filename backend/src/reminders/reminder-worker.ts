import { randomUUID } from "node:crypto";

import { and, asc, eq, isNotNull, lt, lte } from "drizzle-orm";

import { toMessageSnapshot } from "../api/conversations/conversation.service.js";
import type { ReminderRecurrence } from "../api/reminders/reminder.types.js";
import { getEnvironment } from "../config/env.js";
import { database } from "../db/client.js";
import {
  conversations,
  messages,
  modelRuns,
  personas,
  reminderDeliveries,
  reminders,
} from "../db/schema.js";
import { conversationEvents } from "../events/conversation-events.js";
import { logger } from "../lib/logger.js";
import {
  createReminderVoiceGenerator,
  type ReminderVoiceGenerator,
} from "../models/reminder-voice.js";
import { VoiceOutputLeakageError } from "../models/voice.js";
import { nextReminderOccurrence } from "./reminder-schedule.js";

export interface ClaimedReminder {
  reminderId: string;
  deliveryId: string;
  userId: string;
  conversationId: string;
  title: string;
  timezone: string;
  occurrenceAt: Date;
  recurrence: ReminderRecurrence;
  attemptCount: number;
}

function recurrenceValue(value: string | null): ReminderRecurrence {
  return value === "daily" || value === "weekly" || value === "monthly"
    ? value
    : null;
}

async function claimNextReminder(): Promise<ClaimedReminder | null> {
  return database.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select({
        reminderId: reminders.id,
        userId: reminders.userId,
        conversationId: reminders.conversationId,
        title: reminders.title,
        timezone: reminders.timezone,
        occurrenceAt: reminders.nextRunAt,
        recurrenceRule: reminders.recurrenceRule,
      })
      .from(reminders)
      .where(
        and(
          eq(reminders.status, "scheduled"),
          isNotNull(reminders.nextRunAt),
          lte(reminders.nextRunAt, new Date()),
        ),
      )
      .orderBy(asc(reminders.nextRunAt), asc(reminders.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate?.occurrenceAt) return null;
    const recurrence = recurrenceValue(candidate.recurrenceRule);
    const [existingDelivery] = await transaction
      .select()
      .from(reminderDeliveries)
      .where(
        and(
          eq(reminderDeliveries.reminderId, candidate.reminderId),
          eq(reminderDeliveries.occurrenceAt, candidate.occurrenceAt),
        ),
      )
      .limit(1)
      .for("update");

    if (existingDelivery?.status === "delivered") {
      const now = new Date();
      const nextRunAt = nextReminderOccurrence(
        candidate.occurrenceAt,
        recurrence,
        candidate.timezone,
        now,
      );
      await transaction
        .update(reminders)
        .set({
          status: nextRunAt ? "scheduled" : "completed",
          nextRunAt,
          lastFiredAt: candidate.occurrenceAt,
          updatedAt: now,
        })
        .where(eq(reminders.id, candidate.reminderId));
      return null;
    }

    let deliveryId = existingDelivery?.id;
    let attemptCount = (existingDelivery?.attemptCount ?? 0) + 1;

    if (deliveryId) {
      const [claimed] = await transaction
        .update(reminderDeliveries)
        .set({
          status: "processing",
          attemptCount,
          lastErrorCode: null,
          updatedAt: new Date(),
        })
        .where(eq(reminderDeliveries.id, deliveryId))
        .returning({ id: reminderDeliveries.id });
      if (!claimed) return null;
    } else {
      deliveryId = randomUUID();
      attemptCount = 1;
      await transaction.insert(reminderDeliveries).values({
        id: deliveryId,
        reminderId: candidate.reminderId,
        occurrenceAt: candidate.occurrenceAt,
        status: "processing",
        attemptCount,
      });
    }

    await transaction
      .update(reminders)
      .set({ nextRunAt: null, updatedAt: new Date() })
      .where(eq(reminders.id, candidate.reminderId));

    return {
      reminderId: candidate.reminderId,
      deliveryId,
      userId: candidate.userId,
      conversationId: candidate.conversationId,
      title: candidate.title,
      timezone: candidate.timezone,
      occurrenceAt: candidate.occurrenceAt,
      recurrence,
      attemptCount,
    };
  });
}

async function recoverStaleReminderDeliveries(): Promise<void> {
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const stale = await database
    .select({
      deliveryId: reminderDeliveries.id,
      reminderId: reminderDeliveries.reminderId,
      occurrenceAt: reminderDeliveries.occurrenceAt,
      reminderStatus: reminders.status,
      nextRunAt: reminders.nextRunAt,
    })
    .from(reminderDeliveries)
    .innerJoin(reminders, eq(reminders.id, reminderDeliveries.reminderId))
    .where(
      and(
        eq(reminderDeliveries.status, "processing"),
        lt(reminderDeliveries.updatedAt, staleBefore),
      ),
    );

  for (const record of stale) {
    await database.transaction(async (transaction) => {
      if (record.reminderStatus === "scheduled" && record.nextRunAt === null) {
        await transaction
          .update(reminderDeliveries)
          .set({ status: "pending", updatedAt: new Date() })
          .where(eq(reminderDeliveries.id, record.deliveryId));
        await transaction
          .update(reminders)
          .set({ nextRunAt: record.occurrenceAt, updatedAt: new Date() })
          .where(eq(reminders.id, record.reminderId));
      } else {
        await transaction
          .update(reminderDeliveries)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(eq(reminderDeliveries.id, record.deliveryId));
      }
    });
  }
}

async function releaseReminder(claimed: ClaimedReminder, error: unknown) {
  const code = error instanceof Error ? error.name : "REMINDER_DELIVERY_ERROR";
  await database.transaction(async (transaction) => {
    await transaction
      .update(reminderDeliveries)
      .set({ status: "pending", lastErrorCode: code, updatedAt: new Date() })
      .where(eq(reminderDeliveries.id, claimed.deliveryId));

    const [current] = await transaction
      .select({ status: reminders.status, nextRunAt: reminders.nextRunAt })
      .from(reminders)
      .where(eq(reminders.id, claimed.reminderId))
      .limit(1)
      .for("update");
    if (current?.status === "scheduled" && current.nextRunAt === null) {
      await transaction
        .update(reminders)
        .set({ nextRunAt: claimed.occurrenceAt, updatedAt: new Date() })
        .where(eq(reminders.id, claimed.reminderId));
    }
  });
}

export interface ReminderProcessor {
  process(claimed: ClaimedReminder): Promise<void>;
}

export function createReminderProcessor(dependencies: {
  voiceGenerator?: ReminderVoiceGenerator;
} = {}): ReminderProcessor {
  const voiceGenerator =
    dependencies.voiceGenerator ?? createReminderVoiceGenerator();

  return {
    async process(claimed) {
      const environment = getEnvironment();
      const [persona] = await database
        .select({
          name: personas.name,
          voiceDirection: personas.voiceDirection,
          customStyle: personas.customStyle,
          preferredUserName: personas.preferredUserName,
          endearmentPreference: personas.endearmentPreference,
          boundaries: personas.boundaries,
          version: personas.version,
        })
        .from(personas)
        .where(eq(personas.userId, claimed.userId))
        .limit(1);
      if (!persona) throw new Error("Reminder owner has no persona.");

      conversationEvents.publish(claimed.conversationId, {
        type: "typing.started",
        data: { conversationId: claimed.conversationId, sender: "assistant" },
      });

      try {
      let bubbles = [claimed.title];
      const modelRunId = randomUUID();
      await database.insert(modelRuns).values({
        id: modelRunId,
        phase: "reminder_voice",
        provider: "openrouter",
        model: environment.VOICE_MODEL,
        promptVersion: "reminder-voice-v3",
        personaVersion: persona.version,
        status: "running",
        inputJson: {
          reminderId: claimed.reminderId,
          deliveryId: claimed.deliveryId,
          reminderText: claimed.title,
        },
      });

      try {
        const generation = await voiceGenerator.generate({
          persona,
          reminderText: claimed.title,
        });
        bubbles = generation.bubbles;
        await database
          .update(modelRuns)
          .set({
            status: "completed",
            provider: generation.completion.provider ?? "openrouter",
            model: generation.completion.model,
            rawOutput: generation.rawOutput,
            inputTokens: generation.completion.usage.inputTokens,
            outputTokens: generation.completion.usage.outputTokens,
            estimatedCostUsd: generation.completion.usage.estimatedCostUsd,
            latencyMs: generation.completion.latencyMs,
            completedAt: new Date(),
          })
          .where(eq(modelRuns.id, modelRunId));
      } catch (error) {
        await database
          .update(modelRuns)
          .set({
            status: "failed",
            rawOutput:
              error instanceof VoiceOutputLeakageError
                ? error.rawOutput.slice(0, 20_000)
                : undefined,
            errorCode: error instanceof Error ? error.name : "REMINDER_VOICE_ERROR",
            errorMessage: (error instanceof Error ? error.message : String(error)).slice(
              0,
              2_000,
            ),
            completedAt: new Date(),
          })
          .where(eq(modelRuns.id, modelRunId));
        logger.warn(
          { reminderId: claimed.reminderId, deliveryId: claimed.deliveryId },
          "Reminder voice failed; delivering original text",
        );
      }

        const createdMessages = await database.transaction(async (transaction) => {
          const [current] = await transaction
            .select({ status: reminders.status, nextRunAt: reminders.nextRunAt })
            .from(reminders)
            .where(eq(reminders.id, claimed.reminderId))
            .limit(1)
            .for("update");

          if (current?.status !== "scheduled" || current.nextRunAt !== null) {
            await transaction
              .update(reminderDeliveries)
              .set({ status: "cancelled", updatedAt: new Date() })
              .where(eq(reminderDeliveries.id, claimed.deliveryId));
            return [];
          }

          const created = [];
          const baseTime = Date.now();
          for (const [partIndex, content] of bubbles.entries()) {
            const [message] = await transaction
              .insert(messages)
              .values({
                id: randomUUID(),
                conversationId: claimed.conversationId,
                reminderDeliveryId: claimed.deliveryId,
                role: "assistant",
                kind: "reminder",
                origin: "system",
                content,
                partIndex,
                createdAt: new Date(baseTime + partIndex),
              })
              .returning({
                id: messages.id,
                turnId: messages.turnId,
                clientMessageId: messages.clientMessageId,
                role: messages.role,
                content: messages.content,
                kind: messages.kind,
                origin: messages.origin,
                partIndex: messages.partIndex,
                createdAt: messages.createdAt,
              });
            if (message) created.push(message);
          }

          const now = new Date();
          const nextRunAt = nextReminderOccurrence(
            claimed.occurrenceAt,
            claimed.recurrence,
            claimed.timezone,
            now,
          );
          const lastMessage = created.at(-1);
          await transaction
            .update(reminderDeliveries)
            .set({
              status: "delivered",
              messageId: lastMessage?.id ?? null,
              deliveredAt: now,
              lastErrorCode: null,
              updatedAt: now,
            })
            .where(eq(reminderDeliveries.id, claimed.deliveryId));
          await transaction
            .update(reminders)
            .set({
              status: nextRunAt ? "scheduled" : "completed",
              nextRunAt,
              lastFiredAt: claimed.occurrenceAt,
              updatedAt: now,
            })
            .where(eq(reminders.id, claimed.reminderId));

          if (lastMessage) {
            await transaction
              .update(conversations)
              .set({ lastMessageAt: lastMessage.createdAt, updatedAt: now })
              .where(eq(conversations.id, claimed.conversationId));
          }

          return created;
        });

        for (const message of createdMessages) {
          conversationEvents.publish(claimed.conversationId, {
            type: "message.created",
            data: { message: toMessageSnapshot(message) },
          });
        }
      } finally {
        conversationEvents.publish(claimed.conversationId, {
          type: "typing.stopped",
          data: { conversationId: claimed.conversationId, sender: "assistant" },
        });
      }
    },
  };
}

export interface ReminderWorker {
  stop(): void;
}

export function startReminderWorker(dependencies: {
  processor?: ReminderProcessor;
} = {}): ReminderWorker {
  const environment = getEnvironment();
  const processor = dependencies.processor ?? createReminderProcessor();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let lastRecoveryAt = 0;

  const schedule = (delay: number) => {
    if (!stopped) timer = setTimeout(run, delay);
  };

  const run = async () => {
    try {
      if (Date.now() - lastRecoveryAt >= 60_000) {
        await recoverStaleReminderDeliveries();
        lastRecoveryAt = Date.now();
      }
      const claimed = await claimNextReminder();
      if (!claimed) {
        schedule(environment.JOB_POLL_MS);
        return;
      }

      try {
        await processor.process(claimed);
      } catch (error) {
        await releaseReminder(claimed, error);
        logger.error(
          { error, reminderId: claimed.reminderId, deliveryId: claimed.deliveryId },
          "Reminder delivery failed",
        );
      }
      schedule(0);
    } catch (error) {
      logger.error({ error }, "Reminder worker loop failed");
      schedule(environment.JOB_POLL_MS);
    }
  };

  void recoverStaleReminderDeliveries()
    .then(() => {
      lastRecoveryAt = Date.now();
      schedule(0);
    })
    .catch((error: unknown) => {
      logger.error({ error }, "Failed to recover stale reminder deliveries");
      schedule(environment.JOB_POLL_MS);
    });

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
