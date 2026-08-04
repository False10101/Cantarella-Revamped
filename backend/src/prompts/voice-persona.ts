import { readFileSync } from "node:fs";

import {
  voiceDirectionAddons,
  type VoiceDirection,
} from "../persona/voice-directions.js";

export const CANTARELLA_CORE_VERSION = "soul-v1";

export const cantarellaCoreSoul = readFileSync(
  new URL("./SOUL.md", import.meta.url),
  "utf8",
).trim();

export interface VoicePersonaConfiguration {
  name: string;
  voiceDirection: VoiceDirection;
  customStyle: string;
  preferredUserName: string | null;
  endearmentPreference: string | null;
  boundaries: string[];
}

function section(title: string, content: string): string {
  return `## ${title}\n\n${content}`;
}

export function buildVoicePersonaPrompt(
  configuration: VoicePersonaConfiguration,
): string {
  const sections = [cantarellaCoreSoul];
  const directionAddon = voiceDirectionAddons[configuration.voiceDirection];

  if (directionAddon) {
    sections.push(section("VOICE DIRECTION ADD-ON", directionAddon));
  }

  const identityOverrides = [
    `The current persona name is ${configuration.name}.`,
    configuration.preferredUserName
      ? `The current user's preferred name is ${configuration.preferredUserName}. Use it instead of any literal user name appearing in the core.`
      : null,
    configuration.endearmentPreference
      ? `Endearment preference: ${configuration.endearmentPreference}`
      : null,
  ].filter((value): value is string => value !== null);

  sections.push(
    section(
      "CURRENT USER PERSONALIZATION",
      `${identityOverrides.join("\n")}\n\nThese preferences take priority over conflicting details in the core while leaving every non-conflicting part of the core intact.`,
    ),
  );

  if (configuration.customStyle.trim()) {
    sections.push(
      section(
        "USER-WRITTEN VOICE OVERRIDE",
        `${configuration.customStyle.trim()}\n\nThis user-written preference has higher priority than both the core and the selected voice direction when they conflict. Preserve the rest of the core unchanged.`,
      ),
    );
  }

  if (configuration.boundaries.length > 0) {
    sections.push(
      section(
        "USER BOUNDARIES — HIGHEST PERSONA PRIORITY",
        `${configuration.boundaries.map((boundary) => `- ${boundary}`).join("\n")}\n\nThese boundaries override any conflicting core, direction, or custom-style instruction. Preserve every non-conflicting part of the core unchanged.`,
      ),
    );
  }

  sections.push(
    section(
      "PERSONA RESOLUTION ORDER",
      "Apply the full core first. Then apply the selected voice-direction add-on. Then apply current-user personalization. Then apply the user-written voice override. Finally apply user boundaries. Later layers override only direct conflicts; they do not replace or weaken unrelated parts of Cantarella's core identity.",
    ),
  );

  return sections.join("\n\n---\n\n");
}
