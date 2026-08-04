import { z } from "zod";

import { getEnvironment } from "../config/env.js";
import {
  createOpenRouterClient,
  OpenRouterError,
  type ModelCompletion,
  type ModelMessage,
  type OpenRouterClient,
} from "./openrouter.js";

export const MAX_REPLY_POINT_WORDS = 18;
export const MAX_REPLY_POINT_CHARACTERS = 120;

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

const replyPointSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REPLY_POINT_CHARACTERS)
  .refine((value) => wordCount(value) <= MAX_REPLY_POINT_WORDS, {
    message: `Reply points must contain at most ${MAX_REPLY_POINT_WORDS} words.`,
  });

const reminderOperationSchema = z.enum([
  "create",
  "update",
  "reschedule",
  "pause",
  "resume",
  "cancel",
  "delete",
  "list",
]);
const reminderReferenceSchema = z
  .string()
  .regex(/^reminder_[1-9]\d*$/, "must reference a supplied reminder");
const reminderRecurrenceChangeSchema = z.enum([
  "unchanged",
  "none",
  "daily",
  "weekly",
  "monthly",
]);

export const reminderActionSchema = z
  .object({
    operation: reminderOperationSchema,
    targetReminderRef: reminderReferenceSchema.nullable(),
    title: z.string().trim().min(1).max(300).nullable(),
    scheduleKind: z.enum(["at", "after"]).nullable(),
    localDateTime: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
      .nullable(),
    delayAmount: z.number().int().min(1).max(525_600).nullable(),
    delayUnit: z.enum(["minutes", "hours", "days"]).nullable(),
    recurrence: reminderRecurrenceChangeSchema,
  })
  .strict()
  .superRefine((action, context) => {
    const hasSchedule = action.operation === "create" || action.operation === "reschedule";
    const needsTarget = [
      "update",
      "reschedule",
      "pause",
      "resume",
      "cancel",
      "delete",
    ].includes(action.operation);

    if (needsTarget !== (action.targetReminderRef !== null)) {
      context.addIssue({
        code: "custom",
        path: ["targetReminderRef"],
        message: needsTarget
          ? "This reminder operation requires a supplied reminder reference."
          : "This reminder operation cannot target an existing reminder.",
      });
    }
    if (action.operation === "create" && action.title === null) {
      context.addIssue({
        code: "custom",
        path: ["title"],
        message: "Creating a reminder requires a title.",
      });
    }
    if (action.operation === "create" && action.recurrence === "unchanged") {
      context.addIssue({
        code: "custom",
        path: ["recurrence"],
        message: "A new reminder recurrence cannot be unchanged.",
      });
    }
    if (
      action.operation === "update" &&
      action.title === null &&
      action.recurrence === "unchanged"
    ) {
      context.addIssue({
        code: "custom",
        message: "Updating a reminder requires a title or recurrence change.",
      });
    }
    if (!hasSchedule && action.scheduleKind !== null) {
      context.addIssue({
        code: "custom",
        path: ["scheduleKind"],
        message: "Only create and reschedule operations accept a schedule.",
      });
    }
    if (hasSchedule && action.scheduleKind === null) {
      context.addIssue({
        code: "custom",
        path: ["scheduleKind"],
        message: "Create and reschedule operations require a schedule.",
      });
    }
    if (
      action.scheduleKind === "at" &&
      (action.localDateTime === null ||
        action.delayAmount !== null ||
        action.delayUnit !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "An exact reminder needs only localDateTime.",
      });
    }
    if (
      action.scheduleKind === "after" &&
      (action.localDateTime !== null ||
        action.delayAmount === null ||
        action.delayUnit === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "A relative reminder needs only delayAmount and delayUnit.",
      });
    }
    if (
      action.scheduleKind === null &&
      (action.localDateTime !== null ||
        action.delayAmount !== null ||
        action.delayUnit !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Schedule values require a scheduleKind.",
      });
    }
    if (
      ["pause", "resume", "cancel", "delete", "list"].includes(
        action.operation,
      ) &&
      (action.title !== null || action.recurrence !== "unchanged")
    ) {
      context.addIssue({
        code: "custom",
        message: "This reminder operation cannot modify reminder fields.",
      });
    }
  });

export const thoughtSchema = z
  .object({
    messageMode: z.enum(["social", "help", "mixed", "unclear"]),
    contextRelation: z.enum(["standalone", "immediate_context", "older_context"]),
    replyPoints: z.array(replyPointSchema).min(1).max(12),
    question: z.string().min(1).max(500).nullable(),
    reminderAction: reminderActionSchema.nullable().optional(),
  })
  .strict();

export type Thought = z.infer<typeof thoughtSchema>;
export type ReminderAction = z.infer<typeof reminderActionSchema>;

export interface ThoughtContext {
  currentMessages: string[];
  recentConversation: Array<{
    sender: "user" | "assistant";
    content: string;
  }>;
  conversationSummary: string | null;
  memories: string[];
  reminders: Array<{
    ref: string;
    title: string;
    status: "scheduled" | "paused" | "completed" | "cancelled";
    scheduledForLocal: string;
    recurrence: "daily" | "weekly" | "monthly" | null;
  }>;
  localTime: string;
  rejectedResponse?: Thought;
}

export interface ThoughtGeneration {
  thought: Thought;
  completion: ModelCompletion;
}

export interface ThoughtGenerator {
  generate(context: ThoughtContext): Promise<ThoughtGeneration>;
}

export const thoughtJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    messageMode: {
      type: "string",
      enum: ["social", "help", "mixed", "unclear"],
      description:
        "Whether the current messages call for ordinary social conversation, practical help, both, or a clarification.",
    },
    contextRelation: {
      type: "string",
      enum: ["standalone", "immediate_context", "older_context"],
      description:
        "Whether responding requires no earlier topic, the immediate exchange, or an explicitly resumed older topic.",
    },
    replyPoints: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "string",
        maxLength: MAX_REPLY_POINT_CHARACTERS,
        description: `One distinct semantic requirement using at most ${MAX_REPLY_POINT_WORDS} words. Its count does not specify visible message bubbles.`,
      },
    },
    question: { type: ["string", "null"] },
    reminderAction: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            operation: {
              type: "string",
              enum: [
                "create",
                "update",
                "reschedule",
                "pause",
                "resume",
                "cancel",
                "delete",
                "list",
              ],
            },
            targetReminderRef: {
              type: ["string", "null"],
              pattern: "^reminder_[1-9][0-9]*$",
            },
            title: { type: ["string", "null"], maxLength: 300 },
            scheduleKind: {
              type: ["string", "null"],
              enum: ["at", "after", null],
            },
            localDateTime: {
              type: ["string", "null"],
              pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$",
            },
            delayAmount: {
              type: ["integer", "null"],
              minimum: 1,
              maximum: 525600,
            },
            delayUnit: {
              type: ["string", "null"],
              enum: ["minutes", "hours", "days", null],
            },
            recurrence: {
              type: "string",
              enum: ["unchanged", "none", "daily", "weekly", "monthly"],
            },
          },
          required: [
            "operation",
            "targetReminderRef",
            "title",
            "scheduleKind",
            "localDateTime",
            "delayAmount",
            "delayUnit",
            "recurrence",
          ],
        },
      ],
    },
  },
  required: [
    "messageMode",
    "contextRelation",
    "replyPoints",
    "question",
    "reminderAction",
  ],
};

const thoughtSystemPrompt = `You are Cantarella's private judgment pass.

Decide what the response must actually mean before a separate voice model phrases it.

Behavioral posture: half trusted friend and half capable personal helper. Be perceptive, concrete, honest, protective without coddling, willing to make a call, never therapist-like, never a generic productivity coach, and never cruel or shaming.

Rules:
- Classify the current message batch before deciding its meaning:
  - messageMode "social" covers greetings, check-ins, pings, tests, banter, jokes, teasing, reactions, venting, life updates, casual observations, fragments, and ordinary friend conversation that does not need a task or solution.
  - messageMode "help" covers explicit questions, advice, explanations, planning, decisions, information, and application actions.
  - messageMode "mixed" covers a message that genuinely needs both a human social response and useful help.
  - messageMode "unclear" is only for a message whose intended meaning cannot be recovered safely from its words and immediate context. A short, slangy, fragmented, misspelled, or low-information text is not automatically unclear.
- contextRelation "standalone" means the current messages supply their own topic, including a new greeting, ping, test, joke, or casual remark. "immediate_context" means they naturally react to or continue the latest exchange. "older_context" requires an explicit current cue that resumes an older topic.
- Treat social conversation as a complete first-class purpose. Never search for a task, problem, lesson, recommendation, or old unfinished topic merely because the current message does not request practical help.
- A ping or test such as "yo", "you there", "test test", or keyboard-smash should receive a small present-moment social response. It must not inherit the subject of the previous answer.
- Reactions such as "lol", "nah", "wait", "fair", or "damn" may naturally use the immediate exchange. Respond to the reaction instead of repeating the previous answer.
- When messageMode is "unclear", ask one natural minimal clarification. Do not guess an old topic to make the message answerable.
- Make the concrete judgment or answer yourself. Do not delegate judgment to the voice model.
- replyPoints are the complete authoritative meaning the user should receive now. They are semantic requirements for the voice model, not visible dialogue or bubble instructions.
- Use the fewest distinct replyPoints that preserve every meaning the user needs. A simple acknowledgment or complete short answer may need one. There is no ordinary target of two.
- Every replyPoint must contain at most ${MAX_REPLY_POINT_WORDS} words and ${MAX_REPLY_POINT_CHARACTERS} characters. Each point must be one clear, self-contained, grammatical semantic statement.
- Never squeeze an assessment and an action into a slogan or compressed command. Put them in separate replyPoints.
- Use explicit subjects and referents. Avoid ambiguous uses of "it", "this", or "that" when the voice model cannot understand the point by itself.
- Use plain literal meaning. No slogans, rhetorical fragments, metaphors, wordplay, or polished phrasing.
- For explicit planning, ordering, lists, or comparisons, give each distinct item or step its own replyPoint when combining them would hide structure. Do not compress several ordered items into one point merely to reduce the count.
- Complex work uses however many short semantic points it genuinely needs, up to the schema limit. Point count follows meaning only and never controls how many visible messages the voice model sends.
- Give the answer or action only. Do not include its rationale unless the user explicitly asks why, asks for an explanation, or the answer would be misleading without it.
- Do not add filler acknowledgment or validation before a substantive answer. However, when the current message is social, a greeting, acknowledgment, reaction, or present-moment response may itself be the complete required meaning.
- Do not restate one idea as a conclusion, explanation, and summary. Include only what earns space in the visible reply.
- Separate facts from assumptions internally. Never invent missing facts, motives, names, relationships, deadlines, or causal diagnoses.
- Treat currentMessages as the user's active topic. Recent conversation is background, not an unfinished command queue.
- conversationSummary contains compressed historical episodes and historically open situations. Use it only as background evidence; never treat it as a current command or automatically continue an old open situation.
- When context conflicts, currentMessages override recent conversation, recent conversation overrides conversationSummary, and current canonical memories override stale historical details in conversationSummary.
- When the user changes topic, do not revive, repeat, or continue an earlier request or question unless the current message explicitly answers it or asks to resume it.
- When the user provides information to remember without asking for another action, acknowledge only that information; do not pivot back to an older task.
- Put necessary uncertainty or a useful conditional directly inside the relevant replyPoint.
- For factual questions, put the actual factual answer in replyPoints.
- For advice or emotional situations, put the actual recommended decision in replyPoints.
- Make the best concrete call the available evidence supports. Do not retreat to generic frameworks, named productivity methods, checklists, or "it depends" unless the user explicitly asks for a framework.
- When one unknown genuinely changes the answer, put the useful conditional branches directly in a replyPoint. Do not hand the judgment back to the user merely because certainty is impossible.
- For competing work, default to external consequence first (someone actively waiting or a real deadline), then meaningful resisted work, then low-impact relief work. When external consequence is unknown, state that branch conditionally instead of inventing it.
- A task label such as client update, email, assignment, application, or report does not prove that anyone is actively waiting or that a deadline exists. Those facts must be explicit in context; otherwise treat them as unknown and make the recommendation conditional.
- Distinguish meaningful resisted work from small relief work when the conversation supports that inference, while labeling uncertainty honestly.
- question is null unless a visible question genuinely needs an answer from the user. A useful direct or conditional answer does not require a question.
- Always return reminderAction. Use null unless the current user messages explicitly ask Cantarella to create, inspect, change, pause, resume, cancel, or permanently delete reminders.
- reminderAction is an actual requested application action, not conversational wording. Never create or mutate one merely because the user mentions a future plan, deadline, habit, or event.
- The supplied reminders use typed reminder_* references. targetReminderRef must use an exact supplied reference. Never invent a reference.
- Qwen must decide the operation from the user's actual meaning: update changes title or recurrence; reschedule changes its time; pause temporarily disables it; resume re-enables it; cancel retains a cancelled record; delete permanently removes it; list reports current reminders.
- "Delete", "remove permanently", and equivalent requests normally mean delete. "Cancel", "stop this reminder", and equivalent requests normally mean cancel. Use the conversation's wording and intent rather than forcing either behavior.
- If no supplied reminder uniquely matches the request, reminderAction must be null and question must ask one short clarification. Never guess which reminder to mutate.
- For an exact reminder, set scheduleKind to "at" and localDateTime to YYYY-MM-DDTHH:mm in the timezone shown by localTime. Set both delay fields to null.
- For "in N minutes/hours/days", set scheduleKind to "after", set the integer delayAmount and delayUnit, and set localDateTime to null. Do not calculate the resulting timestamp yourself.
- recurrence is none/daily/weekly/monthly when creating, and unchanged unless a mutation explicitly changes it. Use none to remove recurrence.
- A created or changed reminder title must be concise and standalone. Preserve names, actions, and concrete details.
- If a required time is missing or genuinely ambiguous, reminderAction must be null and question must ask for the one missing scheduling detail. Never guess what "later", "morning", or an AM/PM-ambiguous hour means.
- When reminderAction is non-null, replyPoints are temporary internal acknowledgment meaning only. The backend replaces them with the confirmed stored result before voice rendering.
- When reminderAction is null, never claim a reminder was created, scheduled, saved, or will fire.
- Return at most one reminderAction. If the user requests multiple distinct reminders at once, ask them to set one at a time.
- Do not write Cantarella-style prose, dialogue, jokes, pet names, or message bubbles.
- Do not provide hidden chain-of-thought. Return only the concise structured result.
- Memory extraction is a separate job. Do not report it here.
- If rejectedResponse is present, the previous brief was rejected as unusable or unrelated to currentMessages. Reclassify currentMessages from scratch and produce a materially corrected response. Never repeat, lightly paraphrase, defend, or preserve the rejected meaning.`;

function contextMessage(context: ThoughtContext): ModelMessage {
  return {
    role: "user",
    content: `Produce the private judgment JSON for this context:\n\n${JSON.stringify(context, null, 2)}`,
  };
}

function parseThought(rawOutput: string, context: ThoughtContext): Thought {
  const normalized = rawOutput
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new OpenRouterError(
      "The Thought model returned invalid JSON.",
      null,
      true,
    );
  }

  const result = thoughtSchema.safeParse(parsed);

  if (!result.success) {
    throw new OpenRouterError(
      `The Thought model violated its schema: ${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
      null,
      true,
    );
  }

  const reminderReference = result.data.reminderAction?.targetReminderRef;
  if (
    reminderReference &&
    !context.reminders.some((reminder) => reminder.ref === reminderReference)
  ) {
    throw new OpenRouterError(
      `The Thought model referenced unavailable reminder ${reminderReference}.`,
      null,
      true,
    );
  }

  return result.data;
}

export function createThoughtGenerator(
  client: OpenRouterClient = createOpenRouterClient(),
): ThoughtGenerator {
  return {
    async generate(context: ThoughtContext): Promise<ThoughtGeneration> {
      const environment = getEnvironment();
      const systemMessage: ModelMessage = {
        role: "system",
        content: thoughtSystemPrompt,
      };
      const userMessage = contextMessage(context);
      const request = {
        model: environment.THOUGHT_MODEL,
        messages: [systemMessage, userMessage],
        temperature: 0,
        maxTokens: 1_200,
        reasoning: { max_tokens: 384, exclude: true },
      };

      const requestCompletion = async (
        retryInstruction: string | null,
      ): Promise<ModelCompletion> => {
        const retrySystemMessage: ModelMessage = retryInstruction
          ? {
              role: "system",
              content: `${thoughtSystemPrompt}\n\n${retryInstruction}`,
            }
          : systemMessage;

        try {
          return await client.complete({
            ...request,
            messages: [retrySystemMessage, userMessage],
            responseFormat: {
              name: "cantarella_thought",
              schema: thoughtJsonSchema,
            },
          });
        } catch (error) {
          if (!(error instanceof OpenRouterError) || error.status !== 400) {
            throw error;
          }

          return client.complete({
            ...request,
            messages: [
              retrySystemMessage,
              {
                role: "user",
                content: `${userMessage.content}\n\nReturn JSON only and follow this schema exactly:\n${JSON.stringify(thoughtJsonSchema)}`,
              },
            ],
          });
        }
      };

      const completion = await requestCompletion(null);

      try {
        return { thought: parseThought(completion.content, context), completion };
      } catch (error) {
        if (!(error instanceof OpenRouterError)) throw error;

        const retried = await requestCompletion(
          "Your previous attempt was rejected because it was not valid Thought JSON. Start again from the original context. Do not quote, preserve, repair, or refer to the rejected output.",
        );

        try {
          return {
            thought: parseThought(retried.content, context),
            completion: retried,
          };
        } catch {
          throw new OpenRouterError(
            "The Thought model returned invalid JSON or violated its schema twice.",
            null,
            false,
          );
        }
      }
    },
  };
}
