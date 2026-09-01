import { describe, expect, it, vi } from "vitest";

import { generateReminderVoice } from "../src/models/reminder-voice.js";
import type { CompleteModel } from "../src/models/openrouter.js";

describe("reminder voice adapter", () => {
  it("uses the normal voice adapter with only persona and due-reminder meaning", async () => {
    const complete = vi.fn().mockResolvedValue({
      content: "hey, time to submit that proposal",
      model: "aion-labs/aion-3.0-mini",
      provider: "AionLabs",
      usage: { inputTokens: 80, outputTokens: 9, estimatedCostUsd: 0.0001 },
      latencyMs: 400,
    });
    const result = await generateReminderVoice({
      persona: {
        name: "Cantarella",
        voiceDirection: "default",
        customStyle: "",
        preferredUserName: "Ian",
        endearmentPreference: null,
        boundaries: [],
      },
      reminderText: "Submit the project proposal",
    }, complete as CompleteModel);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.generation.bubbles).toEqual(["hey, time to submit that proposal"]);
    const request = complete.mock.calls[0]?.[0];
    expect(request.model).toBe("openai/gpt-5.6-luna");
    expect(request.maxTokens).toBe(180);
    expect(request.messages[0].content).toContain(
      '"replyPoints": [\n    "Submit the project proposal"',
    );
    expect(request.messages[0].content).toContain("PRIVATE CHAT");
    expect(request.messages[0].content).toContain("DUE REMINDER DELIVERY");
    expect(request.messages[0].content).toContain(
      "Private-chat voice",
    );
    expect(request.messages[0].content).toContain(
      "Keep the actual action, names, numbers, and concrete details true",
    );
    expect(request.messages[0].content).toContain(
      'Never use formal alert wording such as "This is your reminder to"',
    );
    expect(request.messages[0].content).not.toContain("recentConversation");
  });
});
