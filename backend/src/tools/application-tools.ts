import { and, desc, eq, gt, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { database } from "../db/client.js";
import { memories, reminders } from "../db/schema.js";
import {
  createChatMemory,
  executeMemoryAction,
  invalidMemoryAction,
  isInvalidMemoryActionError,
} from "../memory/memory-action.js";
import { memoryTopics, memoryTypes } from "../memory/memory-core.js";
import type { RetrieveMemories } from "../memory/memory-retrieval.js";
import type {
  ModelFunctionTool,
  ModelToolCall,
} from "../models/openrouter.js";
import {
  reminderActionSchema,
  type ThoughtApplicationResult,
  type ThoughtToolExecutionResult,
  type ThoughtToolRuntime,
} from "../models/thought.js";
import {
  executeReminderAction,
  invalidReminderAction,
  isInvalidReminderActionError,
} from "../reminders/reminder-action.js";

const reminderStatuses = [
  "scheduled",
  "paused",
  "completed",
  "cancelled",
] as const;
const reminderRecurrences = [
  "unchanged",
  "none",
  "daily",
  "weekly",
  "monthly",
] as const;
const confidentMemorySimilarity = 0.5;
const confidentMemoryLead = 0.15;

const readToolNames = new Set(["find_memories", "find_reminders"]);
const mutationToolNames = new Set([
  "save_memory",
  "save_memories",
  "delete_memory",
  "delete_memories",
  "save_reminder",
  "delete_reminder",
]);

interface MutationTargetCandidate {
  id: string;
  label: string;
  similarity?: number | null;
}

export interface MutationTargetResolution {
  status: "none" | "unique" | "confident" | "ambiguous";
  allowedTargetId: string | null;
  candidateIds: string[];
}

function normalizedTargetText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolveMutationTarget(
  originalRequest: string,
  candidates: MutationTargetCandidate[],
): MutationTargetResolution {
  if (candidates.length === 0) {
    return { status: "none", allowedTargetId: null, candidateIds: [] };
  }

  const request = normalizedTargetText(originalRequest);
  const explicitlyNamed = candidates.filter((candidate) => {
    const label = normalizedTargetText(candidate.label);
    return label.length >= 3 && request.includes(label);
  });
  if (explicitlyNamed.length === 1) {
    return {
      status: "confident",
      allowedTargetId: explicitlyNamed[0]?.id ?? null,
      candidateIds: candidates.map((candidate) => candidate.id),
    };
  }

  const scored = candidates
    .filter(
      (candidate): candidate is MutationTargetCandidate & { similarity: number } =>
        typeof candidate.similarity === "number" &&
        Number.isFinite(candidate.similarity),
    );
  const plausible = scored.length > 0
    ? scored.filter(
        (candidate) => candidate.similarity >= confidentMemorySimilarity,
      )
    : candidates;

  if (plausible.length === 0) {
    return {
      status: "none",
      allowedTargetId: null,
      candidateIds: candidates.map((candidate) => candidate.id),
    };
  }
  if (plausible.length === 1) {
    return {
      status: "unique",
      allowedTargetId: plausible[0]?.id ?? null,
      candidateIds: candidates.map((candidate) => candidate.id),
    };
  }

  const ranked = plausible
    .filter(
      (candidate): candidate is MutationTargetCandidate & { similarity: number } =>
        typeof candidate.similarity === "number",
    )
    .sort((left, right) => right.similarity - left.similarity);
  const best = ranked[0];
  const runnerUp = ranked[1];
  if (
    best &&
    runnerUp &&
    best.similarity - runnerUp.similarity >= confidentMemoryLead
  ) {
    return {
      status: "confident",
      allowedTargetId: best.id,
      candidateIds: candidates.map((candidate) => candidate.id),
    };
  }

  return {
    status: "ambiguous",
    allowedTargetId: null,
    candidateIds: candidates.map((candidate) => candidate.id),
  };
}

function targetResolutionOutput(resolution: MutationTargetResolution) {
  return {
    status: resolution.status,
    allowedTargetId: resolution.allowedTargetId,
    instruction:
      resolution.status === "ambiguous"
        ? "Several plausible targets remain. Passive memory work must be skipped silently; an explicit edit or deletion may ask which target."
        : resolution.status === "none"
          ? "No existing target matched. Never update or delete a guessed ID. A clearly warranted new record may still be created with a null ID."
          : "Only allowedTargetId may be mutated for this lookup.",
  };
}

function functionTool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ModelFunctionTool {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        additionalProperties: false,
        properties,
        required,
      },
    },
  };
}

const idProperty = { type: "string", format: "uuid" };

export const applicationTools: ModelFunctionTool[] = [
  functionTool(
    "find_memories",
    "Find relevant active memories, or list them when query is null. Resolve conversational shorthand before searching. Use this before every memory create, update, or delete so related details can be merged instead of duplicated or overwritten.",
    {
      query: { type: ["string", "null"], minLength: 1, maxLength: 500 },
      types: {
        type: "array",
        items: { type: "string", enum: memoryTypes },
        maxItems: 6,
      },
      limit: { type: "integer", minimum: 1, maximum: 200 },
    },
    ["query"],
  ),
  functionTool(
    "save_memory",
    "After find_memories succeeds in this turn, silently create or update useful memory from ordinary conversation. Omit memoryId only when no relevant memory was found; for an update choose one ID returned by find_memories and merge its useful details with the new information. retrievalFacets contains only independently searchable details, never paraphrases; use [] for simple memories and at most four facets. Always supply expiresAt: use an absolute RFC 3339 timestamp for a deadline-bound or otherwise time-bounded current memory, and null only for stable or genuinely open-ended memory.",
    {
      memoryId: { type: ["string", "null"], format: "uuid" },
      canonicalText: { type: "string", minLength: 1, maxLength: 1500 },
      type: { type: "string", enum: memoryTypes },
      topic: { type: "string", enum: memoryTopics },
      subject: { type: ["string", "null"], minLength: 1, maxLength: 120 },
      retrievalFacets: {
        type: "array",
        items: { type: "string", minLength: 1, maxLength: 300 },
        maxItems: 4,
      },
      importance: { type: "number", minimum: 0, maximum: 1 },
      expiresAt: {
        type: ["string", "null"],
        format: "date-time",
        description:
          "Absolute expiry after the bounded situation ends, including a short grace period; null only when the memory is stable or genuinely open-ended.",
      },
    },
    ["canonicalText", "type", "topic", "subject", "retrievalFacets", "expiresAt"],
  ),
  functionTool(
    "save_memories",
    "Batch-create or batch-update several memories after find_memories succeeds. Use this for one explicit request affecting multiple distinct memories, such as moving several records to one topic. Every update memoryId must have been returned by find_memories in this turn.",
    {
      memories: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            memoryId: { type: ["string", "null"], format: "uuid" },
            canonicalText: { type: "string", minLength: 1, maxLength: 1500 },
            type: { type: "string", enum: memoryTypes },
            topic: { type: "string", enum: memoryTopics },
            subject: { type: ["string", "null"], minLength: 1, maxLength: 120 },
            retrievalFacets: {
              type: "array",
              items: { type: "string", minLength: 1, maxLength: 300 },
              maxItems: 4,
            },
            importance: { type: "number", minimum: 0, maximum: 1 },
            expiresAt: { type: ["string", "null"], format: "date-time" },
          },
          required: ["canonicalText", "type", "topic", "subject", "retrievalFacets", "expiresAt"],
        },
      },
    },
    ["memories"],
  ),
  functionTool(
    "delete_memory",
    "Permanently delete one clearly targeted memory when the user explicitly asks to forget, remove, or delete it. Never ask for confirmation after the target is resolved.",
    { memoryId: idProperty },
    ["memoryId"],
  ),
  functionTool(
    "delete_memories",
    "Permanently delete several clearly targeted memories in one explicit request. Every memoryId must have been returned by find_memories in this turn. For an explicit request to clear all memories, first use find_memories with query null, then pass its listed IDs here.",
    {
      memoryIds: {
        type: "array",
        minItems: 1,
        maxItems: 200,
        items: idProperty,
      },
    },
    ["memoryIds"],
  ),
  functionTool(
    "find_reminders",
    "Find reminders, or list them when query is null. Resolve conversational shorthand before searching. Use this before changing or deleting an existing reminder.",
    {
      query: { type: ["string", "null"], minLength: 1, maxLength: 500 },
      status: { type: ["string", "null"], enum: [...reminderStatuses, null] },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    },
    ["query"],
  ),
  functionTool(
    "save_reminder",
    "Create, update, reschedule, pause, resume, or cancel one reminder. Supply only fields used by that operation; omit irrelevant fields instead of sending null. Existing-target operations require allowedTargetId from find_reminders.",
    {
      operation: {
        type: "string",
        enum: ["create", "update", "reschedule", "pause", "resume", "cancel"],
      },
      reminderId: { type: ["string", "null"], format: "uuid" },
      title: { type: ["string", "null"], maxLength: 300 },
      scheduleKind: { type: ["string", "null"], enum: ["at", "after", null] },
      localDateTime: {
        type: ["string", "null"],
        pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
      },
      delayAmount: { type: ["integer", "null"], minimum: 1, maximum: 525600 },
      delayUnit: {
        type: ["string", "null"],
        enum: ["minutes", "hours", "days", null],
      },
      recurrence: { type: "string", enum: reminderRecurrences },
    },
    ["operation"],
  ),
  functionTool(
    "delete_reminder",
    "Permanently delete one clearly targeted reminder. This is distinct from cancelling it and requires an allowed reminderId from find_reminders.",
    { reminderId: idProperty },
    ["reminderId"],
  ),
];

const findMemoriesSchema = z.object({
  query: z.string().trim().min(1).max(500).nullable(),
  types: z.array(z.enum(memoryTypes)).max(6).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
const saveMemorySchema = z.object({
  memoryId: z.string().uuid().nullable().optional(),
  canonicalText: z.string().trim().min(1).max(1_500),
  type: z.enum(memoryTypes),
  topic: z.enum(memoryTopics),
  subject: z.string().trim().min(1).max(120).nullable(),
  retrievalFacets: z.array(z.string().trim().min(1).max(300)).max(4),
  importance: z.number().min(0).max(1).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable(),
});
const saveMemoriesSchema = z.object({
  memories: z.array(saveMemorySchema).min(1).max(50),
});
const memoryIdSchema = z.object({ memoryId: z.string().uuid() });
const memoryIdsSchema = z.object({
  memoryIds: z.array(z.string().uuid()).min(1).max(200),
});
const findRemindersSchema = z.object({
  query: z.string().trim().min(1).max(500).nullable(),
  status: z.enum(reminderStatuses).nullable().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
const saveReminderSchema = z.object({
  operation: z.enum(["create", "update", "reschedule", "pause", "resume", "cancel"]),
  reminderId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(300).nullable().optional(),
  scheduleKind: z.enum(["at", "after"]).nullable().optional(),
  localDateTime: z.string().nullable().optional(),
  delayAmount: z.number().int().min(1).max(525600).nullable().optional(),
  delayUnit: z.enum(["minutes", "hours", "days"]).nullable().optional(),
  recurrence: z.enum(reminderRecurrences).optional(),
});
const reminderIdSchema = z.object({ reminderId: z.string().uuid() });

function argumentsObject(call: ModelToolCall): Record<string, unknown> {
  const parsed = JSON.parse(call.function.arguments) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function memoryRecord(record: typeof memories.$inferSelect) {
  return {
    id: record.id,
    type: record.type,
    topic: record.topic,
    subject: record.subject,
    content: record.canonicalText,
    importance: record.importance,
    confidence: record.confidence,
    expiresAt: record.expiresAt?.toISOString() ?? null,
  };
}

function reminderRecord(record: typeof reminders.$inferSelect) {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    scheduledFor: record.scheduledFor.toISOString(),
    timezone: record.timezone,
    recurrence: record.recurrenceRule,
  };
}

function errorOutput(error: unknown) {
  return {
    ok: false,
    code: error instanceof Error ? error.name : "APPLICATION_ERROR",
    error: error instanceof Error ? error.message : String(error),
  };
}

const explicitMemoryTimeBoundPatterns = [
  /\b(?:due|deadline|expires?|ending|ends?|until|through)\b/i,
  /\b(?:today|tonight|tomorrow|this|next)\s+(?:morning|afternoon|evening|night|week|weekend|month|semester|term)\b/i,
  /\b(?:in|within|for)\s+(?:about\s+)?(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|a couple(?:\s+of)?|couple(?:\s+of)?)\s+(?:hours?|days?|weeks?|months?)\b/i,
  /\b(?:temporar(?:y|ily)|exam week|finals week)\b/i,
];

export function requiresTimeBoundMemoryExpiry(input: {
  type: (typeof memoryTypes)[number];
  canonicalText: string;
  originalRequest: string;
}): boolean {
  if (input.type !== "situation" && input.type !== "event") return false;
  const evidence = `${input.canonicalText}\n${input.originalRequest}`;
  return explicitMemoryTimeBoundPatterns.some((pattern) => pattern.test(evidence));
}

function enforceMemoryExpiry(
  input: z.infer<typeof saveMemorySchema>,
  originalRequest: string,
): void {
  if (
    input.expiresAt === null &&
    requiresTimeBoundMemoryExpiry({
      type: input.type,
      canonicalText: input.canonicalText,
      originalRequest,
    })
  ) {
    throw invalidMemoryAction(
      "A deadline-bound or time-bounded memory requires an absolute expiresAt timestamp after its relevant window.",
    );
  }
}

export interface ApplicationToolContext {
  userId: string;
  conversationId: string;
  turnId: string;
  sourceMessageId: string;
  originalRequest: string;
  timezone: string;
  referenceAt: Date;
  retrieveMemories: RetrieveMemories;
}

export function createApplicationToolRuntime(
  context: ApplicationToolContext,
): ThoughtToolRuntime {
  const retrievedMemoryIds = new Set<string>();
  const retrievedReminderIds = new Set<string>();
  const allowedReminderIds = new Set<string>();
  const mutatedMemoryIds = new Set<string>();
  const mutatedReminderIds = new Set<string>();
  const listedMemoryIds = new Set<string>();
  let memoryLookupPerformed = false;

  const rememberResolution = (
    resolution: MutationTargetResolution,
    allowedIds: Set<string>,
  ) => {
    if (resolution.allowedTargetId) allowedIds.add(resolution.allowedTargetId);
    return targetResolutionOutput(resolution);
  };
  const requireSafeMemoryTarget = (memoryId: string, allowListed = false) => {
    if (
      !retrievedMemoryIds.has(memoryId) &&
      !(allowListed && listedMemoryIds.has(memoryId))
    ) {
      throw invalidMemoryAction(
        "The memory target was not returned by find_memories in this turn.",
      );
    }
    if (mutatedMemoryIds.has(memoryId)) {
      throw invalidMemoryAction(
        "The same memory cannot be mutated twice in one turn.",
      );
    }
  };
  const requireSafeReminderTarget = (reminderId: string) => {
    if (!retrievedReminderIds.has(reminderId) || !allowedReminderIds.has(reminderId)) {
      throw invalidReminderAction(
        "The reminder target was not uniquely resolved by find_reminders.",
      );
    }
    if (mutatedReminderIds.has(reminderId)) {
      throw invalidReminderAction(
        "The same reminder cannot be mutated twice in one turn.",
      );
    }
  };
  const reminderResult = async (
    action: Parameters<typeof executeReminderAction>[0]["action"],
  ): Promise<ThoughtToolExecutionResult> => {
    const result = await executeReminderAction({
      action,
      turnId: context.turnId,
      userId: context.userId,
      conversationId: context.conversationId,
      sourceMessageId: context.sourceMessageId,
      originalRequest: context.originalRequest,
      timezone: context.timezone,
      referenceAt: context.referenceAt,
    });
    const applicationResult: ThoughtApplicationResult = {
      kind: "reminder",
      reminderId: result.primaryReminder?.id ?? null,
      reminderIds: result.reminders.map((reminder) => reminder.id),
    };
    return {
      output: { ok: true, reminders: result.reminders },
      applicationResult,
    };
  };
  const explicitClearAllMemoryRequest = () =>
    /\b(?:clear|delete|remove|forget)\b[\s\S]{0,80}\b(?:all|everything|every)\b|\b(?:all|everything|every)\b[\s\S]{0,80}\b(?:memories|memory)\b/i.test(
      context.originalRequest,
    );
  const saveMemory = async (
    input: z.infer<typeof saveMemorySchema>,
  ): Promise<ThoughtToolExecutionResult> => {
    if (!memoryLookupPerformed) {
      throw invalidMemoryAction(
        "save_memory requires a successful find_memories call in the same turn.",
      );
    }
    enforceMemoryExpiry(input, context.originalRequest);
    if (!input.memoryId) {
      const result = await createChatMemory({
        userId: context.userId,
        sourceMessageId: context.sourceMessageId,
        type: input.type,
        topic: input.topic,
        subject: input.subject,
        canonicalText: input.canonicalText,
        retrievalFacets: input.retrievalFacets,
        importance: input.importance ?? 0.7,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      });
      return {
        output: { ok: true, memory: result.memory, operation: "created" },
        applicationResult: {
          kind: "memory",
          memoryId: result.memory.id,
          deletedMemoryCount: 0,
        },
      };
    }

    requireSafeMemoryTarget(input.memoryId);
    const result = await executeMemoryAction({
      action: {
        operation: "edit",
        targetMemoryRef: input.memoryId,
        replacementText: input.canonicalText,
      },
      userId: context.userId,
      sourceMessageId: context.sourceMessageId,
      replacementType: input.type,
      replacementTopic: input.topic,
      replacementSubject: input.subject,
      replacementRetrievalFacets: input.retrievalFacets,
      ...(input.importance !== undefined
        ? { replacementImportance: input.importance }
        : {}),
      replacementExpiresAt: input.expiresAt
        ? new Date(input.expiresAt)
        : null,
    });
    mutatedMemoryIds.add(input.memoryId);
    return {
      output: { ok: true, memory: result.memory, operation: "updated" },
      applicationResult: {
        kind: "memory",
        memoryId: result.memory.id,
        deletedMemoryCount: 0,
      },
    };
  };
  const deleteMemory = async (
    memoryId: string,
    allowListed = false,
  ): Promise<ThoughtToolExecutionResult> => {
    requireSafeMemoryTarget(memoryId, allowListed);
    const result = await executeMemoryAction({
      action: {
        operation: "delete",
        targetMemoryRef: memoryId,
        replacementText: null,
      },
      userId: context.userId,
      sourceMessageId: context.sourceMessageId,
    });
    mutatedMemoryIds.add(memoryId);
    return {
      output: {
        ok: true,
        operation: "deleted",
        deletedMemoryId: result.memory.id,
        deletedMemoryCount: result.deletedMemoryCount,
      },
      applicationResult: {
        kind: "memory",
        memoryId: result.memory.id,
        deletedMemoryCount: result.deletedMemoryCount,
      },
    };
  };

  return {
    tools: applicationTools,
    maxReadCalls: 6,
    maxMutationCalls: 6,
    classify(name) {
      if (readToolNames.has(name)) return "read";
      if (mutationToolNames.has(name)) return "mutation";
      return null;
    },
    async execute(call) {
      try {
        const args = argumentsObject(call);

        if (call.function.name === "find_memories") {
          const input = findMemoriesSchema.parse(args);
          if (input.query !== null) {
            const records = await context.retrieveMemories({
              userId: context.userId,
              queryTexts: [input.query],
            limit: Math.min(input.limit ?? 8, 12),
              minimumSimilarity: 0.18,
            });
            const filtered = input.types
              ? records.filter((record) => input.types?.includes(record.type))
              : records;
            for (const record of filtered) retrievedMemoryIds.add(record.id);
            memoryLookupPerformed = true;
            return {
              output: {
                ok: true,
                query: input.query,
                memories: filtered.map((record) => ({
                  id: record.id,
                  type: record.type,
                  topic: record.topic,
                  subject: record.subject,
                  content: record.canonicalText,
                  importance: record.importance,
                  confidence: record.confidence,
                  similarity: record.similarity,
                  matchKinds: record.matchKinds ?? [],
                  expiresAt: record.expiresAt?.toISOString() ?? null,
                })),
                targetResolution: {
                  status: filtered.length === 0 ? "none" : "candidates",
                  candidateIds: filtered.map((record) => record.id),
                  instruction:
                    filtered.length === 0
                      ? "No matching active memory was found. Create only a clearly warranted new record."
                      : "For an update or deletion, choose only one returned candidate ID. If ordinary passive memory work is uncertain, skip it; explicit edits or deletions may ask one short target clarification.",
                },
              },
            };
          }

          const conditions = [
            eq(memories.userId, context.userId),
            eq(memories.status, "active"),
            or(isNull(memories.expiresAt), gt(memories.expiresAt, new Date())),
          ];
          if (input.types && input.types.length > 0) {
            conditions.push(
              or(...input.types.map((type) => eq(memories.type, type)))!,
            );
          }
          const records = await database
            .select()
            .from(memories)
            .where(and(...conditions))
            .orderBy(desc(memories.importance), desc(memories.updatedAt))
            .limit(input.limit ?? 100);
          for (const record of records) listedMemoryIds.add(record.id);
          memoryLookupPerformed = true;
          return {
            output: {
              ok: true,
              memories: records.map(memoryRecord),
              targetResolution: {
                status: "list_only",
                candidateIds: [],
                instruction:
                  "This unfiltered list cannot authorize a memory mutation. Search with a resolved query before editing or deleting.",
              },
            },
          };
        }

        if (call.function.name === "save_memory") {
          return await saveMemory(saveMemorySchema.parse(args));
        }

        if (call.function.name === "save_memories") {
          const input = saveMemoriesSchema.parse(args);
          const successes: Array<Extract<ThoughtApplicationResult, { kind: "memory" }>> = [];
          const outcomes: unknown[] = [];
          for (const memory of input.memories) {
            try {
              const result = await saveMemory(memory);
              outcomes.push(result.output);
              if (result.applicationResult?.kind === "memory") {
                successes.push(result.applicationResult);
              }
            } catch (error) {
              outcomes.push(errorOutput(error));
            }
          }
          const memoryIds = successes.map((result) => result.memoryId);
          return {
            output: {
              ok: outcomes.length === successes.length,
              operation: "batch_saved",
              results: outcomes,
            },
            ...(memoryIds.length > 0
              ? {
                  applicationResult: {
                    kind: "memory_batch" as const,
                    memoryIds,
                    deletedMemoryCount: 0,
                  },
                }
              : {}),
          };
        }

        if (call.function.name === "delete_memory") {
          return await deleteMemory(memoryIdSchema.parse(args).memoryId);
        }

        if (call.function.name === "delete_memories") {
          const input = memoryIdsSchema.parse(args);
          const allowListed = explicitClearAllMemoryRequest();
          for (const memoryId of input.memoryIds) {
            requireSafeMemoryTarget(memoryId, allowListed);
          }
          const deleted: Array<Extract<ThoughtApplicationResult, { kind: "memory" }>> = [];
          for (const memoryId of input.memoryIds) {
            const result = await deleteMemory(memoryId, allowListed);
            if (result.applicationResult?.kind === "memory") {
              deleted.push(result.applicationResult);
            }
          }
          const memoryIds = deleted.map((result) => result.memoryId);
          return {
            output: {
              ok: true,
              operation: "batch_deleted",
              deletedMemoryIds: memoryIds,
              deletedMemoryCount: deleted.reduce(
                (total, result) => total + (result.deletedMemoryCount ?? 0),
                0,
              ),
            },
            applicationResult: {
              kind: "memory_batch",
              memoryIds,
              deletedMemoryCount: deleted.reduce(
                (total, result) => total + (result.deletedMemoryCount ?? 0),
                0,
              ),
            },
          };
        }

        if (call.function.name === "find_reminders") {
          const input = findRemindersSchema.parse(args);
          const conditions = [
            eq(reminders.userId, context.userId),
            eq(reminders.conversationId, context.conversationId),
          ];
          if (input.status) conditions.push(eq(reminders.status, input.status));
          if (input.query !== null) {
            conditions.push(
              or(
                ilike(reminders.title, `%${input.query}%`),
                ilike(reminders.originalRequest, `%${input.query}%`),
              )!,
            );
          }
          const records = await database
            .select()
            .from(reminders)
            .where(and(...conditions))
            .orderBy(desc(reminders.updatedAt))
            .limit(input.limit ?? 50);
          for (const record of records) retrievedReminderIds.add(record.id);
          const resolution = resolveMutationTarget(
            context.originalRequest,
            records.map((record) => ({ id: record.id, label: record.title })),
          );
          return {
            output: {
              ok: true,
              reminders: records.map(reminderRecord),
              targetResolution: rememberResolution(
                resolution,
                allowedReminderIds,
              ),
            },
          };
        }

        if (call.function.name === "save_reminder") {
          const input = saveReminderSchema.parse(args);
          const action = reminderActionSchema.parse({
            operation: input.operation,
            targetReminderRef: input.reminderId ?? null,
            title: input.title ?? null,
            scheduleKind:
              input.scheduleKind ??
              (input.localDateTime ? "at" : undefined) ??
              (input.delayAmount !== undefined || input.delayUnit !== undefined
                ? "after"
                : null),
            localDateTime: input.localDateTime ?? null,
            delayAmount: input.delayAmount ?? null,
            delayUnit: input.delayUnit ?? null,
            recurrence:
              input.recurrence ??
              (input.operation === "create" ? "none" : "unchanged"),
          });
          if (action.operation !== "create") {
            if (!action.targetReminderRef) {
              throw invalidReminderAction(
                "The reminder operation needs an existing reminder target.",
              );
            }
            requireSafeReminderTarget(action.targetReminderRef);
          }
          const result = await reminderResult(action);
          if (action.targetReminderRef) {
            mutatedReminderIds.add(action.targetReminderRef);
          }
          return result;
        }

        if (call.function.name === "delete_reminder") {
          const input = reminderIdSchema.parse(args);
          requireSafeReminderTarget(input.reminderId);
          const result = await reminderResult({
            operation: "delete",
            targetReminderRef: input.reminderId,
            title: null,
            scheduleKind: null,
            localDateTime: null,
            delayAmount: null,
            delayUnit: null,
            recurrence: "unchanged",
          });
          mutatedReminderIds.add(input.reminderId);
          return result;
        }

        return {
          output: {
            ok: false,
            code: "UNKNOWN_TOOL",
            error: `Unknown application tool ${call.function.name}.`,
          },
        };
      } catch (error) {
        if (
          error instanceof z.ZodError ||
          isInvalidMemoryActionError(error) ||
          isInvalidReminderActionError(error)
        ) {
          return { output: errorOutput(error) };
        }
        throw error;
      }
    },
  };
}
