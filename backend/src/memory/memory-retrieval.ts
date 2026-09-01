import {
  and,
  asc,
  cosineDistance,
  eq,
  gt,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { database } from "../db/client.js";
import { memories, memoryEmbeddings } from "../db/schema.js";
import {
  embedTexts,
  type EmbedTexts,
} from "../models/embedding.js";
import { logger } from "../lib/logger.js";
import type { MemoryType } from "./memory-core.js";
import type { MemoryTopic } from "./memory-core.js";

export type MemoryMatchKind = "exact" | "full_text" | "semantic";

export interface RetrievedMemory {
  id: string;
  type: MemoryType;
  topic: MemoryTopic;
  subject: string | null;
  canonicalText: string;
  importance: number;
  confidence: number;
  expiresAt: Date | null;
  similarity: number;
  matchKinds?: MemoryMatchKind[];
}

export type RetrieveMemories = (input: {
  userId: string;
  queryTexts: string[];
  limit?: number;
  minimumSimilarity?: number;
}) => Promise<RetrievedMemory[]>;

type RawMemoryMatch = Omit<RetrievedMemory, "matchKinds">;

function fullTextQuery(value: string): string | null {
  const terms = [...new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((term) => term.length >= 2)
    .slice(0, 12);
  return terms.length > 0 ? terms.join(" | ") : null;
}

function matchScore(memory: RetrievedMemory): number {
  const kinds = new Set(memory.matchKinds ?? []);
  return (
    (kinds.has("exact") ? 1.5 : 0) +
    (kinds.has("full_text") ? 0.8 : 0) +
    memory.similarity * 0.72 +
    memory.importance * 0.18 +
    memory.confidence * 0.1 +
    (memory.type === "boundary" ? 0.04 : 0)
  );
}

export function rankMemoryMatches(
  matches: RetrievedMemory[],
  limit: number,
): RetrievedMemory[] {
  return [...matches]
    .sort((left, right) => matchScore(right) - matchScore(left))
    .slice(0, limit);
}

function mergeMatches(
  results: Array<{ kind: MemoryMatchKind; records: RawMemoryMatch[] }>,
  limit: number,
): RetrievedMemory[] {
  const merged = new Map<string, RetrievedMemory>();
  for (const { kind, records } of results) {
    for (const record of records) {
      const existing = merged.get(record.id);
      if (!existing) {
        merged.set(record.id, {
          ...record,
          matchKinds: [kind],
        });
        continue;
      }
      existing.similarity = Math.max(existing.similarity, record.similarity);
      if (!existing.matchKinds?.includes(kind)) existing.matchKinds?.push(kind);
    }
  }
  return rankMemoryMatches([...merged.values()], limit);
}

export async function retrieveMemories(
  input: Parameters<RetrieveMemories>[0],
  embed: EmbedTexts = embedTexts,
): Promise<RetrievedMemory[]> {
  const {
    userId,
    queryTexts,
    limit = 8,
    minimumSimilarity = 0.18,
  } = input;
const query = queryTexts.map((text) => text.trim()).filter(Boolean).join("\n");
if (!query) return [];

const now = new Date();
const activeScope = and(
  eq(memories.userId, userId),
  eq(memories.status, "active"),
  or(isNull(memories.expiresAt), gt(memories.expiresAt, now)),
);
const selectFields = {
  id: memories.id,
  type: memories.type,
  topic: memories.topic,
  subject: memories.subject,
  canonicalText: memories.canonicalText,
  importance: memories.importance,
  confidence: memories.confidence,
  expiresAt: memories.expiresAt,
};

const exactPromise = database
  .select(selectFields)
  .from(memories)
  .where(and(activeScope, sql`position(lower(${query}) in lower(${memories.canonicalText})) > 0`))
  .limit(12)
  .then((records) => records.map((record) => ({ ...record, similarity: 0 })));

const tsQuery = fullTextQuery(query);
const fullTextPromise = tsQuery
  ? database
      .select({
        ...selectFields,
        rank: sql<number>`ts_rank_cd(${memories.searchDocument}, to_tsquery('simple', ${tsQuery}))`,
      })
      .from(memories)
      .where(
        and(
          activeScope,
          sql`${memories.searchDocument} @@ to_tsquery('simple', ${tsQuery})`,
        ),
      )
      .orderBy(sql`ts_rank_cd(${memories.searchDocument}, to_tsquery('simple', ${tsQuery})) desc`)
      .limit(24)
      .then((records) => records.map(({ rank: _rank, ...record }) => ({ ...record, similarity: 0 })))
  : Promise.resolve([] as RawMemoryMatch[]);

const semanticPromise = embed([query])
  .then(async (generation) => {
    const [queryEmbedding] = generation.vectors;
    if (!queryEmbedding) return [] as RawMemoryMatch[];
    const distance = cosineDistance(memoryEmbeddings.embedding, queryEmbedding);
    const similarity = sql<number>`1 - (${distance})`;
    const records = await database
      .select({ ...selectFields, similarity })
      .from(memories)
      .innerJoin(
        memoryEmbeddings,
        and(
          eq(memoryEmbeddings.memoryId, memories.id),
          eq(memoryEmbeddings.isCurrent, true),
        ),
      )
      .where(and(activeScope, lt(distance, 1 - minimumSimilarity)))
      .orderBy(asc(distance))
      .limit(Math.max(limit * 4, 36));
    return records;
  })
  .catch((error) => {
    logger.warn(
      { error: error instanceof Error ? error.name : "EmbeddingError" },
      "Memory semantic retrieval unavailable; using lexical retrieval",
    );
    return [] as RawMemoryMatch[];
  });

const [exact, fullText, semantic] = await Promise.all([
  exactPromise,
  fullTextPromise,
  semanticPromise,
]);
  return mergeMatches(
    [
      { kind: "exact", records: exact },
      { kind: "full_text", records: fullText },
      { kind: "semantic", records: semantic },
    ],
    Math.min(limit, 12),
  );
}
