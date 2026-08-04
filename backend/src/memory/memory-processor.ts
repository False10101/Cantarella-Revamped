import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";
import { DateTime } from "luxon";

import { getEnvironment } from "../config/env.js";
import { database } from "../db/client.js";
import {
  conversations,
  inputBatchMessages,
  jobs,
  memories,
  memoryEmbeddings,
  memoryEvents,
  memoryEvidence,
  messages,
  modelRuns,
  turns,
  userSettings,
} from "../db/schema.js";
import {
  createEmbeddingClient,
  type EmbeddingClient,
  type EmbeddingGeneration,
} from "../models/embedding.js";
import type { ModelCompletion } from "../models/openrouter.js";
import {
  createMemoryPolicyGenerator,
  MemoryPolicyOutputError,
  type MemoryCandidate,
  type MemoryPolicyGenerator,
  type MemoryTemporalContext,
  type MemoryType,
} from "./memory-policy.js";
import {
  createMemoryRetriever,
  type MemoryRetriever,
  type RetrievedMemory,
} from "./memory-retrieval.js";

export interface ClaimedMemoryJob {
  id: string;
  turnId: string;
  attemptCount: number;
  maxAttempts: number;
}

export interface MemoryProcessor {
  process(job: ClaimedMemoryJob): Promise<void>;
}

interface PreparedCandidate extends MemoryCandidate {
  normalizedHash: string;
  expiresAtDate: Date | null;
}

interface TurnMemoryContext {
  userId: string;
  temporalContext: MemoryTemporalContext;
  userMessages: Array<{
    id: string;
    content: string;
    createdAtUtc: string;
    createdAtLocal: string;
  }>;
}

function localDateTime(instant: Date, timezone: string): DateTime {
  const localized = DateTime.fromJSDate(instant, { zone: "utc" }).setZone(
    timezone,
  );

  if (!localized.isValid) {
    throw new Error(`Cannot localize memory timestamp to ${timezone}.`);
  }

  return localized;
}

export function createMemoryTemporalContext(
  timezone: string,
  referenceInstant: Date,
): MemoryTemporalContext {
  const localized = localDateTime(referenceInstant, timezone);
  const currentLocalDate = localized.toISODate();
  const currentLocalDateTime = localized.toISO();

  if (!currentLocalDate || !currentLocalDateTime) {
    throw new Error(`Cannot format memory timestamp in ${timezone}.`);
  }

  return {
    timezone,
    referenceInstantUtc: referenceInstant.toISOString(),
    currentLocalDate,
    currentLocalDateTime,
  };
}

export class ObsoleteMemoryJobError extends Error {
  constructor() {
    super("The memory job no longer references a completed turn.");
    this.name = "ObsoleteMemoryJobError";
  }
}

export class MemoryCandidateReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryCandidateReferenceError";
  }
}

export function normalizeMemoryText(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function memoryContentHash(text: string): string {
  return createHash("sha256").update(normalizeMemoryText(text)).digest("hex");
}

function minimumImportance(type: MemoryType): number {
  return type === "situation" || type === "event" ? 0.55 : 0.35;
}

export function prepareMemoryCandidates(
  candidates: MemoryCandidate[],
  input: {
    sourceMessageIds: Set<string>;
    existingMemoryIds: Set<string>;
    now: Date;
  },
): PreparedCandidate[] {
  const seen = new Set<string>();
  const targeted = new Set<string>();
  const prepared: PreparedCandidate[] = [];

  for (const candidate of candidates) {
    const invalidSourceMessageId = candidate.sourceMessageIds.find(
      (messageId) => !input.sourceMessageIds.has(messageId),
    );
    if (invalidSourceMessageId) {
      throw new MemoryCandidateReferenceError(
        `Memory candidate referenced unavailable source message ${invalidSourceMessageId}.`,
      );
    }
    if (
      candidate.targetMemoryId &&
      !input.existingMemoryIds.has(candidate.targetMemoryId)
    ) {
      throw new MemoryCandidateReferenceError(
        `Memory candidate referenced unavailable target memory ${candidate.targetMemoryId}.`,
      );
    }

    if (candidate.confidence < 0.72) continue;
    if (candidate.importance < minimumImportance(candidate.type)) continue;
    if (candidate.targetMemoryId && targeted.has(candidate.targetMemoryId)) continue;

    const normalizedText = normalizeMemoryText(candidate.canonicalText);
    if (!normalizedText) continue;
    const normalizedHash = memoryContentHash(normalizedText);
    const expiresAtDate = candidate.expiresAt
      ? new Date(candidate.expiresAt)
      : null;

    if (seen.has(normalizedHash)) continue;
    if (expiresAtDate && Number.isNaN(expiresAtDate.getTime())) continue;
    if (expiresAtDate && expiresAtDate <= input.now) continue;
    if (candidate.type === "situation" && !expiresAtDate) continue;

    seen.add(normalizedHash);
    if (candidate.targetMemoryId) targeted.add(candidate.targetMemoryId);
    prepared.push({ ...candidate, normalizedHash, expiresAtDate });
  }

  return prepared;
}

async function loadTurnMemoryContext(turnId: string): Promise<TurnMemoryContext> {
  const [turn] = await database
    .select({
      status: turns.status,
      inputBatchId: turns.inputBatchId,
      userId: conversations.ownerUserId,
      timezone: userSettings.timezone,
    })
    .from(turns)
    .innerJoin(conversations, eq(conversations.id, turns.conversationId))
    .innerJoin(userSettings, eq(userSettings.userId, conversations.ownerUserId))
    .where(eq(turns.id, turnId))
    .limit(1);

  if (!turn || turn.status !== "completed") throw new ObsoleteMemoryJobError();

  const userMessages = await database
    .select({
      id: messages.id,
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(inputBatchMessages)
    .innerJoin(messages, eq(messages.id, inputBatchMessages.messageId))
    .where(eq(inputBatchMessages.batchId, turn.inputBatchId))
    .orderBy(asc(inputBatchMessages.position));

  if (userMessages.length === 0) throw new ObsoleteMemoryJobError();

  const referenceMessage = userMessages[userMessages.length - 1];
  if (!referenceMessage) throw new ObsoleteMemoryJobError();

  return {
    userId: turn.userId,
    temporalContext: createMemoryTemporalContext(
      turn.timezone,
      referenceMessage.createdAt,
    ),
    userMessages: userMessages.map((message) => ({
      id: message.id,
      content: message.content,
      createdAtUtc: message.createdAt.toISOString(),
      createdAtLocal:
        localDateTime(message.createdAt, turn.timezone).toISO() ??
        message.createdAt.toISOString(),
    })),
  };
}

async function startMemoryModelRun(
  job: ClaimedMemoryJob,
  inputJson: Record<string, unknown>,
): Promise<string> {
  const id = randomUUID();
  await database.insert(modelRuns).values({
    id,
    turnId: job.turnId,
    jobId: job.id,
    phase: "memory",
    provider: "openrouter",
    model: getEnvironment().THOUGHT_MODEL,
    promptVersion: "memory-v2",
    status: "running",
    inputJson,
  });
  return id;
}

async function completeMemoryModelRun(
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

async function failMemoryModelRun(id: string, error: unknown): Promise<void> {
  await database
    .update(modelRuns)
    .set({
      status: "failed",
      rawOutput:
        error instanceof MemoryPolicyOutputError ? error.rawOutput : undefined,
      errorCode: error instanceof Error ? error.name : "MEMORY_MODEL_ERROR",
      errorMessage: (error instanceof Error ? error.message : String(error)).slice(
        0,
        2_000,
      ),
      completedAt: new Date(),
    })
    .where(eq(modelRuns.id, id));
}

function policyMemories(memories: RetrievedMemory[]) {
  return memories.map((memory) => ({
    id: memory.id,
    type: memory.type,
    canonicalText: memory.canonicalText,
    importance: memory.importance,
    confidence: memory.confidence,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    similarity: memory.similarity,
  }));
}

function vectorForCandidate(
  candidate: PreparedCandidate,
  candidatesNeedingEmbedding: PreparedCandidate[],
  generation: EmbeddingGeneration | null,
): number[] | null {
  const index = candidatesNeedingEmbedding.indexOf(candidate);
  return index === -1 || !generation ? null : generation.vectors[index] ?? null;
}

export function createMemoryProcessor(dependencies: {
  policyGenerator?: MemoryPolicyGenerator;
  embeddingClient?: EmbeddingClient;
  memoryRetriever?: MemoryRetriever;
} = {}): MemoryProcessor {
  const policyGenerator =
    dependencies.policyGenerator ?? createMemoryPolicyGenerator();
  const embeddingClient = dependencies.embeddingClient ?? createEmbeddingClient();
  const memoryRetriever =
    dependencies.memoryRetriever ?? createMemoryRetriever(embeddingClient);

  return {
    async process(job) {
      const context = await loadTurnMemoryContext(job.turnId);
      const existingMemories = await memoryRetriever.retrieve({
        userId: context.userId,
        queryTexts: context.userMessages.map((message) => message.content),
        limit: 20,
        minimumSimilarity: 0.18,
      });
      const policyContext = {
        temporalContext: context.temporalContext,
        userMessages: context.userMessages,
        existingMemories: policyMemories(existingMemories),
      };
      const modelRunId = await startMemoryModelRun(job, policyContext);

      let policyGeneration;
      try {
        policyGeneration = await policyGenerator.generate(policyContext);
        await completeMemoryModelRun(
          modelRunId,
          policyGeneration.completion,
          policyGeneration.plan,
        );
      } catch (error) {
        await failMemoryModelRun(modelRunId, error);
        throw error;
      }

      const now = new Date();
      const candidates = prepareMemoryCandidates(policyGeneration.plan.candidates, {
        sourceMessageIds: new Set(
          context.userMessages.map((message) => message.id),
        ),
        existingMemoryIds: new Set(existingMemories.map((memory) => memory.id)),
        now,
      });
      const candidatesNeedingEmbedding = candidates.filter(
        (candidate) => candidate.action !== "reinforce",
      );
      const embeddingGeneration =
        candidatesNeedingEmbedding.length > 0
          ? await embeddingClient.embed(
              candidatesNeedingEmbedding.map((candidate) => candidate.canonicalText),
            )
          : null;

      await database.transaction(async (transaction) => {
        for (const candidate of candidates) {
          const [exactMemory] = await transaction
            .select()
            .from(memories)
            .where(
              and(
                eq(memories.userId, context.userId),
                eq(memories.normalizedHash, candidate.normalizedHash),
                eq(memories.status, "active"),
              ),
            )
            .limit(1)
            .for("update");

          const targetId = exactMemory?.id ?? candidate.targetMemoryId;
          const [targetMemory] = targetId
            ? await transaction
                .select()
                .from(memories)
                .where(
                  and(
                    eq(memories.id, targetId),
                    eq(memories.userId, context.userId),
                    eq(memories.status, "active"),
                  ),
                )
                .limit(1)
                .for("update")
            : [];

          const [supersededTarget] =
            exactMemory &&
            candidate.action === "correct" &&
            candidate.targetMemoryId &&
            candidate.targetMemoryId !== exactMemory.id
              ? await transaction
                  .select()
                  .from(memories)
                  .where(
                    and(
                      eq(memories.id, candidate.targetMemoryId),
                      eq(memories.userId, context.userId),
                      eq(memories.status, "active"),
                    ),
                  )
                  .limit(1)
                  .for("update")
              : [];

          const effectiveAction = exactMemory ? "reinforce" : candidate.action;

          if (effectiveAction === "reinforce") {
            if (!targetMemory) continue;

            if (supersededTarget) {
              await transaction
                .update(memories)
                .set({ status: "superseded", updatedAt: now })
                .where(eq(memories.id, supersededTarget.id));
              await transaction
                .update(memoryEmbeddings)
                .set({ isCurrent: false, supersededAt: now })
                .where(
                  and(
                    eq(memoryEmbeddings.memoryId, supersededTarget.id),
                    eq(memoryEmbeddings.isCurrent, true),
                  ),
                );
              await transaction.insert(memoryEvents).values({
                id: randomUUID(),
                userId: context.userId,
                lineageId: supersededTarget.lineageId,
                memoryId: supersededTarget.id,
                relatedMemoryId: targetMemory.id,
                eventType: "superseded",
                actor: "memory_policy",
                sourceMessageId: candidate.sourceMessageIds[0],
                modelRunId,
              });
            }

            await transaction
              .update(memories)
              .set({
                importance: Math.max(targetMemory.importance, candidate.importance),
                confidence: Math.min(
                  1,
                  Math.max(targetMemory.confidence, candidate.confidence) + 0.02,
                ),
                expiresAt: candidate.expiresAtDate ?? targetMemory.expiresAt,
                lastReinforcedAt: now,
                updatedAt: now,
              })
              .where(eq(memories.id, targetMemory.id));

            for (const messageId of candidate.sourceMessageIds) {
              await transaction
                .insert(memoryEvidence)
                .values({
                  id: randomUUID(),
                  memoryId: targetMemory.id,
                  messageId,
                  relationship: supersededTarget ? "corrects" : "reinforces",
                  confidence: candidate.confidence,
                })
                .onConflictDoNothing();
            }

            await transaction.insert(memoryEvents).values({
              id: randomUUID(),
              userId: context.userId,
              lineageId: targetMemory.lineageId,
              memoryId: targetMemory.id,
              relatedMemoryId: supersededTarget?.id ?? null,
              eventType: supersededTarget ? "corrected" : "reinforced",
              actor: "memory_policy",
              sourceMessageId: candidate.sourceMessageIds[0],
              modelRunId,
              metadata: {
                confidence: candidate.confidence,
                importance: candidate.importance,
                consolidatedIntoExisting: Boolean(supersededTarget),
              },
            });
            continue;
          }

          const vector = vectorForCandidate(
            candidate,
            candidatesNeedingEmbedding,
            embeddingGeneration,
          );
          if (!vector || !embeddingGeneration) continue;

          const memoryId = randomUUID();
          const lineageId =
            effectiveAction === "correct" && targetMemory
              ? targetMemory.lineageId
              : memoryId;

          if (effectiveAction === "correct") {
            if (!targetMemory) continue;
            await transaction
              .update(memories)
              .set({ status: "superseded", updatedAt: now })
              .where(eq(memories.id, targetMemory.id));
            await transaction
              .update(memoryEmbeddings)
              .set({ isCurrent: false, supersededAt: now })
              .where(
                and(
                  eq(memoryEmbeddings.memoryId, targetMemory.id),
                  eq(memoryEmbeddings.isCurrent, true),
                ),
              );
          }

          await transaction.insert(memories).values({
            id: memoryId,
            userId: context.userId,
            lineageId,
            supersedesMemoryId:
              effectiveAction === "correct" ? (targetMemory?.id ?? null) : null,
            type: candidate.type,
            canonicalText: candidate.canonicalText,
            importance: candidate.importance,
            confidence: candidate.confidence,
            status: "active",
            normalizedHash: candidate.normalizedHash,
            expiresAt: candidate.expiresAtDate,
            lastReinforcedAt: now,
          });
          await transaction.insert(memoryEmbeddings).values({
            id: randomUUID(),
            memoryId,
            embeddingModel: embeddingGeneration.model,
            embeddingDimensions: embeddingGeneration.dimensions,
            contentHash: candidate.normalizedHash,
            embedding: vector,
            isCurrent: true,
          });

          for (const messageId of candidate.sourceMessageIds) {
            await transaction.insert(memoryEvidence).values({
              id: randomUUID(),
              memoryId,
              messageId,
              relationship:
                effectiveAction === "correct" ? "corrects" : "supports",
              confidence: candidate.confidence,
            });
          }

          if (effectiveAction === "correct" && targetMemory) {
            await transaction.insert(memoryEvents).values({
              id: randomUUID(),
              userId: context.userId,
              lineageId,
              memoryId: targetMemory.id,
              relatedMemoryId: memoryId,
              eventType: "superseded",
              actor: "memory_policy",
              sourceMessageId: candidate.sourceMessageIds[0],
              modelRunId,
            });
          }

          await transaction.insert(memoryEvents).values({
            id: randomUUID(),
            userId: context.userId,
            lineageId,
            memoryId,
            relatedMemoryId:
              effectiveAction === "correct" ? (targetMemory?.id ?? null) : null,
            eventType: effectiveAction === "correct" ? "corrected" : "created",
            actor: "memory_policy",
            sourceMessageId: candidate.sourceMessageIds[0],
            modelRunId,
            metadata: {
              confidence: candidate.confidence,
              importance: candidate.importance,
            },
          });
        }

        await transaction
          .update(jobs)
          .set({
            status: "completed",
            completedAt: now,
            lockedAt: null,
            lockedBy: null,
            updatedAt: now,
          })
          .where(eq(jobs.id, job.id));
      });
    },
  };
}
