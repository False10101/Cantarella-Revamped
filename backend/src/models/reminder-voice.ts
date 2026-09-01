import type { VoicePersonaConfiguration } from "../prompts/voice-persona.js";
import type { CompleteModel } from "./openrouter.js";
import { generateVoice, type VoiceResult } from "./voice.js";

export type ReminderVoiceContext = {
  persona: VoicePersonaConfiguration;
  reminderText: string;
};

export async function generateReminderVoice(
  context: ReminderVoiceContext,
  completeModel?: CompleteModel,
): Promise<VoiceResult> {
  return generateVoice({
    persona: context.persona,
    replyBrief: {
      messageMode: "help",
      contextRelation: "standalone",
      applicationActionDecision: "none",
      voiceContext: [],
      replyPoints: [context.reminderText],
      question: null,
    },
    deliveryContext: { kind: "due_reminder" },
  }, completeModel);
}
