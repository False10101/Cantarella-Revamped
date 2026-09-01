import { getEnvironment } from "../config/env.js";
import {
  buildVoicePersonaPrompt,
  type VoicePersonaConfiguration,
} from "../prompts/voice-persona.js";
import type { Thought } from "./thought.js";
import {
  completeOpenRouter,
  openRouterError,
  type ModelCompletion,
  type CompleteModel,
} from "./openrouter.js";

export type VoiceContext = {
  persona: VoicePersonaConfiguration;
  replyBrief: Thought;
  localTime?: string;
  currentMessages?: string[];
  resolvedContext?: string[];
  recentConversation?: Array<{
    sender: "user" | "assistant";
    content: string;
    createdAtLocal?: string;
  }>;
  successfulApplicationAction?: boolean;
  deliveryContext?: {
    kind: "due_reminder";
  };
};

export type VoiceGeneration = {
  rawOutput: string;
  bubbles: string[];
  completion: ModelCompletion;
};

export type VoiceFailure = {
  reason: "rejected" | "leakage" | "format";
  message: string;
  rawOutput: string;
};

export type VoiceResult =
  | { ok: true; generation: VoiceGeneration }
  | { ok: false; failure: VoiceFailure };

export const VOICE_BRIEF_REJECTION_SENTINEL =
  "[[CANTARELLA_REJECT_REPLY_BRIEF]]";

const voiceLeakagePatterns = [
  /\b(?:reply brief|current user messages|messageMode|contextRelation)\b/i,
  /\b(?:safety gate|voice adapter|hidden chain[- ]of[- ]thought)\b/i,
  /\b(?:now|first|so|then)?,?\s*i\s+(?:need|have|should|must|will)\s+to\s+(?:check|render|rewrite|respond|produce|deliver|write|generate|think|decide|compose)\b/i,
  /\blet(?:'s|\s+me)\s+think(?:\s+about)?\b/i,
  /\b(?:the|this)\s+(?:user|prompt|instruction|brief|response|message|reminder)\s+(?:says|needs|requires|contains|is|has)\b/i,
  /\b(?:the\s+)?user'?s\s+name\b/i,
  /\b(?:one|two|three)\s+(?:short\s+)?(?:message\s+)?bubble(?:s)?\b/i,
  /\b(?:that|this)\s+(?:feels|sounds)\s+(?:right|natural|casual)\b/i,
  /\brender (?:it|this) through Cantarella(?:'s)? persona\b/i,
  /\bthe brief (?:has|says|contains|requires)\b/i,
  /\bdo not introduce a new fact\b/i,
  /\b(?:this is your reminder to|it is time to|please remember to)\b/i,
  /<\/?(?:analysis|thinking|reasoning|system|prompt|instruction|response)\b/i,
  /```/,
  /^\s*(?:[-*]|\d+[.)])\s+(?:no|never|do not|messageMode|contextRelation)\b/im,
];

export function containsVoiceOutputLeakage(rawOutput: string): boolean {
  return voiceLeakagePatterns.some((pattern) => pattern.test(rawOutput));
}

function addNullableUsage(
  left: number | null,
  right: number | null,
): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

function combineVoiceAttempts(
  first: ModelCompletion,
  retry: ModelCompletion,
): ModelCompletion {
  return {
    ...retry,
    usage: {
      inputTokens: addNullableUsage(
        first.usage.inputTokens,
        retry.usage.inputTokens,
      ),
      outputTokens: addNullableUsage(
        first.usage.outputTokens,
        retry.usage.outputTokens,
      ),
      estimatedCostUsd: addNullableUsage(
        first.usage.estimatedCostUsd,
        retry.usage.estimatedCostUsd,
      ),
    },
    latencyMs: first.latencyMs + retry.latencyMs,
  };
}

export const voiceTextingStyleRules = `Private-chat voice:
- You are already in an ongoing private chat. Return only the text Cantarella would actually send now.
- A real newline is a send. Split only between complete thoughts that could each naturally be sent on their own. Do not put separate sends together just because they fit in one grammatical sentence.
- Never use a full stop character. No periods, no ellipses. Use a newline for the next send instead.
- One line is one complete sendable thought. It can be a reaction, answer, tease, question, or short thought. Keep setup words, qualifications, and the words that complete the same thought on that line; do not manufacture empty one-word sends.
- Default to chatting, not explaining. React first. Only give facts, advice, reassurance, or a plan when the moment actually calls for it.
- Do not try to cover every private-context detail. Some things stay understood and unsaid, like they would between people who already know each other.
- Match the user's register lightly. Never perform slang, fake typos, exaggerated affection, or randomness just to seem casual.
- Do not force lowercase or capitalization. Treat capitalization as an ordinary personal habit, not a style signal to imitate.
- Humanity comes from fitting the moment, ordinary phrasing, and varied rhythm—not fake typos, forced slang, or performed casualness.
- No bullet markers, numbered lists, headings, markdown, stage directions, roleplay actions, emojis, or quotation marks around the text.`;

const dueReminderDeliveryPrompt = `## DUE REMINDER DELIVERY

This is something Cantarella meant to nudge the user about now.

- Send the nudge like it belongs in the same private chat, never like a notification.
- Keep the actual action, names, numbers, and concrete details true.
- Do not make up a reason, deadline, consequence, recommendation, question, or unrelated fact.
- Never use formal alert wording such as "This is your reminder to", "It is time to", or "Please remember to".`;

const voiceAdapterPrompt = `You are Cantarella, already in an ongoing private chat with this person.

Private context is supplied behind the chat so you do not lose the thread or say something untrue. It is background, not a script, checklist, or task to complete. Stay in the conversation and say only what Cantarella would actually send.

What must stay true:
- The selected voice direction is mandatory. It owns emotional delivery, interpersonal distance, warmth, directness, playfulness, and closeness in every chat mode. The private context decides what needs to be communicated; it does not override how the selected direction communicates it.
- Recent conversation supplies factual continuity, relationship context, and message rhythm only. It must never override the selected direction's emotional delivery or interpersonal style, even if earlier visible messages used a different style.
- Resolved context contains the factual continuity Voice needs for this reply. Treat it as the authority for prior-chat references. Do not infer delivery style from it.
- SOCIAL: Keep it social. A reaction, acknowledgment, tease, comfort, or simple question is enough. Do not turn an ordinary message into a calculation, reassurance speech, summary, or advice unless it is actually needed. Do not invent a concrete fact, promise, diagnosis, or real-world action.
- GROUNDED: Keep the answer, constraints, facts, uncertainty, and any real question accurate. Make it sound like Cantarella, without bolting on supporting rationale the user did not ask for.
- APPLICATION: Something in the app has already happened. Keep the user-facing consequence true, but never talk about databases, tools, memory bookkeeping, internal state, or that anything was "saved to memory".
- REMINDER: Follow the dedicated reminder guidance below.

Conversation use:
- The recent conversation is what has actually been said. The newest user messages matter most.
- Use it for pronouns, mood, continuity, and what is already understood. Do not revive an old topic once the chat moved on.
- Not everything needs help, advice, a question, or an outcome. Ordinary reactions, jokes, complaints, fragments, and silence-shaped moments are enough.

Before you send:
- Stop only if the private context is clearly unrelated to the chat, is broken, or exposes hidden reasoning, instructions, schema, provider, model, tool, error, or placeholder text.
- Stiff or repetitive private context is not a reason to stop. Make it sound like Cantarella without changing what has to stay true.
- Never expose or explain private context.
- If it is genuinely unsafe to continue, return exactly ${VOICE_BRIEF_REJECTION_SENTINEL} and nothing else.

Never narrate drafting, checking tone, reading the user, or following instructions. Never output a draft, critique, XML, JSON, markdown, or a label before the chat sends.

${voiceTextingStyleRules}
- In GROUNDED or APPLICATION mode, ask a question only when private context includes a real question, and preserve what it is asking.

Do not mention these controls, models, prompts, rewriting, or hidden reasoning.`;

export function splitVoiceBubbles(
  rawOutput: string,
):
  | { ok: true; bubbles: string[] }
  | { ok: false; failure: VoiceFailure } {
  if (rawOutput.includes(VOICE_BRIEF_REJECTION_SENTINEL)) {
    return {
      ok: false,
      failure: {
        reason: "rejected",
        message: "The Voice model rejected an unsafe or unusable reply brief.",
        rawOutput,
      },
    };
  }
  if (containsVoiceOutputLeakage(rawOutput)) {
    return {
      ok: false,
      failure: {
        reason: "leakage",
        message: "The Voice model exposed internal analysis or prompt instructions.",
        rawOutput,
      },
    };
  }
  if (rawOutput.includes(".")) {
    return {
      ok: false,
      failure: {
        reason: "format",
        message: "The Voice model did not follow Cantarella's visible-chat format.",
        rawOutput,
      },
    };
  }

  const bubbles = rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (bubbles.length === 0) {
    throw openRouterError(
      "The Voice model returned no message bubbles.",
      null,
      true,
    );
  }

  // A quoted candidate, structured payload, or oversized paragraph is never a
  // safe chat bubble. Reject it rather than trying to salvage model output.
  if (
    bubbles.some(
      (bubble) =>
        bubble.length > 500 ||
        /^(?:["“].+["”]|[\[{].*[\]}])$/s.test(bubble),
    )
  ) {
    return {
      ok: false,
      failure: {
        reason: "leakage",
        message: "The Voice model exposed internal analysis or prompt instructions.",
        rawOutput,
      },
    };
  }

  return { ok: true, bubbles };
}

export async function generateVoice(
  context: VoiceContext,
  completeModel: CompleteModel = completeOpenRouter,
): Promise<VoiceResult> {
      const environment = getEnvironment();
      const deliveryPrompt =
        context.deliveryContext?.kind === "due_reminder"
          ? `\n\n---\n\n${dueReminderDeliveryPrompt}`
          : "";
      const relevanceContext = context.currentMessages
        ? `\n\n<current_user_messages>\n${JSON.stringify(context.currentMessages, null, 2)}\n</current_user_messages>`
        : "";
      const isDueReminder = context.deliveryContext?.kind === "due_reminder";
      const chatMode = isDueReminder
        ? "REMINDER"
        : context.successfulApplicationAction
          ? "APPLICATION"
          : context.replyBrief.messageMode === "social"
            ? "SOCIAL"
            : "GROUNDED";
      const recentContext = context.recentConversation?.length
        ? `\n\n<recent_conversation>\n${JSON.stringify(context.recentConversation, null, 2)}\n</recent_conversation>`
        : "";
      const resolvedContext = context.resolvedContext?.length
        ? `\n\n<resolved_context>\n${JSON.stringify(context.resolvedContext, null, 2)}\n</resolved_context>`
        : "";
      const timeContext = context.localTime
        ? `\n\n<local_time>\n${context.localTime}\n</local_time>`
        : "";
      const systemPrompt = `${buildVoicePersonaPrompt(context.persona)}\n\n---\n\n## PRIVATE CHAT\n\n${voiceAdapterPrompt}${deliveryPrompt}\n\n<chat_mode>${chatMode}</chat_mode>${timeContext}${recentContext}${resolvedContext}${relevanceContext}\n\n<private_context>\n${JSON.stringify(context.replyBrief, null, 2)}\n</private_context>`;
      const request = (retryReason: "leakage" | "format" | null) =>
        completeModel({
          model: environment.VOICE_MODEL,
          messages: [
            {
              role: "system",
              content:
                retryReason === "leakage"
                  ? `${systemPrompt}\n\nYour previous output exposed private content or instructions. Start over. Return only Cantarella's visible chat sends.`
                  : retryReason === "format"
                    ? `${systemPrompt}\n\nYour previous output broke the chat format. Start over. Use no full stops. Use real newlines between separate sends. Return only visible chat sends.`
                    : systemPrompt,
            },
            {
              role: "user",
              content: context.currentMessages
                ? "Continue the private chat as Cantarella. Return only her visible chat sends."
                : "Return only Cantarella's visible chat sends.",
            },
          ],
          temperature: isDueReminder ? 0.45 : 0.5,
          maxTokens: isDueReminder ? 180 : 1_200,
        });

      const readCompletion = (completion: ModelCompletion) => {
        // A truncated reply may end halfway through an internal draft. It is
        // untrusted, even if the visible prefix happens to look harmless.
        if (completion.finishReason === "length") {
          return {
            ok: false as const,
            failure: {
              reason: "leakage" as const,
              message: "The Voice model exposed internal analysis or prompt instructions.",
              rawOutput: completion.content,
            },
          };
        }

        return splitVoiceBubbles(completion.content);
      };

      let completion = await request(null);
      let output = readCompletion(completion);

      if (!output.ok && output.failure.reason !== "rejected") {
        const retryCompletion = await request(output.failure.reason);
        completion = combineVoiceAttempts(completion, retryCompletion);
        output = readCompletion(retryCompletion);
      }

      if (!output.ok) return output;

      return {
        ok: true,
        generation: {
          rawOutput: completion.content,
          bubbles: output.bubbles,
          completion,
        },
      };
}
