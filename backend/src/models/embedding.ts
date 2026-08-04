import { getEnvironment } from "../config/env.js";

const EMBEDDING_DIMENSIONS = 1_536;

type FetchImplementation = typeof fetch;

interface EmbeddingPayload {
  data?: Array<{
    embedding?: number[];
    index?: number;
  }>;
  model?: string;
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

export interface EmbeddingGeneration {
  vectors: number[][];
  model: string;
  dimensions: number;
  inputTokens: number | null;
  latencyMs: number;
}

export interface EmbeddingClient {
  embed(inputs: string[]): Promise<EmbeddingGeneration>;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

function requiredApiKey(): string {
  const apiKey = getEnvironment().OPENROUTER_API_KEY;

  if (!apiKey || apiKey === "replace-me") {
    throw new EmbeddingError(
      "OPENROUTER_API_KEY is not configured.",
      null,
      false,
    );
  }

  return apiKey;
}

function validateInputs(inputs: string[]): string[] {
  const normalized = inputs.map((input) => input.trim());

  if (normalized.length === 0 || normalized.some((input) => input.length === 0)) {
    throw new EmbeddingError(
      "Embedding input must contain at least one non-empty string.",
      null,
      false,
    );
  }

  return normalized;
}

export function createEmbeddingClient(
  fetchImplementation: FetchImplementation = fetch,
): EmbeddingClient {
  return {
    async embed(inputs) {
      const normalizedInputs = validateInputs(inputs);
      const environment = getEnvironment();
      const startedAt = Date.now();
      let response: Response;

      try {
        response = await fetchImplementation(
          "https://openrouter.ai/api/v1/embeddings",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${requiredApiKey()}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: environment.EMBEDDING_MODEL,
              input: normalizedInputs,
              dimensions: EMBEDDING_DIMENSIONS,
              encoding_format: "float",
            }),
            signal: AbortSignal.timeout(environment.MODEL_TIMEOUT_MS),
          },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Embedding request failed.";
        throw new EmbeddingError(message, null, true);
      }

      const payload = (await response.json().catch(() => ({}))) as EmbeddingPayload;

      if (!response.ok) {
        throw new EmbeddingError(
          payload.error?.message ?? `OpenRouter returned HTTP ${response.status}.`,
          response.status,
          response.status === 408 ||
            response.status === 409 ||
            response.status === 429 ||
            response.status >= 500,
        );
      }

      const ordered = [...(payload.data ?? [])].sort(
        (left, right) => (left.index ?? 0) - (right.index ?? 0),
      );
      const vectors = ordered.map((item) => item.embedding ?? []);

      if (
        vectors.length !== normalizedInputs.length ||
        vectors.some(
          (vector) =>
            vector.length !== EMBEDDING_DIMENSIONS ||
            vector.some((value) => !Number.isFinite(value)),
        )
      ) {
        throw new EmbeddingError(
          "OpenRouter returned malformed embedding vectors.",
          response.status,
          true,
        );
      }

      return {
        vectors,
        model: payload.model ?? environment.EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        inputTokens:
          payload.usage?.prompt_tokens ?? payload.usage?.total_tokens ?? null,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}
