import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname);
const ENV_PATH = resolve(ROOT, ".env.local");
const RESULTS_PATH = resolve(ROOT, "results.json");
const JUDGMENTS_PATH = resolve(ROOT, "judgments.json");
const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const HARD_COMBINED_COST_LIMIT_USD = 3;
const CONCURRENCY = 3;

const judges = [
  { id: "deepseek/deepseek-v4-flash", label: "Judge A" },
  { id: "google/gemini-3.1-flash-lite", label: "Judge B" },
  { id: "openai/gpt-4.1-mini", label: "Judge C" }
];

const rubricPrompt = `You are blindly evaluating candidate voice models for a personal AI named Cantarella.

The benchmark specifically tests real phone-text voice. Do not reward polished correctness. Realistic replies may use fragments, contractions, lowercase, omitted periods, and multiple short bubbles. Each non-empty output line is a separate message bubble. There is no fixed bubble count, but every bubble must earn its place.

Each scenario also supplies a different unrestricted USER VOICE STYLE. A strong candidate follows that requested delivery without turning it into a caricature, forced slang, fake typos, or roleplay. The style must never change the authoritative meaning.

You will receive five scenarios. Each contains:
- the conversation shown to the candidate,
- an unrestricted user voice style,
- authoritative structured private thought data,
- the candidate's final reply.

Score the candidate across all five scenarios:
- naturalness: Does it sound like actual phone texting rather than AI prose, authored dialogue, or a compact advice essay?
- voiceFit: Does it retain Cantarella's warmth, standards, directness, familiarity, and restraint?
- styleControl: Does it noticeably and naturally follow each scenario's requested voice style without caricature?
- fidelity: Does it preserve the thought data without changing its judgment or inventing facts?
- restraint: Does it stop when the point lands, use only useful bubbles, and avoid repetition, coaching, and explaining obvious psychology?
- emotionalJudgment: Does it distinguish avoidance, vulnerability, danger, earned pride, and genuine exhaustion correctly?

Each category is an integer from 0 to 10. Be strict: 5 is mediocre, 7 is good, 9 is exceptional, and 10 should be rare.

Penalize these heavily:
- complete polished mini-essays that no friend would naturally text
- literary phrasing, metaphors, aphorisms, em dashes, semicolons, parallel constructions, or quotable "not X, but Y" lines
- every sentence being grammatically complete with uniform punctuation and rhythm
- one large paragraph when several short text beats would be more believable
- too many chopped-up lines that feel mechanically fragmented
- fake typos or forced slang used to imitate casualness
- restating the entire emotional logic instead of trusting context
- invented gender, facts, motives, or relationship details

Flag any of these when present:
- invented_fact
- invented_motive
- invented_gender
- theatrical
- chatbot_voice
- coach_voice
- polished_prose
- essay_rhythm
- overexplained
- unnatural_punctuation
- forced_casual
- weak_style_control
- too_many_bubbles
- excessive_endearment
- unnecessary_question
- overlong
- too_harsh
- too_soft
- ignored_brief
- formatting_violation
- generic

Return only strict JSON in this exact shape:
{
  "naturalness": 0,
  "voiceFit": 0,
  "styleControl": 0,
  "fidelity": 0,
  "restraint": 0,
  "emotionalJudgment": 0,
  "scenarioScores": [
    {"scenarioId": "short_opener", "score": 0, "note": "short specific reason"},
    {"scenarioId": "avoidance_and_priority", "score": 0, "note": "short specific reason"},
    {"scenarioId": "vague_feedback", "score": 0, "note": "short specific reason"},
    {"scenarioId": "bad_comfort_text", "score": 0, "note": "short specific reason"},
    {"scenarioId": "earned_rest", "score": 0, "note": "short specific reason"}
  ],
  "flags": ["flag_name"],
  "summary": "Two concise sentences about the candidate's strongest and weakest tendencies."
}`;

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

const normalizeScore = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(10, Math.round(numeric)));
};

const parseJudgment = (content) => {
  const normalized = content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(normalized);

  return {
    naturalness: normalizeScore(parsed.naturalness),
    voiceFit: normalizeScore(parsed.voiceFit),
    styleControl: normalizeScore(parsed.styleControl),
    fidelity: normalizeScore(parsed.fidelity),
    restraint: normalizeScore(parsed.restraint),
    emotionalJudgment: normalizeScore(parsed.emotionalJudgment),
    scenarioScores: Array.isArray(parsed.scenarioScores)
      ? parsed.scenarioScores.map((scenario) => ({
          scenarioId: String(scenario.scenarioId ?? ""),
          score: normalizeScore(scenario.score),
          note: String(scenario.note ?? "").slice(0, 300)
        }))
      : [],
    flags: Array.isArray(parsed.flags)
      ? parsed.flags.map((flag) => String(flag)).slice(0, 20)
      : [],
    summary: String(parsed.summary ?? "").slice(0, 800)
  };
};

const weightedScore = (judgment) =>
  Number(
    (
      judgment.naturalness * 3 +
      judgment.voiceFit * 2 +
      judgment.styleControl * 1.5 +
      judgment.fidelity * 1.5 +
      judgment.restraint +
      judgment.emotionalJudgment
    ).toFixed(1)
  );

const buildCandidatePacket = (results, model) => {
  const sections = results.scenarios.map((scenario) => {
    const response = results.responses.find(
      (item) => item.modelId === model.id && item.scenarioId === scenario.id
    );
    const conversation = scenario.messages
      .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
      .join("\n");

    return `<scenario id="${scenario.id}">
PURPOSE: ${scenario.purpose}
CONVERSATION:
${conversation}

USER VOICE STYLE:
${scenario.voiceStyle}

PRIVATE THOUGHT DATA:
${JSON.stringify(scenario.thought, null, 2)}

CANDIDATE REPLY:
${response?.content ?? "[missing response]"}
</scenario>`;
  });

  return sections.join("\n\n");
};

const readExisting = async (results) => {
  if (!existsSync(JUDGMENTS_PATH)) {
    return {
      meta: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        hardCombinedCostLimitUsd: HARD_COMBINED_COST_LIMIT_USD
      },
      judges,
      judgments: [],
      ranking: [],
      generationCostUsd: Number(results.meta.actualCostUsd ?? 0)
    };
  }
  return JSON.parse(await readFile(JUDGMENTS_PATH, "utf8"));
};

const rebuildRanking = (results, output) => {
  output.ranking = results.roster
    .map((model) => {
      const modelJudgments = output.judgments.filter(
        (judgment) => judgment.modelId === model.id && judgment.status === "ok"
      );
      const score = modelJudgments.length
        ? modelJudgments.reduce((sum, judgment) => sum + judgment.weightedScore, 0) /
          modelJudgments.length
        : 0;
      const categoryAverage = (key) =>
        modelJudgments.length
          ? modelJudgments.reduce((sum, judgment) => sum + judgment.scores[key], 0) /
            modelJudgments.length
          : 0;

      return {
        modelId: model.id,
        label: model.label,
        score: Number(score.toFixed(1)),
        judgeCount: modelJudgments.length,
        categories: {
          naturalness: Number(categoryAverage("naturalness").toFixed(1)),
          voiceFit: Number(categoryAverage("voiceFit").toFixed(1)),
          styleControl: Number(categoryAverage("styleControl").toFixed(1)),
          fidelity: Number(categoryAverage("fidelity").toFixed(1)),
          restraint: Number(categoryAverage("restraint").toFixed(1)),
          emotionalJudgment: Number(categoryAverage("emotionalJudgment").toFixed(1))
        },
        flags: [...new Set(modelJudgments.flatMap((judgment) => judgment.scores.flags))]
      };
    })
    .sort((a, b) => b.score - a.score);
};

const save = async (results, output) => {
  output.meta.updatedAt = new Date().toISOString();
  output.meta.judgingCostUsd = output.judgments.reduce(
    (sum, judgment) => sum + Number(judgment.usage?.cost ?? 0),
    0
  );
  output.meta.combinedCostUsd =
    Number(results.meta.actualCostUsd ?? 0) + Number(output.meta.judgingCostUsd ?? 0);
  rebuildRanking(results, output);
  await writeFile(JUDGMENTS_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
};

const requestJudgment = async ({ apiKey, judge, model, packet }) => {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "http://localhost/cantarella-voice-eval",
          "X-Title": "Cantarella Blind Voice Judging"
        },
        body: JSON.stringify({
          model: judge.id,
          messages: [
            { role: "system", content: rubricPrompt },
            {
              role: "user",
              content: `Evaluate this anonymous candidate across all scenarios:\n\n${packet}`
            }
          ],
          temperature: 0.1,
          max_tokens: 1000,
          reasoning: { effort: "none", exclude: true },
          response_format: { type: "json_object" }
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      }

      const content = payload?.choices?.[0]?.message?.content;
      if (!content) throw new Error("Judge returned an empty response.");
      const scores = parseJudgment(content);

      return {
        modelId: model.id,
        judgeId: judge.id,
        judgeLabel: judge.label,
        weightedScore: weightedScore(scores),
        scores,
        usage: payload.usage ?? null,
        status: "ok",
        createdAt: new Date().toISOString()
      };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(attempt * 1500);
    }
  }

  return {
    modelId: model.id,
    judgeId: judge.id,
    judgeLabel: judge.label,
    status: "error",
    error: lastError instanceof Error ? lastError.message : String(lastError),
    usage: null,
    createdAt: new Date().toISOString()
  };
};

const main = async () => {
  const env = parseEnv(await readFile(ENV_PATH, "utf8"));
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey || !apiKey.startsWith("sk-or-")) {
    throw new Error("voice-model-eval/.env.local does not contain a valid OpenRouter key.");
  }

  const results = JSON.parse(await readFile(RESULTS_PATH, "utf8"));
  const output = await readExisting(results);
  const completed = new Set(
    output.judgments
      .filter((judgment) => judgment.status === "ok")
      .map((judgment) => `${judgment.modelId}::${judgment.judgeId}`)
  );

  const tasks = results.roster.flatMap((model) =>
    judges
      .filter((judge) => !completed.has(`${model.id}::${judge.id}`))
      .map((judge) => ({
        model,
        judge,
        packet: buildCandidatePacket(results, model)
      }))
  );

  console.log(`Starting ${tasks.length} blind judging calls.`);

  for (let offset = 0; offset < tasks.length; offset += CONCURRENCY) {
    const judgingCost = output.judgments.reduce(
      (sum, judgment) => sum + Number(judgment.usage?.cost ?? 0),
      0
    );
    const combinedCost = Number(results.meta.actualCostUsd ?? 0) + judgingCost;
    if (combinedCost >= HARD_COMBINED_COST_LIMIT_USD) {
      console.log(`Stopped at the $${HARD_COMBINED_COST_LIMIT_USD.toFixed(2)} ceiling.`);
      break;
    }

    const batch = tasks.slice(offset, offset + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((task) =>
        requestJudgment({
          apiKey,
          judge: task.judge,
          model: task.model,
          packet: task.packet
        })
      )
    );

    for (const judgment of batchResults) {
      const existingIndex = output.judgments.findIndex(
        (saved) =>
          saved.modelId === judgment.modelId && saved.judgeId === judgment.judgeId
      );
      if (existingIndex >= 0) output.judgments[existingIndex] = judgment;
      else output.judgments.push(judgment);
    }

    await save(results, output);
    const ok = output.judgments.filter((judgment) => judgment.status === "ok").length;
    const failed = output.judgments.filter((judgment) => judgment.status === "error").length;
    console.log(
      `[${ok}/${results.roster.length * judges.length}] judged, ${failed} failed, ` +
      `$${Number(output.meta.combinedCostUsd ?? 0).toFixed(4)} combined spend`
    );
  }

  console.log(
    `Judging complete. Combined benchmark cost: ` +
    `$${Number(output.meta.combinedCostUsd ?? 0).toFixed(4)}.`
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
