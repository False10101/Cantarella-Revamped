import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildVoicePersonaPrompt,
  cantarellaCoreSoul,
} from "../src/prompts/voice-persona.js";

describe("Cantarella voice persona composition", () => {
  it("loads the neutral core directly from SOUL.md", () => {
    const soul = readFileSync(
      new URL("../src/prompts/SOUL.md", import.meta.url),
      "utf8",
    );

    expect(cantarellaCoreSoul).toBe(soul.trim());
    expect(cantarellaCoreSoul).toContain(
      "The selected voice direction determines Cantarella's expressive style.",
    );
  });

  it("uses the full core and the selected default direction", () => {
    const prompt = buildVoicePersonaPrompt({
      name: "Cantarella",
      voiceDirection: "default",
      customStyle: "",
      preferredUserName: "Ian",
      endearmentPreference: null,
      boundaries: [],
    });

    expect(prompt.startsWith(cantarellaCoreSoul)).toBe(true);
    expect(prompt).toContain("## VOICE DIRECTION ADD-ON");
    expect(prompt).toContain("Keep a balanced, familiar, and grounded presence.");
    expect(prompt).not.toContain("## USER-WRITTEN VOICE OVERRIDE");
    expect(prompt).not.toContain("## USER BOUNDARIES");
    expect(prompt).toContain("The current persona name is Cantarella.");
  });

  it("orders direction, custom override, and boundaries after the unchanged core", () => {
    const prompt = buildVoicePersonaPrompt({
      name: "Cantarella",
      voiceDirection: "nurturing",
      customStyle: "Be softer specifically when I mention exams.",
      preferredUserName: "Mina",
      endearmentPreference: "Use endearments rarely.",
      boundaries: ["Never use emojis"],
    });

    const coreIndex = prompt.indexOf(cantarellaCoreSoul);
    const directionIndex = prompt.indexOf("## VOICE DIRECTION ADD-ON");
    const customIndex = prompt.indexOf("## USER-WRITTEN VOICE OVERRIDE");
    const boundaryIndex = prompt.indexOf(
      "## USER BOUNDARIES — HIGHEST PERSONA PRIORITY",
    );

    expect(coreIndex).toBe(0);
    expect(directionIndex).toBeGreaterThan(coreIndex);
    expect(customIndex).toBeGreaterThan(directionIndex);
    expect(boundaryIndex).toBeGreaterThan(customIndex);
    expect(prompt).toContain(
      "Use it instead of any literal user name appearing in the core.",
    );
  });
});
