import { z } from "zod";

import { getEnvironment } from "../config/env.js";
import {
  completeOpenRouter,
  isOpenRouterError,
  openRouterError,
  type ModelCompletion,
  type ModelMessage,
  type CompleteModel,
} from "../models/openrouter.js";

const summaryPlanSchema = z
  .object({
    summaryText: z.string().trim().min(1).max(1_600),
    openSituations: z.array(z.string().trim().min(1).max(240)).max(8),
  })
  .strict();

export type SummaryPlan = z.infer<typeof summaryPlanSchema>;

export interface SummaryPolicyContext {
  timezone: string;
  previousChunk: {
    summaryText: string;
    openSituations: string[];
  } | null;
  newMessages: Array<{
    id: string;
    turnId: string | null;
    sender: "user" | "assistant";
    content: string;
    createdAtLocal: string;
  }>;
}

export interface SummaryPolicyGeneration {
  plan: SummaryPlan;
  completion: ModelCompletion;
}

export const summaryPlanJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    summaryText: { type: "string", minLength: 1, maxLength: 1_600 },
    openSituations: {
      type: "array",
      maxItems: 8,
      items: { type: "string", minLength: 1, maxLength: 240 },
    },
  },
  required: ["summaryText", "openSituations"],
};

export type SummaryPolicyOutputError = Error & {
  rawOutput: string;
  retryable: boolean;
};

export function summaryPolicyOutputError(
  message: string,
  rawOutput: string,
): SummaryPolicyOutputError {
  const error = openRouterError(
    message,
    null,
    true,
  ) as unknown as SummaryPolicyOutputError;
  error.name = "SummaryPolicyOutputError";
  error.rawOutput = rawOutput;
  return error;
}

export function isSummaryPolicyOutputError(
  error: unknown,
): error is SummaryPolicyOutputError {
  return (
    isOpenRouterError(error) &&
    error.name === "SummaryPolicyOutputError" &&
    typeof (error as Partial<SummaryPolicyOutputError>).rawOutput === "string"
  );
}

const summaryPolicyPrompt = `You create immutable conversation-summary chunks for Cantarella.

Summarize only NEW MESSAGES. PREVIOUS CHUNK is reference context solely for resolving names, pronouns, callbacks, and continuing topics. Never merge, rewrite, or recompress the previous chunk into summaryText.

Preserve the details that may matter when this episode is retrieved later:
- concrete topics, events, decisions, advice, plans, constraints, corrections, and outcomes
- what the user asked for and what Cantarella actually answered or committed to
- named people, projects, places, dates, quantities, and meaningful causal context
- disagreement, uncertainty, and changes of direction

openSituations contains only unresolved threads created or still explicitly active in NEW MESSAGES: unanswered questions, pending decisions, promised follow-ups, unfinished plans, or ongoing situations. Do not carry an item merely because it appeared in PREVIOUS CHUNK; include it only when NEW MESSAGES show it remains active.

Discard greetings, filler, repeated wording, generic acknowledgments, and stylistic details that do not affect meaning. Do not invent motives, facts, resolutions, or future actions. Do not write dialogue or Cantarella's voice. Use neutral, information-dense prose with explicit referents. Resolve relative dates using each message's createdAtLocal and the supplied timezone when a date matters.

The output is historical background, never a pending command queue. Return only the required JSON.`;

function contextMessage(context: SummaryPolicyContext): ModelMessage {
  return {
    role: "user",
    content: `Create one immutable summary chunk from this context:\n\n${JSON.stringify(context, null, 2)}`,
  };
}

export function parseSummaryPlan(rawOutput: string): SummaryPlan {
  const normalized = rawOutput
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw summaryPolicyOutputError(
      "The summary model returned invalid JSON.",
      rawOutput,
    );
  }

  const result = summaryPlanSchema.safeParse(parsed);
  if (!result.success) {
    throw summaryPolicyOutputError(
      `The summary model violated its schema: ${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
      rawOutput,
    );
  }

  return result.data;
}

export async function generateSummaryPlan(
  context: SummaryPolicyContext,
  completeModel: CompleteModel = completeOpenRouter,
): Promise<SummaryPolicyGeneration> {
const environment = getEnvironment();
const userMessage = contextMessage(context);

const request = (retryInstruction: string | null) =>
  completeModel({
    model: environment.THOUGHT_MODEL,
    messages: [
      {
        role: "system",
        content: retryInstruction
          ? `${summaryPolicyPrompt}\n\n${retryInstruction}`
          : summaryPolicyPrompt,
      },
      userMessage,
    ],
    temperature: 0,
    maxTokens: 6_000,
    reasoning: { exclude: true },
    ...(environment.THOUGHT_MODEL.split(":", 1)[0] ===
    "deepseek/deepseek-v4-pro-0813"
      ? {}
      : {
          responseFormat: {
            name: "cantarella_conversation_summary_chunk",
            schema: summaryPlanJsonSchema,
          },
        }),
    ...(environment.THOUGHT_MODEL.split(":", 1)[0] ===
    "deepseek/deepseek-v4-pro-0813"
      ? {
          providerRouting: {
            order: ["deepseek"],
            allowFallbacks: true,
            maxPrice: { prompt: 3, completion: 5 },
          },
        }
      : {}),
  });

const firstCompletion = await request(null);
try {
  return {
    plan: parseSummaryPlan(firstCompletion.content),
    completion: firstCompletion,
  };
} catch (error) {
  if (!isOpenRouterError(error)) throw error;
}

const retryCompletion = await request(
  "Your previous response was malformed. Start again from the original context and return exactly one valid JSON object matching the required schema.",
);

try {
  return {
    plan: parseSummaryPlan(retryCompletion.content),
    completion: retryCompletion,
  };
} catch (error) {
  if (isSummaryPolicyOutputError(error)) {
    throw summaryPolicyOutputError(error.message, retryCompletion.content);
  }
  throw error;
}
}
