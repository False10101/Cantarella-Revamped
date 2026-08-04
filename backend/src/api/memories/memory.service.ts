import { randomUUID } from "node:crypto";

import { and, desc, eq, ilike, ne } from "drizzle-orm";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { database } from "../../db/client.js";
import {
  memories,
  memoryEmbeddings,
  memoryEvents,
  users,
  type Memory,
} from "../../db/schema.js";
import { HttpError } from "../../http/http-error.js";
import {
  memoryContentHash,
  normalizeMemoryText,
} from "../../memory/memory-processor.js";
import {
  createEmbeddingClient,
  type EmbeddingClient,
  type EmbeddingGeneration,
} from "../../models/embedding.js";
import type {
  CreateMemoryInput,
  ListMemoriesQuery,
  MemorySnapshot,
  PublicMemoryType,
  UpdateMemoryInput,
} from "./memory.types.js";

export interface MemoryService {
  list(
    identity: AuthenticatedIdentity,
    query: ListMemoriesQuery,
  ): Promise<MemorySnapshot[]>;
  create(
    identity: AuthenticatedIdentity,
    input: CreateMemoryInput,
  ): Promise<MemorySnapshot>;
  update(
    identity: AuthenticatedIdentity,
    memoryId: string,
    input: UpdateMemoryInput,
  ): Promise<MemorySnapshot>;
  remove(
    identity: AuthenticatedIdentity,
    memoryId: string,
  ): Promise<MemorySnapshot>;
}

function accountNotInitialized(): HttpError {
  return new HttpError(
    404,
    "ACCOUNT_NOT_INITIALIZED",
    "Complete the login bootstrap before accessing memories.",
  );
}

function memoryNotFound(): HttpError {
  return new HttpError(404, "MEMORY_NOT_FOUND", "The memory does not exist.");
}

function memoryConflict(): HttpError {
  return new HttpError(
    409,
    "MEMORY_ALREADY_EXISTS",
    "That memory is already stored.",
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

function toSnapshot(memory: Memory): MemorySnapshot {
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

function parsedExpiry(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function validateExpiry(type: PublicMemoryType, expiresAt: Date | null): void {
  if (type === "situation" && expiresAt === null) {
    throw new HttpError(
      400,
      "INVALID_MEMORY",
      "Situation memories require an expiry time.",
    );
  }

  if (expiresAt && expiresAt <= new Date()) {
    throw new HttpError(
      400,
      "INVALID_MEMORY",
      "Memory expiry must be in the future.",
    );
  }
}

async function loadUserId(identity: AuthenticatedIdentity): Promise<string> {
  const [user] = await database
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.authIssuer, identity.issuer),
        eq(users.authSubject, identity.subject),
      ),
    )
    .limit(1);

  if (!user) throw accountNotInitialized();
  return user.id;
}

function embeddingValues(
  memoryId: string,
  contentHash: string,
  generation: EmbeddingGeneration,
) {
  const vector = generation.vectors[0];
  if (!vector) throw new Error("The embedding response was empty.");

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

export function createMemoryService(dependencies: {
  embeddingClient?: EmbeddingClient;
} = {}): MemoryService {
  const embeddingClient = dependencies.embeddingClient ?? createEmbeddingClient();

  return {
    async list(identity, query) {
      const userId = await loadUserId(identity);
      const conditions = [
        eq(memories.userId, userId),
        eq(memories.status, query.status),
      ];

      if (query.type) conditions.push(eq(memories.type, query.type));
      if (query.search) {
        conditions.push(ilike(memories.canonicalText, `%${query.search}%`));
      }

      const records = await database
        .select()
        .from(memories)
        .where(and(...conditions))
        .orderBy(desc(memories.updatedAt), desc(memories.createdAt))
        .limit(query.limit);

      return records.map(toSnapshot);
    },

    async create(identity, input) {
      const userId = await loadUserId(identity);
      const normalizedHash = memoryContentHash(
        normalizeMemoryText(input.content),
      );
      const expiresAt = parsedExpiry(input.expiresAt);
      validateExpiry(input.type, expiresAt);

      const [duplicate] = await database
        .select({ id: memories.id })
        .from(memories)
        .where(
          and(
            eq(memories.userId, userId),
            eq(memories.normalizedHash, normalizedHash),
            eq(memories.status, "active"),
          ),
        )
        .limit(1);
      if (duplicate) throw memoryConflict();

      const embedding = await embeddingClient.embed([input.content]);
      const now = new Date();
      const memoryId = randomUUID();

      try {
        return await database.transaction(async (transaction) => {
          const [created] = await transaction
            .insert(memories)
            .values({
              id: memoryId,
              userId,
              lineageId: memoryId,
              type: input.type,
              canonicalText: input.content,
              importance: input.importance,
              confidence: 1,
              status: "active",
              normalizedHash,
              expiresAt,
              lastReinforcedAt: now,
            })
            .returning();
          if (!created) throw new Error("The memory was not created.");

          await transaction.insert(memoryEmbeddings).values(
            embeddingValues(memoryId, normalizedHash, embedding),
          );
          await transaction.insert(memoryEvents).values({
            id: randomUUID(),
            userId,
            lineageId: memoryId,
            memoryId,
            eventType: "created",
            actor: "user",
            metadata: { source: "memory_page", userConfirmed: true },
          });

          return toSnapshot(created);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw memoryConflict();
        throw error;
      }
    },

    async update(identity, memoryId, input) {
      const userId = await loadUserId(identity);
      const [existing] = await database
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.id, memoryId),
            eq(memories.userId, userId),
            eq(memories.status, "active"),
          ),
        )
        .limit(1);
      if (!existing) throw memoryNotFound();

      const nextContent = input.content ?? existing.canonicalText;
      const nextType = input.type ?? existing.type;
      const nextExpiresAt =
        input.expiresAt === undefined
          ? existing.expiresAt
          : parsedExpiry(input.expiresAt);
      validateExpiry(nextType, nextExpiresAt);

      const contentChanged = nextContent !== existing.canonicalText;
      const nextHash = contentChanged
        ? memoryContentHash(normalizeMemoryText(nextContent))
        : existing.normalizedHash;
      const embedding = contentChanged
        ? await embeddingClient.embed([nextContent])
        : null;

      try {
        return await database.transaction(async (transaction) => {
          const [locked] = await transaction
            .select()
            .from(memories)
            .where(
              and(
                eq(memories.id, memoryId),
                eq(memories.userId, userId),
                eq(memories.status, "active"),
              ),
            )
            .limit(1)
            .for("update");
          if (!locked) throw memoryNotFound();

          if (nextHash !== locked.normalizedHash) {
            const [duplicate] = await transaction
              .select({ id: memories.id })
              .from(memories)
              .where(
                and(
                  eq(memories.userId, userId),
                  eq(memories.normalizedHash, nextHash),
                  eq(memories.status, "active"),
                  ne(memories.id, memoryId),
                ),
              )
              .limit(1);
            if (duplicate) throw memoryConflict();
          }

          const now = new Date();
          const [updated] = await transaction
            .update(memories)
            .set({
              canonicalText: nextContent,
              type: nextType,
              importance: input.importance ?? locked.importance,
              confidence: 1,
              normalizedHash: nextHash,
              expiresAt: nextExpiresAt,
              updatedAt: now,
            })
            .where(eq(memories.id, memoryId))
            .returning();
          if (!updated) throw memoryNotFound();

          if (contentChanged && embedding) {
            await transaction
              .update(memoryEmbeddings)
              .set({ isCurrent: false, supersededAt: now })
              .where(
                and(
                  eq(memoryEmbeddings.memoryId, memoryId),
                  eq(memoryEmbeddings.isCurrent, true),
                ),
              );
            await transaction.insert(memoryEmbeddings).values(
              embeddingValues(memoryId, nextHash, embedding),
            );
          }

          await transaction.insert(memoryEvents).values({
            id: randomUUID(),
            userId,
            lineageId: locked.lineageId,
            memoryId,
            eventType: "user_edited",
            actor: "user",
            metadata: {
              before: {
                content: locked.canonicalText,
                type: locked.type,
                importance: locked.importance,
                expiresAt: locked.expiresAt?.toISOString() ?? null,
              },
              after: {
                content: updated.canonicalText,
                type: updated.type,
                importance: updated.importance,
                expiresAt: updated.expiresAt?.toISOString() ?? null,
              },
              userConfirmed: true,
            },
          });

          return toSnapshot(updated);
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw memoryConflict();
        throw error;
      }
    },

    async remove(identity, memoryId) {
      const userId = await loadUserId(identity);

      return database.transaction(async (transaction) => {
        const [locked] = await transaction
          .select()
          .from(memories)
          .where(
            and(
              eq(memories.id, memoryId),
              eq(memories.userId, userId),
              eq(memories.status, "active"),
            ),
          )
          .limit(1)
          .for("update");
        if (!locked) throw memoryNotFound();

        const now = new Date();
        const [deleted] = await transaction
          .update(memories)
          .set({ status: "deleted", updatedAt: now })
          .where(eq(memories.id, memoryId))
          .returning();
        if (!deleted) throw memoryNotFound();

        await transaction
          .update(memoryEmbeddings)
          .set({ isCurrent: false, supersededAt: now })
          .where(
            and(
              eq(memoryEmbeddings.memoryId, memoryId),
              eq(memoryEmbeddings.isCurrent, true),
            ),
          );
        await transaction.insert(memoryEvents).values({
          id: randomUUID(),
          userId,
          lineageId: locked.lineageId,
          memoryId,
          eventType: "deleted",
          actor: "user",
          metadata: {
            content: locked.canonicalText,
            type: locked.type,
            source: "memory_page",
          },
        });

        return toSnapshot(deleted);
      });
    },
  };
}
