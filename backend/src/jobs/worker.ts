import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, lt, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { getEnvironment } from "../config/env.js";
import { database } from "../db/client.js";
import { inputBatches, jobs, turns } from "../db/schema.js";
import { conversationEvents } from "../events/conversation-events.js";
import { logger } from "../lib/logger.js";
import { isEmbeddingError } from "../models/embedding.js";
import { isOpenRouterError } from "../models/openrouter.js";
import {
  createTurnProcessor,
  isObsoleteTurnJobError,
  isTurnDeferredError,
  type ClaimedTurnJob,
  type TurnProcessor,
} from "../pipeline/turn-processor.js";
import {
  createSummaryProcessor,
  isObsoleteSummaryJobError,
  type SummaryProcessor,
} from "../summary/summary-processor.js";

const turnJobPayloadSchema = z.object({ turnId: z.string().uuid() }).strict();
const supportedJobKinds = [
  "generate_turn",
  "sync_turn_memory",
  "summarize_conversation",
] as const;
const staleJobAgeMs = 5 * 60_000;
const staleJobRecoveryIntervalMs = 60_000;
type SupportedJobKind = (typeof supportedJobKinds)[number];

interface ClaimedJob extends ClaimedTurnJob {
  kind: SupportedJobKind;
}

async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  return database.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select({
        id: jobs.id,
        kind: jobs.kind,
        payload: jobs.payload,
        attemptCount: jobs.attemptCount,
        maxAttempts: jobs.maxAttempts,
      })
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAt, new Date())))
      .orderBy(desc(jobs.priority), asc(jobs.runAt), asc(jobs.createdAt))
      .limit(1)
      .for("update", { skipLocked: true });

    if (!candidate) return null;

    const payload = turnJobPayloadSchema.safeParse(candidate.payload);
    const kind = supportedJobKinds.find((value) => value === candidate.kind);
    if (!kind || !payload.success) {
      await transaction
        .update(jobs)
        .set({
          status: "failed",
          attemptCount: candidate.attemptCount + 1,
          lastErrorCode: "INVALID_JOB_PAYLOAD",
          lastErrorMessage: "The job payload is invalid.",
          lockedAt: null,
          lockedBy: null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, candidate.id));
      return null;
    }

    const attemptCount = candidate.attemptCount + 1;
    await transaction
      .update(jobs)
      .set({
        status: "processing",
        attemptCount,
        lockedAt: new Date(),
        lockedBy: workerId,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, candidate.id));

    return {
      id: candidate.id,
      kind,
      turnId: payload.data.turnId,
      attemptCount,
      maxAttempts: candidate.maxAttempts,
    };
  });
}

async function deferJob(job: ClaimedJob, runAt: Date): Promise<void> {
  await database
    .update(jobs)
    .set({
      status: "pending",
      runAt,
      attemptCount: sql`greatest(${jobs.attemptCount} - 1, 0)`,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
}

async function completeObsoleteJob(job: ClaimedJob): Promise<void> {
  await database
    .update(jobs)
    .set({
      status: "completed",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, job.id));
}

function isRetryable(error: unknown): boolean {
  if (isOpenRouterError(error) || isEmbeddingError(error)) {
    return error.retryable;
  }
  if (error instanceof Error && error.name === "VoiceBriefRejectedError") {
    return false;
  }
  return true;
}

async function failTurnJob(job: ClaimedJob, error: unknown): Promise<void> {
  const retryable =
    isRetryable(error);
  const shouldRetry = retryable && job.attemptCount < job.maxAttempts;
  const code = error instanceof Error ? error.name : "TURN_GENERATION_ERROR";
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
  const now = new Date();
  const [turn] = await database
    .select({
      conversationId: turns.conversationId,
      batchId: turns.inputBatchId,
    })
    .from(turns)
    .where(eq(turns.id, job.turnId))
    .limit(1);

  await database.transaction(async (transaction) => {
    await transaction
      .update(jobs)
      .set(
        shouldRetry
          ? {
              status: "pending",
              runAt: new Date(now.getTime() + 1_500 * job.attemptCount),
              lockedAt: null,
              lockedBy: null,
              lastErrorCode: code,
              lastErrorMessage: message,
              updatedAt: now,
            }
          : {
              status: "failed",
              lockedAt: null,
              lockedBy: null,
              lastErrorCode: code,
              lastErrorMessage: message,
              updatedAt: now,
            },
      )
      .where(eq(jobs.id, job.id));

    await transaction
      .update(turns)
      .set({
        status: shouldRetry ? "queued" : "failed",
        errorCode: code,
        errorMessage: message,
        retryable: shouldRetry,
        failedAt: shouldRetry ? null : now,
        updatedAt: now,
      })
      .where(eq(turns.id, job.turnId));

    if (turn) {
      await transaction
        .update(inputBatches)
        .set({
          status: shouldRetry ? "ready" : "cancelled",
          updatedAt: now,
        })
        .where(eq(inputBatches.id, turn.batchId));
    }
  });

  if (turn) {
    conversationEvents.publish(turn.conversationId, {
      type: "typing.stopped",
      data: { conversationId: turn.conversationId, sender: "assistant" },
    });

    if (!shouldRetry) {
      conversationEvents.publish(turn.conversationId, {
        type: "turn.failed",
        data: {
          turnId: job.turnId,
          code,
          message: "Cantarella couldn't respond.",
          retryable: false,
        },
      });
    }
  }

  const logContext = {
    jobId: job.id,
    turnId: job.turnId,
    code,
    errorMessage: message,
    retryable: shouldRetry,
  };
  if (shouldRetry) {
    logger.warn(logContext, "Turn generation attempt failed; retrying");
  } else {
    logger.error(logContext, "Turn generation failed");
  }
}

async function failSummaryJob(job: ClaimedJob, error: unknown): Promise<void> {
  const retryable = isRetryable(error);
  const shouldRetry = retryable && job.attemptCount < job.maxAttempts;
  const code = error instanceof Error ? error.name : "SUMMARY_SYNC_ERROR";
  const message = (error instanceof Error ? error.message : String(error)).slice(
    0,
    2_000,
  );
  const now = new Date();

  await database
    .update(jobs)
    .set(
      shouldRetry
        ? {
            status: "pending",
            runAt: new Date(now.getTime() + 1_500 * job.attemptCount),
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: code,
            lastErrorMessage: message,
            updatedAt: now,
          }
        : {
            status: "failed",
            lockedAt: null,
            lockedBy: null,
            lastErrorCode: code,
            lastErrorMessage: message,
            updatedAt: now,
          },
    )
    .where(eq(jobs.id, job.id));

  logger.error(
    { jobId: job.id, turnId: job.turnId, code, retryable: shouldRetry },
    "Conversation summarization failed",
  );
}

async function recoverStaleJobs(): Promise<void> {
  const staleBefore = new Date(Date.now() - staleJobAgeMs);
  await database
    .update(jobs)
    .set({
      status: "pending",
      lockedAt: null,
      lockedBy: null,
      runAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.status, "processing"), lt(jobs.lockedAt, staleBefore)));
}

export interface JobWorker {
  stop(): void;
}

export function startJobWorker(dependencies: {
  turnProcessor?: TurnProcessor;
  summaryProcessor?: SummaryProcessor;
} = {}): JobWorker {
  const environment = getEnvironment();
  const turnProcessor = dependencies.turnProcessor ?? createTurnProcessor();
  const summaryProcessor =
    dependencies.summaryProcessor ?? createSummaryProcessor();

  if (
    !environment.OPENROUTER_API_KEY ||
    environment.OPENROUTER_API_KEY === "replace-me"
  ) {
    logger.warn("Job worker not started because OPENROUTER_API_KEY is missing");
    return { stop() {} };
  }

  const workerId = `cantarella-${process.pid}-${randomUUID()}`;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let nextStaleRecoveryAt = 0;

  const schedule = (delay: number) => {
    if (!stopped) timer = setTimeout(run, delay);
  };

  const run = async () => {
    try {
      const now = Date.now();
      if (now >= nextStaleRecoveryAt) {
        await recoverStaleJobs();
        nextStaleRecoveryAt = now + staleJobRecoveryIntervalMs;
      }

      const job = await claimNextJob(workerId);

      if (!job) {
        schedule(environment.JOB_POLL_MS);
        return;
      }

      try {
        if (job.kind === "generate_turn") {
          await turnProcessor.process(job);
        } else if (job.kind === "sync_turn_memory") {
          // Legacy jobs from the previous dual-writer memory pipeline are
          // intentionally retired. Kimi now owns memory inside generate_turn.
          await completeObsoleteJob(job);
        } else {
          await summaryProcessor.process(job);
        }
      } catch (error) {
        if (job.kind === "generate_turn" && isTurnDeferredError(error)) {
          await deferJob(job, error.runAt);
        } else if (
          isObsoleteTurnJobError(error) ||
          isObsoleteSummaryJobError(error)
        ) {
          await completeObsoleteJob(job);
        } else if (job.kind === "summarize_conversation") {
          await failSummaryJob(job, error);
        } else {
          await failTurnJob(job, error);
        }
      }

      schedule(0);
    } catch (error) {
      logger.error({ error }, "Job worker loop failed");
      schedule(environment.JOB_POLL_MS);
    }
  };

  schedule(0);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
