import { z } from "zod";

import { getEnvironment } from "../config/env.js";
import {
  createOpenRouterClient,
  OpenRouterError,
  type ModelCompletion,
  type ModelMessage,
  type OpenRouterClient,
} from "../models/openrouter.js";

const memoryTypeSchema = z.enum([
  "profile",
  "preference",
  "relationship",
  "boundary",
  "situation",
  "event",
]);

const messageReferenceSchema = z
  .string()
  .regex(/^message_[1-9]\d*$/, "must reference a supplied USER MESSAGE");
const memoryReferenceSchema = z
  .string()
  .regex(/^memory_[1-9]\d*$/, "must reference a supplied EXISTING MEMORY");

const memoryCandidateSchema = z
  .object({
    action: z.enum(["add", "reinforce", "correct"]),
    targetMemoryId: z.string().uuid().nullable(),
    type: memoryTypeSchema,
    canonicalText: z.string().trim().min(1).max(500),
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    expiresAt: z.string().trim().min(1).nullable(),
    sourceMessageIds: z.array(z.string().uuid()).min(1).max(12),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.action === "add" && candidate.targetMemoryId !== null) {
      context.addIssue({
        code: "custom",
        path: ["targetMemoryId"],
        message: "add candidates cannot target an existing memory",
      });
    }

    if (candidate.action !== "add" && candidate.targetMemoryId === null) {
      context.addIssue({
        code: "custom",
        path: ["targetMemoryId"],
        message: "reinforce and correct candidates require a target memory",
      });
    }
  });

const memoryPolicyCandidateSchema = z
  .object({
    action: z.enum(["add", "reinforce", "correct"]),
    targetMemoryRef: memoryReferenceSchema.nullable(),
    type: memoryTypeSchema,
    canonicalText: z.string().trim().min(1).max(500),
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    expiresAt: z.string().trim().min(1).nullable(),
    sourceMessageRefs: z.array(messageReferenceSchema).min(1).max(12),
  })
  .strict()
  .superRefine((candidate, context) => {
    if (candidate.action === "add" && candidate.targetMemoryRef !== null) {
      context.addIssue({
        code: "custom",
        path: ["targetMemoryRef"],
        message: "add candidates cannot target an existing memory",
      });
    }

    if (candidate.action !== "add" && candidate.targetMemoryRef === null) {
      context.addIssue({
        code: "custom",
        path: ["targetMemoryRef"],
        message: "reinforce and correct candidates require a target memory",
      });
    }
  });

const memoryPolicyOutputSchema = z
  .object({
    candidates: z.array(memoryPolicyCandidateSchema).max(8),
  })
  .strict();

const memoryPlanSchema = z
  .object({
    candidates: z.array(memoryCandidateSchema).max(8),
  })
  .strict();

export type MemoryType = z.infer<typeof memoryTypeSchema>;
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;
export type MemoryPlan = z.infer<typeof memoryPlanSchema>;

export interface MemoryTemporalContext {
  timezone: string;
  referenceInstantUtc: string;
  currentLocalDate: string;
  currentLocalDateTime: string;
}

export interface MemoryPolicyContext {
  temporalContext: MemoryTemporalContext;
  userMessages: Array<{
    id: string;
    content: string;
    createdAtUtc: string;
    createdAtLocal: string;
  }>;
  existingMemories: Array<{
    id: string;
    type: MemoryType;
    canonicalText: string;
    importance: number;
    confidence: number;
    expiresAt: string | null;
    similarity: number;
  }>;
}

export interface MemoryPolicyGeneration {
  plan: MemoryPlan;
  completion: ModelCompletion;
}

export interface MemoryPolicyGenerator {
  generate(context: MemoryPolicyContext): Promise<MemoryPolicyGeneration>;
}

export const memoryPlanJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["add", "reinforce", "correct"] },
          targetMemoryRef: {
            type: ["string", "null"],
            pattern: "^memory_[1-9][0-9]*$",
          },
          type: {
            type: "string",
            enum: [
              "profile",
              "preference",
              "relationship",
              "boundary",
              "situation",
              "event",
            ],
          },
          canonicalText: { type: "string", minLength: 1, maxLength: 500 },
          importance: { type: "number", minimum: 0, maximum: 1 },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          expiresAt: { type: ["string", "null"] },
          sourceMessageRefs: {
            type: "array",
            minItems: 1,
            maxItems: 12,
            items: {
              type: "string",
              pattern: "^message_[1-9][0-9]*$",
            },
          },
        },
        required: [
          "action",
          "targetMemoryRef",
          "type",
          "canonicalText",
          "importance",
          "confidence",
          "expiresAt",
          "sourceMessageRefs",
        ],
      },
    },
  },
  required: ["candidates"],
};

export class MemoryPolicyOutputError extends OpenRouterError {
  constructor(
    message: string,
    public readonly rawOutput: string,
  ) {
    super(message, null, true);
    this.name = "MemoryPolicyOutputError";
  }
}

const memoryPolicyPrompt = `You are Cantarella's private long-term memory policy.

Read only the supplied USER MESSAGES as new evidence. Cantarella's own replies are deliberately absent and can never prove a user fact.

Return durable memory operations, not a conversation reply.

Write a candidate only when the information is likely to improve a future answer because it is stable, explicitly important, a meaningful relationship fact, a user boundary, a repeated pattern, or a genuinely ongoing situation.

Never store:
- greetings, jokes, conversational filler, or a one-off passing mood
- ordinary short-lived plans, errands, tasks, or tomorrow's schedule
- an inference about motives, personality, health, diagnosis, trauma, or relationships that the user did not state
- passwords, API keys, access tokens, financial identifiers, authentication data, or other secrets
- a fact asserted only by Cantarella
- the same fact twice

Types:
- profile: stable facts about the user's identity or life
- preference: stable likes, dislikes, and interaction preferences
- relationship: durable facts about named people and relationships
- boundary: explicit limits Cantarella should respect
- situation: ongoing but temporary context; expiresAt is required
- event: a meaningful past event worth remembering, not a routine daily action

Actions:
- add: a useful fact not represented by EXISTING MEMORIES; targetMemoryRef must be null
- reinforce: new user evidence supports the same fact; targetMemoryRef is required and canonicalText must preserve the existing fact's meaning
- correct: the user explicitly replaces or contradicts an existing fact; targetMemoryRef is required and canonicalText is the corrected replacement

References are typed and cannot be interchanged:
- sourceMessageRefs may contain only message_* references present under USER MESSAGES
- targetMemoryRef may contain only a memory_* reference present under EXISTING MEMORIES
- never copy a memory_* reference into sourceMessageRefs

Every sourceMessageRef must point to a USER MESSAGE that directly supports the candidate. A correction requires explicit user evidence; semantic similarity alone is not contradiction.

canonicalText must be a short, neutral, standalone fact with explicit referents. Do not imitate Cantarella's voice. Do not include reasoning.

Relative-time rules:
- Interpret today, tomorrow, yesterday, weekdays, and other relative dates in TEMPORAL CONTEXT.timezone.
- For each fact, anchor relative language to its source USER MESSAGE.createdAtLocal. Never derive its calendar date from createdAtUtc.
- TEMPORAL CONTEXT.currentLocalDate is the local calendar date of the newest supplied user message and is the default reference date for the batch.
- When canonicalText makes a relative date explicit, use the resolved local calendar date.
- expiresAt must be an absolute ISO-8601 timestamp with an offset or Z that represents the intended expiry instant.

importance and confidence are decimals from 0 to 1. confidence measures how directly the user established the fact. expiresAt is an ISO-8601 timestamp or null. Return {"candidates":[]} when nothing earns durable storage.`;

interface MemoryPolicyReferenceContext {
  modelContext: {
    temporalContext: MemoryTemporalContext;
    userMessages: Array<{
      ref: string;
      content: string;
      createdAtUtc: string;
      createdAtLocal: string;
    }>;
    existingMemories: Array<{
      ref: string;
      type: MemoryType;
      canonicalText: string;
      importance: number;
      confidence: number;
      expiresAt: string | null;
      similarity: number;
    }>;
  };
  messageIdsByReference: Map<string, string>;
  memoryIdsByReference: Map<string, string>;
}

function referenceContext(
  context: MemoryPolicyContext,
): MemoryPolicyReferenceContext {
  const messageIdsByReference = new Map<string, string>();
  const memoryIdsByReference = new Map<string, string>();
  const userMessages = context.userMessages.map(({ id, ...message }, index) => {
    const ref = `message_${index + 1}`;
    messageIdsByReference.set(ref, id);
    return { ref, ...message };
  });
  const existingMemories = context.existingMemories.map(
    ({ id, ...memory }, index) => {
      const ref = `memory_${index + 1}`;
      memoryIdsByReference.set(ref, id);
      return { ref, ...memory };
    },
  );

  return {
    modelContext: {
      temporalContext: context.temporalContext,
      userMessages,
      existingMemories,
    },
    messageIdsByReference,
    memoryIdsByReference,
  };
}

function contextMessage(context: MemoryPolicyContext): ModelMessage {
  const references = referenceContext(context);
  return {
    role: "user",
    content: `Produce the memory-policy JSON for this context:\n\n${JSON.stringify(references.modelContext, null, 2)}`,
  };
}

export function parseMemoryPlan(
  rawOutput: string,
  context: MemoryPolicyContext,
): MemoryPlan {
  const normalized = rawOutput
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new MemoryPolicyOutputError(
      "The memory-policy model returned invalid JSON.",
      rawOutput,
    );
  }

  const result = memoryPolicyOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new MemoryPolicyOutputError(
      `The memory-policy model violated its schema: ${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
      rawOutput,
    );
  }

  const references = referenceContext(context);
  const candidates = result.data.candidates.map((candidate) => {
    const sourceMessageIds = candidate.sourceMessageRefs.map((reference) => {
      const id = references.messageIdsByReference.get(reference);
      if (!id) {
        throw new MemoryPolicyOutputError(
          `The memory-policy model returned unknown message reference ${reference}.`,
          rawOutput,
        );
      }
      return id;
    });
    const targetMemoryId = candidate.targetMemoryRef
      ? references.memoryIdsByReference.get(candidate.targetMemoryRef)
      : null;

    if (candidate.targetMemoryRef && !targetMemoryId) {
      throw new MemoryPolicyOutputError(
        `The memory-policy model returned unknown memory reference ${candidate.targetMemoryRef}.`,
        rawOutput,
      );
    }

    return {
      action: candidate.action,
      targetMemoryId: targetMemoryId ?? null,
      type: candidate.type,
      canonicalText: candidate.canonicalText,
      importance: candidate.importance,
      confidence: candidate.confidence,
      expiresAt: candidate.expiresAt,
      sourceMessageIds,
    };
  });

  return memoryPlanSchema.parse({ candidates });
}

export function createMemoryPolicyGenerator(
  client: OpenRouterClient = createOpenRouterClient(),
): MemoryPolicyGenerator {
  return {
    async generate(context) {
      const environment = getEnvironment();
      const userMessage = contextMessage(context);

      const request = async (retryInstruction: string | null) => {
        const systemContent = retryInstruction
          ? `${memoryPolicyPrompt}\n\n${retryInstruction}`
          : memoryPolicyPrompt;

        return client.complete({
          model: environment.THOUGHT_MODEL,
          messages: [
            { role: "system", content: systemContent },
            userMessage,
          ],
          temperature: 0,
          maxTokens: 2_000,
          responseFormat: {
            name: "cantarella_memory_plan",
            schema: memoryPlanJsonSchema,
          },
          reasoning: { max_tokens: 384, exclude: true },
        });
      };

      const firstCompletion = await request(null);

      let firstError: OpenRouterError | null = null;
      try {
        return {
          plan: parseMemoryPlan(firstCompletion.content, context),
          completion: firstCompletion,
        };
      } catch (error) {
        if (!(error instanceof OpenRouterError)) throw error;
        firstError = error;
      }

      const retryCompletion = await request(
        `Your previous response was invalid: ${firstError.message} Start over from the original context. Use only supplied message_* references for sourceMessageRefs and supplied memory_* references for targetMemoryRef. Return only one valid JSON object matching the required memory plan.`,
      );

      try {
        return {
          plan: parseMemoryPlan(retryCompletion.content, context),
          completion: retryCompletion,
        };
      } catch (error) {
        throw error;
      }
    },
  };
}
