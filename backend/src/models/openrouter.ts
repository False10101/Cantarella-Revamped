import { getEnvironment } from "../config/env.js";

export interface ModelToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ModelToolCall[];
  toolCallId?: string;
  name?: string;
  reasoning?: string;
  reasoningDetails?: unknown[];
}

export interface ModelUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUsd: number | null;
}

export interface ModelCompletion {
  content: string;
  toolCalls?: ModelToolCall[];
  reasoning?: string;
  reasoningDetails?: unknown[];
  finishReason?: string | null;
  model: string;
  provider: string | null;
  usage: ModelUsage;
  latencyMs: number;
}

export interface JsonSchemaResponseFormat {
  name: string;
  schema: Record<string, unknown>;
}

export interface ModelFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface CompletionRequest {
  model: string;
  messages: ModelMessage[];
  temperature: number;
  maxTokens: number;
  responseFormat?: JsonSchemaResponseFormat;
  tools?: ModelFunctionTool[];
  toolChoice?: "auto" | "none" | {
    type: "function";
    function: { name: string };
  };
  parallelToolCalls?: boolean;
  reasoning?: {
    effort?: "low" | "medium" | "high" | "xhigh";
    max_tokens?: number;
    exclude: boolean;
  };
  providerRouting?: {
    order: string[];
    allowFallbacks: boolean;
    maxPrice?: {
      prompt: number;
      completion: number;
    };
  };
}

type FetchImplementation = typeof fetch;

interface OpenRouterPayload {
  model?: string;
  provider?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | null;
      tool_calls?: ModelToolCall[];
      reasoning?: string | null;
      reasoning_content?: string | null;
      reasoning_details?: unknown[];
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
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.toolCalls ? null : message.content,
          ...(message.toolCalls ? { tool_calls: message.toolCalls } : {}),
          ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
          ...(message.name ? { name: message.name } : {}),
          ...(message.reasoning ? { reasoning: message.reasoning } : {}),
          ...(message.reasoningDetails
            ? { reasoning_details: message.reasoningDetails }
            : {}),
        })),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
      };

      if (request.providerRouting) {
        body.provider = {
          order: request.providerRouting.order,
          allow_fallbacks: request.providerRouting.allowFallbacks,
          ...(request.providerRouting.maxPrice
            ? { max_price: request.providerRouting.maxPrice }
            : {}),
        };
      }

      if (request.responseFormat) {
        body.response_format = {
          type: "json_schema",
          json_schema: {
            name: request.responseFormat.name,
            strict: true,
            schema: request.responseFormat.schema,
          },
        };
      }

      if (request.tools) {
        body.tools = request.tools;
        body.tool_choice = request.toolChoice ?? "auto";
        if (request.parallelToolCalls !== undefined) {
          body.parallel_tool_calls = request.parallelToolCalls;
        }
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

      const choice = payload.choices?.[0];
      const content = choice?.message?.content?.trim() ?? "";
      const toolCalls = choice?.message?.tool_calls ?? [];
      const reasoning =
        choice?.message?.reasoning ??
        choice?.message?.reasoning_content ??
        undefined;
      const reasoningDetails = choice?.message?.reasoning_details;

      if (!content && toolCalls.length === 0) {
        throw new OpenRouterError(
          payload.error?.message ?? "OpenRouter returned an empty completion.",
          response.status,
          true,
        );
      }

      return {
        content,
        toolCalls,
        ...(reasoning ? { reasoning } : {}),
        ...(reasoningDetails ? { reasoningDetails } : {}),
        finishReason: choice?.finish_reason ?? null,
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
