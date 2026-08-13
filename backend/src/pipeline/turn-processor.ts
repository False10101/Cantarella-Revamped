import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { toMessageSnapshot } from "../api/conversations/conversation.service.js";
import { getEnvironment } from "../config/env.js";
import { database } from "../db/client.js";
import {
  conversations,
  inputBatchMessages,
  inputBatches,
  jobs,
  messages,
  modelRuns,
  personas,
  turns,
  users,
  userSettings,
} from "../db/schema.js";
import { conversationEvents } from "../events/conversation-events.js";
import {
  createMemoryRetriever,
  type MemoryRetriever,
} from "../memory/memory-retrieval.js";
import {
  createThoughtGenerator,
  ThoughtContractError,
  type Thought,
  type ThoughtContext,
  type ThoughtGeneration,
  type ThoughtGenerator,
} from "../models/thought.js";
import {
  createVoiceGenerator,
  VoiceBriefRejectedError,
  VoiceOutputLeakageError,
  type VoiceGeneration,
  type VoiceGenerator,
} from "../models/voice.js";
import { createApplicationToolRuntime } from "../tools/application-tools.js";
import { orderRecentContextMessages } from "./message-order.js";
import {
  createSummaryRetriever,
  formatSummaryContext,
  type SummaryRetriever,
} from "../summary/summary-retrieval.js";

export interface ClaimedTurnJob {
  id: string;
  turnId: string;
  attemptCount: number;
  maxAttempts: number;
}

export class TurnDeferredError extends Error {
  constructor(public readonly runAt: Date) {
    super("The input batch is still collecting messages.");
    this.name = "TurnDeferredError";
  }
}

export class ObsoleteTurnJobError extends Error {
  constructor() {
    super("The turn job is already terminal.");
    this.name = "ObsoleteTurnJobError";
  }
}

interface PreparedTurn {
  turnId: string;
  batchId: string;
  conversationId: string;
  userId: string;
  timezone: string;
  persona: {
    name: string;
    voiceDirection:
      | "default"
      | "softer"
      | "firmer"
      | "playful"
      | "nurturing"
      | "intimate";
    customStyle: string;
    preferredUserName: string | null;
    endearmentPreference: string | null;
    boundaries: string[];
    version: number;
  };
}

function localTime(timezone: string, instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "long",
  }).format(instant);
}

async function prepareTurn(turnId: string): Promise<PreparedTurn> {
  return database.transaction(async (transaction) => {
    const [turnReference] = await transaction
      .select({ conversationId: turns.conversationId })
      .from(turns)
      .where(eq(turns.id, turnId))
      .limit(1);

    if (!turnReference) throw new ObsoleteTurnJobError();

    await transaction
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.id, turnReference.conversationId))
      .for("update");

    const [record] = await transaction
      .select({
        turnId: turns.id,
        turnStatus: turns.status,
        batchId: inputBatches.id,
        batchStatus: inputBatches.status,
        settleAt: inputBatches.settleAt,
        conversationId: conversations.id,
        userId: users.id,
        timezone: userSettings.timezone,
        personaName: personas.name,
        voiceDirection: personas.voiceDirection,
        customStyle: personas.customStyle,
        preferredUserName: personas.preferredUserName,
        endearmentPreference: personas.endearmentPreference,
        boundaries: personas.boundaries,
        personaVersion: personas.version,
      })
      .from(turns)
      .innerJoin(inputBatches, eq(inputBatches.id, turns.inputBatchId))
      .innerJoin(conversations, eq(conversations.id, turns.conversationId))
      .innerJoin(users, eq(users.id, conversations.ownerUserId))
      .innerJoin(userSettings, eq(userSettings.userId, users.id))
      .innerJoin(personas, eq(personas.userId, users.id))
      .where(eq(turns.id, turnId))
      .limit(1);

    if (!record || ["completed", "failed", "cancelled"].includes(record.turnStatus)) {
      throw new ObsoleteTurnJobError();
    }

    const now = new Date();
    if (record.batchStatus === "collecting" && record.settleAt > now) {
      throw new TurnDeferredError(record.settleAt);
    }

    await transaction
      .update(inputBatches)
      .set({
        status: "processing",
        sealedAt: now,
        updatedAt: now,
      })
      .where(eq(inputBatches.id, record.batchId));

    await transaction
      .update(turns)
      .set({
        status: "thinking",
        startedAt: now,
        errorCode: null,
        errorMessage: null,
        retryable: null,
        updatedAt: now,
      })
      .where(eq(turns.id, record.turnId));

    return {
      turnId: record.turnId,
      batchId: record.batchId,
      conversationId: record.conversationId,
      userId: record.userId,
      timezone: record.timezone,
      persona: {
        name: record.personaName,
        voiceDirection: record.voiceDirection,
        customStyle: record.customStyle,
        preferredUserName: record.preferredUserName,
        endearmentPreference: record.endearmentPreference,
        boundaries: record.boundaries,
        version: record.personaVersion,
      },
    };
  });
}

async function loadThoughtContext(
  prepared: PreparedTurn,
  memoryRetriever: MemoryRetriever,
  summaryRetriever: SummaryRetriever,
): Promise<{
  context: ThoughtContext;
  recentConversation: Array<{
    sender: "user" | "assistant";
    content: string;
  }>;
  sourceMessageId: string;
  referenceAt: Date;
  originalRequest: string;
}> {
  const batchMessages = await database
    .select({
      id: messages.id,
      content: messages.content,
      createdAt: messages.createdAt,
      position: inputBatchMessages.position,
    })
    .from(inputBatchMessages)
    .innerJoin(messages, eq(messages.id, inputBatchMessages.messageId))
    .where(eq(inputBatchMessages.batchId, prepared.batchId))
    .orderBy(asc(inputBatchMessages.position));

  if (batchMessages.length === 0) {
    throw new Error("The turn has no input messages.");
  }

  const batchMessageIds = batchMessages.map((message) => message.id);
  const referenceMessage = batchMessages.at(-1);
  if (!referenceMessage) throw new Error("The turn has no reference message.");
  const recentMessages = await database
    .select({
      id: messages.id,
      turnId: messages.turnId,
      role: messages.role,
      content: messages.content,
      createdAt: messages.createdAt,
      partIndex: messages.partIndex,
    })
    .from(messages)
    .leftJoin(turns, eq(turns.id, messages.turnId))
    .where(
      and(
        eq(messages.conversationId, prepared.conversationId),
        or(isNull(messages.turnId), eq(turns.status, "completed")),
        isNull(messages.deletedAt),
        inArray(messages.role, ["user", "assistant"]),
        notInArray(messages.id, batchMessageIds),
      ),
    )
    .orderBy(
      desc(messages.createdAt),
      sql`${messages.partIndex} desc nulls last`,
      desc(messages.id),
    )
    .limit(60);
  const orderedRecentMessages = orderRecentContextMessages(recentMessages);
  const summaryRetrieval = await summaryRetriever.retrieve({
    userId: prepared.userId,
    conversationId: prepared.conversationId,
    queryTexts: [],
    recentLimit: 2,
    relevantLimit: 0,
  });
  const reminderContext: ThoughtContext["reminders"] = [];
  const memoryContext: ThoughtContext["memories"] = [];

  const summaryCursorIndex = summaryRetrieval.latestEndMessageId
    ? orderedRecentMessages.findIndex(
        (message) => message.id === summaryRetrieval.latestEndMessageId,
      )
    : -1;
  const unsummarizedRecentMessages =
    summaryCursorIndex >= 0
      ? orderedRecentMessages.slice(summaryCursorIndex + 1)
      : orderedRecentMessages;
  const recentConversation = limitRecentContext(unsummarizedRecentMessages).map(
    (message) => ({
      sender: message.role as "user" | "assistant",
      content: message.content,
    }),
  );

  return {
    recentConversation,
    context: {
      currentMessages: batchMessages.map((message) => message.content),
      recentConversation,
      conversationSummary: formatSummaryContext(summaryRetrieval),
      memories: memoryContext,
      reminders: reminderContext,
      localTime: localTime(prepared.timezone, referenceMessage.createdAt),
    },
    sourceMessageId: referenceMessage.id,
    referenceAt: referenceMessage.createdAt,
    originalRequest: batchMessages.map((message) => message.content).join("\n"),
  };
}

export function limitRecentContext<T>(messagesToLimit: T[]): T[] {
  return messagesToLimit.slice(-12);
}

async function createModelRun(input: {
  job: ClaimedTurnJob;
  phase: "thought" | "voice";
  model: string;
  promptVersion: string;
  personaVersion: number;
  inputJson: Record<string, unknown>;
}): Promise<string> {
  const id = randomUUID();
  await database.insert(modelRuns).values({
    id,
    turnId: input.job.turnId,
    jobId: input.job.id,
    phase: input.phase,
    provider: "openrouter",
    model: input.model,
    promptVersion: input.promptVersion,
    personaVersion: input.personaVersion,
    status: "running",
    inputJson: input.inputJson,
  });
  return id;
}

async function completeModelRun(
  id: string,
  input: {
    provider: string | null;
    model: string;
    outputJson?: Record<string, unknown>;
    rawOutput: string;
    inputTokens: number | null;
    outputTokens: number | null;
    estimatedCostUsd: number | null;
    latencyMs: number;
  },
): Promise<void> {
  await database
    .update(modelRuns)
    .set({
      provider: input.provider ?? "openrouter",
      model: input.model,
      status: "completed",
      outputJson: input.outputJson,
      rawOutput: input.rawOutput,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      estimatedCostUsd: input.estimatedCostUsd,
      latencyMs: input.latencyMs,
      completedAt: new Date(),
    })
    .where(eq(modelRuns.id, id));
}

async function failModelRun(id: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await database
    .update(modelRuns)
    .set({
      status: "failed",
      rawOutput:
        error instanceof VoiceOutputLeakageError
          ? error.rawOutput.slice(0, 20_000)
          : error instanceof ThoughtContractError
            ? error.rawOutput.slice(0, 20_000)
          : undefined,
      errorCode: error instanceof Error ? error.name : "MODEL_ERROR",
      errorMessage: message.slice(0, 2_000),
      completedAt: new Date(),
    })
    .where(eq(modelRuns.id, id));
}

export interface TurnProcessor {
  process(job: ClaimedTurnJob): Promise<void>;
}

export function createTurnProcessor(dependencies: {
  thoughtGenerator?: ThoughtGenerator;
  voiceGenerator?: VoiceGenerator;
  memoryRetriever?: MemoryRetriever;
  summaryRetriever?: SummaryRetriever;
} = {}): TurnProcessor {
  const thoughtGenerator =
    dependencies.thoughtGenerator ?? createThoughtGenerator();
  const voiceGenerator = dependencies.voiceGenerator ?? createVoiceGenerator();
  const memoryRetriever =
    dependencies.memoryRetriever ?? createMemoryRetriever();
  const summaryRetriever =
    dependencies.summaryRetriever ?? createSummaryRetriever();

  return {
    async process(job) {
      const environment = getEnvironment();
      const prepared = await prepareTurn(job.turnId);
      const {
        context,
        sourceMessageId,
        referenceAt,
        originalRequest,
      } = await loadThoughtContext(
        prepared,
        memoryRetriever,
        summaryRetriever,
      );

      conversationEvents.publish(prepared.conversationId, {
        type: "turn.status",
        data: { turnId: prepared.turnId, status: "thinking" },
      });

      let voiceGeneration: VoiceGeneration | undefined;
      let rejectedResponse: Thought | undefined;
      const toolRuntime = createApplicationToolRuntime({
        userId: prepared.userId,
        conversationId: prepared.conversationId,
        turnId: prepared.turnId,
        sourceMessageId,
        originalRequest,
        timezone: prepared.timezone,
        referenceAt,
        memoryRetriever,
      });

      for (let generationAttempt = 1; generationAttempt <= 2; generationAttempt += 1) {
        const attemptContext: ThoughtContext = rejectedResponse
          ? { ...context, rejectedResponse }
          : context;
        const thoughtRunId = await createModelRun({
          job,
          phase: "thought",
          model: environment.THOUGHT_MODEL,
          promptVersion: "thought-v15-tools",
          personaVersion: prepared.persona.version,
          inputJson: { ...attemptContext, generationAttempt },
        });

        let thoughtGeneration: ThoughtGeneration;
        try {
          thoughtGeneration = await thoughtGenerator.generate(
            attemptContext,
            toolRuntime,
          );
          await completeModelRun(thoughtRunId, {
            provider: thoughtGeneration.completion.provider,
            model: thoughtGeneration.completion.model,
            outputJson: {
              ...thoughtGeneration.thought,
              toolExecutions: thoughtGeneration.toolExecutions ?? [],
            },
            rawOutput: thoughtGeneration.completion.content,
            inputTokens: thoughtGeneration.completion.usage.inputTokens,
            outputTokens: thoughtGeneration.completion.usage.outputTokens,
            estimatedCostUsd:
              thoughtGeneration.completion.usage.estimatedCostUsd,
            latencyMs: thoughtGeneration.completion.latencyMs,
          });
        } catch (error) {
          await failModelRun(thoughtRunId, error);
          throw error;
        }

        const applicationResults =
          thoughtGeneration.applicationResults ??
          (thoughtGeneration.applicationResult
            ? [thoughtGeneration.applicationResult]
            : []);
        const memoryResults = applicationResults.filter(
          (result) => result.kind === "memory",
        );
        const reminderResults = applicationResults.filter(
          (result) => result.kind === "reminder",
        );
        const latestMemoryResult = memoryResults.at(-1);
        const latestReminderResult = reminderResults.at(-1);
        const voiceBrief: Thought = {
          messageMode: thoughtGeneration.thought.messageMode,
          contextRelation: thoughtGeneration.thought.contextRelation,
          applicationActionDecision: "none",
          replyPoints: thoughtGeneration.thought.replyPoints,
          question: thoughtGeneration.thought.question,
        };

        await database
          .update(turns)
          .set({ status: "voicing", updatedAt: new Date() })
          .where(eq(turns.id, prepared.turnId));
        conversationEvents.publish(prepared.conversationId, {
          type: "turn.status",
          data: { turnId: prepared.turnId, status: "voicing" },
        });
        conversationEvents.publish(prepared.conversationId, {
          type: "typing.started",
          data: { conversationId: prepared.conversationId, sender: "assistant" },
        });

        const voiceRunId = await createModelRun({
          job,
          phase: "voice",
          model: environment.VOICE_MODEL,
          promptVersion: "voice-v10-contextual",
          personaVersion: prepared.persona.version,
          inputJson: {
            replyBrief: voiceBrief,
            currentMessages: context.currentMessages,
            recentConversation: context.recentConversation.slice(-6),
            authorityMode:
              applicationResults.length > 0
                ? "application"
                : voiceBrief.messageMode === "social"
                  ? "social"
                  : "grounded",
            personaVersion: prepared.persona.version,
            generationAttempt,
            reminderId:
              latestReminderResult?.reminderId ?? null,
            reminderIds: reminderResults.flatMap(
              (result) => result.reminderIds,
            ),
            memoryId:
              latestMemoryResult?.memoryId ?? null,
            deletedMemoryCount:
              memoryResults.reduce(
                (total, result) => total + (result.deletedMemoryCount ?? 0),
                0,
              ) || null,
          },
        });

        try {
          voiceGeneration = await voiceGenerator.generate({
            persona: prepared.persona,
            replyBrief: voiceBrief,
            currentMessages: context.currentMessages,
            recentConversation: context.recentConversation.slice(-6),
            successfulApplicationAction: applicationResults.length > 0,
          });
          await completeModelRun(voiceRunId, {
            provider: voiceGeneration.completion.provider,
            model: voiceGeneration.completion.model,
            rawOutput: voiceGeneration.rawOutput,
            inputTokens: voiceGeneration.completion.usage.inputTokens,
            outputTokens: voiceGeneration.completion.usage.outputTokens,
            estimatedCostUsd: voiceGeneration.completion.usage.estimatedCostUsd,
            latencyMs: voiceGeneration.completion.latencyMs,
          });
          break;
        } catch (error) {
          await failModelRun(voiceRunId, error);

          if (
            applicationResults.length > 0 ||
            error instanceof VoiceOutputLeakageError
          ) {
            const fallbackBubbles = [
              ...voiceBrief.replyPoints,
              ...(voiceBrief.question ? [voiceBrief.question] : []),
            ];
            voiceGeneration = {
              rawOutput: fallbackBubbles.join("\n"),
              bubbles: fallbackBubbles,
              completion: {
                content: fallbackBubbles.join("\n"),
                model: environment.VOICE_MODEL,
                provider: null,
                usage: {
                  inputTokens: null,
                  outputTokens: null,
                  estimatedCostUsd: null,
                },
                latencyMs: 0,
              },
            };
            break;
          }

          if (
            error instanceof VoiceBriefRejectedError &&
            generationAttempt === 1
          ) {
            rejectedResponse = thoughtGeneration.thought;
            conversationEvents.publish(prepared.conversationId, {
              type: "typing.stopped",
              data: {
                conversationId: prepared.conversationId,
                sender: "assistant",
              },
            });
            await database
              .update(turns)
              .set({ status: "thinking", updatedAt: new Date() })
              .where(eq(turns.id, prepared.turnId));
            conversationEvents.publish(prepared.conversationId, {
              type: "turn.status",
              data: { turnId: prepared.turnId, status: "thinking" },
            });
            continue;
          }

          throw error;
        }
      }

      if (!voiceGeneration) {
        throw new VoiceBriefRejectedError();
      }

      const deliveryStartedAt = new Date();
      const createdMessages = await database.transaction(async (transaction) => {
        const created = [];

        for (const [partIndex, content] of voiceGeneration.bubbles.entries()) {
          const [message] = await transaction
            .insert(messages)
            .values({
              id: randomUUID(),
              conversationId: prepared.conversationId,
              turnId: prepared.turnId,
              role: "assistant",
              kind: "chat",
              origin: "system",
              content,
              partIndex,
              createdAt: new Date(deliveryStartedAt.getTime() + partIndex),
            })
            .onConflictDoNothing()
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
        const lastMessage = created.at(-1);
        await transaction
          .update(turns)
          .set({ status: "completed", completedAt: now, updatedAt: now })
          .where(eq(turns.id, prepared.turnId));
        await transaction
          .update(inputBatches)
          .set({ status: "completed", updatedAt: now })
          .where(eq(inputBatches.id, prepared.batchId));
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
        await transaction
          .insert(jobs)
          .values({
            id: randomUUID(),
            kind: "summarize_conversation",
            payload: { turnId: prepared.turnId },
            status: "pending",
            priority: -20,
            runAt: now,
            maxAttempts: 3,
            dedupeKey: `summarize-conversation:${prepared.turnId}`,
          })
          .onConflictDoNothing();

        if (lastMessage) {
          await transaction
            .update(conversations)
            .set({ lastMessageAt: lastMessage.createdAt, updatedAt: now })
            .where(eq(conversations.id, prepared.conversationId));
        }

        return created;
      });

      for (const message of createdMessages) {
        conversationEvents.publish(prepared.conversationId, {
          type: "message.created",
          data: { message: toMessageSnapshot(message) },
        });
      }
      conversationEvents.publish(prepared.conversationId, {
        type: "typing.stopped",
        data: { conversationId: prepared.conversationId, sender: "assistant" },
      });
      conversationEvents.publish(prepared.conversationId, {
        type: "turn.completed",
        data: { turnId: prepared.turnId },
      });
    },
  };
}
