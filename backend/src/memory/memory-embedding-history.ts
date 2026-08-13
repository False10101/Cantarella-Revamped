export interface MemoryEmbeddingIdentity {
  id: string;
  embeddingModel: string;
  contentHash: string;
}

export function reusableMemoryEmbeddingId(
  embeddings: MemoryEmbeddingIdentity[],
  embeddingModel: string,
  contentHash: string,
): string | null {
  return (
    embeddings.find(
      (embedding) =>
        embedding.embeddingModel === embeddingModel &&
        embedding.contentHash === contentHash,
    )?.id ?? null
  );
}
