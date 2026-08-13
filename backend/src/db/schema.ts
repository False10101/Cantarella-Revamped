import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  varchar,
} from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

const timestampColumns = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

const messageRoles = ["user", "assistant", "system"] as const;
const messageKinds = ["chat", "reminder"] as const;
const messageOrigins = ["web", "android", "ios", "system"] as const;
const inputBatchStatuses = [
  "collecting",
  "ready",
  "processing",
  "completed",
  "cancelled",
] as const;
const turnStatuses = [
  "queued",
  "thinking",
  "voicing",
  "completed",
  "failed",
  "cancelled",
] as const;
const modelRunPhases = [
  "thought",
  "voice",
  "memory",
  "summary",
  "reminder_voice",
] as const;
const modelRunStatuses = ["running", "completed", "failed"] as const;
const summaryStatuses = ["pending", "active", "superseded", "archived"] as const;
const memoryTypes = [
  "profile",
  "preference",
  "relationship",
  "boundary",
  "situation",
  "event",
] as const;
const memoryStatuses = [
  "pending",
  "active",
  "superseded",
  "archived",
  "deleted",
] as const;
const memoryEvidenceRelationships = [
  "supports",
  "reinforces",
  "corrects",
  "contradicts",
] as const;
const memoryEventTypes = [
  "created",
  "reinforced",
  "corrected",
  "superseded",
  "user_edited",
  "archived",
  "restored",
  "expired",
  "deleted",
  "embedding_failed",
  "reembedded",
] as const;
const memoryEventActors = ["user", "memory_policy", "system"] as const;
const voiceDirections = [
  "default",
  "softer",
  "firmer",
  "playful",
  "nurturing",
  "intimate",
] as const;
const reminderStatuses = ["scheduled", "paused", "completed", "cancelled"] as const;
const reminderDeliveryStatuses = [
  "pending",
  "processing",
  "delivered",
  "failed",
  "cancelled",
] as const;
const jobStatuses = ["pending", "processing", "completed", "failed", "cancelled"] as const;

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    authIssuer: text("auth_issuer").notNull(),
    authSubject: text("auth_subject").notNull(),
    email: text("email"),
    displayName: text("display_name"),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
    }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("users_auth_identity_unique").on(
      table.authIssuer,
      table.authSubject,
    ),
  ],
);

export const userSettings = pgTable(
  "user_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    timezone: text("timezone").notNull(),
    quietHoursStart: time("quiet_hours_start"),
    quietHoursEnd: time("quiet_hours_end"),
    ...timestampColumns,
  },
  (table) => [
    check(
      "user_settings_quiet_hours_pair_check",
      sql`(${table.quietHoursStart} is null) = (${table.quietHoursEnd} is null)`,
    ),
  ],
);

export const personas = pgTable(
  "personas",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer("version").notNull().default(1),
    name: text("name").notNull(),
    voiceDirection: text("voice_direction", { enum: voiceDirections })
      .notNull()
      .default("default"),
    customStyle: text("custom_style").notNull(),
    preferredUserName: text("preferred_user_name"),
    endearmentPreference: text("endearment_preference"),
    boundaries: jsonb("boundaries").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("personas_user_unique").on(table.userId),
    check("personas_version_positive_check", sql`${table.version} > 0`),
    check(
      "personas_voice_direction_check",
      sql`${table.voiceDirection} in ('default', 'softer', 'firmer', 'playful', 'nurturing', 'intimate')`,
    ),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [uniqueIndex("conversations_owner_unique").on(table.ownerUserId)],
);

export const inputBatches = pgTable(
  "input_batches",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    status: text("status", { enum: inputBatchStatuses }).notNull(),
    settleAt: timestamp("settle_at", { withTimezone: true }).notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    index("input_batches_ready_idx").on(
      table.conversationId,
      table.status,
      table.settleAt,
    ),
    check(
      "input_batches_status_check",
      sql`${table.status} in ('collecting', 'ready', 'processing', 'completed', 'cancelled')`,
    ),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    turnId: uuid("turn_id").references((): AnyPgColumn => turns.id, {
      onDelete: "set null",
    }),
    reminderDeliveryId: uuid("reminder_delivery_id").references(
      (): AnyPgColumn => reminderDeliveries.id,
      { onDelete: "set null" },
    ),
    role: text("role", { enum: messageRoles }).notNull(),
    kind: text("kind", { enum: messageKinds }).notNull().default("chat"),
    origin: text("origin", { enum: messageOrigins }).notNull(),
    content: text("content").notNull(),
    clientMessageId: uuid("client_message_id"),
    partIndex: integer("part_index"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("messages_conversation_created_idx").on(
      table.conversationId,
      table.createdAt,
    ),
    uniqueIndex("messages_client_id_unique")
      .on(table.conversationId, table.clientMessageId)
      .where(sql`${table.clientMessageId} is not null`),
    uniqueIndex("messages_turn_part_unique")
      .on(table.turnId, table.partIndex)
      .where(sql`${table.turnId} is not null and ${table.role} = 'assistant'`),
    check("messages_role_check", sql`${table.role} in ('user', 'assistant', 'system')`),
    check("messages_kind_check", sql`${table.kind} in ('chat', 'reminder')`),
    check(
      "messages_origin_check",
      sql`${table.origin} in ('web', 'android', 'ios', 'system')`,
    ),
    check("messages_content_not_empty_check", sql`length(btrim(${table.content})) > 0`),
    check(
      "messages_part_index_check",
      sql`${table.partIndex} is null or ${table.partIndex} >= 0`,
    ),
  ],
);

export const inputBatchMessages = pgTable(
  "input_batch_messages",
  {
    batchId: uuid("batch_id")
      .notNull()
      .references(() => inputBatches.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.batchId, table.messageId] }),
    uniqueIndex("input_batch_messages_message_unique").on(table.messageId),
    uniqueIndex("input_batch_messages_position_unique").on(
      table.batchId,
      table.position,
    ),
    check("input_batch_messages_position_check", sql`${table.position} >= 0`),
  ],
);

export const turns = pgTable(
  "turns",
  {
    id: uuid("id").primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    inputBatchId: uuid("input_batch_id")
      .notNull()
      .references(() => inputBatches.id, { onDelete: "cascade" }),
    status: text("status", { enum: turnStatuses }).notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    retryOfTurnId: uuid("retry_of_turn_id").references(
      (): AnyPgColumn => turns.id,
      { onDelete: "set null" },
    ),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    retryable: boolean("retryable"),
    queuedAt: timestamp("queued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("turns_batch_attempt_unique").on(
      table.inputBatchId,
      table.attemptNumber,
    ),
    uniqueIndex("turns_one_active_per_conversation_unique")
      .on(table.conversationId)
      .where(sql`${table.status} in ('thinking', 'voicing')`),
    index("turns_conversation_status_idx").on(
      table.conversationId,
      table.status,
      table.queuedAt,
    ),
    check(
      "turns_status_check",
      sql`${table.status} in ('queued', 'thinking', 'voicing', 'completed', 'failed', 'cancelled')`,
    ),
    check("turns_attempt_positive_check", sql`${table.attemptNumber} > 0`),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: jobStatuses }).notNull(),
    priority: integer("priority").notNull().default(0),
    runAt: timestamp("run_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull(),
    dedupeKey: text("dedupe_key"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("jobs_dedupe_key_unique")
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    index("jobs_claim_idx").on(
      table.status,
      table.runAt,
      table.priority,
    ),
    check(
      "jobs_status_check",
      sql`${table.status} in ('pending', 'processing', 'completed', 'failed', 'cancelled')`,
    ),
    check("jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check("jobs_max_attempts_check", sql`${table.maxAttempts} > 0`),
  ],
);

export const modelRuns = pgTable(
  "model_runs",
  {
    id: uuid("id").primaryKey(),
    turnId: uuid("turn_id").references(() => turns.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    phase: text("phase", { enum: modelRunPhases }).notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    personaVersion: integer("persona_version"),
    status: text("status", { enum: modelRunStatuses }).notNull(),
    inputJson: jsonb("input_json").$type<Record<string, unknown>>(),
    outputJson: jsonb("output_json").$type<Record<string, unknown>>(),
    rawOutput: text("raw_output"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 12,
      scale: 8,
      mode: "number",
    }),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("model_runs_turn_phase_idx").on(table.turnId, table.phase),
    index("model_runs_job_idx").on(table.jobId),
    check(
      "model_runs_phase_check",
      sql`${table.phase} in ('thought', 'voice', 'memory', 'summary', 'reminder_voice')`,
    ),
    check(
      "model_runs_status_check",
      sql`${table.status} in ('running', 'completed', 'failed')`,
    ),
    check(
      "model_runs_tokens_check",
      sql`(${table.inputTokens} is null or ${table.inputTokens} >= 0) and (${table.outputTokens} is null or ${table.outputTokens} >= 0)`,
    ),
    check(
      "model_runs_latency_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
  ],
);

export const conversationSummaries = pgTable(
  "conversation_summaries",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    startMessageId: uuid("start_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "restrict" }),
    endMessageId: uuid("end_message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "restrict" }),
    summaryText: text("summary_text").notNull(),
    openSituations: jsonb("open_situations").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status", { enum: summaryStatuses }).notNull(),
    tokenCount: integer("token_count"),
    searchDocument: tsvector("search_document").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("summary_text", ''))`,
    ),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("conversation_summaries_range_unique").on(
      table.conversationId,
      table.startMessageId,
      table.endMessageId,
    ),
    index("conversation_summaries_lookup_idx").on(
      table.userId,
      table.conversationId,
      table.status,
    ),
    index("conversation_summaries_search_idx").using(
      "gin",
      table.searchDocument,
    ),
    check(
      "conversation_summaries_status_check",
      sql`${table.status} in ('pending', 'active', 'superseded', 'archived')`,
    ),
    check(
      "conversation_summaries_text_not_empty_check",
      sql`length(btrim(${table.summaryText})) > 0`,
    ),
    check(
      "conversation_summaries_token_count_check",
      sql`${table.tokenCount} is null or ${table.tokenCount} >= 0`,
    ),
  ],
);

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lineageId: uuid("lineage_id").notNull(),
    supersedesMemoryId: uuid("supersedes_memory_id").references(
      (): AnyPgColumn => memories.id,
      { onDelete: "restrict" },
    ),
    type: text("type", { enum: memoryTypes }).notNull(),
    canonicalText: text("canonical_text").notNull(),
    importance: numeric("importance", {
      precision: 4,
      scale: 3,
      mode: "number",
    }).notNull(),
    confidence: numeric("confidence", {
      precision: 4,
      scale: 3,
      mode: "number",
    }).notNull(),
    status: text("status", { enum: memoryStatuses }).notNull(),
    normalizedHash: varchar("normalized_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastReinforcedAt: timestamp("last_reinforced_at", { withTimezone: true }),
    pendingDeleteConfirmationTurnId: uuid(
      "pending_delete_confirmation_turn_id",
    ).references((): AnyPgColumn => turns.id, { onDelete: "set null" }),
    searchDocument: tsvector("search_document").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce("canonical_text", ''))`,
    ),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("memories_active_hash_unique")
      .on(table.userId, table.normalizedHash)
      .where(sql`${table.status} = 'active'`),
    index("memories_user_status_expiry_idx").on(
      table.userId,
      table.status,
      table.expiresAt,
    ),
    index("memories_lineage_idx").on(table.userId, table.lineageId),
    index("memories_search_idx").using("gin", table.searchDocument),
    check(
      "memories_type_check",
      sql`${table.type} in ('profile', 'preference', 'relationship', 'boundary', 'situation', 'event')`,
    ),
    check(
      "memories_status_check",
      sql`${table.status} in ('pending', 'active', 'superseded', 'archived', 'deleted')`,
    ),
    check(
      "memories_importance_check",
      sql`${table.importance} >= 0 and ${table.importance} <= 1`,
    ),
    check(
      "memories_confidence_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
    check(
      "memories_text_not_empty_check",
      sql`length(btrim(${table.canonicalText})) > 0`,
    ),
    check(
      "memories_not_self_superseding_check",
      sql`${table.supersedesMemoryId} is null or ${table.supersedesMemoryId} <> ${table.id}`,
    ),
  ],
);

export const memoryEvidence = pgTable(
  "memory_evidence",
  {
    id: uuid("id").primaryKey(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    relationship: text("relationship", {
      enum: memoryEvidenceRelationships,
    }).notNull(),
    confidence: numeric("confidence", {
      precision: 4,
      scale: 3,
      mode: "number",
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("memory_evidence_unique").on(
      table.memoryId,
      table.messageId,
      table.relationship,
    ),
    index("memory_evidence_message_idx").on(table.messageId),
    check(
      "memory_evidence_relationship_check",
      sql`${table.relationship} in ('supports', 'reinforces', 'corrects', 'contradicts')`,
    ),
    check(
      "memory_evidence_confidence_check",
      sql`${table.confidence} >= 0 and ${table.confidence} <= 1`,
    ),
  ],
);

export const memoryEmbeddings = pgTable(
  "memory_embeddings",
  {
    id: uuid("id").primaryKey(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    embeddingModel: text("embedding_model").notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("memory_embeddings_content_unique").on(
      table.memoryId,
      table.embeddingModel,
      table.contentHash,
    ),
    uniqueIndex("memory_embeddings_current_unique")
      .on(table.memoryId)
      .where(sql`${table.isCurrent} = true`),
    check(
      "memory_embeddings_dimensions_check",
      sql`${table.embeddingDimensions} = 1536`,
    ),
    check(
      "memory_embeddings_superseded_check",
      sql`(${table.isCurrent} = true and ${table.supersededAt} is null) or (${table.isCurrent} = false and ${table.supersededAt} is not null)`,
    ),
  ],
);

export const conversationSummaryEmbeddings = pgTable(
  "conversation_summary_embeddings",
  {
    id: uuid("id").primaryKey(),
    conversationSummaryId: uuid("conversation_summary_id")
      .notNull()
      .references(() => conversationSummaries.id, { onDelete: "cascade" }),
    embeddingModel: text("embedding_model").notNull(),
    embeddingDimensions: integer("embedding_dimensions").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("conversation_summary_embeddings_content_unique").on(
      table.conversationSummaryId,
      table.embeddingModel,
      table.contentHash,
    ),
    uniqueIndex("conversation_summary_embeddings_current_unique")
      .on(table.conversationSummaryId)
      .where(sql`${table.isCurrent} = true`),
    check(
      "conversation_summary_embeddings_dimensions_check",
      sql`${table.embeddingDimensions} = 1536`,
    ),
    check(
      "conversation_summary_embeddings_superseded_check",
      sql`(${table.isCurrent} = true and ${table.supersededAt} is null) or (${table.isCurrent} = false and ${table.supersededAt} is not null)`,
    ),
  ],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    originalRequest: text("original_request"),
    timezone: text("timezone").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    recurrenceRule: text("recurrence_rule"),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    status: text("status", { enum: reminderStatuses }).notNull(),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    pendingDeleteConfirmationTurnId: uuid(
      "pending_delete_confirmation_turn_id",
    ).references(() => turns.id, { onDelete: "set null" }),
    creationKey: text("creation_key"),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("reminders_creation_key_unique")
      .on(table.userId, table.creationKey)
      .where(sql`${table.creationKey} is not null`),
    index("reminders_due_idx").on(table.status, table.nextRunAt),
    check(
      "reminders_status_check",
      sql`${table.status} in ('scheduled', 'paused', 'completed', 'cancelled')`,
    ),
    check("reminders_title_not_empty_check", sql`length(btrim(${table.title})) > 0`),
  ],
);

export const reminderDeliveries = pgTable(
  "reminder_deliveries",
  {
    id: uuid("id").primaryKey(),
    reminderId: uuid("reminder_id")
      .notNull()
      .references(() => reminders.id, { onDelete: "cascade" }),
    occurrenceAt: timestamp("occurrence_at", { withTimezone: true }).notNull(),
    status: text("status", { enum: reminderDeliveryStatuses }).notNull(),
    messageId: uuid("message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex("reminder_deliveries_occurrence_unique").on(
      table.reminderId,
      table.occurrenceAt,
    ),
    index("reminder_deliveries_status_idx").on(table.status, table.occurrenceAt),
    check(
      "reminder_deliveries_status_check",
      sql`${table.status} in ('pending', 'processing', 'delivered', 'failed', 'cancelled')`,
    ),
    check(
      "reminder_deliveries_attempt_count_check",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const memoryEvents = pgTable(
  "memory_events",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lineageId: uuid("lineage_id").notNull(),
    memoryId: uuid("memory_id")
      .notNull()
      .references(() => memories.id, { onDelete: "cascade" }),
    relatedMemoryId: uuid("related_memory_id").references(() => memories.id, {
      onDelete: "set null",
    }),
    eventType: text("event_type", { enum: memoryEventTypes }).notNull(),
    actor: text("actor", { enum: memoryEventActors }).notNull(),
    sourceMessageId: uuid("source_message_id").references(() => messages.id, {
      onDelete: "set null",
    }),
    modelRunId: uuid("model_run_id").references(() => modelRuns.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("memory_events_lineage_created_idx").on(
      table.userId,
      table.lineageId,
      table.createdAt,
    ),
    index("memory_events_memory_created_idx").on(
      table.memoryId,
      table.createdAt,
    ),
    check(
      "memory_events_type_check",
      sql`${table.eventType} in ('created', 'reinforced', 'corrected', 'superseded', 'user_edited', 'archived', 'restored', 'expired', 'deleted', 'embedding_failed', 'reembedded')`,
    ),
    check(
      "memory_events_actor_check",
      sql`${table.actor} in ('user', 'memory_policy', 'system')`,
    ),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Turn = typeof turns.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
