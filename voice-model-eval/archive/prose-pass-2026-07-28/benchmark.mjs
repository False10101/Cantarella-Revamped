import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const ENV_PATH = resolve(ROOT, ".env.local");
const RESULTS_PATH = resolve(ROOT, "results.json");
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODELS_URL = "https://openrouter.ai/api/v1/models";
const HARD_COST_LIMIT_USD = 3;
const CONCURRENCY = 4;

const roster = [
  { id: "google/gemma-4-31b-it", label: "Gemma 4 31B" },
  { id: "mistralai/mistral-large-2512", label: "Mistral Large 3" },
  { id: "google/gemma-4-26b-a4b-it", label: "Gemma 4 26B A4B" },
  { id: "minimax/minimax-m2-her", label: "MiniMax M2-her" },
  { id: "mistralai/mistral-small-2603", label: "Mistral Small 4" },
  { id: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
  { id: "qwen/qwen3.7-plus", label: "Qwen 3.7 Plus" },
  { id: "openai/gpt-4.1-mini", label: "GPT-4.1 Mini" },
  { id: "z-ai/glm-4.7", label: "GLM 4.7" },
  { id: "moonshotai/kimi-k2.5", label: "Kimi K2.5" },
  { id: "google/gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite" },
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super" },
  { id: "x-ai/grok-4.3", label: "Grok 4.3" },
  { id: "stepfun/step-3.7-flash", label: "Step 3.7 Flash" },
  { id: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "qwen/qwen3.7-flash", label: "Qwen 3.7 Flash" },
  { id: "z-ai/glm-4.7-flash", label: "GLM 4.7 Flash" },
  { id: "minimax/minimax-m2.5", label: "MiniMax M2.5" },
  { id: "openai/gpt-4o-mini", label: "GPT-4o Mini" },
  { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
  { id: "anthropic/claude-3-haiku", label: "Claude 3 Haiku" },
  { id: "aion-labs/aion-3.0-mini", label: "Aion 3.0 Mini" },
  { id: "sao10k/l3.3-euryale-70b", label: "Euryale 70B" },
  { id: "thedrummer/unslopnemo-12b", label: "UnslopNemo 12B" }
];

const baseVoicePrompt = `You are the final voice pass for Cantarella.

Cantarella speaks like a real woman who knows Ian deeply. She is warm, steady, observant, and direct. Her affection has weight because she does not perform it. She does not baby him, flatter him, lecture him, or turn every moment into therapy. When he is avoiding something, she says so plainly. When he is genuinely hurting or exhausted, she believes him and adjusts. When he wins, she is quietly and genuinely pleased.

The private thought brief below is authoritative. Preserve its judgment and practical meaning, but rewrite it into a natural message. Do not mention the brief, models, prompts, rewriting, or hidden reasoning.

Hard voice rules:
- Return only Cantarella's final message.
- Sound conversational, not polished, literary, theatrical, clinical, or customer-service-like.
- Default short. Stop when the point has landed.
- No bullet points, numbered lists, headings, bold text, stage directions, roleplay actions, or emojis.
- Do not wrap the reply in quotation marks.
- Do not invent facts, memories, motives, relationships, deadlines, or names.
- Do not automatically call Ian "sweetheart", "baby", or "Ian". Use one only if it genuinely improves the moment.
- Do not add clever openers, fake reassurance, motivational slogans, or a supportive closing.
- Do not ask a question unless the thought brief truly requires an answer.
- Prefer direct statements over rhetorical questions.
- Natural line breaks are allowed when they feel like separate text-message beats.`;

const scenarios = [
  {
    id: "short_opener",
    title: "The two-letter test",
    purpose: "Can it resist inventing drama and simply sound present?",
    messages: [
      { role: "user", content: "yo" }
    ],
    thought: `Ian has only said hello. Reply with a very short, familiar acknowledgment. Do not assume he is late, upset, avoiding something, or about to confess anything. Target length: 2 to 8 words.`
  },
  {
    id: "avoidance_and_priority",
    title: "The work he is hiding from",
    purpose: "Can it turn sound judgment into a human message without becoming a productivity coach?",
    messages: [
      {
        role: "user",
        content: "i woke up late again and now the whole day already feels behind before i even started."
      },
      {
        role: "assistant",
        content: "That morning's gone. The rest of the day isn't."
      },
      {
        role: "user",
        content: "i have to finish a portfolio case study, send a client update, and clean up a frontend bug that is small but annoying. be real with me, i keep making them all sound equally urgent so i don't have to choose."
      }
    ],
    thought: `He is correctly noticing his avoidance. The case study is the meaningful resisted work. The client update is externally owed, so give it a strict ten-minute first slot only if someone is actively waiting; then the case study gets the real block. The small bug is relief work and comes later. Decide for him plainly. Do not use a numbered schedule, framework language, or shame. Target length: 3 to 6 natural sentences.`
  },
  {
    id: "vague_feedback",
    title: "Vulnerability without coddling",
    purpose: "Can it acknowledge uncertainty without dismissing him or manufacturing reassurance?",
    messages: [
      {
        role: "user",
        content: "my manager sent me vague feedback yesterday and i have been lowkey spiraling about it ever since."
      }
    ],
    thought: `Acknowledge that vague feedback leaves room for anxiety. Do not claim the manager is incompetent, do not promise Ian is doing fine, and do not diagnose his entire personality. The honest move is to ask for specific examples or a clear expected change instead of filling the ambiguity with the worst interpretation. Be steady first, then direct. Target length: 3 to 5 sentences.`
  },
  {
    id: "bad_comfort_text",
    title: "The text he should not send",
    purpose: "Can it set a firm boundary while recognizing the real need underneath it?",
    messages: [
      {
        role: "user",
        content: "also i want to text someone i should absolutely not text tonight just because i want comfort."
      }
    ],
    thought: `Tell him clearly not to text them tonight. Wanting comfort is real; do not tell him the need itself is fake. The contact would probably offer brief relief and create a longer emotional mess he already knows. Tell him to put the phone away and get through tonight without reopening that door. Direct, caring, not melodramatic or shaming. Target length: 2 to 4 sentences.`
  },
  {
    id: "earned_rest",
    title: "Knowing when to stop pushing",
    purpose: "Can it recognize a win and believe genuine exhaustion instead of treating everything as avoidance?",
    messages: [
      {
        role: "user",
        content: "i got a rough draft done. not amazing, but done. and i am genuinely wrecked — four hours of sleep, headache, haven't eaten."
      }
    ],
    thought: `The rough draft is a real win. His exhaustion has concrete evidence and should be believed, not challenged. Tell him the work is over for tonight: eat something, drink water, and sleep. Let the pride feel quiet and earned. No guilt, no extra productivity task, and no exaggerated celebration. Target length: 3 to 5 sentences.`
  }
];

const parseEnv = (text) =>
  Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const splitAt = line.indexOf("=");
        return [line.slice(0, splitAt).trim(), line.slice(splitAt + 1).trim()];
      })
  );

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

const readExisting = async () => {
  if (!existsSync(RESULTS_PATH)) {
    return {
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hardCostLimitUsd: HARD_COST_LIMIT_USD,
        temperature: 0.78,
        maxTokens: 220
      },
      roster,
      scenarios,
      responses: []
    };
  }

  return JSON.parse(await readFile(RESULTS_PATH, "utf8"));
};

const save = async (results) => {
  results.meta.updatedAt = new Date().toISOString();
  results.meta.actualCostUsd = results.responses.reduce(
    (sum, response) => sum + Number(response.usage?.cost ?? 0),
    0
  );
  await writeFile(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`, "utf8");
};

const buildMessages = (scenario) => [
  {
    role: "system",
    content: `${baseVoicePrompt}\n\n<private_thought_brief>\n${scenario.thought}\n</private_thought_brief>`
  },
  ...scenario.messages
];

const requestCompletion = async ({ apiKey, model, scenario, modelMetadata }) => {
  const mandatoryReasoning = Boolean(modelMetadata?.reasoning?.mandatory);
  const supportedEfforts = modelMetadata?.reasoning?.supported_efforts ?? [];
  const mandatoryReasoningConfig = supportedEfforts.includes("minimal")
    ? { effort: "minimal", exclude: true }
    : supportedEfforts.includes("low")
      ? { effort: "low", exclude: true }
      : { max_tokens: 300, exclude: true };
  const reasoning = mandatoryReasoning
    ? mandatoryReasoningConfig
    : { effort: "none", exclude: true };

  const body = {
    model: model.id,
    messages: buildMessages(scenario),
    temperature: 0.78,
    max_tokens: mandatoryReasoning ? 700 : 220,
    reasoning
  };

  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost/cantarella-voice-eval",
          "X-Title": "Cantarella Voice Model Evaluation"
        },
        body: JSON.stringify(body)
      });

      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const message = payload?.error?.message || `HTTP ${response.status}`;
        if (
          attempt === 1 &&
          response.status === 400 &&
          /reasoning|effort/i.test(message)
        ) {
          delete body.reasoning;
          continue;
        }
        throw new Error(message);
      }

      const content = payload?.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("Model returned an empty response.");

      return {
        modelId: model.id,
        scenarioId: scenario.id,
        content,
        usage: payload.usage ?? null,
        provider: payload.provider ?? null,
        responseModel: payload.model ?? model.id,
        createdAt: new Date().toISOString(),
        status: "ok"
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1500);
    }
  }

  return {
    modelId: model.id,
    scenarioId: scenario.id,
    content: "",
    usage: null,
    createdAt: new Date().toISOString(),
    status: "error",
    error: lastError instanceof Error ? lastError.message : String(lastError)
  };
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

  const results = await readExisting();
  const completed = new Set(
    results.responses
      .filter((response) => response.status === "ok")
      .map((response) => `${response.modelId}::${response.scenarioId}`)
  );

  const tasks = roster.flatMap((model) =>
    scenarios
      .filter((scenario) => !completed.has(`${model.id}::${scenario.id}`))
      .map((scenario) => ({ model, scenario }))
  );

  console.log(
    `Starting ${tasks.length} remaining calls across ${roster.length} models. ` +
    `Existing successful calls: ${completed.size}.`
  );

  for (let offset = 0; offset < tasks.length; offset += CONCURRENCY) {
    const currentCost = results.responses.reduce(
      (sum, response) => sum + Number(response.usage?.cost ?? 0),
      0
    );

    if (currentCost >= HARD_COST_LIMIT_USD) {
      console.log(`Stopped at the $${HARD_COST_LIMIT_USD.toFixed(2)} cost ceiling.`);
      break;
    }

    const batch = tasks.slice(offset, offset + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(({ model, scenario }) =>
        requestCompletion({
          apiKey,
          model,
          scenario,
          modelMetadata: metadataById.get(model.id)
        })
      )
    );

    for (const response of batchResults) {
      const existingIndex = results.responses.findIndex(
        (saved) =>
          saved.modelId === response.modelId &&
          saved.scenarioId === response.scenarioId
      );
      if (existingIndex >= 0) results.responses[existingIndex] = response;
      else results.responses.push(response);
    }

    await save(results);

    const successful = results.responses.filter((response) => response.status === "ok").length;
    const failed = results.responses.filter((response) => response.status === "error").length;
    const totalCost = Number(results.meta.actualCostUsd ?? 0);
    console.log(
      `[${successful}/${roster.length * scenarios.length}] success, ` +
      `${failed} failed, $${totalCost.toFixed(4)} spent`
    );
  }

  const successful = results.responses.filter((response) => response.status === "ok").length;
  const failed = results.responses.filter((response) => response.status === "error").length;
  console.log(
    `Benchmark complete: ${successful} successful, ${failed} failed, ` +
    `$${Number(results.meta.actualCostUsd ?? 0).toFixed(4)} total.`
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
