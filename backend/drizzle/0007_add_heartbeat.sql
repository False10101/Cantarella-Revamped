CREATE TABLE "heartbeat" (
  "conversation_id" uuid PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL,
  "last_user_message_at" timestamp with time zone NOT NULL,
  "last_proactive_at" timestamp with time zone,
  "next_check_at" timestamp with time zone NOT NULL,
  "paused_until" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "heartbeat"
  ADD CONSTRAINT "heartbeat_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "heartbeat"
  ADD CONSTRAINT "heartbeat_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "heartbeat_due_idx" ON "heartbeat" USING btree ("next_check_at");
