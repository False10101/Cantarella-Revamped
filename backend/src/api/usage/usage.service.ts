import { and, eq, gte, sql } from "drizzle-orm";
import { DateTime } from "luxon";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { database } from "../../db/client.js";
import {
  conversations,
  modelRuns,
  reminders,
  turns,
  userSettings,
  users,
} from "../../db/schema.js";
import { httpError, type HttpError } from "../../http/http-error.js";

const usagePhases = [
  "thought",
  "voice",
  "memory",
  "summary",
  "reminder_voice",
] as const;

type UsagePhase = (typeof usagePhases)[number];

export interface UsagePeriod {
  totalUsd: number;
  byPhase: Record<UsagePhase, number>;
}

export interface UsageOverview {
  today: UsagePeriod;
  thisMonth: UsagePeriod;
  allTime: UsagePeriod;
}

export interface UsageService {
  getOverview(identity: AuthenticatedIdentity): Promise<UsageOverview>;
}

function emptyPeriod(): UsagePeriod {
  return {
    totalUsd: 0,
    byPhase: {
      thought: 0,
      voice: 0,
      memory: 0,
      summary: 0,
      reminder_voice: 0,
    },
  };
}

async function loadOwner(identity: AuthenticatedIdentity): Promise<{
  userId: string;
  timezone: string;
}> {
  const [owner] = await database
    .select({ userId: users.id, timezone: userSettings.timezone })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .where(
      and(
        eq(users.authIssuer, identity.issuer),
        eq(users.authSubject, identity.subject),
      ),
    )
    .limit(1);

  if (!owner) {
    throw httpError(
      404,
      "ACCOUNT_NOT_INITIALIZED",
      "Complete the login bootstrap before viewing usage.",
    );
  }

  return owner;
}

async function loadPeriod(userId: string, from?: Date): Promise<UsagePeriod> {
  const period = emptyPeriod();
  const ownerCondition = sql`coalesce(${conversations.ownerUserId}, ${reminders.userId}, (${modelRuns.inputJson}->>'userId')::uuid) = ${userId}::uuid`;
  const conditions = [
    eq(modelRuns.status, "completed"),
    ownerCondition,
  ];

  if (from) conditions.push(gte(modelRuns.completedAt, from));

  const rows = await database
    .select({
      phase: modelRuns.phase,
      totalUsd: sql<string>`coalesce(sum(${modelRuns.estimatedCostUsd}), 0)`,
    })
    .from(modelRuns)
    .leftJoin(turns, eq(turns.id, modelRuns.turnId))
    .leftJoin(conversations, eq(conversations.id, turns.conversationId))
    .leftJoin(
      reminders,
      sql`${reminders.id} = (${modelRuns.inputJson}->>'reminderId')::uuid`,
    )
    .where(and(...conditions))
    .groupBy(modelRuns.phase);

  for (const row of rows) {
    if (!usagePhases.includes(row.phase as UsagePhase)) continue;
    const phase = row.phase as UsagePhase;
    const cost = Number(row.totalUsd) || 0;
    period.byPhase[phase] = cost;
    period.totalUsd += cost;
  }

  return period;
}

export function createUsageService(): UsageService {
  return {
    async getOverview(identity) {
      const owner = await loadOwner(identity);
      const now = DateTime.now().setZone(owner.timezone);
      const startOfToday = now.startOf("day").toUTC().toJSDate();
      const startOfMonth = now.startOf("month").toUTC().toJSDate();

      const [today, thisMonth, allTime] = await Promise.all([
        loadPeriod(owner.userId, startOfToday),
        loadPeriod(owner.userId, startOfMonth),
        loadPeriod(owner.userId),
      ]);

      return { today, thisMonth, allTime };
    },
  };
}
