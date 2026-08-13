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
  createEmbeddingClient,
  type EmbeddingClient,
} from "../models/embedding.js";
import { logger } from "../lib/logger.js";
import type { MemoryType } from "./memory-core.js";

export interface RetrievedMemory {
  id: string;
  type: MemoryType;
  canonicalText: string;
  importance: number;
  confidence: number;
  expiresAt: Date | null;
  similarity: number;
}

export interface MemoryRetriever {
  retrieve(input: {
    userId: string;
    queryTexts: string[];
    limit?: number;
    minimumSimilarity?: number;
  }): Promise<RetrievedMemory[]>;
}

export function rankMemoryMatches(
  matches: RetrievedMemory[],
  limit: number,
): RetrievedMemory[] {
  return [...matches]
    .sort((left, right) => {
      const leftScore =
        left.similarity * 0.72 +
        left.importance * 0.18 +
        left.confidence * 0.1 +
        (left.type === "boundary" ? 0.04 : 0);
      const rightScore =
        right.similarity * 0.72 +
        right.importance * 0.18 +
        right.confidence * 0.1 +
        (right.type === "boundary" ? 0.04 : 0);

      return rightScore - leftScore;
    })
    .slice(0, limit);
}

export function createMemoryRetriever(
  embeddingClient: EmbeddingClient = createEmbeddingClient(),
): MemoryRetriever {
  return {
    async retrieve({
      userId,
      queryTexts,
      limit = 8,
      minimumSimilarity = 0.28,
    }) {
      const query = queryTexts.map((text) => text.trim()).filter(Boolean).join("\n");
      if (!query) return [];

      let queryEmbedding: number[];

      try {
        const generation = await embeddingClient.embed([query]);
        const [vector] = generation.vectors;
        if (!vector) return [];
        queryEmbedding = vector;
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.name : "EmbeddingError" },
          "Memory semantic retrieval unavailable; using importance fallback",
        );
        return [];
      }

      const distance = cosineDistance(memoryEmbeddings.embedding, queryEmbedding);
      const similarity = sql<number>`1 - (${distance})`;
      const records = await database
        .select({
          id: memories.id,
          type: memories.type,
          canonicalText: memories.canonicalText,
          importance: memories.importance,
          confidence: memories.confidence,
          expiresAt: memories.expiresAt,
          similarity,
        })
        .from(memories)
        .innerJoin(
          memoryEmbeddings,
          and(
            eq(memoryEmbeddings.memoryId, memories.id),
            eq(memoryEmbeddings.isCurrent, true),
          ),
        )
        .where(
          and(
            eq(memories.userId, userId),
            eq(memories.status, "active"),
            or(isNull(memories.expiresAt), gt(memories.expiresAt, new Date())),
            lt(distance, 1 - minimumSimilarity),
          ),
        )
        .orderBy(asc(distance))
        .limit(Math.max(limit * 2, 12));

      return rankMemoryMatches(records, limit);
    },
  };
}
