import {
  type VoicePersonaConfiguration,
} from "../prompts/voice-persona.js";
import {
  createOpenRouterClient,
  type ModelCompletion,
  type OpenRouterClient,
} from "./openrouter.js";
import { createVoiceGenerator } from "./voice.js";

export interface ReminderVoiceContext {
  persona: VoicePersonaConfiguration;
  reminderText: string;
}

export interface ReminderVoiceGeneration {
  rawOutput: string;
  bubbles: string[];
  completion: ModelCompletion;
}

export interface ReminderVoiceGenerator {
  generate(context: ReminderVoiceContext): Promise<ReminderVoiceGeneration>;
}

export function createReminderVoiceGenerator(
  client: OpenRouterClient = createOpenRouterClient(),
): ReminderVoiceGenerator {
  const voiceGenerator = createVoiceGenerator(client);

  return {
    async generate(context) {
      return voiceGenerator.generate({
        persona: context.persona,
        replyBrief: {
          messageMode: "help",
          contextRelation: "standalone",
          replyPoints: [context.reminderText],
          question: null,
          reminderAction: null,
        },
        deliveryContext: { kind: "due_reminder" },
      });
    },
  };
}
