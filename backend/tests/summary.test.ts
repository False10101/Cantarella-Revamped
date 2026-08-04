import { describe, expect, it } from "vitest";

import type { CompletionRequest } from "../src/models/openrouter.js";
import type { RecentContextMessage } from "../src/pipeline/message-order.js";
import {
  recentRawStartIndex,
  selectNextSummaryChunk,
} from "../src/summary/summary-chunking.js";
import {
  createSummaryPolicyGenerator,
  parseSummaryPlan,
  SummaryPolicyOutputError,
} from "../src/summary/summary-policy.js";
import { formatSummaryContext } from "../src/summary/summary-retrieval.js";

function message(
  index: number,
  turnId: string | null,
): RecentContextMessage {
  return {
    id: `message-${index.toString().padStart(3, "0")}`,
    turnId,
    role: index % 3 === 0 ? "user" : "assistant",
    content: `message ${index}`,
    createdAt: new Date(1_700_000_000_000 + index),
    partIndex: index % 3 === 0 ? null : (index % 3) - 1,
  };
}

function turnMessages(turnCount: number): RecentContextMessage[] {
  return Array.from({ length: turnCount }, (_, turnIndex) =>
    Array.from({ length: 3 }, (_, offset) => {
      const index = turnIndex * 3 + offset;
      return message(index, `turn-${turnIndex}`);
    }),
  ).flat();
}

const validPlan = {
  summaryText:
    "The user tested reminder delivery and accepted the latest Telegram wording.",
  openSituations: ["The conversation-summary architecture is being implemented."],
};

describe("conversation summary policy", () => {
  it("parses the strict immutable chunk result", () => {
    expect(parseSummaryPlan(JSON.stringify(validPlan))).toEqual(validPlan);
  });

  it("retries malformed output from the original context", async () => {
    const requests: CompletionRequest[] = [];
    const outputs = ["not json", JSON.stringify(validPlan)];
    const generator = createSummaryPolicyGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: outputs[requests.length - 1] ?? outputs[1]!,
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    const result = await generator.generate({
      timezone: "Asia/Bangkok",
      previousChunk: {
        summaryText: "Earlier context only.",
        openSituations: [],
      },
      newMessages: [
        {
          id: "5919e43d-7615-4ad4-8d1f-38f56075fe9c",
          turnId: "2cafb281-a2b2-41c4-b6ee-b85fba970dbe",
          sender: "user",
          content: "the latest reminder sounds fine",
          createdAtLocal: "2026-08-04T11:04:00.000+07:00",
        },
      ],
    });

    expect(result.plan).toEqual(validPlan);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.responseFormat?.name).toBe(
      "cantarella_conversation_summary_chunk",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "Summarize only NEW MESSAGES",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "Never merge, rewrite, or recompress the previous chunk",
    );
    expect(requests[1]?.messages[1]?.content).toContain(
      "the latest reminder sounds fine",
    );
    expect(
      requests[1]?.messages.every(
        (requestMessage) => !requestMessage.content.includes("not json"),
      ),
    ).toBe(true);
  });

  it("keeps a second malformed output retryable", async () => {
    const generator = createSummaryPolicyGenerator({
      async complete(request) {
        return {
          content: "still malformed",
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    await expect(
      generator.generate({
        timezone: "Asia/Bangkok",
        previousChunk: null,
        newMessages: [],
      }),
    ).rejects.toMatchObject({
      name: "SummaryPolicyOutputError",
      retryable: true,
      rawOutput: "still malformed",
    } satisfies Partial<SummaryPolicyOutputError>);
  });
});

describe("conversation summary chunk boundaries", () => {
  it("keeps the latest fifteen messages raw and summarizes complete turns", () => {
    const records = turnMessages(12);
    const chunk = selectNextSummaryChunk(records, null);

    expect(recentRawStartIndex(records)).toBe(21);
    expect(chunk).toHaveLength(15);
    expect(chunk?.[0]?.turnId).toBe("turn-0");
    expect(chunk?.at(-1)?.turnId).toBe("turn-4");
  });

  it("starts the next immutable chunk after the previous cursor", () => {
    const records = turnMessages(18);
    const first = selectNextSummaryChunk(records, null);
    const second = selectNextSummaryChunk(records, first?.at(-1)?.id ?? null);

    expect(first).toHaveLength(15);
    expect(second).toHaveLength(15);
    expect(second?.[0]?.id).toBe(records[15]?.id);
    expect(new Set(first?.map((record) => record.id))).not.toContain(
      second?.[0]?.id,
    );
  });

  it("waits instead of summarizing fewer than one target chunk", () => {
    expect(selectNextSummaryChunk(turnMessages(9), null)).toBeNull();
  });
});

describe("conversation summary context formatting", () => {
  it("keeps recent and relevant historical episodes visibly separate", () => {
    const context = formatSummaryContext({
      latestEndMessageId: "recent-end",
      recent: [
        {
          id: "recent",
          startMessageId: "recent-start",
          endMessageId: "recent-end",
          summaryText: "The user accepted the Telegram reminder wording.",
          openSituations: ["Conversation summarization remains unfinished."],
          createdAt: new Date("2026-08-04T04:00:00.000Z"),
          similarity: null,
        },
      ],
      relevant: [
        {
          id: "older",
          startMessageId: "older-start",
          endMessageId: "older-end",
          summaryText: "The user previously tested long-term memory retrieval.",
          openSituations: [],
          createdAt: new Date("2026-08-03T04:00:00.000Z"),
          similarity: 0.8,
        },
      ],
    });

    expect(context).toContain("Recent compressed conversation episodes");
    expect(context).toContain("Relevant older conversation episodes");
    expect(context).toContain("Historically open situations");
  });
});
