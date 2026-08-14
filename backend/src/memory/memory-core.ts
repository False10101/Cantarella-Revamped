import { createHash } from "node:crypto";

export const memoryTypes = [
  "profile",
  "preference",
  "relationship",
  "boundary",
  "situation",
  "event",
] as const;

export type MemoryType = (typeof memoryTypes)[number];

export const memoryTopics = [
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
] as const;

export type MemoryTopic = (typeof memoryTopics)[number];

export const memoryEmbeddingRoles = [
  "canonical",
  "facet_1",
  "facet_2",
  "facet_3",
] as const;

export type MemoryEmbeddingRole = (typeof memoryEmbeddingRoles)[number];

export function normalizeMemoryText(text: string): string {
  return text
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function memoryContentHash(text: string): string {
  return createHash("sha256").update(normalizeMemoryText(text)).digest("hex");
}
