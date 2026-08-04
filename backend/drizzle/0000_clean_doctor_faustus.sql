CREATE TABLE "conversation_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"start_message_id" uuid NOT NULL,
	"end_message_id" uuid NOT NULL,
	"summary_text" text NOT NULL,
	"open_situations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"token_count" integer,
	"search_document" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("summary_text", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_summaries_status_check" CHECK ("conversation_summaries"."status" in ('pending', 'active', 'superseded', 'archived')),
	CONSTRAINT "conversation_summaries_text_not_empty_check" CHECK (length(btrim("conversation_summaries"."summary_text")) > 0),
	CONSTRAINT "conversation_summaries_token_count_check" CHECK ("conversation_summaries"."token_count" is null or "conversation_summaries"."token_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "conversation_summary_embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_summary_id" uuid NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "conversation_summary_embeddings_dimensions_check" CHECK ("conversation_summary_embeddings"."embedding_dimensions" = 1536),
	CONSTRAINT "conversation_summary_embeddings_superseded_check" CHECK (("conversation_summary_embeddings"."is_current" = true and "conversation_summary_embeddings"."superseded_at" is null) or ("conversation_summary_embeddings"."is_current" = false and "conversation_summary_embeddings"."superseded_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "input_batch_messages" (
	"batch_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "input_batch_messages_batch_id_message_id_pk" PRIMARY KEY("batch_id","message_id"),
	CONSTRAINT "input_batch_messages_position_check" CHECK ("input_batch_messages"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "input_batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"status" text NOT NULL,
	"settle_at" timestamp with time zone NOT NULL,
	"sealed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "input_batches_status_check" CHECK ("input_batches"."status" in ('collecting', 'ready', 'processing', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"run_at" timestamp with time zone NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer NOT NULL,
	"dedupe_key" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error_code" text,
	"last_error_message" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_status_check" CHECK ("jobs"."status" in ('pending', 'processing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "jobs_attempt_count_check" CHECK ("jobs"."attempt_count" >= 0),
	CONSTRAINT "jobs_max_attempts_check" CHECK ("jobs"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"supersedes_memory_id" uuid,
	"type" text NOT NULL,
	"canonical_text" text NOT NULL,
	"importance" numeric(4, 3) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"status" text NOT NULL,
	"normalized_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone,
	"last_reinforced_at" timestamp with time zone,
	"search_document" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce("canonical_text", ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_type_check" CHECK ("memories"."type" in ('profile', 'preference', 'relationship', 'boundary', 'situation', 'event')),
	CONSTRAINT "memories_status_check" CHECK ("memories"."status" in ('pending', 'active', 'superseded', 'archived', 'deleted')),
	CONSTRAINT "memories_importance_check" CHECK ("memories"."importance" >= 0 and "memories"."importance" <= 1),
	CONSTRAINT "memories_confidence_check" CHECK ("memories"."confidence" >= 0 and "memories"."confidence" <= 1),
	CONSTRAINT "memories_text_not_empty_check" CHECK (length(btrim("memories"."canonical_text")) > 0),
	CONSTRAINT "memories_not_self_superseding_check" CHECK ("memories"."supersedes_memory_id" is null or "memories"."supersedes_memory_id" <> "memories"."id")
);
--> statement-breakpoint
CREATE TABLE "memory_embeddings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"memory_id" uuid NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding_dimensions" integer NOT NULL,
	"content_hash" varchar(64) NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "memory_embeddings_dimensions_check" CHECK ("memory_embeddings"."embedding_dimensions" = 1536),
	CONSTRAINT "memory_embeddings_superseded_check" CHECK (("memory_embeddings"."is_current" = true and "memory_embeddings"."superseded_at" is null) or ("memory_embeddings"."is_current" = false and "memory_embeddings"."superseded_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "memory_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"lineage_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"related_memory_id" uuid,
	"event_type" text NOT NULL,
	"actor" text NOT NULL,
	"source_message_id" uuid,
	"model_run_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_events_type_check" CHECK ("memory_events"."event_type" in ('created', 'reinforced', 'corrected', 'superseded', 'user_edited', 'archived', 'restored', 'expired', 'deleted', 'embedding_failed', 'reembedded')),
	CONSTRAINT "memory_events_actor_check" CHECK ("memory_events"."actor" in ('user', 'memory_policy', 'system'))
);
--> statement-breakpoint
CREATE TABLE "memory_evidence" (
	"id" uuid PRIMARY KEY NOT NULL,
	"memory_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memory_evidence_relationship_check" CHECK ("memory_evidence"."relationship" in ('supports', 'reinforces', 'corrects', 'contradicts')),
	CONSTRAINT "memory_evidence_confidence_check" CHECK ("memory_evidence"."confidence" >= 0 and "memory_evidence"."confidence" <= 1)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"turn_id" uuid,
	"reminder_delivery_id" uuid,
	"role" text NOT NULL,
	"kind" text DEFAULT 'chat' NOT NULL,
	"origin" text NOT NULL,
	"content" text NOT NULL,
	"client_message_id" uuid,
	"part_index" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "messages_role_check" CHECK ("messages"."role" in ('user', 'assistant', 'system')),
	CONSTRAINT "messages_kind_check" CHECK ("messages"."kind" in ('chat', 'reminder')),
	CONSTRAINT "messages_origin_check" CHECK ("messages"."origin" in ('web', 'android', 'ios', 'system')),
	CONSTRAINT "messages_content_not_empty_check" CHECK (length(btrim("messages"."content")) > 0),
	CONSTRAINT "messages_part_index_check" CHECK ("messages"."part_index" is null or "messages"."part_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "model_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"turn_id" uuid,
	"job_id" uuid,
	"phase" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"persona_version" integer,
	"status" text NOT NULL,
	"input_json" jsonb,
	"output_json" jsonb,
	"raw_output" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"estimated_cost_usd" numeric(12, 8),
	"latency_ms" integer,
	"error_code" text,
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_runs_phase_check" CHECK ("model_runs"."phase" in ('thought', 'voice', 'summary', 'reminder_voice')),
	CONSTRAINT "model_runs_status_check" CHECK ("model_runs"."status" in ('running', 'completed', 'failed')),
	CONSTRAINT "model_runs_tokens_check" CHECK (("model_runs"."input_tokens" is null or "model_runs"."input_tokens" >= 0) and ("model_runs"."output_tokens" is null or "model_runs"."output_tokens" >= 0)),
	CONSTRAINT "model_runs_latency_check" CHECK ("model_runs"."latency_ms" is null or "model_runs"."latency_ms" >= 0)
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"custom_style" text NOT NULL,
	"preferred_user_name" text,
	"endearment_preference" text,
	"boundaries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personas_version_positive_check" CHECK ("personas"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "reminder_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reminder_id" uuid NOT NULL,
	"occurrence_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"message_id" uuid,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminder_deliveries_status_check" CHECK ("reminder_deliveries"."status" in ('pending', 'processing', 'delivered', 'failed', 'cancelled')),
	CONSTRAINT "reminder_deliveries_attempt_count_check" CHECK ("reminder_deliveries"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"title" text NOT NULL,
	"original_request" text,
	"timezone" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"recurrence_rule" text,
	"next_run_at" timestamp with time zone,
	"status" text NOT NULL,
	"source_message_id" uuid,
	"creation_key" text,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reminders_status_check" CHECK ("reminders"."status" in ('scheduled', 'paused', 'completed', 'cancelled')),
	CONSTRAINT "reminders_title_not_empty_check" CHECK (length(btrim("reminders"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "turns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"input_batch_id" uuid NOT NULL,
	"status" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"retry_of_turn_id" uuid,
	"error_code" text,
	"error_message" text,
	"retryable" boolean,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turns_status_check" CHECK ("turns"."status" in ('queued', 'thinking', 'voicing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "turns_attempt_positive_check" CHECK ("turns"."attempt_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_quiet_hours_pair_check" CHECK (("user_settings"."quiet_hours_start" is null) = ("user_settings"."quiet_hours_end" is null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"auth_issuer" text NOT NULL,
	"auth_subject" text NOT NULL,
	"email" text,
	"display_name" text,
	"onboarding_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_start_message_id_messages_id_fk" FOREIGN KEY ("start_message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summaries" ADD CONSTRAINT "conversation_summaries_end_message_id_messages_id_fk" FOREIGN KEY ("end_message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_summary_embeddings" ADD CONSTRAINT "conversation_summary_embeddings_conversation_summary_id_conversation_summaries_id_fk" FOREIGN KEY ("conversation_summary_id") REFERENCES "public"."conversation_summaries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_batch_messages" ADD CONSTRAINT "input_batch_messages_batch_id_input_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."input_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_batch_messages" ADD CONSTRAINT "input_batch_messages_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "input_batches" ADD CONSTRAINT "input_batches_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_supersedes_memory_id_memories_id_fk" FOREIGN KEY ("supersedes_memory_id") REFERENCES "public"."memories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_related_memory_id_memories_id_fk" FOREIGN KEY ("related_memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_events" ADD CONSTRAINT "memory_events_model_run_id_model_runs_id_fk" FOREIGN KEY ("model_run_id") REFERENCES "public"."model_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_evidence" ADD CONSTRAINT "memory_evidence_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_reminder_delivery_id_reminder_deliveries_id_fk" FOREIGN KEY ("reminder_delivery_id") REFERENCES "public"."reminder_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_turn_id_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_runs" ADD CONSTRAINT "model_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_input_batch_id_input_batches_id_fk" FOREIGN KEY ("input_batch_id") REFERENCES "public"."input_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turns" ADD CONSTRAINT "turns_retry_of_turn_id_turns_id_fk" FOREIGN KEY ("retry_of_turn_id") REFERENCES "public"."turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_summaries_range_unique" ON "conversation_summaries" USING btree ("conversation_id","start_message_id","end_message_id");--> statement-breakpoint
CREATE INDEX "conversation_summaries_lookup_idx" ON "conversation_summaries" USING btree ("user_id","conversation_id","status");--> statement-breakpoint
CREATE INDEX "conversation_summaries_search_idx" ON "conversation_summaries" USING gin ("search_document");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_summary_embeddings_content_unique" ON "conversation_summary_embeddings" USING btree ("conversation_summary_id","embedding_model","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_summary_embeddings_current_unique" ON "conversation_summary_embeddings" USING btree ("conversation_summary_id") WHERE "conversation_summary_embeddings"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_owner_unique" ON "conversations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "input_batch_messages_message_unique" ON "input_batch_messages" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "input_batch_messages_position_unique" ON "input_batch_messages" USING btree ("batch_id","position");--> statement-breakpoint
CREATE INDEX "input_batches_ready_idx" ON "input_batches" USING btree ("conversation_id","status","settle_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_key_unique" ON "jobs" USING btree ("dedupe_key") WHERE "jobs"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_at","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "memories_active_hash_unique" ON "memories" USING btree ("user_id","normalized_hash") WHERE "memories"."status" = 'active';--> statement-breakpoint
CREATE INDEX "memories_user_status_expiry_idx" ON "memories" USING btree ("user_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "memories_lineage_idx" ON "memories" USING btree ("user_id","lineage_id");--> statement-breakpoint
CREATE INDEX "memories_search_idx" ON "memories" USING gin ("search_document");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_embeddings_content_unique" ON "memory_embeddings" USING btree ("memory_id","embedding_model","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_embeddings_current_unique" ON "memory_embeddings" USING btree ("memory_id") WHERE "memory_embeddings"."is_current" = true;--> statement-breakpoint
CREATE INDEX "memory_events_lineage_created_idx" ON "memory_events" USING btree ("user_id","lineage_id","created_at");--> statement-breakpoint
CREATE INDEX "memory_events_memory_created_idx" ON "memory_events" USING btree ("memory_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memory_evidence_unique" ON "memory_evidence" USING btree ("memory_id","message_id","relationship");--> statement-breakpoint
CREATE INDEX "memory_evidence_message_idx" ON "memory_evidence" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_id_unique" ON "messages" USING btree ("conversation_id","client_message_id") WHERE "messages"."client_message_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_turn_part_unique" ON "messages" USING btree ("turn_id","part_index") WHERE "messages"."turn_id" is not null and "messages"."role" = 'assistant';--> statement-breakpoint
CREATE INDEX "model_runs_turn_phase_idx" ON "model_runs" USING btree ("turn_id","phase");--> statement-breakpoint
CREATE INDEX "model_runs_job_idx" ON "model_runs" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_user_unique" ON "personas" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_deliveries_occurrence_unique" ON "reminder_deliveries" USING btree ("reminder_id","occurrence_at");--> statement-breakpoint
CREATE INDEX "reminder_deliveries_status_idx" ON "reminder_deliveries" USING btree ("status","occurrence_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_creation_key_unique" ON "reminders" USING btree ("user_id","creation_key") WHERE "reminders"."creation_key" is not null;--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_batch_attempt_unique" ON "turns" USING btree ("input_batch_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "turns_one_active_per_conversation_unique" ON "turns" USING btree ("conversation_id") WHERE "turns"."status" in ('thinking', 'voicing');--> statement-breakpoint
CREATE INDEX "turns_conversation_status_idx" ON "turns" USING btree ("conversation_id","status","queued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_identity_unique" ON "users" USING btree ("auth_issuer","auth_subject");