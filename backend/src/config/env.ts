import "dotenv/config";
import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: z.string().min(1),
  AUTH0_DOMAIN: z.string().min(1),
  AUTH0_AUDIENCE: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  THOUGHT_MODEL: z
    .string()
    .min(1)
    .default("openai/gpt-6-luna"),
  VOICE_MODEL: z.string().min(1).default("openai/gpt-5.6-luna"),
  VOICE_CONTEXT_MODE: z.enum(["history", "resolved"]).default("history"),
  EMBEDDING_MODEL: z
    .string()
    .min(1)
    .default("openai/text-embedding-3-small"),
  MESSAGE_SETTLE_MS: z.coerce.number().int().min(250).max(10_000).default(1_200),
  MODEL_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(120_000),
  JOB_POLL_MS: z.coerce.number().int().min(100).max(10_000).default(500),
});

export type Environment = z.infer<typeof environmentSchema>;

let parsedEnvironment: Environment | undefined;

export function getEnvironment(): Environment {
  if (parsedEnvironment) {
    return parsedEnvironment;
  }

  const result = environmentSchema.safeParse(process.env);

  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");

    throw new Error(`Invalid backend environment fields: ${fields}`);
  }

  parsedEnvironment = result.data;
  return parsedEnvironment;
}
