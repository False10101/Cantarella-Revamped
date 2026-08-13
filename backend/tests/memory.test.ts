import { describe, expect, it } from "vitest";

import {
  memoryContentHash,
  normalizeMemoryText,
} from "../src/memory/memory-core.js";
import { reusableMemoryEmbeddingId } from "../src/memory/memory-embedding-history.js";
import {
  rankMemoryMatches,
  type RetrievedMemory,
} from "../src/memory/memory-retrieval.js";

describe("memory core", () => {
  it("reuses a historical embedding when canonical memory returns to old content", () => {
    expect(
      reusableMemoryEmbeddingId(
        [
          {
            id: "old-8k-vector",
            embeddingModel: "text-embedding-3-small",
            contentHash: "8k-hash",
          },
          {
            id: "current-2k-vector",
            embeddingModel: "text-embedding-3-small",
            contentHash: "2k-hash",
          },
        ],
        "text-embedding-3-small",
        "8k-hash",
      ),
    ).toBe("old-8k-vector");
  });

  it("normalizes equivalent text into the same deterministic hash", () => {
    expect(normalizeMemoryText("  Ian PREFERS direct feedback!! ")).toBe(
      "ian prefers direct feedback",
    );
    expect(memoryContentHash("Ian prefers direct feedback.")).toBe(
      memoryContentHash(" ian PREFERS direct feedback "),
    );
  });
});

describe("memory retrieval ranking", () => {
  it("blends semantic relevance with importance, confidence, and boundaries", () => {
    const records: RetrievedMemory[] = [
      {
        id: "2cafb281-a2b2-41c4-b6ee-b85fba970dbe",
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
