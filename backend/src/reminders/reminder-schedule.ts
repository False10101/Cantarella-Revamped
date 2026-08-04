import { DateTime } from "luxon";

import type { ReminderRecurrence } from "../api/reminders/reminder.types.js";

export function nextReminderOccurrence(
  occurrence: Date,
  recurrence: ReminderRecurrence,
  timezone: string,
  after: Date,
): Date | null {
  if (!recurrence) return null;

  let local = DateTime.fromJSDate(occurrence, { zone: "utc" }).setZone(timezone);
  const afterMillis = after.getTime();

  for (let skipped = 0; skipped < 10_000; skipped += 1) {
    local =
      recurrence === "daily"
        ? local.plus({ days: 1 })
        : recurrence === "weekly"
          ? local.plus({ weeks: 1 })
          : local.plus({ months: 1 });

    const candidate = local.toUTC().toJSDate();
    if (candidate.getTime() > afterMillis) return candidate;
  }

  throw new Error("Could not calculate the next reminder occurrence.");
}
