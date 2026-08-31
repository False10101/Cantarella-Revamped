ALTER TABLE "heartbeat" ADD COLUMN "schedule_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat" ADD COLUMN "last_proactive_message_id" uuid;--> statement-breakpoint
ALTER TABLE "heartbeat" ADD COLUMN "awaiting_reply" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat" ALTER COLUMN "next_check_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "heartbeat" ADD CONSTRAINT "heartbeat_last_proactive_message_id_messages_id_fk" FOREIGN KEY ("last_proactive_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "heartbeat" ADD CONSTRAINT "heartbeat_schedule_version_positive_check" CHECK ("heartbeat"."schedule_version" > 0);--> statement-breakpoint
ALTER TABLE "messages" DROP CONSTRAINT "messages_kind_check";--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_kind_check" CHECK ("messages"."kind" in ('chat', 'reminder', 'proactive'));
