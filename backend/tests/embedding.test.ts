import { describe, expect, it } from "vitest";

import {
  createEmbeddingClient,
  EmbeddingError,
} from "../src/models/embedding.js";

describe("OpenAI embedding client", () => {
  it("requests and validates 1536-dimensional float embeddings", async () => {
    let body: Record<string, unknown> | undefined;
    const client = createEmbeddingClient(async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          model: "text-embedding-3-small",
          data: [{ index: 0, embedding: Array.from({ length: 1_536 }, () => 0) }],
          usage: { prompt_tokens: 4, total_tokens: 4 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await client.embed(["Ian prefers concise replies."]);

    expect(body).toMatchObject({
      model: "text-embedding-3-small",
      dimensions: 1_536,
      encoding_format: "float",
    });
    expect(result.vectors[0]).toHaveLength(1_536);
    expect(result.inputTokens).toBe(4);
  });

  it("rejects malformed vectors instead of writing them", async () => {
    const client = createEmbeddingClient(async () =>
      new Response(
        JSON.stringify({
          data: [{ index: 0, embedding: [0.1, 0.2] }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(client.embed(["hello"])).rejects.toMatchObject({
      name: "EmbeddingError",
      retryable: true,
    } satisfies Partial<EmbeddingError>);
  });

  it("marks rate limits retryable", async () => {
    const client = createEmbeddingClient(async () =>
      new Response(JSON.stringify({ error: { message: "slow down" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(client.embed(["hello"])).rejects.toMatchObject({
      status: 429,
      retryable: true,
    });
  });
});

