import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  buildVoicePersonaPrompt,
  cantarellaCoreSoul,
} from "../src/prompts/voice-persona.js";

const originalSoulSha256 =
  "6b1d104078c74f126ccde30040cfa32fafd4d4e0d085f4348ef2f9075190586a";

describe("Cantarella voice persona composition", () => {
  it("keeps the canonical SOUL.md byte-for-byte unchanged", () => {
    const soulBytes = readFileSync(
      new URL("../src/prompts/SOUL.md", import.meta.url),
    );

    expect(createHash("sha256").update(soulBytes).digest("hex")).toBe(
      originalSoulSha256,
    );
  });

  it("uses the full core with no direction addon or custom override by default", () => {
    const prompt = buildVoicePersonaPrompt({
      name: "Cantarella",
      voiceDirection: "default",
      customStyle: "",
      preferredUserName: "Ian",
      endearmentPreference: null,
      boundaries: [],
    });

    expect(prompt.startsWith(cantarellaCoreSoul)).toBe(true);
    expect(prompt).not.toContain("## VOICE DIRECTION ADD-ON");
    expect(prompt).not.toContain("## USER-WRITTEN VOICE OVERRIDE");
    expect(prompt).not.toContain("## USER BOUNDARIES");
    expect(prompt).toContain("Response length varies.");
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
