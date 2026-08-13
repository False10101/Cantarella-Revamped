import { randomUUID } from "node:crypto";

import { and, eq, ne } from "drizzle-orm";

import type { MemorySnapshot } from "../api/memories/memory.types.js";
import { database } from "../db/client.js";
import {
  memories,
  memoryEmbeddings,
  memoryEvidence,
  memoryEvents,
  type Memory,
} from "../db/schema.js";
import {
  createEmbeddingClient,
  type EmbeddingClient,
  type EmbeddingGeneration,
} from "../models/embedding.js";
import type { MemoryAction } from "../models/thought.js";
import {
  memoryContentHash,
  normalizeMemoryText,
  type MemoryType,
} from "./memory-core.js";
import { reusableMemoryEmbeddingId } from "./memory-embedding-history.js";

export class InvalidMemoryActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMemoryActionError";
  }
}

function snapshot(memory: Memory): MemorySnapshot {
  return {
    id: memory.id,
    type: memory.type,
    content: memory.canonicalText,
    importance: memory.importance,
    confidence: memory.confidence,
    status: memory.status,
    expiresAt: memory.expiresAt?.toISOString() ?? null,
    lastReinforcedAt: memory.lastReinforcedAt?.toISOString() ?? null,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}

function embeddingValues(
  memoryId: string,
  contentHash: string,
  generation: EmbeddingGeneration,
) {
  const vector = generation.vectors[0];
  if (!vector) throw new Error("The memory embedding response was empty.");
  return {
    id: randomUUID(),
    memoryId,
    embeddingModel: generation.model,
    embeddingDimensions: generation.dimensions,
    contentHash,
    embedding: vector,
    isCurrent: true,
  };
}

export interface MemoryActionResult {
  memory: MemorySnapshot;
  deletedMemoryCount: number;
}

export async function createChatMemory(input: {
  userId: string;
  sourceMessageId: string;
  type: MemoryType;
  canonicalText: string;
  importance: number;
  expiresAt: Date | null;
}, embeddingClient: EmbeddingClient = createEmbeddingClient()): Promise<MemoryActionResult> {
  const normalizedHash = memoryContentHash(normalizeMemoryText(input.canonicalText));
  const embedding = await embeddingClient.embed([input.canonicalText]);
  const now = new Date();
  const memoryId = randomUUID();

  const created = await database.transaction(async (transaction) => {
    const [duplicate] = await transaction
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.userId, input.userId),
          eq(memories.normalizedHash, normalizedHash),
          eq(memories.status, "active"),
        ),
      )
      .limit(1)
      .for("update");
    if (duplicate) {
      throw new InvalidMemoryActionError("That memory is already stored.");
    }

    const [record] = await transaction
      .insert(memories)
      .values({
        id: memoryId,
        userId: input.userId,
        lineageId: memoryId,
        type: input.type,
        canonicalText: input.canonicalText,
        importance: input.importance,
        confidence: 1,
        status: "active",
        normalizedHash,
        expiresAt: input.expiresAt,
        lastReinforcedAt: now,
      })
      .returning();
    if (!record) throw new InvalidMemoryActionError("The memory could not be stored.");

    await transaction.insert(memoryEmbeddings).values(
      embeddingValues(memoryId, normalizedHash, embedding),
    );
    await transaction.insert(memoryEvidence).values({
      id: randomUUID(),
      memoryId,
      messageId: input.sourceMessageId,
      relationship: "supports",
      confidence: 1,
    });
    await transaction.insert(memoryEvents).values({
      id: randomUUID(),
      userId: input.userId,
      lineageId: memoryId,
      memoryId,
      eventType: "created",
      actor: "user",
      sourceMessageId: input.sourceMessageId,
      metadata: { source: "chat_agent" },
    });
    return record;
  });

  const memory = snapshot(created);
  return {
    memory,
    deletedMemoryCount: 0,
  };
}

export async function executeMemoryAction(
  input: {
    action: MemoryAction;
    userId: string;
    sourceMessageId: string;
    replacementType?: MemoryType;
    replacementImportance?: number;
    replacementExpiresAt?: Date | null;
  },
  embeddingClient: EmbeddingClient = createEmbeddingClient(),
): Promise<MemoryActionResult> {
  const memoryId = input.action.targetMemoryRef;
  const [existing] = await database
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.id, memoryId),
        eq(memories.userId, input.userId),
        eq(memories.status, "active"),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new InvalidMemoryActionError(
      "The selected memory no longer exists or is not active.",
    );
  }

  if (input.action.operation === "delete") {
    const deletedCount = await database.transaction(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.id, memoryId),
            eq(memories.userId, input.userId),
            eq(memories.status, "active"),
          ),
        )
        .limit(1)
        .for("update");
      if (!locked) {
        throw new InvalidMemoryActionError(
          "The selected memory no longer exists or is not active.",
        );
      }

      await transaction
        .update(memories)
        .set({ supersedesMemoryId: null })
        .where(
          and(
            eq(memories.userId, input.userId),
            eq(memories.lineageId, locked.lineageId),
          ),
        );
      const deleted = await transaction
        .delete(memories)
        .where(
          and(
            eq(memories.userId, input.userId),
            eq(memories.lineageId, locked.lineageId),
          ),
        )
        .returning({ id: memories.id });
      if (deleted.length === 0) {
        throw new InvalidMemoryActionError(
          "The selected memory could not be deleted.",
        );
      }
      return deleted.length;
    });

    const removed = snapshot(existing);
    return {
      memory: removed,
      deletedMemoryCount: deletedCount,
    };
  }

  const replacementText = input.action.replacementText;
  if (!replacementText) {
    throw new InvalidMemoryActionError(
      "The memory edit has no replacement text.",
    );
  }
  const normalizedHash = memoryContentHash(normalizeMemoryText(replacementText));
  const contentChanged = replacementText !== existing.canonicalText;
  const embeddingChanged = normalizedHash !== existing.normalizedHash;
  const embedding = embeddingChanged
    ? await embeddingClient.embed([replacementText])
    : null;

  const updated = await database.transaction(async (transaction) => {
    const [locked] = await transaction
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.id, memoryId),
          eq(memories.userId, input.userId),
          eq(memories.status, "active"),
        ),
      )
      .limit(1)
      .for("update");
    if (!locked) {
      throw new InvalidMemoryActionError(
        "The selected memory no longer exists or is not active.",
      );
    }

    if (normalizedHash !== locked.normalizedHash) {
      const [duplicate] = await transaction
        .select({ id: memories.id })
        .from(memories)
        .where(
          and(
            eq(memories.userId, input.userId),
            eq(memories.normalizedHash, normalizedHash),
            eq(memories.status, "active"),
            ne(memories.id, memoryId),
          ),
        )
        .limit(1);
      if (duplicate) {
        throw new InvalidMemoryActionError(
          "That corrected memory is already stored.",
        );
      }
    }

    const now = new Date();
    const [record] = await transaction
      .update(memories)
      .set({
        canonicalText: replacementText,
        normalizedHash,
        ...(input.replacementType
          ? { type: input.replacementType }
          : {}),
        ...(input.replacementImportance !== undefined
          ? { importance: input.replacementImportance }
          : {}),
        ...(input.replacementExpiresAt !== undefined
          ? { expiresAt: input.replacementExpiresAt }
          : {}),
        confidence: 1,
        lastReinforcedAt: now,
        pendingDeleteConfirmationTurnId: null,
        updatedAt: now,
      })
      .where(eq(memories.id, memoryId))
      .returning();
    if (!record) {
      throw new InvalidMemoryActionError(
        "The selected memory could not be edited.",
      );
    }

    if (embeddingChanged && embedding) {
      const historicalEmbeddings = await transaction
        .select({
          id: memoryEmbeddings.id,
          embeddingModel: memoryEmbeddings.embeddingModel,
          contentHash: memoryEmbeddings.contentHash,
        })
        .from(memoryEmbeddings)
        .where(eq(memoryEmbeddings.memoryId, memoryId));
      const reusableEmbeddingId = reusableMemoryEmbeddingId(
        historicalEmbeddings,
        embedding.model,
        normalizedHash,
      );
      await transaction
        .update(memoryEmbeddings)
        .set({ isCurrent: false, supersededAt: now })
        .where(
          and(
            eq(memoryEmbeddings.memoryId, memoryId),
            eq(memoryEmbeddings.isCurrent, true),
          ),
        );
      if (reusableEmbeddingId) {
        const vector = embedding.vectors[0];
        if (!vector) {
          throw new Error("The memory embedding response was empty.");
        }
        await transaction
          .update(memoryEmbeddings)
          .set({
            embeddingDimensions: embedding.dimensions,
            embedding: vector,
            isCurrent: true,
            supersededAt: null,
          })
          .where(eq(memoryEmbeddings.id, reusableEmbeddingId));
      } else {
        await transaction.insert(memoryEmbeddings).values(
          embeddingValues(memoryId, normalizedHash, embedding),
        );
      }
    }

    await transaction.insert(memoryEvents).values({
      id: randomUUID(),
      userId: input.userId,
      lineageId: locked.lineageId,
      memoryId,
      eventType: "user_edited",
      actor: "user",
      sourceMessageId: input.sourceMessageId,
      metadata: {
        before: locked.canonicalText,
        after: replacementText,
        source: "chat_agent",
        contentChanged,
      },
    });

    return record;
  });

  const result = snapshot(updated);
  return {
    memory: result,
    deletedMemoryCount: 0,
  };
}
