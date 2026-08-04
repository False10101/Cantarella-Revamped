import { describe, expect, it } from "vitest";

import {
  createMemoryTemporalContext,
  MemoryCandidateReferenceError,
  memoryContentHash,
  normalizeMemoryText,
  prepareMemoryCandidates,
} from "../src/memory/memory-processor.js";
import {
  createMemoryPolicyGenerator,
  MemoryPolicyOutputError,
  parseMemoryPlan,
  type MemoryCandidate,
} from "../src/memory/memory-policy.js";
import {
  rankMemoryMatches,
  type RetrievedMemory,
} from "../src/memory/memory-retrieval.js";
import type { CompletionRequest } from "../src/models/openrouter.js";

const sourceMessageId = "5919e43d-7615-4ad4-8d1f-38f56075fe9c";
const existingMemoryId = "2cafb281-a2b2-41c4-b6ee-b85fba970dbe";

const candidate: MemoryCandidate = {
  action: "add",
  targetMemoryId: null,
  type: "preference",
  canonicalText: "Ian prefers direct feedback.",
  importance: 0.8,
  confidence: 0.95,
  expiresAt: null,
  sourceMessageIds: [sourceMessageId],
};

const candidateOutput = {
  action: "add",
  targetMemoryRef: null,
  type: "preference",
  canonicalText: "Ian prefers direct feedback.",
  importance: 0.8,
  confidence: 0.95,
  expiresAt: null,
  sourceMessageRefs: ["message_1"],
};

const temporalContext = createMemoryTemporalContext(
  "Asia/Bangkok",
  new Date("2026-08-03T17:04:00.000Z"),
);

const userMessages = [
  {
    id: sourceMessageId,
    content: "i prefer direct feedback",
    createdAtUtc: "2026-08-03T17:04:00.000Z",
    createdAtLocal: "2026-08-04T00:04:00.000+07:00",
  },
];

describe("memory policy contract", () => {
  it("accepts strict user-evidenced memory operations", () => {
    expect(
      parseMemoryPlan(JSON.stringify({ candidates: [candidateOutput] }), {
        temporalContext,
        userMessages,
        existingMemories: [],
      }),
    ).toEqual({ candidates: [candidate] });
  });

  it("rejects an update without a target memory", () => {
    expect(() =>
      parseMemoryPlan(
        JSON.stringify({
          candidates: [{ ...candidateOutput, action: "correct" }],
        }),
        {
          temporalContext,
          userMessages,
          existingMemories: [],
        },
      ),
    ).toThrow("violated its schema");
  });

  it("retries malformed policy JSON from the original evidence", async () => {
    const requests: CompletionRequest[] = [];
    const outputs = [
      "not json",
      JSON.stringify({ candidates: [candidateOutput] }),
    ];
    const generator = createMemoryPolicyGenerator({
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
      temporalContext,
      userMessages,
      existingMemories: [],
    });

    expect(result.plan.candidates).toEqual([candidate]);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.responseFormat?.name).toBe("cantarella_memory_plan");
    expect(requests[1]?.messages[1]?.content).toContain(
      "i prefer direct feedback",
    );
    expect(requests[0]?.messages[1]?.content).toContain('"ref": "message_1"');
    expect(requests[0]?.messages[1]?.content).not.toContain(sourceMessageId);
    expect(requests[0]?.messages[0]?.content).toContain(
      "Never derive its calendar date from createdAtUtc",
    );
    expect(requests[0]?.messages[1]?.content).toContain(
      '"currentLocalDate": "2026-08-04"',
    );
    expect(
      requests[1]?.messages.every(
        (message) => !message.content.includes("not json"),
      ),
    ).toBe(true);
  });

  it("retries when the model puts a memory reference in message evidence", async () => {
    const requests: CompletionRequest[] = [];
    const outputs = [
      JSON.stringify({
        candidates: [
          { ...candidateOutput, sourceMessageRefs: ["memory_1"] },
        ],
      }),
      JSON.stringify({ candidates: [candidateOutput] }),
    ];
    const generator = createMemoryPolicyGenerator({
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
      temporalContext,
      userMessages,
      existingMemories: [
        {
          id: existingMemoryId,
          type: "preference",
          canonicalText: "Ian prefers concise replies.",
          importance: 0.7,
          confidence: 0.9,
          expiresAt: null,
          similarity: 0.8,
        },
      ],
    });

    expect(result.plan.candidates).toEqual([candidate]);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages[0]?.content).toContain(
      "sourceMessageRefs",
    );
  });

  it("keeps a second malformed result retryable and preserves its raw output", async () => {
    const generator = createMemoryPolicyGenerator({
      async complete(request) {
        return {
          content: "still not json",
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    await expect(
      generator.generate({
        temporalContext,
        userMessages,
        existingMemories: [],
      }),
    ).rejects.toMatchObject({
      name: "MemoryPolicyOutputError",
      retryable: true,
      rawOutput: "still not json",
    } satisfies Partial<MemoryPolicyOutputError>);
  });
});

describe("memory temporal context", () => {
  it("uses the source message date in the user's timezone across UTC midnight", () => {
    expect(temporalContext).toEqual({
      timezone: "Asia/Bangkok",
      referenceInstantUtc: "2026-08-03T17:04:00.000Z",
      currentLocalDate: "2026-08-04",
      currentLocalDateTime: "2026-08-04T00:04:00.000+07:00",
    });
  });

  it("preserves the previous calendar date in a timezone behind UTC", () => {
    expect(
      createMemoryTemporalContext(
        "America/Los_Angeles",
        new Date("2026-08-04T02:30:00.000Z"),
      ).currentLocalDate,
    ).toBe("2026-08-03");
  });
});

describe("memory write policy guards", () => {
  it("normalizes equivalent text into the same deterministic hash", () => {
    expect(normalizeMemoryText("  Ian PREFERS direct feedback!! ")).toBe(
      "ian prefers direct feedback",
    );
    expect(memoryContentHash("Ian prefers direct feedback.")).toBe(
      memoryContentHash(" ian PREFERS direct feedback "),
    );
  });

  it("drops low-value facts, expired state, and duplicates", () => {
    const prepared = prepareMemoryCandidates(
      [
        candidate,
        { ...candidate, canonicalText: "IAN PREFERS DIRECT FEEDBACK!" },
        {
          ...candidate,
          canonicalText: "A passing detail",
          confidence: 0.4,
        },
        {
          ...candidate,
          canonicalText: "Ian is preparing for exams.",
          type: "situation",
          importance: 0.9,
          expiresAt: null,
        },
      ],
      {
        sourceMessageIds: new Set([sourceMessageId]),
        existingMemoryIds: new Set([existingMemoryId]),
        now: new Date("2026-08-03T16:00:00.000Z"),
      },
    );

    expect(prepared).toHaveLength(1);
    expect(prepared[0]?.canonicalText).toBe(candidate.canonicalText);
  });

  it("fails loudly when resolved evidence is not an eligible user message", () => {
    expect(() =>
      prepareMemoryCandidates(
        [
          {
            ...candidate,
            sourceMessageIds: ["11376b4f-8d6f-4487-9951-c1d6fd732ab1"],
          },
        ],
        {
          sourceMessageIds: new Set([sourceMessageId]),
          existingMemoryIds: new Set([existingMemoryId]),
          now: new Date("2026-08-03T16:00:00.000Z"),
        },
      ),
    ).toThrow(MemoryCandidateReferenceError);
  });

  it("accepts a valid correction only when its target was retrieved", () => {
    const correction: MemoryCandidate = {
      ...candidate,
      action: "correct",
      targetMemoryId: existingMemoryId,
      canonicalText: "Ian prefers gentle feedback when exhausted.",
    };

    expect(
      prepareMemoryCandidates([correction], {
        sourceMessageIds: new Set([sourceMessageId]),
        existingMemoryIds: new Set([existingMemoryId]),
        now: new Date("2026-08-03T16:00:00.000Z"),
      }),
    ).toHaveLength(1);
    expect(() =>
      prepareMemoryCandidates([correction], {
        sourceMessageIds: new Set([sourceMessageId]),
        existingMemoryIds: new Set(),
        now: new Date("2026-08-03T16:00:00.000Z"),
      }),
    ).toThrow(MemoryCandidateReferenceError);
  });
});

describe("memory retrieval ranking", () => {
  it("blends semantic relevance with importance, confidence, and boundaries", () => {
    const records: RetrievedMemory[] = [
      {
        id: existingMemoryId,
        type: "preference",
        canonicalText: "Ian likes concise replies.",
        importance: 0.7,
        confidence: 0.9,
        expiresAt: null,
        similarity: 0.75,
      },
      {
        id: "6ae44432-bfbd-42fe-896d-f9277473a347",
        type: "boundary",
        canonicalText: "Do not use guilt as motivation.",
        importance: 0.95,
        confidence: 1,
        expiresAt: null,
        similarity: 0.72,
      },
    ];

    expect(rankMemoryMatches(records, 1)[0]?.type).toBe("boundary");
  });
});
