import {
  and,
  asc,
  cosineDistance,
  desc,
  eq,
  lt,
  notInArray,
  sql,
} from "drizzle-orm";

import { database } from "../db/client.js";
import {
  conversationSummaries,
  conversationSummaryEmbeddings,
} from "../db/schema.js";
import { logger } from "../lib/logger.js";
import {
  embedTexts,
  type EmbedTexts,
} from "../models/embedding.js";

export interface RetrievedSummaryChunk {
  id: string;
  startMessageId: string;
  endMessageId: string;
  summaryText: string;
  openSituations: string[];
  createdAt: Date;
  similarity: number | null;
}

export interface SummaryRetrieval {
  recent: RetrievedSummaryChunk[];
  relevant: RetrievedSummaryChunk[];
  latestEndMessageId: string | null;
}

export type RetrieveSummaryChunks = (input: {
  userId: string;
  conversationId: string;
  queryTexts: string[];
  recentLimit?: number;
  relevantLimit?: number;
  minimumSimilarity?: number;
}) => Promise<SummaryRetrieval>;

export function formatSummaryContext(
  retrieval: SummaryRetrieval,
): string | null {
  if (retrieval.recent.length === 0 && retrieval.relevant.length === 0) {
    return null;
  }

  const sections: string[] = [];
  if (retrieval.recent.length > 0) {
    sections.push(
      `Recent compressed conversation episodes:\n${retrieval.recent
        .map((chunk) => `- ${chunk.summaryText}`)
        .join("\n")}`,
    );
  }
  if (retrieval.relevant.length > 0) {
    sections.push(
      `Relevant older conversation episodes:\n${retrieval.relevant
        .map((chunk) => `- ${chunk.summaryText}`)
        .join("\n")}`,
    );
  }

  const openSituations = [
    ...retrieval.recent,
    ...retrieval.relevant,
  ].flatMap((chunk) => chunk.openSituations);
  const uniqueOpenSituations = [...new Set(openSituations)];
  if (uniqueOpenSituations.length > 0) {
    sections.push(
      `Historically open situations (background only; current messages decide whether they remain active):\n${uniqueOpenSituations
        .map((item) => `- ${item}`)
        .join("\n")}`,
    );
  }

  return sections.join("\n\n");
}

export async function retrieveSummaryChunks(
  input: Parameters<RetrieveSummaryChunks>[0],
  embed: EmbedTexts = embedTexts,
): Promise<SummaryRetrieval> {
  const {
    userId,
    conversationId,
    queryTexts,
    recentLimit = 2,
    relevantLimit = 3,
    minimumSimilarity = 0.22,
  } = input;
const recentRecords = await database
  .select({
    id: conversationSummaries.id,
    startMessageId: conversationSummaries.startMessageId,
    endMessageId: conversationSummaries.endMessageId,
    summaryText: conversationSummaries.summaryText,
    openSituations: conversationSummaries.openSituations,
    createdAt: conversationSummaries.createdAt,
  })
  .from(conversationSummaries)
  .where(
    and(
      eq(conversationSummaries.userId, userId),
      eq(conversationSummaries.conversationId, conversationId),
      eq(conversationSummaries.status, "active"),
    ),
  )
  .orderBy(desc(conversationSummaries.createdAt))
  .limit(recentLimit);

const recent = [...recentRecords]
  .reverse()
  .map((record) => ({ ...record, similarity: null }));
const latestEndMessageId = recent.at(-1)?.endMessageId ?? null;
const query = queryTexts.map((text) => text.trim()).filter(Boolean).join("\n");
if (!query || relevantLimit === 0) {
  return { recent, relevant: [], latestEndMessageId };
}

try {
  const generation = await embed([query]);
  const [queryEmbedding] = generation.vectors;
  if (!queryEmbedding) {
    return { recent, relevant: [], latestEndMessageId };
  }

  const distance = cosineDistance(
    conversationSummaryEmbeddings.embedding,
    queryEmbedding,
  );
  const similarity = sql<number>`1 - (${distance})`;
  const conditions = [
    eq(conversationSummaries.userId, userId),
    eq(conversationSummaries.conversationId, conversationId),
    eq(conversationSummaries.status, "active"),
    eq(conversationSummaryEmbeddings.isCurrent, true),
    lt(distance, 1 - minimumSimilarity),
  ];
  const recentIds = recent.map((chunk) => chunk.id);
  if (recentIds.length > 0) {
    conditions.push(notInArray(conversationSummaries.id, recentIds));
  }

  const relevant = await database
    .select({
      id: conversationSummaries.id,
      startMessageId: conversationSummaries.startMessageId,
      endMessageId: conversationSummaries.endMessageId,
      summaryText: conversationSummaries.summaryText,
      openSituations: conversationSummaries.openSituations,
      createdAt: conversationSummaries.createdAt,
      similarity,
    })
    .from(conversationSummaries)
    .innerJoin(
      conversationSummaryEmbeddings,
      eq(
        conversationSummaryEmbeddings.conversationSummaryId,
        conversationSummaries.id,
      ),
    )
    .where(and(...conditions))
    .orderBy(asc(distance))
    .limit(relevantLimit);

  return { recent, relevant, latestEndMessageId };
} catch (error) {
  logger.warn(
    { error: error instanceof Error ? error.name : "EmbeddingError" },
    "Conversation-summary semantic retrieval unavailable; using recent chunks only",
  );
    return { recent, relevant: [], latestEndMessageId };
  }
}
