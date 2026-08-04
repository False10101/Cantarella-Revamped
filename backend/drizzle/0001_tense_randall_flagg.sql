ALTER TABLE "personas" ADD COLUMN IF NOT EXISTS "voice_direction" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'personas_voice_direction_check'
			AND conrelid = 'public.personas'::regclass
	) THEN
		ALTER TABLE "personas"
			ADD CONSTRAINT "personas_voice_direction_check"
			CHECK ("personas"."voice_direction" in ('default', 'softer', 'firmer', 'playful', 'nurturing', 'intimate'));
	END IF;
END
$$;
