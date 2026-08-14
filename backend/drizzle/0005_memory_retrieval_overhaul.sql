ALTER TABLE "memories" ADD COLUMN "topic" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "subject" varchar(120);--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_topic_check" CHECK ("memories"."topic" in ('personal', 'finances', 'university', 'projects', 'people', 'health', 'routines', 'home', 'logistics', 'other'));--> statement-breakpoint
CREATE INDEX "memories_user_topic_idx" ON "memories" USING btree ("user_id","status","topic","updated_at");--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD COLUMN "embedding_role" text DEFAULT 'canonical' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD COLUMN "source_text" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "memory_embeddings" AS "embedding" SET "source_text" = "memory"."canonical_text" FROM "memories" AS "memory" WHERE "embedding"."memory_id" = "memory"."id";--> statement-breakpoint
DROP INDEX "memory_embeddings_content_unique";--> statement-breakpoint
DROP INDEX "memory_embeddings_current_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "memory_embeddings_content_unique" ON "memory_embeddings" USING btree ("memory_id","embedding_model","embedding_role","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_embeddings_current_unique" ON "memory_embeddings" USING btree ("memory_id","embedding_role") WHERE "memory_embeddings"."is_current" = true;--> statement-breakpoint
CREATE INDEX "memory_embeddings_current_role_idx" ON "memory_embeddings" USING btree ("memory_id","embedding_role","is_current");--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_role_check" CHECK ("memory_embeddings"."embedding_role" in ('canonical', 'facet_1', 'facet_2', 'facet_3'));
