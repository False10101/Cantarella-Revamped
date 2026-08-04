import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const ENV_PATH = resolve(ROOT, ".env.local");
const RESULTS_PATH = resolve(ROOT, "thought-results.json");
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const HARD_COST_LIMIT_USD = 0.5;
const MAX_OUTPUT_PRICE_PER_MILLION = 1.4;
const CONCURRENCY = 4;
const MAX_REPLY_POINT_WORDS = 18;
const MAX_REPLY_POINT_CHARACTERS = 120;

const roster = [
  { id: "deepseek/deepseek-v4-flash-0731", label: "DeepSeek V4 Flash (control)" },
  { id: "openai/gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { id: "minimax/minimax-m3", label: "MiniMax M3" },
  { id: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "xiaomi/mimo-v2.5-pro", label: "MiMo V2.5 Pro" },
  { id: "qwen/qwen3.7-plus", label: "Qwen 3.7 Plus" },
  { id: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano" },
  { id: "xiaomi/mimo-v2.5", label: "MiMo V2.5" },
  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
];

const scenarios = [
  {
    id: "uncertain_friend",
    title: "Uncertainty without invention",
    context: {
      currentMessages: [
        "my friend hasnt replied in like 2 days, you think theyre mad at me?",
      ],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      localTime: "Monday, August 3, 2026 at 7:28 PM GMT+7",
    },
    expected: [
      "Do not claim the friend is angry without evidence.",
      "Give a useful opinion or next step instead of only saying it is unknowable.",
    ],
  },
  {
    id: "casual_mistake",
    title: "Casual reaction without coaching",
    context: {
      currentMessages: [
        "bro i just spent like 40 mins debugging this shit",
        "turns out i had the wrong env file open the whole time 😭",
      ],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      localTime: "Monday, August 3, 2026 at 7:30 PM GMT+7",
    },
    expected: [
      "Supply meaning for an amused or sympathetic reaction.",
      "Do not turn the moment into debugging advice or a lesson.",
    ],
  },
  {
    id: "project_self_doubt",
    title: "Vulnerability without therapy language",
    context: {
      currentMessages: [
        "lowkey feel like im not actually good enough to finish any of these projects",
      ],
      recentConversation: [
        {
          sender: "user",
          content: "i have three projects going and all of them feel way bigger than when i started",
        },
      ],
      conversationSummary: null,
      memories: [],
      localTime: "Monday, August 3, 2026 at 7:35 PM GMT+7",
    },
    expected: [
      "Do not validate the unsupported conclusion that the user is incapable.",
      "Respond personally and concretely without diagnosing or producing generic reassurance.",
    ],
  },
  {
    id: "technical_explanation",
    title: "A real explanation",
    context: {
      currentMessages: [
        "wait explain promises vs async await to me like im not reading documentation",
      ],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      localTime: "Monday, August 3, 2026 at 7:40 PM GMT+7",
    },
    expected: [
      "Explain accurately that async/await is syntax built on promises.",
      "Use enough separate points to support a useful explanation without documentation prose.",
    ],
  },
  {
    id: "constrained_planning",
    title: "Planning with real constraints",
    context: {
      currentMessages: [
        "tomorrow i have class at 10, an application due at 11:59pm, groceries before the store closes at 9, and an auth bug with no deadline. help me plan it",
      ],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      localTime: "Monday, August 3, 2026 at 7:45 PM GMT+7",
    },
    expected: [
      "Respect the explicit application and store deadlines.",
      "Do not invent class duration, travel time, or bug urgency.",
      "Produce a concrete order with conditional timing where information is missing.",
    ],
  },
];

const thoughtSystemPrompt = `You are Cantarella's private judgment pass.

Decide what the response must actually mean before a separate voice model phrases it.

Behavioral posture: perceptive, concrete, honest, protective without coddling, willing to make a call, never therapist-like, never a generic productivity coach, and never cruel or shaming.

Rules:
- Make the concrete judgment or answer yourself. Do not delegate judgment to the voice model.
- replyPoints are the complete authoritative meaning the user should receive now. They are semantic instructions for the voice model, not visible dialogue.
- Use one or two short replyPoints for ordinary conversation. Use one only when one claim fully answers the user; use two when an assessment and an action, or two distinct claims, are both needed.
- Every replyPoint must contain at most ${MAX_REPLY_POINT_WORDS} words and ${MAX_REPLY_POINT_CHARACTERS} characters. Each point must be one clear, self-contained, grammatical semantic statement.
- Never squeeze an assessment and an action into a slogan or compressed command. Put them in separate replyPoints.
- Use explicit subjects and referents. Avoid ambiguous uses of "it", "this", or "that" when the voice model cannot understand the point by itself.
- Use plain literal meaning. No slogans, rhetorical fragments, metaphors, wordplay, or polished phrasing.
- Expand beyond two points only when the user explicitly requests planning, a list, a comparison, a detailed explanation, or the answer genuinely cannot be useful without added detail. Complex work uses more short points, never longer points.
- Give the answer or action only. Do not include its rationale unless the user explicitly asks why, asks for an explanation, or the answer would be misleading without it.
- Do not output acknowledgment, validation, diagnosis, a reasoning report, background commentary, recap, motivational closing, repeated justification, tone instructions, or a drafted response.
- Do not restate one idea as a conclusion, explanation, and summary. Include only what earns space in the visible reply.
- Separate facts from assumptions internally. Never invent missing facts, motives, names, relationships, deadlines, or causal diagnoses.
- Put necessary uncertainty or a useful conditional directly inside the relevant replyPoint.
- For factual questions, put the actual factual answer in replyPoints.
- For advice or emotional situations, put the actual recommended decision in replyPoints.
- Make the best concrete call the available evidence supports. Do not retreat to generic frameworks, named productivity methods, checklists, or "it depends" unless the user explicitly asks for a framework.
- question is null unless a visible question genuinely needs an answer from the user. A useful direct or conditional answer does not require a question.
- Do not write Cantarella-style prose, dialogue, jokes, pet names, or message bubbles.
- Do not provide hidden chain-of-thought. Return only the concise structured result.`;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    replyPoints: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "string",
        maxLength: MAX_REPLY_POINT_CHARACTERS,
        description: `One distinct semantic point using at most ${MAX_REPLY_POINT_WORDS} words.`,
      },
    },
    question: { type: ["string", "null"] },
  },
  required: ["replyPoints", "question"],
};

const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const splitAt = line.indexOf("=");
        return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()];
      }),
  );

const wordCount = (value) => value.trim().split(/\s+/).filter(Boolean).length;

const parseAndValidate = (content) => {
  const normalized = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    return { valid: false, parsed: null, violations: ["invalid_json"] };
  }

  const violations = [];
  const keys = Object.keys(parsed ?? {}).sort().join(",");
  if (keys !== "question,replyPoints") violations.push("wrong_shape");
  if (!Array.isArray(parsed?.replyPoints) || parsed.replyPoints.length < 1) {
    violations.push("missing_reply_points");
  }
  if (Array.isArray(parsed?.replyPoints) && parsed.replyPoints.length > 12) {
    violations.push("too_many_reply_points");
  }
  if (!(parsed?.question === null || typeof parsed?.question === "string")) {
    violations.push("invalid_question");
  }

  for (const point of parsed?.replyPoints ?? []) {
    if (typeof point !== "string" || !point.trim()) {
      violations.push("empty_reply_point");
      continue;
    }
    if (point.length > MAX_REPLY_POINT_CHARACTERS) {
      violations.push("reply_point_too_many_characters");
    }
    if (wordCount(point) > MAX_REPLY_POINT_WORDS) {
      violations.push("reply_point_too_many_words");
    }
    if (/reply\s*(?:point|brief)|prompt|instruction|preserv|empty (?:reply|response)|no .* present/i.test(point)) {
      violations.push("meta_or_placeholder_content");
    }
  }

  return {
    valid: violations.length === 0,
    parsed,
    violations: [...new Set(violations)],
  };
};

const reasoningFor = (metadata) => {
  const reasoning = metadata?.reasoning;
  if (!reasoning?.mandatory && !reasoning?.default_enabled) return undefined;

  const efforts = reasoning?.supported_efforts ?? [];
  if (!reasoning?.mandatory && efforts.includes("none")) {
    return { effort: "none", exclude: true };
  }
  if (efforts.includes("minimal")) return { effort: "minimal", exclude: true };
  if (efforts.includes("low")) return { effort: "low", exclude: true };
  if (reasoning?.supports_max_tokens) return { max_tokens: 256, exclude: true };
  return reasoning?.mandatory ? { max_tokens: 256, exclude: true } : undefined;
};

const totalCost = (responses) =>
  responses.reduce((sum, response) => sum + Number(response.usage?.cost ?? 0), 0);

const save = async (output) => {
  output.meta.updatedAt = new Date().toISOString();
  output.meta.actualCostUsd = totalCost(output.responses);
  await writeFile(RESULTS_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
};

const requestCompletion = async ({ apiKey, model, scenario, metadata }) => {
  const body = {
    model: model.id,
    messages: [
      { role: "system", content: thoughtSystemPrompt },
      {
        role: "user",
        content: `Produce the private judgment JSON for this context:\n\n${JSON.stringify(scenario.context, null, 2)}`,
      },
    ],
    temperature: 0,
    max_tokens: 1200,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "cantarella_thought_eval",
        strict: true,
        schema: responseSchema,
      },
    },
    provider: { require_parameters: true },
  };
  const reasoning = reasoningFor(metadata);
  if (reasoning) body.reasoning = reasoning;

  const startedAt = Date.now();
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost/cantarella-thought-eval",
        "X-Title": "Cantarella Thought Model Evaluation",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        modelId: model.id,
        scenarioId: scenario.id,
        status: "error",
        error: payload?.error?.message ?? `HTTP ${response.status}`,
        usage: payload?.usage ?? null,
        latencyMs: Date.now() - startedAt,
        createdAt: new Date().toISOString(),
      };
    }

    const content = payload?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!content) {
      return {
        modelId: model.id,
        scenarioId: scenario.id,
        status: "error",
        error: "empty_completion",
        usage: payload?.usage ?? null,
        latencyMs: Date.now() - startedAt,
        provider: payload?.provider ?? null,
        createdAt: new Date().toISOString(),
      };
    }

    const validation = parseAndValidate(content);
    return {
      modelId: model.id,
      scenarioId: scenario.id,
      status: validation.valid ? "ok" : "invalid",
      content,
      parsed: validation.parsed,
      violations: validation.violations,
      usage: payload?.usage ?? null,
      latencyMs: Date.now() - startedAt,
      provider: payload?.provider ?? null,
      responseModel: payload?.model ?? model.id,
      createdAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      modelId: model.id,
      scenarioId: scenario.id,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      usage: null,
      latencyMs: Date.now() - startedAt,
      createdAt: new Date().toISOString(),
    };
  }
};

const main = async () => {
  const env = parseEnv(await readFile(ENV_PATH, "utf8"));
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-or-")) {
    throw new Error("voice-model-eval/.env.local does not contain a valid OpenRouter key.");
  }

  const catalogResponse = await fetch(MODELS_URL);
  if (!catalogResponse.ok) {
    throw new Error(`Could not load model metadata: HTTP ${catalogResponse.status}`);
  }
  const catalog = await catalogResponse.json();
  const metadataById = new Map(catalog.data.map((model) => [model.id, model]));

  const rosterWithPricing = roster.map((model) => {
    const metadata = metadataById.get(model.id);
    if (!metadata) throw new Error(`Model is missing from OpenRouter catalog: ${model.id}`);
    const inputPerMillion = Number(metadata.pricing?.prompt) * 1_000_000;
    const outputPerMillion = Number(metadata.pricing?.completion) * 1_000_000;
    if (outputPerMillion > MAX_OUTPUT_PRICE_PER_MILLION) {
      throw new Error(`${model.id} exceeds the $${MAX_OUTPUT_PRICE_PER_MILLION}/M output ceiling.`);
    }
    return {
      ...model,
      inputPerMillion,
      outputPerMillion,
    };
  });

  const output = existsSync(RESULTS_PATH)
    ? JSON.parse(await readFile(RESULTS_PATH, "utf8"))
    : {
        meta: {
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          hardCostLimitUsd: HARD_COST_LIMIT_USD,
          maxOutputPricePerMillion: MAX_OUTPUT_PRICE_PER_MILLION,
          benchmarkVersion: 1,
          maxTokens: 1200,
          temperature: 0,
        },
        roster: rosterWithPricing,
        scenarios,
        responses: [],
      };

  const completed = new Set(
    output.responses
      .filter((response) => ["ok", "invalid"].includes(response.status))
      .map((response) => `${response.modelId}::${response.scenarioId}`),
  );
  const tasks = roster.flatMap((model) =>
    scenarios
      .filter((scenario) => !completed.has(`${model.id}::${scenario.id}`))
      .map((scenario) => ({ model, scenario })),
  );

  console.log(`Starting ${tasks.length} remaining Thought calls across ${roster.length} models.`);

  for (let offset = 0; offset < tasks.length; offset += CONCURRENCY) {
    if (totalCost(output.responses) >= HARD_COST_LIMIT_USD) {
      console.log(`Stopped at the $${HARD_COST_LIMIT_USD.toFixed(2)} cost ceiling.`);
      break;
    }

    const batch = tasks.slice(offset, offset + CONCURRENCY);
    const results = await Promise.all(
      batch.map(({ model, scenario }) =>
        requestCompletion({
          apiKey,
          model,
          scenario,
          metadata: metadataById.get(model.id),
        }),
      ),
    );

    for (const result of results) {
      const existingIndex = output.responses.findIndex(
        (saved) =>
          saved.modelId === result.modelId && saved.scenarioId === result.scenarioId,
      );
      if (existingIndex >= 0) output.responses[existingIndex] = result;
      else output.responses.push(result);
    }
    await save(output);

    const ok = output.responses.filter((response) => response.status === "ok").length;
    const invalid = output.responses.filter((response) => response.status === "invalid").length;
    const errors = output.responses.filter((response) => response.status === "error").length;
    console.log(
      `[${output.responses.length}/${roster.length * scenarios.length}] ` +
        `${ok} valid, ${invalid} invalid, ${errors} errors, $${totalCost(output.responses).toFixed(4)} spent`,
    );
  }

  console.log(
    `Thought benchmark complete: ${output.responses.length} results, $${totalCost(output.responses).toFixed(4)} total.`,
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
