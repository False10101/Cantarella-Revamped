import { z } from "zod";

import { getEnvironment } from "../config/env.js";
import {
  createOpenRouterClient,
  OpenRouterError,
  type CompletionRequest,
  type ModelCompletion,
  type ModelFunctionTool,
  type ModelMessage,
  type ModelToolCall,
  type OpenRouterClient,
} from "./openrouter.js";

export const MAX_REPLY_POINT_WORDS = 18;
export const MAX_REPLY_POINT_CHARACTERS = 160;
export const THOUGHT_MAX_OUTPUT_TOKENS = 2_400;
const MAX_TOOL_CALLS_PER_RESPONSE = 3;

const thoughtMetaLeakPattern = /\b(?:chain[- ]of[- ]thought|hidden (?:analysis|reasoning)|system prompt|developer message|replyPoints|messageMode|contextRelation|applicationActionDecision|tool call|json schema)\b/i;
const applicationIntentPattern = /\b(?:remember|save|store|remind|schedule|reschedule|change|update|edit|pause|resume|cancel|delete|remove|forget)\b/i;
const mutationSuccessClaimPattern = /\b(?:(?:i(?:'ve| have)?|cantarella has|it (?:was|has been|is now)|the (?:memory|reminder) (?:was|has been|is now)|successfully)\s+(?:remembered|stored|saved|created|scheduled|rescheduled|updated|edited|paused|resumed|cancelled|deleted|removed|forgotten)|will remember)\b/i;
const memoryMaintenanceNarrationPattern = /(?:\b(?:memory|storage|stored)\b.{0,80}\b(?:save[ds]?|stor(?:e|ed)|update[ds]?|change[ds]?|remember(?:ed)?|delete[ds]?|remove[ds]?|forgot(?:ten)?)\b|\b(?:save[ds]?|stor(?:e|ed)|update[ds]?|change[ds]?|remember(?:ed)?|delete[ds]?|remove[ds]?|forgot(?:ten)?)\b.{0,80}\b(?:memory|storage|stored)\b|\bi(?:'ve| have| will|'ll)?\s+(?:saved|stored|updated|remembered)\b)/i;
const memoryStatusQuestionPattern = /\b(?:did|do|does|have|has|is|are|was|were|can|could|would|will|wont|won't|not gonna)\b.{0,60}\b(?:remember|memory|save|saved|store|stored|update|updated|delete|deleted|forget|forgot)\b/i;

function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function numericValues(value: string): Set<number> {
  const values = new Set<number>();
  const pattern = /\b(\d[\d,]*(?:\.\d+)?)\s*(k)?\b/gi;
  for (const match of value.matchAll(pattern)) {
    const rawNumber = match[1];
    if (!rawNumber) continue;
    const parsed = Number(rawNumber.replaceAll(",", ""));
    if (!Number.isFinite(parsed)) continue;
    values.add(match[2] ? parsed * 1_000 : parsed);
  }
  return values;
}

function hasCorrectionCue(value: string): boolean {
  return /\b(?:mb|my bad|actually|wait|i meant|meant|make that|correction|sorry|no)\b/i.test(
    value,
  );
}

const replyPointSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REPLY_POINT_CHARACTERS)
  .refine((value) => wordCount(value) <= MAX_REPLY_POINT_WORDS, {
    message: `Reply points must contain at most ${MAX_REPLY_POINT_WORDS} words.`,
  })
  .refine((value) => !thoughtMetaLeakPattern.test(value), {
    message: "Reply points cannot contain model instructions, schema labels, or hidden reasoning.",
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
const memoryReferenceSchema = z
  .string()
  .regex(/^memory_[1-9]\d*$/, "must reference a supplied memory");

export const memoryActionSchema = z
  .object({
    operation: z.enum(["edit", "delete"]),
    targetMemoryRef: memoryReferenceSchema,
    replacementText: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((action, context) => {
    if (action.operation === "edit" && action.replacementText === null) {
      context.addIssue({
        code: "custom",
        path: ["replacementText"],
        message: "Editing a memory requires replacement text.",
      });
    }
    if (action.operation === "delete" && action.replacementText !== null) {
      context.addIssue({
        code: "custom",
        path: ["replacementText"],
        message: "Deleting a memory cannot include replacement text.",
      });
    }
  });

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
      [
        "pause",
        "resume",
        "cancel",
        "delete",
        "list",
      ].includes(
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
    applicationActionDecision: z.enum(["none", "clarify"]),
    replyPoints: z.array(replyPointSchema).min(1).max(12),
    question: z.string().trim().min(1).max(500).nullable(),
  })
  .strict()
  .superRefine((thought, context) => {
    if (
      thought.applicationActionDecision === "clarify" &&
      thought.question === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["question"],
        message: "An ambiguous application action requires a clarification question.",
      });
    }
    if (
      thought.applicationActionDecision === "clarify" &&
      thought.messageMode !== "unclear"
    ) {
      context.addIssue({
        code: "custom",
        path: ["messageMode"],
        message: "An application clarification must use unclear message mode.",
      });
    }
    const normalizedPoints = thought.replyPoints.map((point) =>
      point.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
    );
    if (new Set(normalizedPoints).size !== normalizedPoints.length) {
      context.addIssue({
        code: "custom",
        path: ["replyPoints"],
        message: "Reply points must not repeat the same meaning verbatim.",
      });
    }
    if (thought.question && thoughtMetaLeakPattern.test(thought.question)) {
      context.addIssue({
        code: "custom",
        path: ["question"],
        message: "The user-facing question cannot expose internal model instructions.",
      });
    }
  });

const modelThoughtSchema = z
  .object({
    messageMode: z.enum(["social", "help", "mixed", "unclear"]),
    contextRelation: z.enum(["standalone", "immediate_context", "older_context"]),
    replyPoints: z.array(replyPointSchema).min(1).max(12),
    question: z.string().trim().min(1).max(500).nullable(),
  })
  .strip();

export type Thought = z.infer<typeof thoughtSchema>;
export type ReminderAction = z.infer<typeof reminderActionSchema>;
export type MemoryAction = z.infer<typeof memoryActionSchema>;

export interface ThoughtContext {
  currentMessages: string[];
  recentConversation: Array<{
    sender: "user" | "assistant";
    content: string;
  }>;
  conversationSummary: string | null;
  memories: Array<{
    ref: string;
    type: "profile" | "preference" | "relationship" | "boundary" | "situation" | "event";
    content: string;
  }>;
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
  toolExecutions?: Array<{
    name: string;
    arguments: Record<string, unknown>;
    output: unknown;
  }>;
  applicationResult?: ThoughtApplicationResult;
  applicationResults?: ThoughtApplicationResult[];
}

export function suppressAutomaticMemoryNarration(
  thought: Thought,
  currentMessages: string[],
  toolExecutions: Array<{ name: string; output: unknown }>,
): Thought {
  const successfulSave = toolExecutions.some((execution) => {
    if (execution.name !== "save_memory") return false;
    if (
      !execution.output ||
      typeof execution.output !== "object" ||
      Array.isArray(execution.output)
    ) {
      return false;
    }
    return (execution.output as { ok?: unknown }).ok === true;
  });
  if (!successfulSave) return thought;

  const currentText = currentMessages.join("\n");
  if (memoryStatusQuestionPattern.test(currentText)) return thought;

  const conversationalPoints = thought.replyPoints.filter(
    (point) => !memoryMaintenanceNarrationPattern.test(point),
  );
  return {
    ...thought,
    replyPoints:
      conversationalPoints.length > 0
        ? conversationalPoints
        : ["Acknowledge the user's information or correction briefly."],
  };
}

const thoughtApplicationResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("memory"),
    memoryId: z.string().uuid(),
    deletedMemoryCount: z.number().int().min(0).optional(),
  }).strict(),
  z.object({
    kind: z.literal("reminder"),
    reminderId: z.string().uuid().nullable(),
    reminderIds: z.array(z.string().uuid()),
  }).strict(),
]);

export type ThoughtApplicationResult = z.infer<
  typeof thoughtApplicationResultSchema
>;

export interface ThoughtToolExecutionResult {
  output: unknown;
  terminalThought?: Thought;
  applicationResult?: ThoughtApplicationResult;
}

export interface ThoughtToolRuntime {
  tools: ModelFunctionTool[];
  classify(name: string): "read" | "mutation" | null;
  execute(call: ModelToolCall): Promise<ThoughtToolExecutionResult>;
  maxToolRounds?: number;
  maxReadCalls?: number;
  maxMutationCalls?: number;
}

export class ThoughtContractError extends OpenRouterError {
  constructor(
    message: string,
    public readonly rawOutput: string,
    retryable: boolean,
  ) {
    super(message, null, retryable);
    this.name = "ThoughtContractError";
  }
}

export interface ThoughtGenerator {
  generate(
    context: ThoughtContext,
    toolRuntime?: ThoughtToolRuntime,
  ): Promise<ThoughtGeneration>;
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
    question: { type: ["string", "null"], minLength: 1, maxLength: 500 },
  },
  required: [
    "messageMode",
    "contextRelation",
    "replyPoints",
    "question",
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
- Ordinary conversational wording carries full intent. Never require the user to name a feature, CRUD operation, stored record, or application action formally.
- Corrections such as "my bad", "mb", "actually", "wait, it's X", "I meant X", or "make that X" normally use immediate context. Resolve their referent from the latest relevant exchange.
- A value or fact supplied in a current correction overrides every older conversation message, summary, and canonical memory. Never answer with the superseded value.
- When an application action is ready, emit the tool call instead of final JSON.
- Full confidence means operation, target, and required values each have one reasonable interpretation from currentMessages and immediate context. It does not mean mathematical certainty, and it does not apply to ordinary opinions, advice, or harmless social conversation.
- For an explicit memory or reminder action, if currentMessages and immediate context do not identify one clear target or required value, do not keep debating possible interpretations. Make one read-tool lookup only when a concrete subject is available to search. Otherwise ask one short, natural clarification.
- Never use an old summary, deleted value, or distant episode to guess what a vague reference such as "current", "this", "that", or "the one" means. Those are background only; ambiguity that immediate context cannot resolve earns a clarification.
- When "forget", "delete", or "remove" has one clear stored memory or reminder target in immediate context, treat it as an immediate permanent-deletion request. Do not reinterpret it as merely dropping the topic and do not ask for confirmation.
- Clarify a deletion request only when no target can be resolved or multiple stored targets remain equally plausible after useful read-tool calls. Clarification identifies the target; it must never serve as a deletion confirmation.
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
- question is null unless a visible question genuinely earns a response. Natural curiosity, emotional check-ins, useful reminder offers, missing context, and friendly pushback are valid conversational reasons to ask one question.
- Do not end every turn with a question. React, answer, observe, tease, or simply stay present when that is more human. Avoid another optional question when recent replies already feel interrogative.
- A natural question continues the relationship; it must never exist merely because internal storage wants permission.
- localTime is authoritative for the user's current local date and time. Never ask the user what day or time it currently is when localTime already answers it.
- When messageMode is "unclear", question must contain the one minimum distinction needed. The backend derives clarification state from this combination.

Conversation interpretation guide:
- Read natural chat for commitments and state changes, not command words. People reveal durable information while venting, correcting themselves, reporting progress, or mentioning plans in passing.
- A durable fact is likely to matter in a later conversation: identity, school or work context, relationships, stable preferences, boundaries, deadlines, active projects, commitments, or clearly tracked progress.
- A temporary but actively tracked situation can be useful memory while it remains open. Preserve its subject, current state, deadline, and next meaningful milestone in one canonical record.
- Every save_memory call must include expiresAt. Use null only for stable or genuinely open-ended memory. When the current fact has an explicit deadline, end date, or bounded window, expiresAt must be a non-null absolute RFC 3339 timestamp after that window, normally with one or two days of grace.
- Resolve relative time such as "tomorrow", "next week", or "in a week" against localTime. Store the resulting absolute local date in canonicalText as well as the absolute expiresAt timestamp; never persist an unanchored relative deadline by itself.
- Emotional intensity alone does not make a detail durable. "This assignment is killing me" is conversation. "The database assignment is due Friday" is durable. "I finished the schema, about 30% done" updates its tracked state.
- Specificity is evidence. Named people, projects, institutions, amounts, dates, stable likes, and explicit boundaries usually deserve memory when asserted as real current facts.
- Hypotheticals, examples, jokes, guesses, possibilities, quoted text, and abandoned ideas are not user facts. "If I moved to Chiang Mai" must not become "User lives in Chiang Mai."
- Corrections change the canonical fact instead of creating a contradictory second memory. "Actually rent is 8k" means find the rent memory and update it. A later "forget the rent amount" means find and delete it.
- Pronouns inherit the nearest coherent subject. In "the assignment is due Friday" followed by "I finished its schema", "its" refers to that assignment. Search using the resolved subject, not the raw pronoun.
- A question about the user's own previously stated facts, preferences, people, deadlines, progress, or location is a memory-recall request. Call find_memories before saying the information is unknown, even when no matching memory was preloaded into the context.
- Every memory create or update requires find_memories first, even when the message appears to introduce a new fact. Search using the resolved subject so an older partial memory can be merged instead of duplicated or overwritten. If no relevant memory is returned, create one; if one relevant memory is returned, preserve its useful details while merging the new information into one canonical update.
- When a tracked problem, missing item, or incomplete task becomes fixed, obtained, completed, or otherwise resolved, update its canonical memory to that resolved state. Do not delete it unless the user explicitly asks to forget or remove it.
- Reminder intent requires a future interruption requested or clearly accepted by the user. "I should call May tomorrow" may be a plan worth remembering but is not automatically a reminder. "Remind me to call May tomorrow" creates one.
- New reminder creation does not require searching reminders. Rescheduling, changing, pausing, cancelling, or deleting an existing reminder does.
- Wording such as "the X reminder", "the X one", "move", "push", "make it", "instead", "not 8", or "works better" identifies an existing reminder operation. Search reminders first and never create a duplicate from that wording.
- Never turn natural conversation into a storage questionnaire. If passive memory is uncertain, skip it and answer naturally. Ask only when an explicit requested operation cannot safely identify its target or required time.

Representative mappings:
- "my mobile computing presentation is monday" -> save a new event or situation memory silently, then respond to the conversation.
- "schema section done, probably 30% now" with an existing assignment in context -> find that assignment memory, update its canonical state, then respond.
- "nah i hate phone calls" -> save a durable preference when asserted as the user's real preference; do not ask permission.
- "May is my capstone partner, she does frontend" -> save one relationship memory containing both facts.
- "what if I hated phone calls?" -> no memory mutation because it is hypothetical.
- "remind me at 9 tonight to check the mailbox" -> create a reminder directly; supply title, scheduleKind, localDateTime, and recurrence only when needed.
- "make the mailbox one 10 instead" -> find reminders using "mailbox", then reschedule only allowedTargetId.
- "forget what I said about rent" -> find the rent memory, choose the returned rent candidate ID, delete it, then continue naturally without asking for confirmation.
- "yo" or "test test" -> no tools; return one small social meaning.

Tool-stage discipline:
- First completion: either return the final brief, call useful read tools, or create a clearly requested new reminder. save_memory is unavailable until find_memories succeeds in the same turn.
- After memory read results: choose one returned candidate ID for an existing-record mutation only when the target is clear from currentMessages and immediate context. If several candidates remain plausible, ask one target clarification for an explicit edit/deletion or silently skip passive memory work. For reminder read results, use allowedTargetId.
- After any mutation result: do not call another tool unless other independent mutations from the same user batch are still pending. Return the final brief immediately.
- After find_memories succeeds, use save_memory to create or update. For create, send canonicalText, type, topic, subject, retrievalFacets, and expiresAt. topic must use the supplied controlled enum. subject is a short stable identifier for the specific thing when useful, otherwise null. retrievalFacets is [] for simple memories and contains at most three independently searchable details for compound memories. For update, send one returned candidate ID as memoryId and merge the existing record's useful details with the new information.
- For save_reminder create, omit reminderId and all irrelevant fields. Exact schedules use localDateTime; relative schedules use delayAmount and delayUnit. For existing operations, use allowedTargetId as reminderId.
- All memory and reminder lookups and mutations must use the supplied tools. Resolve shorthand and pronouns from currentMessages and recentConversation before searching. Never search unresolved phrases such as "it", "that", or "the one".
- Memory is part of ordinary conversation, not a permission-based feature. Silently save useful durable facts, preferences, boundaries, relationships, and clearly tracked current state. Silently correct an existing memory when ordinary conversation supplies its new value.
- Do not store every passing phrase, joke, hypothetical, or disposable detail. If passive information is too ambiguous to store safely, skip the memory change and continue the conversation normally.
- Never ask "should I save/update/remember that?" when one useful interpretation is already clear. A rare natural offer to start tracking a new category is allowed when tracking itself is genuinely the topic.
- A dynamic tracked value stays one canonical memory. For example, an existing 14k budget followed by a clear 10k spend should update the budget to 4k instead of creating a separate spending memory.
- Reminder creation requires clear user intent because it causes a future interruption. Cantarella may naturally offer a reminder when useful, but an offer is conversation, not a reminder mutation.
- Use at most three read calls and then at most three mutation calls. Independent calls may be batched. Finish every needed read before emitting mutations, and emit all intended mutations together in one mutation stage.
- Never return from mutation to another read. Never repeat a tool call, invent a tool name, or exceed the supplied schemas.
- A memory mutation ID must come from the current turn's find_memories candidates. Candidate retrieval does not make a target clear by itself: use currentMessages and immediate context. For passive memory work, uncertainty means silently skip. For an explicit edit or deletion, uncertainty means ask one short question identifying the candidates. Reminder targetResolution remains authoritative.
- Up to three distinct clear mutations may run in one turn, including mixed memory and reminder work. Never mutate the same target twice in one turn.
- Ordinary conversational wording carries full tool intent. The user never needs to name CRUD operations, database records, tools, memory, or reminders formally.
- Tool arguments must match the supplied schema exactly. Never guess database IDs, timestamps, enum values, missing fields, or mutation targets.
- Omit optional tool fields that are irrelevant. Never write the string "null". For new records, omit the existing-record ID rather than sending a fake ID.
- Context references such as memory_1 and reminder_1 are readable aliases, never database IDs. Existing memory mutations must use a UUID returned by find_memories in this turn; existing reminder mutations must use allowedTargetId.
- A clear memory deletion request must call delete_memory immediately. A clear reminder deletion request must call delete_reminder immediately. Never ask whether the user is sure, never create pending confirmation state, and never substitute archiving or cancellation for deletion.
- A tool result is authoritative. Never claim success, absence, or failure beyond what the tool result states.
- Do not narrate memory machinery. Never say "stored memory", "saved to memory", "memory updated", or "memory deleted". When the user explicitly asked to forget something, acknowledge naturally with meaning such as "forgotten" or "gone" without naming storage internals.
- A final response contains only messageMode, contextRelation, replyPoints, and question. It must be one JSON object with no preface, suffix, commentary, or tool call.
- Do not write Cantarella-style prose, dialogue, jokes, pet names, or message bubbles.
- Do not provide hidden chain-of-thought. Return only the concise structured result.
- You are the sole live owner of memory and reminder decisions for this turn. No separate memory model will reconsider them later.
- If rejectedResponse is present, the previous brief was rejected as unusable or unrelated to currentMessages. Reclassify currentMessages from scratch and produce a materially corrected response. Never repeat, lightly paraphrase, defend, or preserve the rejected meaning.`;

function contextMessage(context: ThoughtContext): ModelMessage {
  return {
    role: "user",
    content: `Produce the private judgment JSON for this context:\n\n${JSON.stringify(context, null, 2)}`,
  };
}

function parseThought(
  rawOutput: string,
  context: ThoughtContext,
  hasSuccessfulMutation = false,
): Thought {
  const normalized = rawOutput.trim();
  const fenced = normalized.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i);
  const jsonPayload = fenced?.[1]?.trim() ?? normalized;

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonPayload);
  } catch {
    throw new OpenRouterError(
      "The Thought model returned invalid JSON.",
      null,
      true,
    );
  }

  const modelResult = modelThoughtSchema.safeParse(parsed);

  if (!modelResult.success) {
    throw new OpenRouterError(
      `The Thought model violated its schema: ${modelResult.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
      null,
      true,
    );
  }

  const result = thoughtSchema.safeParse({
    ...modelResult.data,
    applicationActionDecision:
      modelResult.data.messageMode === "unclear" ? "clarify" : "none",
  });

  if (!result.success) {
    throw new OpenRouterError(
      `The Thought model violated its schema: ${result.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ")}`,
      null,
      true,
    );
  }

  const currentText = context.currentMessages.join("\n");
  const correctedValues = hasCorrectionCue(currentText)
    ? numericValues(currentText)
    : new Set<number>();
  if (correctedValues.size > 0) {
    const assertions = [result.data.replyPoints.join("\n")];
    for (const assertion of assertions) {
      const assertedValues = numericValues(assertion);
      if (
        assertedValues.size > 0 &&
        ![...assertedValues].some((value) => correctedValues.has(value))
      ) {
        throw new OpenRouterError(
          "The Thought model contradicted a numeric correction in the current user messages.",
          null,
          true,
        );
      }
    }
  }

  if (
    !hasSuccessfulMutation &&
    applicationIntentPattern.test(currentText) &&
    mutationSuccessClaimPattern.test(
      `${result.data.replyPoints.join("\n")}\n${result.data.question ?? ""}`,
    )
  ) {
    throw new OpenRouterError(
      "The Thought model claimed an application mutation without a successful mutation tool result.",
      null,
      true,
    );
  }

  return result.data;
}

function completionEvidence(completions: ModelCompletion[]): string {
  return JSON.stringify(
    completions.map((completion) => ({
      content: completion.content,
      toolCalls: completion.toolCalls ?? [],
      finishReason: completion.finishReason ?? null,
      model: completion.model,
      provider: completion.provider,
    })),
  ).slice(0, 20_000);
}

function parseToolArguments(call: ModelToolCall): Record<string, unknown> | null {
  try {
    const value = JSON.parse(call.function.arguments) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isStructurallyValidToolCall(call: ModelToolCall): boolean {
  return Boolean(
    call &&
    call.type === "function" &&
    typeof call.id === "string" &&
    call.id.length > 0 &&
    call.function &&
    typeof call.function.name === "string" &&
    call.function.name.length > 0 &&
    typeof call.function.arguments === "string" &&
    call.function.arguments.length <= 20_000,
  );
}

export function createThoughtGenerator(
  client: OpenRouterClient = createOpenRouterClient(),
): ThoughtGenerator {
  return {
    async generate(
      context: ThoughtContext,
      toolRuntime?: ThoughtToolRuntime,
    ): Promise<ThoughtGeneration> {
      const environment = getEnvironment();
      const systemMessage: ModelMessage = {
        role: "system",
        content: thoughtSystemPrompt,
      };
      const userMessage = contextMessage(context);
      const baseRequest = {
        model: environment.THOUGHT_MODEL,
        temperature: 0,
        maxTokens: THOUGHT_MAX_OUTPUT_TOKENS,
        reasoning: { max_tokens: 384, exclude: true },
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
      };
      const completions: ModelCompletion[] = [];
      const toolExecutions: NonNullable<ThoughtGeneration["toolExecutions"]> = [];
      const messages: ModelMessage[] = [systemMessage, userMessage];

      const completeWithNitroFallback = async (
        request: CompletionRequest,
      ): Promise<ModelCompletion> => {
        try {
          return await client.complete(request);
        } catch (firstError) {
          const isEmptyNitroResponse =
            firstError instanceof OpenRouterError &&
            firstError.message === "OpenRouter returned an empty completion." &&
            request.model.endsWith(":nitro");
          if (!isEmptyNitroResponse) throw firstError;

          try {
            return await client.complete(request);
          } catch (secondError) {
            const isSecondEmptyResponse =
              secondError instanceof OpenRouterError &&
              secondError.message === "OpenRouter returned an empty completion.";
            if (!isSecondEmptyResponse) throw secondError;
            return client.complete({
              ...request,
              model: request.model.slice(0, -":nitro".length),
            });
          }
        }
      };

      const requestCompletion = async (input: {
        tools?: ModelFunctionTool[];
        forceFinal?: boolean;
      } = {}): Promise<ModelCompletion> => {
        const availableTools = input.tools ?? toolRuntime?.tools ?? [];
        const useTools = Boolean(
          toolRuntime && !input.forceFinal && availableTools.length > 0,
        );
        const request = {
          ...baseRequest,
          messages,
          ...(useTools
            ? {
                tools: availableTools,
                toolChoice: "auto" as const,
                ...(environment.THOUGHT_MODEL.split(":", 1)[0] ===
                "deepseek/deepseek-v4-pro-0813"
                  ? {}
                  : { parallelToolCalls: true }),
              }
            : environment.THOUGHT_MODEL.split(":", 1)[0] ===
                "deepseek/deepseek-v4-pro-0813"
              ? {}
              : {
                responseFormat: {
                  name: "cantarella_thought",
                  schema: thoughtJsonSchema,
                },
                }),
        };
        try {
          return await completeWithNitroFallback(request);
        } catch (error) {
          if (
            useTools ||
            !(error instanceof OpenRouterError) ||
            !(
              error.status === 400 ||
              (error.status === 404 &&
                error.message.includes("No endpoints found"))
            )
          ) {
            throw error;
          }
          return completeWithNitroFallback({
            ...baseRequest,
            messages,
          });
        }
      };

      const combinedCompletion = (): ModelCompletion => {
        const last = completions.at(-1);
        if (!last) throw new Error("Thought produced no model completion.");
        const sum = (
          values: Array<number | null | undefined>,
        ): number | null => {
          const present = values.filter((value): value is number => value !== null && value !== undefined);
          return present.length === 0
            ? null
            : present.reduce((total, value) => total + value, 0);
        };
        return {
          content: completions
            .map((completion) =>
              completion.content || JSON.stringify(completion.toolCalls ?? []),
            )
            .join("\n"),
          model: last.model,
          provider: last.provider,
          usage: {
            inputTokens: sum(completions.map((completion) => completion.usage.inputTokens)),
            outputTokens: sum(completions.map((completion) => completion.usage.outputTokens)),
            estimatedCostUsd: sum(
              completions.map((completion) => completion.usage.estimatedCostUsd),
            ),
          },
          latencyMs: completions.reduce(
            (total, completion) => total + completion.latencyMs,
            0,
          ),
        };
      };

      const maxReadCalls = toolRuntime?.maxReadCalls ?? 3;
      const maxMutationCalls = toolRuntime?.maxMutationCalls ?? 3;
      let parseFailure: OpenRouterError | null = null;
      let readCalls = 0;
      let mutationCalls = 0;
      let forceFinal = false;
      const seenToolFingerprints = new Set<string>();
      const applicationResults: ThoughtApplicationResult[] = [];
      const maxModelSteps = maxReadCalls + maxMutationCalls + 4;

      for (let round = 0; round < maxModelSteps; round += 1) {
        // Keep the complete application surface visible for every open tool
        // stage. Runtime guards—not hidden tool definitions—enforce ordering,
        // candidate safety, and per-turn limits.
        const availableTools = toolRuntime && !forceFinal
          ? toolRuntime.tools
          : [];
        const completion = await requestCompletion({
          tools: availableTools,
          forceFinal: forceFinal || availableTools.length === 0,
        });
        completions.push(completion);
        const calls = completion.toolCalls ?? [];

        if (calls.length > 0) {
          if (!toolRuntime) {
            throw new ThoughtContractError(
              "The Thought model requested a tool when no tool runtime was available.",
              completionEvidence(completions),
              true,
            );
          }
          if (forceFinal || availableTools.length === 0) {
            throw new ThoughtContractError(
              "The Thought model requested a tool after the application stage was closed.",
              completionEvidence(completions),
              true,
            );
          }
          if (calls.length > MAX_TOOL_CALLS_PER_RESPONSE) {
            throw new ThoughtContractError(
              `The Thought model exceeded ${MAX_TOOL_CALLS_PER_RESPONSE} tool calls in one response.`,
              completionEvidence(completions),
              true,
            );
          }
          if (!calls.every(isStructurallyValidToolCall)) {
            throw new ThoughtContractError(
              "The Thought model returned a structurally invalid tool call.",
              completionEvidence(completions),
              true,
            );
          }
          const callIds = calls.map((call) => call.id);
          if (callIds.some((id) => !id) || new Set(callIds).size !== callIds.length) {
            throw new ThoughtContractError(
              "The Thought model returned missing or duplicate tool-call IDs.",
              completionEvidence(completions),
              true,
            );
          }
          const kinds = calls.map((call) => toolRuntime.classify(call.function.name));
          const responseHasRead = kinds.includes("read");
          const responseHasMutation = kinds.includes("mutation");
          let mutationStageAttempted = false;

          messages.push({
            role: "assistant",
            content: completion.content,
            toolCalls: calls,
            ...(completion.reasoning ? { reasoning: completion.reasoning } : {}),
            ...(completion.reasoningDetails
              ? { reasoningDetails: completion.reasoningDetails }
              : {}),
          });

          for (const [index, call] of calls.entries()) {
            const kind = kinds[index] ?? null;
            const parsedArguments = parseToolArguments(call);
            const fingerprint = `${call.function.name}:${
              parsedArguments ? JSON.stringify(parsedArguments) : call.function.arguments
            }`;
            const isDuplicate = seenToolFingerprints.has(fingerprint);
            let execution: ThoughtToolExecutionResult;

            if (isDuplicate) {
              execution = {
                output: {
                  ok: false,
                  code: "DUPLICATE_TOOL_CALL_REJECTED",
                  error: "The duplicate tool call did not run. Use the existing result and finish the current stage.",
                },
              };
              if (kind === "read") readCalls = maxReadCalls;
              if (kind === "mutation") mutationStageAttempted = true;
            } else if (kind === null) {
              execution = {
                output: {
                  ok: false,
                  code: "UNKNOWN_TOOL",
                  error: `Unknown tool ${call.function.name}. Use only supplied tool names.`,
                },
              };
            } else if (parsedArguments === null) {
              execution = {
                output: {
                  ok: false,
                  code: "MALFORMED_TOOL_ARGUMENTS",
                  error: "Tool arguments must be exactly one valid JSON object matching the supplied schema.",
                },
              };
            } else if (kind === "read" && mutationCalls > 0) {
              execution = {
                output: {
                  ok: false,
                  code: "READ_STAGE_CLOSED",
                  error: "The read stage is closed because mutations already ran.",
                },
              };
            } else if (kind === "read" && readCalls >= maxReadCalls) {
              execution = {
                output: {
                  ok: false,
                  code: "READ_LIMIT_REACHED",
                  error: `The turn already used its ${maxReadCalls} read calls. Use those results.`,
                },
              };
            } else if (kind === "mutation" && responseHasRead) {
              execution = {
                output: {
                  ok: false,
                  code: "MUTATION_MUST_FOLLOW_READS",
                  error: "This mutation did not run. Review the read results, then emit all intended mutations together.",
                },
              };
            } else if (kind === "mutation" && mutationCalls >= maxMutationCalls) {
              execution = {
                output: {
                  ok: false,
                  code: "MUTATION_LIMIT_REACHED",
                  error: `The turn already used its ${maxMutationCalls} mutation calls.`,
                },
              };
              mutationStageAttempted = true;
            } else {
              seenToolFingerprints.add(fingerprint);
              execution = await toolRuntime.execute(call);
              if (kind === "read") readCalls += 1;
              if (kind === "mutation") {
                mutationCalls += 1;
                mutationStageAttempted = true;
              }
            }

            toolExecutions.push({
              name: call.function.name,
              arguments: parsedArguments ?? { malformedArguments: call.function.arguments.slice(0, 2_000) },
              output: execution.output,
            });

            if (execution.terminalThought) {
              if (kind !== "mutation") {
                throw new ThoughtContractError(
                  "A terminal application mutation violated the sequential tool contract.",
                  completionEvidence(completions),
                  false,
                );
              }
              const validatedThought = thoughtSchema.safeParse(
                execution.terminalThought,
              );
              const validatedApplicationResult =
                thoughtApplicationResultSchema.safeParse(
                  execution.applicationResult,
                );
              if (!validatedThought.success || !validatedApplicationResult.success) {
                throw new ThoughtContractError(
                  "The application runtime returned an invalid terminal result.",
                  completionEvidence(completions),
                  false,
                );
              }
              return {
                thought: suppressAutomaticMemoryNarration(
                  validatedThought.data,
                  context.currentMessages,
                  toolExecutions,
                ),
                completion: combinedCompletion(),
                toolExecutions,
                applicationResult: validatedApplicationResult.data,
                applicationResults: [
                  ...applicationResults,
                  validatedApplicationResult.data,
                ],
              };
            }
            if (execution.applicationResult) {
              const validatedApplicationResult =
                thoughtApplicationResultSchema.safeParse(
                  execution.applicationResult,
                );
              if (!validatedApplicationResult.success) {
                throw new ThoughtContractError(
                  "The application runtime returned an invalid mutation result.",
                  completionEvidence(completions),
                  false,
                );
              }
              applicationResults.push(validatedApplicationResult.data);
            }

            messages.push({
              role: "tool",
              name: call.function.name,
              toolCallId: call.id,
              content: JSON.stringify(execution.output),
            });
          }
          if (responseHasMutation && !responseHasRead) {
            forceFinal = true;
          } else if (mutationStageAttempted) {
            forceFinal = true;
          }
          continue;
        }

        try {
          const thought = parseThought(
            completion.content,
            context,
            applicationResults.length > 0,
          );
          return {
            thought: suppressAutomaticMemoryNarration(
              thought,
              context.currentMessages,
              toolExecutions,
            ),
            completion: combinedCompletion(),
            ...(toolExecutions.length > 0 ? { toolExecutions } : {}),
            ...(applicationResults.length > 0
              ? {
                  applicationResult: applicationResults[0],
                  applicationResults,
                }
              : {}),
          };
        } catch (error) {
          if (!(error instanceof OpenRouterError)) throw error;
          if (parseFailure) {
            throw new ThoughtContractError(
              "The Thought model returned invalid final JSON or violated its schema twice.",
              completionEvidence(completions),
              false,
            );
          }
          parseFailure = error;
          forceFinal = true;
          messages.push({
            role: "user",
            content: `Your final response was rejected: ${error.message} Return one corrected JSON object containing only messageMode, contextRelation, replyPoints, and question. Do not call another tool or claim an application change unless a tool already returned success.`,
          });
        }
      }

      throw new ThoughtContractError(
        "The Thought model did not finish within the bounded tool loop.",
        completionEvidence(completions),
        false,
      );
    },
  };
}
