import { describe, expect, it } from "vitest";

import {
  applicationTools,
  createApplicationToolRuntime,
  requiresTimeBoundMemoryExpiry,
  resolveMutationTarget,
} from "../src/tools/application-tools.js";
import {
  generateThought,
  MAX_REPLY_POINT_CHARACTERS,
  suppressAutomaticMemoryNarration,
  ThoughtContractError,
  thoughtSchema,
} from "../src/models/thought.js";
import {
  completeOpenRouter,
  type CompletionRequest,
  type CompleteModel,
} from "../src/models/openrouter.js";
import { limitRecentContext } from "../src/pipeline/turn-processor.js";
import {
  generateVoice,
  splitVoiceBubbles,
  VOICE_BRIEF_REJECTION_SENTINEL,
} from "../src/models/voice.js";

const validThought = {
  messageMode: "help" as const,
  contextRelation: "standalone" as const,
  applicationActionDecision: "none" as const,
  voiceContext: [],
  replyPoints: [
    "If the client is waiting, send a brief update first.",
    "Otherwise, start the portfolio work.",
  ],
  question: null,
};

describe("Thought compatibility", () => {
  it("defaults an omitted voice context from older Thought output", () => {
    const { voiceContext: _voiceContext, ...olderThought } = validThought;

    expect(thoughtSchema.parse(olderThought).voiceContext).toEqual([]);
  });

  it("allows contextual social chat to carry facts without a reply point", () => {
    const socialThought = {
      ...validThought,
      messageMode: "social" as const,
      contextRelation: "immediate_context" as const,
      voiceContext: ["The active exchange is about the user deciding what to eat."],
      replyPoints: [],
    };

    expect(thoughtSchema.parse(socialThought)).toMatchObject({
      voiceContext: socialThought.voiceContext,
      replyPoints: [],
    });
  });

  it("requires facts for a context-dependent Thought handoff", () => {
    const result = thoughtSchema.safeParse({
      ...validThought,
      contextRelation: "immediate_context",
      voiceContext: [],
    });

    expect(result.success).toBe(false);
  });

  it("requires a factual outcome for help and mixed replies", () => {
    const result = thoughtSchema.safeParse({
      ...validThought,
      replyPoints: [],
    });

    expect(result.success).toBe(false);
  });

  it("rejects instructions to Voice in reply points", () => {
    const result = thoughtSchema.safeParse({
      ...validThought,
      messageMode: "social",
      replyPoints: ["Respond to the user's playful request."],
    });

    expect(result.success).toBe(false);
  });
});

function testThoughtGenerator(client: { complete: CompleteModel }) {
  return {
    generate(context: Parameters<typeof generateThought>[0], toolRuntime?: Parameters<typeof generateThought>[1]) {
      return generateThought(context, toolRuntime, client.complete);
    },
  };
}

describe("automatic memory narration", () => {
  const successfulSave = [
    { name: "save_memory", output: { ok: true, operation: "updated" } },
  ];

  it("removes internal save confirmation while preserving the conversational answer", () => {
    const result = suppressAutomaticMemoryNarration(
      {
        ...validThought,
        replyPoints: [
          "You just used 8,000 THB more.",
          "Your budget is now 6,000 THB.",
          "I updated the stored budget memory to 6,000 THB.",
        ],
      },
      ["nah i just used 8k now"],
      successfulSave,
    );

    expect(result.replyPoints).toEqual([
      "You just used 8,000 THB more.",
      "Your budget is now 6,000 THB.",
    ]);
  });

  it("removes storage narration without adding a replacement instruction", () => {
    const result = suppressAutomaticMemoryNarration(
      { ...validThought, replyPoints: ["I saved that in memory."] },
      ["my sister is amy"],
      successfulSave,
    );

    expect(result.replyPoints).toEqual([]);
  });

  it("keeps storage status when the user explicitly asks about it", () => {
    const thought = {
      ...validThought,
      replyPoints: ["I updated the stored budget memory to 6,000 THB."],
    };

    expect(
      suppressAutomaticMemoryNarration(
        thought,
        ["did you update that memory?"],
        successfulSave,
      ),
    ).toEqual(thought);
  });
});

describe("production request parity", () => {
  it("omits unsupported parallel_tool_calls when the request leaves it unset", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const complete = async (...args: Parameters<typeof fetch>) => {
      const [_input, init] = args;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "deepseek/deepseek-v4-pro-0813",
        provider: "DeepSeek",
        choices: [{
          finish_reason: "tool_calls",
          message: {
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "find_memories", arguments: "{\"query\":\"assignment\"}" },
            }],
          },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    await completeOpenRouter({
      model: "deepseek/deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "assignment due in a week" }],
      temperature: 0,
      maxTokens: 1_200,
      tools: applicationTools,
      toolChoice: "auto",
      reasoning: { max_tokens: 384, exclude: true },
      providerRouting: {
        order: ["deepseek"],
        allowFallbacks: true,
        maxPrice: { prompt: 3, completion: 5 },
      },
    }, complete);

    expect(requestBody).not.toBeNull();
    expect(requestBody).not.toHaveProperty("parallel_tool_calls");
  });

  it("does not exclude DeepSeek from its own structured-output round", async () => {
    let requestBody: Record<string, unknown> | null = null;
    const complete = async (...args: Parameters<typeof fetch>) => {
      const [_input, init] = args;
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        model: "deepseek/deepseek-v4-pro-0813",
        provider: "DeepSeek",
        choices: [{
          finish_reason: "stop",
          message: { content: JSON.stringify(validThought) },
        }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    await completeOpenRouter({
      model: "deepseek/deepseek-v4-pro-0813",
      messages: [{ role: "user", content: "return the final brief" }],
      temperature: 0,
      maxTokens: 1_200,
      responseFormat: {
        name: "cantarella_thought",
        schema: { type: "object" },
      },
      providerRouting: {
        order: ["deepseek"],
        allowFallbacks: true,
        maxPrice: { prompt: 3, completion: 5 },
      },
    }, complete);

    expect(requestBody).not.toBeNull();
    const capturedBody = requestBody as unknown as Record<string, unknown>;
    expect(capturedBody.provider).toEqual({
      order: ["deepseek"],
      allow_fallbacks: true,
      max_price: { prompt: 3, completion: 5 },
    });
  });

  it("keeps only the latest twelve raw context messages", () => {
    const messages = Array.from({ length: 20 }, (_, index) => index + 1);
    expect(limitRecentContext(messages)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 9),
    );
  });
});

describe("application deletion tools", () => {
  it("exposes consolidated single and batch memory tools", () => {
    const toolNames = applicationTools.map((tool) => tool.function.name);

    expect(toolNames).toEqual([
      "find_memories",
      "save_memory",
      "save_memories",
      "delete_memory",
      "delete_memories",
      "find_reminders",
      "save_reminder",
      "delete_reminder",
    ]);
    expect(toolNames.some((name) => name.startsWith("request_delete_"))).toBe(false);
    expect(toolNames.some((name) => name.startsWith("confirm_delete_"))).toBe(false);
  });

  it("allows the only matching target without asking a follow-up", () => {
    expect(
      resolveMutationTarget("forget my rent", [
        { id: "rent-memory", label: "The user's monthly rent is 8,000 THB." },
      ]),
    ).toEqual({
      status: "unique",
      allowedTargetId: "rent-memory",
      candidateIds: ["rent-memory"],
    });
  });

  it("allows one explicitly named target when several records were returned", () => {
    expect(
      resolveMutationTarget("delete Check the mailbox", [
        { id: "mailbox", label: "Check the mailbox" },
        { id: "rent", label: "Pay rent" },
      ]),
    ).toEqual({
      status: "confident",
      allowedTargetId: "mailbox",
      candidateIds: ["mailbox", "rent"],
    });
  });

  it("allows a strong semantic target with a clear lead over broad retrieval noise", () => {
    expect(
      resolveMutationTarget("update my current bank budget", [
        { id: "budget", label: "Current bank budget", similarity: 0.627 },
        { id: "tracking", label: "Financial tracking preference", similarity: 0.262 },
      ]),
    ).toEqual({
      status: "confident",
      allowedTargetId: "budget",
      candidateIds: ["budget", "tracking"],
    });
  });

  it("rejects a single weak semantic result as irrelevant", () => {
    expect(
      resolveMutationTarget("assignment due in a week", [
        { id: "eidolon", label: "User owns Eidolon", similarity: 0.275 },
      ]),
    ).toEqual({
      status: "none",
      allowedTargetId: null,
      candidateIds: ["eidolon"],
    });
  });

  it("rejects multiple weak semantic results instead of calling them ambiguous", () => {
    expect(
      resolveMutationTarget("assignment due in a week", [
        { id: "eidolon", label: "User owns Eidolon", similarity: 0.275 },
        { id: "assistant", label: "User wants everyday help", similarity: 0.22 },
        { id: "student", label: "User studies at KMUTT", similarity: 0.18 },
      ]).status,
    ).toBe("none");
  });

  it("requires clarification when multiple targets remain plausible", () => {
    expect(
      resolveMutationTarget("delete that reminder", [
        { id: "mailbox", label: "Check the mailbox" },
        { id: "parcel", label: "Track parcel delivery" },
      ]),
    ).toEqual({
      status: "ambiguous",
      allowedTargetId: null,
      candidateIds: ["mailbox", "parcel"],
    });

    expect(
      resolveMutationTarget("forget my housing cost", [
        { id: "rent", label: "Monthly rent", similarity: 0.58 },
        { id: "utilities", label: "Monthly utilities", similarity: 0.51 },
      ]).status,
    ).toBe("ambiguous");

    expect(
      resolveMutationTarget("forget that old fact", [
        { id: "first", label: "First weak match", similarity: 0.49 },
        { id: "second", label: "Second weak match", similarity: 0.2 },
      ]).status,
    ).toBe("none");
  });
});

describe("time-bound memory expiry contract", () => {
  it("rejects save_memory until find_memories succeeds in the same runtime", async () => {
    const runtime = createApplicationToolRuntime({
      userId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      turnId: "33333333-3333-4333-8333-333333333333",
      sourceMessageId: "44444444-4444-4444-8444-444444444444",
      originalRequest: "i study at kmutt",
      timezone: "Asia/Bangkok",
      referenceAt: new Date("2026-08-13T08:00:00.000Z"),
      retrieveMemories: async () => [],
    });

    const result = await runtime.execute({
      id: "save_without_lookup",
      type: "function",
      function: {
        name: "save_memory",
        arguments: JSON.stringify({
          canonicalText: "The user studies at KMUTT.",
          type: "profile",
          topic: "university",
          subject: "KMUTT",
          retrievalFacets: [],
          expiresAt: null,
        }),
      },
    });

    expect(result.output).toMatchObject({
      ok: false,
      code: "InvalidMemoryActionError",
      error: expect.stringContaining("requires a successful find_memories"),
    });
  });

  it("keeps the complete memory tool surface visible from the first model step", async () => {
    const requests: CompletionRequest[] = [];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            content: "",
            toolCalls: [{
              id: "find_assignment",
              type: "function" as const,
              function: {
                name: "find_memories",
                arguments: JSON.stringify({ query: "internship report" }),
              },
            }],
            model: request.model,
            provider: "test",
            usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
            latencyMs: 1,
          };
        }
        if (requests.length === 2) {
          return {
            content: "",
            toolCalls: [{
              id: "save_assignment",
              type: "function" as const,
              function: {
                name: "save_memory",
                arguments: JSON.stringify({
                  canonicalText: "The internship report is due August 20, 2026.",
                  type: "event",
                  topic: "university",
                  subject: "Internship report",
                  retrievalFacets: [],
                  expiresAt: "2026-08-21T17:00:00.000Z",
                }),
              },
            }],
            model: request.model,
            provider: "test",
            usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
            latencyMs: 1,
          };
        }
        return {
          content: JSON.stringify(validThought),
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    await generator.generate(
      {
        currentMessages: ["the internship report is due august 20"],
        recentConversation: [],
        conversationSummary: null,
        memories: [],
        reminders: [],
        localTime: "Thursday, August 13, 2026 at 3:00 PM GMT+7",
      },
      {
        tools: applicationTools,
        classify(name) {
          if (name === "find_memories") return "read";
          if (name === "save_memory") return "mutation";
          return null;
        },
        async execute(call) {
          return call.function.name === "find_memories"
            ? { output: { ok: true, memories: [] } }
            : { output: { ok: true, operation: "created" } };
        },
      },
    );

    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toContain(
      "save_memory",
    );
    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toContain(
      "find_memories",
    );
    expect(requests[0]?.tools?.map((tool) => tool.function.name)).toContain(
      "save_reminder",
    );
    expect(requests[1]?.tools?.map((tool) => tool.function.name)).toContain(
      "save_memory",
    );
  });

  it("requires every save_memory call to declare expiresAt", () => {
    const saveMemory = applicationTools.find(
      (tool) => tool.function.name === "save_memory",
    );

    expect(saveMemory?.function.parameters).toMatchObject({
      required: ["canonicalText", "type", "topic", "subject", "retrievalFacets", "expiresAt"],
    });
    expect(saveMemory?.function.description).toContain(
      "Always supply expiresAt",
    );
  });

  it("recognizes explicit deadlines and bounded current situations", () => {
    expect(
      requiresTimeBoundMemoryExpiry({
        type: "situation",
        canonicalText:
          "The user's internship final report is due on August 20, 2026.",
        originalRequest: "its due in a week",
      }),
    ).toBe(true);
    expect(
      requiresTimeBoundMemoryExpiry({
        type: "event",
        canonicalText: "The user has exams next week.",
        originalRequest: "exam week starts next week",
      }),
    ).toBe(true);
  });

  it("allows permanent and genuinely open-ended memory to remain unexpired", () => {
    expect(
      requiresTimeBoundMemoryExpiry({
        type: "profile",
        canonicalText: "The user studies at KMUTT.",
        originalRequest: "i study at kmutt",
      }),
    ).toBe(false);
    expect(
      requiresTimeBoundMemoryExpiry({
        type: "situation",
        canonicalText: "The user is developing Eidolon.",
        originalRequest: "im working on eidolon",
      }),
    ).toBe(false);
  });

  it("rejects a bounded memory with a null expiry before touching storage", async () => {
    const runtime = createApplicationToolRuntime({
      userId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      turnId: "33333333-3333-4333-8333-333333333333",
      sourceMessageId: "44444444-4444-4444-8444-444444444444",
      originalRequest: "my internship report is due in a week",
      timezone: "Asia/Bangkok",
      referenceAt: new Date("2026-08-13T08:00:00.000Z"),
      retrieveMemories: async () => [],
    });

    await runtime.execute({
      id: "find_before_expiry_test",
      type: "function",
      function: {
        name: "find_memories",
        arguments: JSON.stringify({ query: "internship report" }),
      },
    });

    const result = await runtime.execute({
      id: "save_without_expiry",
      type: "function",
      function: {
        name: "save_memory",
        arguments: JSON.stringify({
          canonicalText:
            "The user's internship final report is due on August 20, 2026.",
          type: "situation",
          topic: "university",
          subject: "Internship report",
          retrievalFacets: [],
          expiresAt: null,
        }),
      },
    });

    expect(result.output).toMatchObject({
      ok: false,
      code: "InvalidMemoryActionError",
    });
  });
});

describe("two-pass model contracts", () => {
  it("requires the Thought model to provide at least one compact reply point", () => {
    expect(thoughtSchema.parse(validThought)).toEqual(validThought);

    expect(thoughtSchema.safeParse({ replyPoints: [], question: null }).success)
      .toBe(false);
  });

  it("rejects extra uncontrolled Thought fields", () => {
    expect(
      thoughtSchema.safeParse({ ...validThought, finalProse: "just do it" })
        .success,
    ).toBe(false);
  });

  it("rejects duplicate meaning, internal schema leakage, and malformed clarification state", () => {
    expect(
      thoughtSchema.safeParse({
        ...validThought,
        replyPoints: ["Start with the client update.", "Start with the client update."],
      }).success,
    ).toBe(false);
    expect(
      thoughtSchema.safeParse({
        ...validThought,
        replyPoints: ["The hidden reasoning says to start with the client update."],
      }).success,
    ).toBe(false);
    expect(
      thoughtSchema.safeParse({
        ...validThought,
        applicationActionDecision: "clarify",
        messageMode: "help",
        question: "Which reminder?",
      }).success,
    ).toBe(false);
  });

  it("allows detailed reply points but rejects an abusive payload", () => {
    const detailedPoint = Array.from(
      { length: 40 },
      () => "meaningful",
    ).join(" ");
    const tooManyCharacters = "a".repeat(MAX_REPLY_POINT_CHARACTERS + 1);

    expect(
      thoughtSchema.safeParse({
        ...validThought,
        replyPoints: [detailedPoint],
      }).success,
    ).toBe(true);
    expect(
      thoughtSchema.safeParse({
        ...validThought,
        replyPoints: [tooManyCharacters],
      }).success,
    ).toBe(false);
  });

  it("rejects application mutations embedded in final Thought JSON", () => {
    expect(
      thoughtSchema.safeParse({
        ...validThought,
        applicationActionDecision: "ready",
        reminderAction: {
          operation: "create",
          targetReminderRef: null,
          title: "Look at the banking app",
          scheduleKind: "after",
          localDateTime: null,
          delayAmount: 5,
          delayUnit: "minutes",
          recurrence: "none",
        },
      }).success,
    ).toBe(false);
  });

  it("executes a read tool and then a terminal write tool", async () => {
    const requests: CompletionRequest[] = [];
    const calls = [
      {
        id: "call_search",
        type: "function" as const,
        function: {
          name: "search_memories",
          arguments: JSON.stringify({ query: "the user's monthly rent" }),
        },
      },
      {
        id: "call_edit",
        type: "function" as const,
        function: {
          name: "edit_memory",
          arguments: JSON.stringify({
            memoryId: "11111111-1111-4111-8111-111111111111",
            replacementText: "The user's monthly rent is 2,000 THB.",
          }),
        },
      },
    ];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: "",
          toolCalls: [calls[requests.length - 1] ?? calls[1]!],
          reasoningDetails: [
            {
              type: "reasoning.text",
              text: requests.length === 1 ? "resolve rent" : "apply correction",
            },
          ],
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });
    const executed: string[] = [];
    const terminalThought = {
      ...validThought,
      contextRelation: "immediate_context" as const,
      voiceContext: ["The user corrected their rent from 8,000 THB to 2,000 THB."],
      replyPoints: ["The stored rent was updated to 2,000 THB."],
    };

    const result = await generator.generate(
      {
        currentMessages: ["mb mb its 2k"],
        recentConversation: [
          { sender: "user", content: "also fyi, my rent is 8k thb" },
        ],
        conversationSummary: null,
        memories: [],
        reminders: [],
        localTime: "Tuesday, August 11, 2026 at 12:43 PM GMT+7",
      },
      {
        tools: [
          {
            type: "function",
            function: {
              name: "search_memories",
              description: "search",
              parameters: { type: "object" },
            },
          },
          {
            type: "function",
            function: {
              name: "edit_memory",
              description: "edit",
              parameters: { type: "object" },
            },
          },
        ],
        classify(name) {
          return name === "search_memories" ? "read" : "mutation";
        },
        async execute(call) {
          executed.push(call.function.name);
          if (call.function.name === "search_memories") {
            return {
              output: {
                ok: true,
                memories: [
                  {
                    id: "11111111-1111-4111-8111-111111111111",
                    content: "The user's monthly rent is 8,000 THB.",
                  },
                ],
              },
            };
          }
          return {
            output: { ok: true },
            terminalThought,
            applicationResult: {
              kind: "memory",
              memoryId: "11111111-1111-4111-8111-111111111111",
            },
          };
        },
      },
    );

    expect(executed).toEqual(["search_memories", "edit_memory"]);
    expect(requests[0]?.responseFormat).toBeUndefined();
    expect(requests[1]?.messages.find((message) => message.role === "tool")).toMatchObject({
      role: "tool",
      name: "search_memories",
      toolCallId: "call_search",
    });
    expect(requests[1]?.messages.find((message) => message.role === "assistant"))
      .toMatchObject({
        reasoningDetails: [
          { type: "reasoning.text", text: "resolve rent" },
        ],
      });
    expect(result.thought).toEqual(terminalThought);
    expect(result.applicationResult).toEqual({
      kind: "memory",
      memoryId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("accepts multiple independent read tools in one response", async () => {
    const requests: CompletionRequest[] = [];
    const readCalls = [
      {
        id: "call_memory_search",
        type: "function" as const,
        function: {
          name: "search_memories",
          arguments: JSON.stringify({ query: "the user's rent" }),
        },
      },
      {
        id: "call_reminder_list",
        type: "function" as const,
        function: {
          name: "list_reminders",
          arguments: JSON.stringify({ status: null }),
        },
      },
    ];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return requests.length === 1
          ? {
              content: "",
              toolCalls: readCalls,
              model: request.model,
              provider: "test",
              usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
              latencyMs: 1,
            }
          : {
              content: JSON.stringify(validThought),
              model: request.model,
              provider: "test",
              usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
              latencyMs: 1,
            };
      },
    });
    const executed: string[] = [];

    const result = await generator.generate(
      {
        currentMessages: ["what do you remember about my rent and reminders"],
        recentConversation: [],
        conversationSummary: null,
        memories: [],
        reminders: [],
        localTime: "Tuesday, August 11, 2026 at 5:00 PM GMT+7",
      },
      {
        tools: applicationTools,
        classify(name) {
          return name === "search_memories" || name === "list_reminders"
            ? "read"
            : null;
        },
        async execute(call) {
          executed.push(call.function.name);
          return { output: { ok: true, results: [] } };
        },
      },
    );

    expect(executed).toEqual(["search_memories", "list_reminders"]);
    expect(result.thought).toEqual(validThought);
    expect(requests[1]?.messages.filter((message) => message.role === "tool"))
      .toHaveLength(2);
  });

  it("defers a mutation bundled with a read and executes only a later standalone mutation", async () => {
    const requests: CompletionRequest[] = [];
    const memoryId = "11111111-1111-4111-8111-111111111111";
    const searchCall = {
      id: "call_search_mixed",
      type: "function" as const,
      function: {
        name: "search_memories",
        arguments: JSON.stringify({ query: "the user's rent" }),
      },
    };
    const mixedEditCall = {
      id: "call_edit_deferred",
      type: "function" as const,
      function: {
        name: "edit_memory",
        arguments: JSON.stringify({ memoryId, replacementText: "The user's rent is 2,000 THB." }),
      },
    };
    const standaloneEditCall = { ...mixedEditCall, id: "call_edit_standalone" };
    const terminalThought = {
      ...validThought,
      replyPoints: ["The stored rent was updated to 2,000 THB."],
    };
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        const toolCalls = requests.length === 1
          ? [searchCall, mixedEditCall]
          : [standaloneEditCall];
        return {
          content: "",
          toolCalls,
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });
    const executed: string[] = [];

    const result = await generator.generate(
      {
        currentMessages: ["change my rent to 2k"],
        recentConversation: [],
        conversationSummary: null,
        memories: [],
        reminders: [],
        localTime: "Tuesday, August 11, 2026 at 5:00 PM GMT+7",
      },
      {
        tools: applicationTools,
        classify(name) {
          if (name === "search_memories") return "read";
          if (name === "edit_memory") return "mutation";
          return null;
        },
        async execute(call) {
          executed.push(call.function.name);
          if (call.function.name === "search_memories") {
            return { output: { ok: true, memories: [{ id: memoryId }] } };
          }
          return {
            output: { ok: true },
            terminalThought,
            applicationResult: { kind: "memory", memoryId },
          };
        },
      },
    );

    expect(executed).toEqual(["search_memories", "edit_memory"]);
    expect(result.toolExecutions?.map((execution) => execution.output)).toContainEqual(
      expect.objectContaining({ code: "MUTATION_MUST_FOLLOW_READS" }),
    );
    expect(result.thought).toEqual(terminalThought);
  });

  it("executes a valid mutation even when the provider includes incidental prose", async () => {
    const requests: CompletionRequest[] = [];
    const memoryId = "11111111-1111-4111-8111-111111111111";
    const deletionCall = {
      type: "function" as const,
      function: {
        name: "delete_memory",
        arguments: JSON.stringify({ memoryId }),
      },
    };
    const terminalThought = {
      ...validThought,
      replyPoints: ["The stored rent memory was permanently forgotten."],
    };
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: requests.length === 1 ? "I will delete it now." : "",
          toolCalls: [
            {
              ...deletionCall,
              id: requests.length === 1
                ? "delete_with_prose"
                : "delete_standalone",
            },
          ],
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });
    let executionCount = 0;

    const result = await generator.generate(
      {
        currentMessages: ["forget my rent"],
        recentConversation: [],
        conversationSummary: null,
        memories: [],
        reminders: [],
        localTime: "Tuesday, August 11, 2026 at 5:00 PM GMT+7",
      },
      {
        tools: applicationTools,
        classify(name) {
          return name === "delete_memory" ? "mutation" : null;
        },
        async execute() {
          executionCount += 1;
          return {
            output: { ok: true },
            terminalThought,
            applicationResult: {
              kind: "memory",
              memoryId,
              deletedMemoryCount: 1,
            },
          };
        },
      },
    );

    expect(executionCount).toBe(1);
    expect(result.toolExecutions?.[0]?.output).toMatchObject({ ok: true });
    expect(result.thought).toEqual(terminalThought);
  });

  it("executes up to three distinct mutations together", async () => {
    const requests: CompletionRequest[] = [];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        if (requests.length === 1) {
          return {
            content: "",
            toolCalls: [
              {
                id: "delete_one",
                type: "function",
                function: { name: "delete_memory", arguments: JSON.stringify({ memoryId: "11111111-1111-4111-8111-111111111111" }) },
              },
              {
                id: "delete_two",
                type: "function",
                function: { name: "delete_reminder", arguments: JSON.stringify({ reminderId: "22222222-2222-4222-8222-222222222222" }) },
              },
            ],
            model: request.model,
            provider: "test",
            usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
            latencyMs: 1,
          };
        }
        return {
          content: JSON.stringify({
            ...validThought,
            messageMode: "unclear",
            applicationActionDecision: "clarify",
            replyPoints: ["Only one stored item can be changed per turn."],
            question: "Which one should I delete first?",
          }),
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });
    const executed: string[] = [];

    const result = await generator.generate(
      {
        currentMessages: ["delete both of those"],
        recentConversation: [],
        conversationSummary: null,
        memories: [],
        reminders: [],
        localTime: "Tuesday, August 11, 2026 at 5:00 PM GMT+7",
      },
      {
        tools: applicationTools,
        classify(name) {
          return name === "delete_memory" || name === "delete_reminder"
            ? "mutation"
            : null;
        },
        async execute(call) {
          executed.push(call.function.name);
          return call.function.name === "delete_memory"
            ? {
                output: { ok: true },
                applicationResult: {
                  kind: "memory" as const,
                  memoryId: "11111111-1111-4111-8111-111111111111",
                  deletedMemoryCount: 1,
                },
              }
            : {
                output: { ok: true },
                applicationResult: {
                  kind: "reminder" as const,
                  reminderId: "22222222-2222-4222-8222-222222222222",
                  reminderIds: ["22222222-2222-4222-8222-222222222222"],
                },
              };
        },
      },
    );

    expect(executed).toEqual(["delete_memory", "delete_reminder"]);
    expect(result.toolExecutions).toHaveLength(2);
    expect(result.toolExecutions?.every((execution) =>
      (execution.output as { ok?: boolean }).ok === true
    )).toBe(true);
    expect(result.applicationResults).toHaveLength(2);
    expect(result.applicationResults?.map((result) => result.kind)).toEqual([
      "memory",
      "reminder",
    ]);
  });

  it("fails after deferred tool calls never produce a final Thought response", async () => {
    const generator = testThoughtGenerator({
      async complete(request) {
        return {
          content: "",
          toolCalls: Array.from({ length: 4 }, (_, index) => ({
            id: `read_${index}`,
            type: "function" as const,
            function: {
              name: "find_memories",
              arguments: JSON.stringify({ query: `topic ${index}` }),
            },
          })),
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    await expect(generator.generate(
        {
          currentMessages: ["remember these four unrelated things"],
          recentConversation: [],
          conversationSummary: null,
          memories: [],
          reminders: [],
          localTime: "Tuesday, August 11, 2026 at 7:00 PM GMT+7",
        },
        {
          tools: applicationTools,
          classify() {
            return "read";
          },
          async execute() {
            return { output: { ok: true } };
          },
        },
      )).rejects.toMatchObject({
      name: "ThoughtContractError",
      message: "The Thought model requested a tool after tools were closed for its final response.",
      retryable: false,
    });
  });

  it("uses DeepSeek V4 Pro with official-provider preference and fallback", async () => {
    const requests: CompletionRequest[] = [];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: JSON.stringify(validThought),
          model: request.model,
          provider: "fallback-test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    const result = await generator.generate({
      currentMessages: ["yo"],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      reminders: [],
      localTime: "Tuesday, August 11, 2026 at 7:00 PM GMT+7",
    });

    expect(result.thought).toEqual(validThought);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.model).toBe("deepseek/deepseek-v4-pro-0813");
    expect(requests[0]?.providerRouting).toEqual({
      order: ["deepseek"],
      allowFallbacks: true,
      maxPrice: { prompt: 3, completion: 5 },
    });
    expect(requests[0]?.parallelToolCalls).toBeUndefined();
    expect(requests[0]?.maxTokens).toBe(6_000);
    expect(requests[0]?.responseFormat).toBeUndefined();
  });

  it("runs a duplicated read only once and quarantines its duplicate", async () => {
    const requests: CompletionRequest[] = [];
    const call = {
      type: "function" as const,
      function: {
        name: "search_memories",
        arguments: JSON.stringify({ query: "the user's rent" }),
      },
    };
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return requests.length === 1
          ? {
              content: "",
              toolCalls: [
                { ...call, id: "search_once" },
                { ...call, id: "search_duplicate" },
              ],
              model: request.model,
              provider: "test",
              usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
              latencyMs: 1,
            }
          : {
              content: JSON.stringify(validThought),
              model: request.model,
              provider: "test",
              usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
              latencyMs: 1,
            };
      },
    });
    let executionCount = 0;

    const result = await generator.generate(
      {
        currentMessages: ["what do you remember about my rent"],
        recentConversation: [],
        conversationSummary: null,
        memories: [],
        reminders: [],
        localTime: "Tuesday, August 11, 2026 at 5:00 PM GMT+7",
      },
      {
        tools: applicationTools,
        classify(name) {
          return name === "search_memories" ? "read" : null;
        },
        async execute() {
          executionCount += 1;
          return { output: { ok: true, matches: [] } };
        },
      },
    );

    expect(executionCount).toBe(1);
    expect(result.toolExecutions?.[1]?.output).toMatchObject({
      code: "DUPLICATE_TOOL_CALL_REJECTED",
    });
  });

  it("quarantines malformed tool arguments instead of invoking application code", async () => {
    const requests: CompletionRequest[] = [];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return requests.length === 1
          ? {
              content: "",
              toolCalls: [
                {
                  id: "malformed_search",
                  type: "function",
                  function: { name: "search_memories", arguments: "{" },
                },
              ],
              model: request.model,
              provider: "test",
              usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
              latencyMs: 1,
            }
          : {
              content: JSON.stringify(validThought),
              model: request.model,
              provider: "test",
              usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
              latencyMs: 1,
            };
      },
    });
    let executed = false;

    const result = await generator.generate(
      {
        currentMessages: ["what do you remember"],
        recentConversation: [],
        conversationSummary: null,
        memories: [],
        reminders: [],
        localTime: "Tuesday, August 11, 2026 at 5:00 PM GMT+7",
      },
      {
        tools: applicationTools,
        classify(name) {
          return name === "search_memories" ? "read" : null;
        },
        async execute() {
          executed = true;
          return { output: { ok: true } };
        },
      },
    );

    expect(executed).toBe(false);
    expect(result.toolExecutions?.[0]?.output).toMatchObject({
      code: "MALFORMED_TOOL_ARGUMENTS",
    });
  });

  it("tells Qwen that ordinary shorthand can carry tool intent", async () => {
    let capturedRequest: CompletionRequest | undefined;
    const generator = testThoughtGenerator({
      async complete(request) {
        capturedRequest = request;
        return {
          content: JSON.stringify(validThought),
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    const result = await generator.generate({
      currentMessages: ["mb mb its 2k"],
      recentConversation: [
        { sender: "user", content: "also fyi, my rent is 8k thb" },
        { sender: "assistant", content: "got it, 8k thb" },
      ],
      conversationSummary: null,
      memories: [],
      reminders: [],
      localTime: "Tuesday, August 11, 2026 at 12:43 PM GMT+7",
    });

    expect(result.thought).toEqual(validThought);
    expect(capturedRequest?.messages[0]?.content).toContain(
      "Ordinary conversational wording carries full intent",
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "Resolve shorthand and pronouns",
    );
  });

  it("retries when Thought contradicts the number in a current correction", async () => {
    const requests: CompletionRequest[] = [];
    const outputs = [
      JSON.stringify({
        ...validThought,
        replyPoints: ["The user's rent is 8,000 THB."],
      }),
      JSON.stringify({
        ...validThought,
        contextRelation: "immediate_context",
        voiceContext: ["The user corrected their rent from 8,000 THB to 2,000 THB."],
        replyPoints: ["The corrected rent is 2,000 THB."],
      }),
    ];
    const generator = testThoughtGenerator({
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
      currentMessages: ["mb mb its 2k"],
      recentConversation: [
        { sender: "user", content: "also fyi, my rent is 8k thb" },
      ],
      conversationSummary: null,
      memories: [
        {
          ref: "memory_1",
          type: "profile",
          content: "The user's rent is 8,000 THB.",
        },
      ],
      reminders: [],
      localTime: "Tuesday, August 11, 2026 at 12:43 PM GMT+7",
    });

    expect(result.thought.replyPoints).toEqual([
      "The corrected rent is 2,000 THB.",
    ]);
    expect(requests).toHaveLength(2);
  });

  it("instructs clear forget requests to delete immediately without confirmation", async () => {
    const requests: CompletionRequest[] = [];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: JSON.stringify(validThought),
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    const result = await generator.generate({
      currentMessages: ["nvm just forget it ig"],
      recentConversation: [
        { sender: "user", content: "mb mb its 2k" },
        { sender: "assistant", content: "yea got it, updated to 2k" },
      ],
      conversationSummary: null,
      memories: [
        {
          ref: "memory_1",
          type: "profile",
          content: "The user's rent is 2,000 THB.",
        },
      ],
      reminders: [],
      localTime: "Tuesday, August 11, 2026 at 1:11 PM GMT+7",
    });

    expect(result.thought).toEqual(validThought);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.messages[0]?.content).toContain(
      "must call delete_memory immediately",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "never create pending confirmation state",
    );
  });

  it("retries malformed Thought JSON from the original context", async () => {
    const requests: CompletionRequest[] = [];
    const outputs = ["not json", JSON.stringify(validThought)];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: outputs[requests.length - 1] ?? JSON.stringify(validThought),
          model: request.model,
          provider: "test",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostUsd: 0,
          },
          latencyMs: 1,
        };
      },
    });

    const result = await generator.generate({
      currentMessages: ["should i text them again?"],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      reminders: [],
      localTime: "Monday, August 3, 2026 at 8:30 PM GMT+7",
    });

    expect(result.thought).toEqual(validThought);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages[1]?.content).toContain(
      "should i text them again?",
    );
    expect(requests[1]?.messages.at(-1)?.content).toContain(
      "final response was rejected",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "Recent conversation is background, not an unfinished command queue",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "conversationSummary contains compressed historical episodes",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "There is no ordinary target of two",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "sole live owner of memory and reminder decisions",
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      'A ping or test such as "yo", "you there", "test test"',
    );
    expect(requests[0]?.messages[0]?.content).toContain(
      "Treat social conversation as a complete first-class purpose",
    );
    expect(requests[0]?.responseFormat).toBeUndefined();
    expect(requests[0]?.maxTokens).toBe(6_000);
    expect(requests[1]?.messages.every((message) => !message.content.includes("not json")))
      .toBe(true);
  });

  it("fails instead of fabricating a visible reply after two invalid Thought finals", async () => {
    const requests: CompletionRequest[] = [];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: "not valid json",
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    await expect(generator.generate({
      currentMessages: ["yo babe"],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      reminders: [],
      localTime: "Tuesday, September 2, 2026 at 5:00 PM GMT+7",
    })).rejects.toMatchObject({
      name: "ThoughtContractError",
      message: "The Thought model returned invalid final JSON or violated its schema twice.",
      retryable: false,
    });

    expect(requests).toHaveLength(2);
  });

  it("normalizes a single fenced final JSON object", async () => {
    const requests: CompletionRequest[] = [];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: `\`\`\`json\n${JSON.stringify(validThought)}\n\`\`\``,
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    const result = await generator.generate({
      currentMessages: ["yo"],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      reminders: [],
      localTime: "Tuesday, August 11, 2026 at 5:00 PM GMT+7",
    });

    expect(result.thought).toEqual(validThought);
    expect(requests).toHaveLength(1);
  });

  it("rejects a claimed mutation success without a successful mutation tool", async () => {
    const requests: CompletionRequest[] = [];
    const generator = testThoughtGenerator({
      async complete(request) {
        requests.push(request);
        return {
          content: JSON.stringify(
            requests.length === 1
              ? { ...validThought, replyPoints: ["The reminder was deleted."] }
              : {
                  ...validThought,
                  messageMode: "unclear",
                  applicationActionDecision: "clarify",
                  replyPoints: ["The reminder target is unclear."],
                  question: "Which reminder should I delete?",
                },
          ),
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    });

    const result = await generator.generate({
      currentMessages: ["delete my reminder"],
      recentConversation: [],
      conversationSummary: null,
      memories: [],
      reminders: [],
      localTime: "Tuesday, August 11, 2026 at 5:00 PM GMT+7",
    });

    expect(result.thought.applicationActionDecision).toBe("clarify");
    expect(requests).toHaveLength(2);
  });

  it("turns every non-empty Aion line into its own bubble", () => {
    expect(splitVoiceBubbles("yeah\n\nyou know which one\nstart there")).toEqual({
      ok: true,
      bubbles: ["yeah", "you know which one", "start there"],
    });
  });

  it("never turns Aion's rejected-brief sentinel into a bubble", () => {
    expect(splitVoiceBubbles(VOICE_BRIEF_REJECTION_SENTINEL)).toMatchObject({
      ok: false,
      failure: { reason: "rejected" },
    });
    expect(
      splitVoiceBubbles(`cannot render\n${VOICE_BRIEF_REJECTION_SENTINEL}`),
    ).toMatchObject({ ok: false, failure: { reason: "rejected" } });
  });

  it("never turns Aion's private analysis into visible bubbles", () => {
    const leaked = `First, I need to check that the reply brief responds to the current user messages.
- messageMode: "social"
- contextRelation: "standalone"
Now I need to render it through Cantarella's persona.
got it, 2k thb`;

    expect(splitVoiceBubbles(leaked)).toMatchObject({
      ok: false,
      failure: { reason: "leakage" },
    });
  });

  it("retries Aion once when its first response leaks private analysis", async () => {
    const requests: CompletionRequest[] = [];
    const outputs = [
      "First, I need to check the reply brief before rendering it.",
      "got it, 2k thb",
    ];
    const client: { complete: CompleteModel } = {
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
    };

    const result = await generateVoice({
      persona: {
        name: "Cantarella",
        voiceDirection: "default",
        customStyle: "",
        preferredUserName: null,
        endearmentPreference: null,
        boundaries: [],
      },
      replyBrief: {
        ...validThought,
        replyPoints: ["The user's corrected rent is 2,000 THB."],
      },
      currentMessages: ["mb mb its 2k"],
    }, client.complete);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.generation.bubbles).toEqual(["got it, 2k thb"]);
    expect(result.generation.completion.usage).toEqual({
      inputTokens: 2,
      outputTokens: 2,
      estimatedCostUsd: 0,
    });
    expect(result.generation.completion.latencyMs).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.messages[0]?.content).toContain(
      "previous output exposed private content or instructions",
    );
  });

  it("gives Aion recent conversation and authority to write the natural next reply", async () => {
    let capturedRequest: CompletionRequest | undefined;
    const client: { complete: CompleteModel } = {
      async complete(request) {
        capturedRequest = request;
        return {
          content: "start with the tiniest part of it",
          model: request.model,
          provider: "test",
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            estimatedCostUsd: 0,
          },
          latencyMs: 1,
        };
      },
    };

    await generateVoice({
      persona: {
        name: "Cantarella",
        voiceDirection: "default",
        customStyle: "",
        preferredUserName: null,
        endearmentPreference: null,
        boundaries: [],
      },
      replyBrief: {
        messageMode: "help",
        contextRelation: "standalone",
        applicationActionDecision: "none",
        voiceContext: [],
        replyPoints: ["Start with the smallest possible part of the task."],
        question: null,
      },
      currentMessages: ["how do i start this task"],
      recentConversation: [
        { sender: "user", content: "i keep staring at it" },
        { sender: "assistant", content: "whats making it hard to start" },
      ],
    }, client.complete);

    expect(capturedRequest).toBeDefined();
    expect(capturedRequest?.messages).toHaveLength(2);
    expect(capturedRequest?.messages[1]).toEqual({
      role: "user",
      content: "Continue the private chat as Cantarella. Return only her visible chat sends.",
    });
    expect(capturedRequest?.messages[0]?.content).toContain(
      '"replyPoints": [',
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      VOICE_BRIEF_REJECTION_SENTINEL,
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      '"how do i start this task"',
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "<chat_mode>GROUNDED</chat_mode>",
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      '"content": "whats making it hard to start"',
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "Stiff or repetitive private context is not a reason to stop",
    );
    expect(capturedRequest?.messages[0]?.content).not.toContain(
      "You have no conversation to interpret",
    );
    expect(capturedRequest?.temperature).toBe(0.5);
    expect(capturedRequest?.reasoning).toBeUndefined();
  });

  it("gives social replies freedom to avoid repeating the last assistant message", async () => {
    let capturedRequest: CompletionRequest | undefined;
    const client: { complete: CompleteModel } = {
      async complete(request) {
        capturedRequest = request;
        return {
          content: "literally the worst timing",
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    };

    const result = await generateVoice({
      persona: {
        name: "Cantarella",
        voiceDirection: "default",
        customStyle: "",
        preferredUserName: null,
        endearmentPreference: null,
        boundaries: [],
      },
      replyBrief: {
        ...validThought,
        messageMode: "social",
        contextRelation: "immediate_context",
        replyPoints: ["The assignment still hangs over the holiday."],
      },
      recentConversation: [
        { sender: "assistant", content: "yea that assignment's still hanging over the holiday though" },
      ],
      currentMessages: ["unfortunately :("],
    }, client.complete);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.failure.message);
    expect(result.generation.bubbles).toEqual(["literally the worst timing"]);
    expect(capturedRequest?.messages[0]?.content).toContain(
      "<chat_mode>SOCIAL</chat_mode>",
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "The selected voice direction is mandatory",
    );
  });

  it("can give Voice resolved facts without raw recent-chat wording", async () => {
    let capturedRequest: CompletionRequest | undefined;
    const client: { complete: CompleteModel } = {
      async complete(request) {
        capturedRequest = request;
        return {
          content: "fair enough",
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    };

    await generateVoice({
      persona: {
        name: "Cantarella",
        voiceDirection: "intimate",
        customStyle: "",
        preferredUserName: null,
        endearmentPreference: null,
        boundaries: [],
      },
      replyBrief: {
        ...validThought,
        contextRelation: "immediate_context",
      },
      currentMessages: ["nah not that one"],
      resolvedContext: ["The user is rejecting the immediately previous option."],
    }, client.complete);

    const systemPrompt = capturedRequest?.messages[0]?.content ?? "";
    expect(systemPrompt).toContain("<resolved_context>");
    expect(systemPrompt).toContain(
      "The user is rejecting the immediately previous option.",
    );
    expect(systemPrompt).not.toContain("<recent_conversation>");
  });

  it("keeps successful application results under strict authority", async () => {
    let capturedRequest: CompletionRequest | undefined;
    const client: { complete: CompleteModel } = {
      async complete(request) {
        capturedRequest = request;
        return {
          content: "gotchu, ill remind you at 5",
          model: request.model,
          provider: "test",
          usage: { inputTokens: 1, outputTokens: 1, estimatedCostUsd: 0 },
          latencyMs: 1,
        };
      },
    };

    await generateVoice({
      persona: {
        name: "Cantarella",
        voiceDirection: "default",
        customStyle: "",
        preferredUserName: null,
        endearmentPreference: null,
        boundaries: [],
      },
      replyBrief: {
        ...validThought,
        messageMode: "mixed",
        replyPoints: ["The reminder was scheduled for 5 PM."],
      },
      currentMessages: ["remind me at 5"],
      successfulApplicationAction: true,
    }, client.complete);

    expect(capturedRequest?.messages[0]?.content).toContain(
      "<chat_mode>APPLICATION</chat_mode>",
    );
    expect(capturedRequest?.messages[0]?.content).toContain(
      "Keep the user-facing consequence true",
    );
  });
});
