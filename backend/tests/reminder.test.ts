import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import { nextReminderOccurrence } from "../src/reminders/reminder-schedule.js";
import { resolveReminderActionTime } from "../src/reminders/reminder-action.js";

describe("reminder recurrence", () => {
  it("keeps the same Bangkok wall-clock time each day", () => {
    const occurrence = DateTime.fromISO("2026-08-04T10:00:00", {
      zone: "Asia/Bangkok",
    })
      .toUTC()
      .toJSDate();
    const next = nextReminderOccurrence(
      occurrence,
      "daily",
      "Asia/Bangkok",
      occurrence,
    );

    expect(
      DateTime.fromJSDate(next!, { zone: "utc" })
        .setZone("Asia/Bangkok")
        .toFormat("yyyy-MM-dd HH:mm"),
    ).toBe("2026-08-05 10:00");
  });

  it("preserves local time across a daylight-saving transition", () => {
    const occurrence = DateTime.fromISO("2026-10-31T09:00:00", {
      zone: "America/New_York",
    })
      .toUTC()
      .toJSDate();
    const next = nextReminderOccurrence(
      occurrence,
      "daily",
      "America/New_York",
      occurrence,
    );

    expect(
      DateTime.fromJSDate(next!, { zone: "utc" })
        .setZone("America/New_York")
        .toFormat("yyyy-MM-dd HH:mm ZZZ"),
    ).toBe("2026-11-01 09:00 -0500");
  });

  it("skips missed recurring occurrences after downtime", () => {
    const occurrence = new Date("2026-08-01T03:00:00.000Z");
    const after = new Date("2026-08-04T04:00:00.000Z");
    const next = nextReminderOccurrence(
      occurrence,
      "daily",
      "Asia/Bangkok",
      after,
    );

    expect(next?.toISOString()).toBe("2026-08-05T03:00:00.000Z");
  });

  it("finishes a one-time reminder", () => {
    expect(
      nextReminderOccurrence(
        new Date("2026-08-04T03:00:00.000Z"),
        null,
        "Asia/Bangkok",
        new Date("2026-08-04T03:00:01.000Z"),
      ),
    ).toBeNull();
  });

  it("calculates relative chat timers from the source message time", () => {
    const reference = new Date("2026-08-04T03:18:51.000Z");
    const scheduled = resolveReminderActionTime(
      {
        title: "Look at the banking app",
        scheduleKind: "after",
        localDateTime: null,
        delayAmount: 5,
        delayUnit: "minutes",
        recurrence: null,
      },
      "Asia/Bangkok",
      reference,
    );

    expect(scheduled.toISOString()).toBe("2026-08-04T03:23:51.000Z");
  });

  it("resolves exact chat reminders in the account timezone", () => {
    const scheduled = resolveReminderActionTime(
      {
        title: "Join class",
        scheduleKind: "at",
        localDateTime: "2026-08-05T09:00",
        delayAmount: null,
        delayUnit: null,
        recurrence: null,
      },
      "Asia/Bangkok",
      new Date("2026-08-04T03:00:00.000Z"),
    );

    expect(scheduled.toISOString()).toBe("2026-08-05T02:00:00.000Z");
  });
});
