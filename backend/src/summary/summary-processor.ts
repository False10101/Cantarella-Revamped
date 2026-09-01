import { createHash, randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { DateTime } from "luxon";

import { getEnvironment } from "../config/env.js";
import { database } from "../db/client.js";
import {
  conversationSummaries,
  conversationSummaryEmbeddings,
  conversations,
  jobs,
  messages,
  modelRuns,
  turns,
  userSettings,
} from "../db/schema.js";
import {
  embedTexts,
  type EmbedTexts,
} from "../models/embedding.js";
import type { ModelCompletion } from "../models/openrouter.js";
import {
  orderRecentContextMessages,
  type RecentContextMessage,
} from "../pipeline/message-order.js";
import { selectNextSummaryChunk } from "./summary-chunking.js";
import {
  generateSummaryPlan,
  isSummaryPolicyOutputError,
} from "./summary-policy.js";

const MAX_CHUNKS_PER_JOB = 4;

export interface ClaimedSummaryJob {
  id: string;
  turnId: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface SummaryProcessor {
  process(job: ClaimedSummaryJob): Promise<void>;
}

export type ObsoleteSummaryJobError = Error;

export function obsoleteSummaryJobError(): ObsoleteSummaryJobError {
  const error = new Error("The summary job no longer references a completed turn.");
  error.name = "ObsoleteSummaryJobError";
  return error;
}

export function isObsoleteSummaryJobError(
  error: unknown,
): error is ObsoleteSummaryJobError {
  return error instanceof Error && error.name === "ObsoleteSummaryJobError";
}

interface SummaryOwner {
  userId: string;
  conversationId: string;
  timezone: string;
}

async function loadOwner(turnId: string): Promise<SummaryOwner> {
  const [record] = await database
    .select({
      status: turns.status,
      userId: conversations.ownerUserId,
      conversationId: conversations.id,
      timezone: userSettings.timezone,
    })
    .from(turns)
    .innerJoin(conversations, eq(conversations.id, turns.conversationId))
    .innerJoin(userSettings, eq(userSettings.userId, conversations.ownerUserId))
    .where(eq(turns.id, turnId))
    .limit(1);

  if (!record || record.status !== "completed") {
    throw obsoleteSummaryJobError();
  }

  return record;
}

async function loadMessages(
  conversationId: string,
): Promise<RecentContextMessage[]> {
  const records = await database
    .select({
      id: messages.id,
      turnId: messages.turnId,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
      partIndex: messages.partIndex,
    })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        isNull(messages.deletedAt),
        inArray(messages.role, ["user", "assistant"]),
      ),
    )
    .orderBy(asc(messages.createdAt), asc(messages.id));

  return orderRecentContextMessages(records);
}

async function latestChunk(conversationId: string) {
  const [record] = await database
    .select({
      endMessageId: conversationSummaries.endMessageId,
      summaryText: conversationSummaries.summaryText,
      openSituations: conversationSummaries.openSituations,
    })
    .from(conversationSummaries)
    .where(
      and(
        eq(conversationSummaries.conversationId, conversationId),
        eq(conversationSummaries.status, "active"),
      ),
    )
    .orderBy(desc(conversationSummaries.createdAt))
    .limit(1);

  return record ?? null;
}

function localTimestamp(instant: Date, timezone: string): string {
  return (
    DateTime.fromJSDate(instant, { zone: "utc" }).setZone(timezone).toISO() ??
    instant.toISOString()
  );
}

function embeddingText(summaryText: string, openSituations: string[]): string {
  return openSituations.length === 0
    ? summaryText
    : `${summaryText}\n\nOpen situations:\n${openSituations.join("\n")}`;
}

function contentHash(content: string): string {
  return createHash("sha256").update(content.normalize("NFKC").trim()).digest("hex");
}

async function startSummaryModelRun(
  job: ClaimedSummaryJob,
  inputJson: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  await database.insert(modelRuns).values({
    id,
    turnId: job.turnId,
    jobId: job.id,
    phase: "summary",
    provider: "openrouter",
    model: getEnvironment().THOUGHT_MODEL,
    promptVersion: "summary-v1",
    status: "running",
    inputJson,
  });
  return id;
}

async function completeSummaryModelRun(
  id: string,
  completion: ModelCompletion,
  outputJson: Record<string, unknown>,
): Promise<void> {
  await database
    .update(modelRuns)
    .set({
      provider: completion.provider ?? "openrouter",
      model: completion.model,
      status: "completed",
      outputJson,
      rawOutput: completion.content,
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      estimatedCostUsd: completion.usage.estimatedCostUsd,
      latencyMs: completion.latencyMs,
      completedAt: new Date(),
    })
    .where(eq(modelRuns.id, id));
}

async function failSummaryModelRun(id: string, error: unknown): Promise<void> {
  await database
    .update(modelRuns)
    .set({
      status: "failed",
      rawOutput:
        isSummaryPolicyOutputError(error) ? error.rawOutput : undefined,
      errorCode: error instanceof Error ? error.name : "SUMMARY_MODEL_ERROR",
      errorMessage: (error instanceof Error ? error.message : String(error)).slice(
        0,
        2_000,
      ),
      completedAt: new Date(),
    })
    .where(eq(modelRuns.id, id));
}

async function completeJob(jobId: string): Promise<void> {
  const now = new Date();
  await database
    .update(jobs)
    .set({
      status: "completed",
      completedAt: now,
      lockedAt: null,
      lockedBy: null,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));
}

export function createSummaryProcessor(dependencies: {
  generateSummaryPlan?: typeof generateSummaryPlan;
  embed?: EmbedTexts;
} = {}): SummaryProcessor {
  const runSummaryPlan =
    dependencies.generateSummaryPlan ?? generateSummaryPlan;
  const embed = dependencies.embed ?? embedTexts;

  return {
    async process(job) {
      const owner = await loadOwner(job.turnId);

      for (let chunkNumber = 0; chunkNumber < MAX_CHUNKS_PER_JOB; chunkNumber += 1) {
        const [orderedMessages, previousChunk] = await Promise.all([
          loadMessages(owner.conversationId),
          latestChunk(owner.conversationId),
        ]);
        const chunk = selectNextSummaryChunk(
          orderedMessages,
          previousChunk?.endMessageId ?? null,
        );

        if (!chunk) {
          await completeJob(job.id);
          return;
        }

        const firstMessage = chunk[0];
        const lastMessage = chunk.at(-1);
        if (!firstMessage || !lastMessage) {
          await completeJob(job.id);
          return;
        }

        const policyContext = {
          timezone: owner.timezone,
          previousChunk: previousChunk
            ? {
                summaryText: previousChunk.summaryText,
                openSituations: previousChunk.openSituations,
              }
            : null,
          newMessages: chunk.map((message) => ({
            id: message.id,
            turnId: message.turnId,
            sender: message.role as "user" | "assistant",
            content: message.content,
            createdAtLocal: localTimestamp(message.createdAt, owner.timezone),
          })),
        };
        const modelRunId = await startSummaryModelRun(job, policyContext);

        let generation;
        try {
          generation = await runSummaryPlan(policyContext);
          await completeSummaryModelRun(
            modelRunId,
            generation.completion,
            generation.plan,
          );
        } catch (error) {
          await failSummaryModelRun(modelRunId, error);
          throw error;
        }

        const content = embeddingText(
          generation.plan.summaryText,
          generation.plan.openSituations,
        );
        const embeddingGeneration = await embed([content]);
        const [vector] = embeddingGeneration.vectors;
        if (!vector) throw new Error("The summary embedding response was empty.");

        await database.transaction(async (transaction) => {
          const summaryId = randomUUID();
          const [created] = await transaction
            .insert(conversationSummaries)
            .values({
              id: summaryId,
              userId: owner.userId,
              conversationId: owner.conversationId,
              startMessageId: firstMessage.id,
              endMessageId: lastMessage.id,
              summaryText: generation.plan.summaryText,
              openSituations: generation.plan.openSituations,
              status: "active",
              tokenCount: generation.completion.usage.outputTokens,
            })
            .onConflictDoNothing()
            .returning({ id: conversationSummaries.id });

          if (!created) return;

          await transaction.insert(conversationSummaryEmbeddings).values({
            id: randomUUID(),
            conversationSummaryId: summaryId,
            embeddingModel: embeddingGeneration.model,
            embeddingDimensions: embeddingGeneration.dimensions,
            contentHash: contentHash(content),
            embedding: vector,
            isCurrent: true,
          });
        });
      }

      await completeJob(job.id);
    },
  };
}
