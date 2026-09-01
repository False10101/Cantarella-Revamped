import { describe, expect, it } from "vitest";

import {
  embedTexts,
  EmbeddingError,
} from "../src/models/embedding.js";

describe("OpenRouter embedding client", () => {
  it("requests and validates 1536-dimensional float embeddings", async () => {
    let body: Record<string, unknown> | undefined;
    const complete = async (...args: Parameters<typeof fetch>) => {
      const [_input, init] = args;
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "openai/text-embedding-3-small",
          data: [{ index: 0, embedding: Array.from({ length: 1_536 }, () => 0) }],
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const result = await embedTexts(["Ian prefers concise replies."], complete);

    expect(body).toMatchObject({
      model: "openai/text-embedding-3-small",
      dimensions: 1_536,
      encoding_format: "float",
    });
    expect(result.vectors[0]).toHaveLength(1_536);
    expect(result.inputTokens).toBe(4);
  });

  it("rejects malformed vectors instead of writing them", async () => {
    const complete = async () =>
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.1, 0.2] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    await expect(embedTexts(["hello"], complete)).rejects.toMatchObject({
      name: "EmbeddingError",
      retryable: true,
    } satisfies Partial<EmbeddingError>);
  });

  it("marks rate limits retryable", async () => {
    const complete = async () =>
      new Response(JSON.stringify({ error: { message: "slow down" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });

    await expect(embedTexts(["hello"], complete)).rejects.toMatchObject({
      status: 429,
      retryable: true,
    });
  });
});
