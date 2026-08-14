ALTER TABLE "memory_embeddings"
  DROP CONSTRAINT "memory_embeddings_role_check";--> statement-breakpoint
ALTER TABLE "memory_embeddings"
  ADD CONSTRAINT "memory_embeddings_role_check"
  CHECK ("memory_embeddings"."embedding_role" in ('canonical', 'facet_1', 'facet_2', 'facet_3', 'facet_4'));
