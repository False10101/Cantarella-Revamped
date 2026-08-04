import { describe, expect, it } from "vitest";

import {
  createThoughtGenerator,
  MAX_REPLY_POINT_CHARACTERS,
  MAX_REPLY_POINT_WORDS,
  thoughtSchema,
} from "../src/models/thought.js";
import type { CompletionRequest } from "../src/models/openrouter.js";
import {
  createVoiceGenerator,
  splitVoiceBubbles,
  VOICE_BRIEF_REJECTION_SENTINEL,
  VoiceBriefRejectedError,
} from "../src/models/voice.js";

const validThought = {
  messageMode: "help" as const,
  contextRelation: "standalone" as const,
  replyPoints: [
    "If the client is waiting, send a brief update first.",
    "Otherwise, start the portfolio work.",
  ],
  question: null,
  reminderAction: null,
};

describe("two-pass model contracts", () => {
  it("requires the Thought model to provide at least one compact reply point", () => {
    expect(thoughtSchema.parse(validThought)).toEqual(validThought);

    expect(thoughtSchema.safeParse({ replyPoints: [], question: null }).success)
      .toBe(false);
  });

  it("rejects extra uncontrolled Thought fields", () => {
    expect(
      thoughtSchema.safeParse({ ...validThought, finalProse: "just do it" })
        .success,
    ).toBe(false);
  });

  it("rejects paragraph-length reply points", () => {
    const tooManyWords = Array.from(
      { length: MAX_REPLY_POINT_WORDS + 1 },
      () => "a",
    ).join(" ");
    const tooManyCharacters = "a".repeat(MAX_REPLY_POINT_CHARACTERS + 1);

    expect(
      thoughtSchema.safeParse({
        replyPoints: [tooManyWords],
        question: null,
      }).success,
    ).toBe(false);
    expect(
      thoughtSchema.safeParse({
        replyPoints: [tooManyCharacters],
        question: null,
      }).success,
    ).toBe(false);
  });

  it("accepts one explicit structured relative reminder action", () => {
    const result = thoughtSchema.parse({
      messageMode: "help",
      contextRelation: "standalone",
      replyPoints: ["The requested reminder should be scheduled."],
      question: null,
      reminderAction: {
        title: "Look at the banking app",
        scheduleKind: "after",
        localDateTime: null,
        delayAmount: 5,
        delayUnit: "minutes",
        recurrence: null,
      },
    });

    expect(result.reminderAction?.delayAmount).toBe(5);
    expect(
      thoughtSchema.safeParse({
        messageMode: "help",
        contextRelation: "standalone",
        replyPoints: ["The requested reminder should be scheduled."],
        question: null,
        reminderAction: {
          title: "Look at the banking app",
          scheduleKind: "after",
          localDateTime: "2026-08-04T10:30",
          delayAmount: 5,
          delayUnit: "minutes",
          recurrence: null,
        },
      }).success,
    ).toBe(false);
  });

  it("retries malformed Thought JSON from the original context", async () => {
    const requests: CompletionRequest[] = [];
    const outputs = ["not json", JSON.stringify(validThought)];
    const generator = createThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: outputs[requests.length - 1] ?? JSON.stringify(validThought),
          model: request.model,
          provider: "test",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostUsd: 0,
          },
          latencyMs: 1,
        };
      },
    });

    const result = await generator.generate({
      currentMessages: ["should i text them again?"],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      localTime: "Monday, August 3, 2026 at 8:30 PM GMT+7",
    });

    expect(result.thought).toEqual(validThought);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages[1]?.content).toContain(
      "should i text them again?",
    );
    expect(requests[1]?.messages[0]?.content).toContain(
      "Start again from the original context",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "Recent conversation is background, not an unfinished command queue",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "conversationSummary contains compressed historical episodes",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "There is no ordinary target of two",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "Always return reminderAction",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      'A ping or test such as "yo", "you there", "test test"',
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "Treat social conversation as a complete first-class purpose",
    );
    expect(requests[0]?.responseFormat?.schema).toMatchObject({
      required: [
        "messageMode",
        "contextRelation",
        "replyPoints",
        "question",
        "reminderAction",
      ],
    });
    expect(requests[1]?.messages.every((message) => !message.content.includes("not json")))
      .toBe(true);
  });

  it("turns every non-empty Aion line into its own bubble", () => {
    expect(splitVoiceBubbles("yeah\n\nyou know which one\nstart there")).toEqual(
      ["yeah", "you know which one", "start there"],
    );
  });

  it("never turns Aion's rejected-brief sentinel into a bubble", () => {
    expect(() => splitVoiceBubbles(VOICE_BRIEF_REJECTION_SENTINEL)).toThrow(
      VoiceBriefRejectedError,
    );
    expect(() =>
      splitVoiceBubbles(`cannot render\n${VOICE_BRIEF_REJECTION_SENTINEL}`),
    ).toThrow(VoiceBriefRejectedError);
  });

  it("gives Aion the current batch only as a narrow relevance check", async () => {
    let capturedRequest: CompletionRequest | undefined;
    const generator = createVoiceGenerator({
      async complete(request) {
        capturedRequest = request;
        return {
          content: "start with the tiniest part of it",
          model: request.model,
          provider: "test",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostUsd: 0,
          },
          latencyMs: 1,
        };
      },
    });

    await generator.generate({
      persona: {
        name: "Cantarella",
        voiceDirection: "default",
        customStyle: "",
        preferredUserName: null,
        endearmentPreference: null,
        boundaries: [],
      },
      replyBrief: {
        messageMode: "help",
        contextRelation: "standalone",
        replyPoints: ["Start with the smallest possible part of the task."],
        question: null,
        reminderAction: null,
      },
      currentMessages: ["how do i start this task"],
    });

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.messages).toHaveLength(2);
    expect(capturedRequest?.messages[1]).toEqual({
      role: "user",
      content: "Check that the brief responds to the current messages, then render it.",
    });
    expect(capturedRequest?.messages[0]?.content).toContain(
      '"replyPoints": [',
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "yea meditation probably isnt gonna fix the starting part",
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      'Never produce keyword stacks, clipped command chains, or drill-sergeant phrasing',
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "Never target the same number of bubbles as input points",
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "may naturally need three or more",
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      VOICE_BRIEF_REJECTION_SENTINEL,
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      '"how do i start this task"',
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "reject when you are certain the REPLY BRIEF answers, repeats, or revives a topic",
    );
    expect(capturedRequest?.messages[0]?.content).not.toContain(
      "recentConversation",
    );
    expect(capturedRequest?.temperature).toBe(0.5);
    expect(capturedRequest?.reasoning).toBeUndefined();
  });
});
