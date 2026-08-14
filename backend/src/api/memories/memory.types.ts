import { z } from "zod";

export const publicMemoryTypeSchema = z.enum([
  "profile",
  "preference",
  "relationship",
  "boundary",
  "situation",
  "event",
]);

export const publicMemoryTopicSchema = z.enum([
  "personal",
  "finances",
  "university",
  "projects",
  "people",
  "health",
  "routines",
  "home",
  "logistics",
  "other",
]);

const expiresAtSchema = z
  .string()
  .datetime({ offset: true })
  .nullable();

export const memoryIdSchema = z.string().uuid();

export const listMemoriesQuerySchema = z
  .object({
    type: publicMemoryTypeSchema.optional(),
    topic: publicMemoryTopicSchema.optional(),
    status: z.literal("active").default("active"),
    search: z.string().trim().max(120).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const createMemoryInputSchema = z
  .object({
    content: z.string().trim().min(1).max(500),
    type: publicMemoryTypeSchema,
    topic: publicMemoryTopicSchema.default("other"),
    subject: z.string().trim().min(1).max(120).nullable().default(null),
    importance: z.number().min(0).max(1).default(0.7),
    expiresAt: expiresAtSchema.default(null),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.type === "situation" && input.expiresAt === null) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "Situation memories require an expiry time.",
      });
    }
  });

export const updateMemoryInputSchema = z
  .object({
    content: z.string().trim().min(1).max(500).optional(),
    type: publicMemoryTypeSchema.optional(),
    topic: publicMemoryTopicSchema.optional(),
    subject: z.string().trim().min(1).max(120).nullable().optional(),
    importance: z.number().min(0).max(1).optional(),
    expiresAt: expiresAtSchema.optional(),
  })
  .strict()
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one memory field is required.",
  });

export type PublicMemoryType = z.infer<typeof publicMemoryTypeSchema>;
export type PublicMemoryTopic = z.infer<typeof publicMemoryTopicSchema>;
export type ListMemoriesQuery = z.infer<typeof listMemoriesQuerySchema>;
export type CreateMemoryInput = z.infer<typeof createMemoryInputSchema>;
export type UpdateMemoryInput = z.infer<typeof updateMemoryInputSchema>;

export interface MemorySnapshot {
  id: string;
  type: PublicMemoryType;
  topic: PublicMemoryTopic;
  subject: string | null;
  content: string;
  importance: number;
  confidence: number;
  status: "pending" | "active" | "superseded" | "archived" | "deleted";
  expiresAt: string | null;
  lastReinforcedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
