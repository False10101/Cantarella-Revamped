import { z } from "zod";

import { voiceDirectionIds } from "../../persona/voice-directions.js";

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const optionalShortText = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => value || null);

export const onboardingInputSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine(isValidTimeZone, "Timezone must be a valid IANA timezone"),
  persona: z.object({
    name: z.string().trim().min(1).max(80),
    voiceDirection: z.enum(voiceDirectionIds).default("default"),
    customStyle: z.string().trim().max(4_000).default(""),
    preferredUserName: optionalShortText,
    endearmentPreference: optionalShortText,
    boundaries: z.array(z.string().trim().min(1).max(300)).max(30).default([]),
  }),
});

export const accountSettingsInputSchema = onboardingInputSchema;

export type OnboardingInput = z.infer<typeof onboardingInputSchema>;
export type AccountSettingsInput = z.infer<typeof accountSettingsInputSchema>;

export interface AccountSnapshot {
  id: string;
  name: string | null;
  email: string | null;
  timezone: string;
  conversationId: string;
  onboardingComplete: boolean;
  onboardingCompletedAt: string | null;
  persona: {
    name: string;
    voiceDirection: (typeof voiceDirectionIds)[number];
    customStyle: string;
    preferredUserName: string | null;
    endearmentPreference: string | null;
    boundaries: string[];
    version: number;
  };
}
