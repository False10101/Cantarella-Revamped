import { getEnvironment } from "../config/env.js";

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

export interface ModelCompletion {
  content: string;
  model: string;
  provider: string | null;
  usage: ModelUsage;
  latencyMs: number;
}

export interface JsonSchemaResponseFormat {
  name: string;
  schema: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  messages: ModelMessage[];
  temperature: number;
  maxTokens: number;
  responseFormat?: JsonSchemaResponseFormat;
  reasoning?: {
    effort?: "low" | "medium" | "high" | "xhigh";
    max_tokens?: number;
    exclude: boolean;
  };
}

type FetchImplementation = typeof fetch;

interface OpenRouterPayload {
  model?: string;
  provider?: string;
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  };
  error?: {
    message?: string;
  };
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export interface OpenRouterClient {
  complete(request: CompletionRequest): Promise<ModelCompletion>;
}

function requiredApiKey(): string {
  const apiKey = getEnvironment().OPENROUTER_API_KEY;

  if (!apiKey || apiKey === "replace-me") {
    throw new OpenRouterError(
      "OPENROUTER_API_KEY is not configured.",
      null,
      false,
    );
  }

  return apiKey;
}

export function createOpenRouterClient(
  fetchImplementation: FetchImplementation = fetch,
): OpenRouterClient {
  return {
    async complete(request) {
      const startedAt = Date.now();
      const environment = getEnvironment();
      const body: Record<string, unknown> = {
        model: request.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      };

      if (request.responseFormat) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: request.responseFormat.name,
            strict: true,
            schema: request.responseFormat.schema,
          },
        };
        body.provider = { require_parameters: true };
      }

      if (request.reasoning) body.reasoning = request.reasoning;

      let response: Response;

      try {
        response = await fetchImplementation(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${requiredApiKey()}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://cantarella.local",
              "X-Title": "Cantarella",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(environment.MODEL_TIMEOUT_MS),
          },
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "OpenRouter request failed.";
        throw new OpenRouterError(message, null, true);
      }

      const payload = (await response.json().catch(() => ({}))) as OpenRouterPayload;

      if (!response.ok) {
        throw new OpenRouterError(
          payload.error?.message ?? `OpenRouter returned HTTP ${response.status}.`,
          response.status,
          response.status === 408 ||
            response.status === 409 ||
            response.status === 429 ||
            response.status >= 500,
        );
      }

      const content = payload.choices?.[0]?.message?.content?.trim();

      if (!content) {
        throw new OpenRouterError(
          payload.error?.message ?? "OpenRouter returned an empty completion.",
          response.status,
          true,
        );
      }

      return {
        content,
        model: payload.model ?? request.model,
        provider: payload.provider ?? null,
        usage: {
          inputTokens: payload.usage?.prompt_tokens ?? null,
          outputTokens: payload.usage?.completion_tokens ?? null,
          estimatedCostUsd: payload.usage?.cost ?? null,
        },
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}
