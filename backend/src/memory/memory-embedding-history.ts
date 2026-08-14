export interface MemoryEmbeddingIdentity {
  id: string;
  embeddingModel: string;
  embeddingRole: string;
  contentHash: string;
}

export function reusableMemoryEmbeddingId(
  embeddings: MemoryEmbeddingIdentity[],
  embeddingModel: string,
  embeddingRole: string,
  contentHash: string,
): string | null {
  return (
    embeddings.find(
        (embedding) =>
          embedding.embeddingModel === embeddingModel &&
          embedding.embeddingRole === embeddingRole &&
          embedding.contentHash === contentHash,
    )?.id ?? null
  );
}
