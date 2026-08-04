import { z } from "zod";

export const reminderIdSchema = z.string().uuid();
export const reminderRecurrenceSchema = z
  .enum(["daily", "weekly", "monthly"])
  .nullable();
export const reminderStatusSchema = z.enum([
  "scheduled",
  "paused",
  "completed",
]);

const localDateTimeSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use YYYY-MM-DDTHH:mm.");

export const listRemindersQuerySchema = z
  .object({
    status: reminderStatusSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const createReminderInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    scheduledForLocal: localDateTimeSchema.optional(),
    recurrence: reminderRecurrenceSchema.default(null),
    clientRequestId: z.string().uuid().optional(),
  })
  .strict()
  .refine(
    (input) =>
      Number(input.scheduledFor !== undefined) +
        Number(input.scheduledForLocal !== undefined) ===
      1,
    { message: "Provide exactly one reminder schedule." },
  );

export const updateReminderInputSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    scheduledForLocal: localDateTimeSchema.optional(),
    recurrence: reminderRecurrenceSchema.optional(),
    status: z.enum(["scheduled", "paused"]).optional(),
  })
  .strict()
  .refine(
    (input) =>
      !(
        input.scheduledFor !== undefined &&
        input.scheduledForLocal !== undefined
      ),
    { message: "Provide only one reminder schedule." },
  )
  .refine((input) => Object.keys(input).length > 0, {
    message: "At least one reminder field is required.",
  });

export type ReminderRecurrence = z.infer<typeof reminderRecurrenceSchema>;
export type ReminderStatus = z.infer<typeof reminderStatusSchema>;
export type ListRemindersQuery = z.infer<typeof listRemindersQuerySchema>;
export type CreateReminderInput = z.infer<typeof createReminderInputSchema>;
export type UpdateReminderInput = z.infer<typeof updateReminderInputSchema>;

export interface ReminderSnapshot {
  id: string;
  title: string;
  timezone: string;
  scheduledFor: string;
  recurrence: ReminderRecurrence;
  nextRunAt: string | null;
  status: "scheduled" | "paused" | "completed" | "cancelled";
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
}
