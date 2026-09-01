import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { database } from "../../db/client.js";
import {
  conversations,
  personas,
  users,
  userSettings,
} from "../../db/schema.js";
import { httpError, type HttpError } from "../../http/http-error.js";
import type {
  AccountSettingsInput,
  AccountSnapshot,
  OnboardingInput,
} from "./account.types.js";

export interface LoginResult {
  account: AccountSnapshot;
  isNewUser: boolean;
}

export interface AccountService {
  login(identity: AuthenticatedIdentity): Promise<LoginResult>;
  getCurrent(identity: AuthenticatedIdentity): Promise<AccountSnapshot>;
  completeOnboarding(
    identity: AuthenticatedIdentity,
    input: OnboardingInput,
  ): Promise<AccountSnapshot>;
  updateSettings(
    identity: AuthenticatedIdentity,
    input: AccountSettingsInput,
  ): Promise<AccountSnapshot>;
}

async function loadAccount(
  identity: AuthenticatedIdentity,
): Promise<AccountSnapshot | null> {
  const [record] = await database
    .select({
      id: users.id,
      name: users.displayName,
      email: users.email,
      onboardingCompletedAt: users.onboardingCompletedAt,
      timezone: userSettings.timezone,
      conversationId: conversations.id,
      personaName: personas.name,
      voiceDirection: personas.voiceDirection,
      customStyle: personas.customStyle,
      preferredUserName: personas.preferredUserName,
      endearmentPreference: personas.endearmentPreference,
      boundaries: personas.boundaries,
      personaVersion: personas.version,
    })
    .from(users)
    .innerJoin(userSettings, eq(userSettings.userId, users.id))
    .innerJoin(conversations, eq(conversations.ownerUserId, users.id))
    .innerJoin(personas, eq(personas.userId, users.id))
    .where(
      and(
        eq(users.authIssuer, identity.issuer),
        eq(users.authSubject, identity.subject),
      ),
    )
    .limit(1);

  if (!record) {
    return null;
  }

  return {
    id: record.id,
    name: record.name,
    email: record.email,
    timezone: record.timezone,
    conversationId: record.conversationId,
    onboardingComplete: record.onboardingCompletedAt !== null,
    onboardingCompletedAt:
      record.onboardingCompletedAt?.toISOString() ?? null,
    persona: {
      name: record.personaName,
      voiceDirection: record.voiceDirection,
      customStyle: record.customStyle,
      preferredUserName: record.preferredUserName,
      endearmentPreference: record.endearmentPreference,
      boundaries: record.boundaries,
      version: record.personaVersion,
    },
  };
}

function accountNotInitialized(): HttpError {
  return httpError(
    404,
    "ACCOUNT_NOT_INITIALIZED",
    "Complete the login bootstrap before accessing this account.",
  );
}

export function createAccountService(): AccountService {
  return {
    async login(identity) {
      const result = await database.transaction(async (transaction) => {
        const [createdUser] = await transaction
          .insert(users)
          .values({
            id: randomUUID(),
            authIssuer: identity.issuer,
            authSubject: identity.subject,
          })
          .onConflictDoNothing({
            target: [users.authIssuer, users.authSubject],
          })
          .returning({ id: users.id });

        let userId = createdUser?.id;

        if (!userId) {
          const [existingUser] = await transaction
            .select({ id: users.id })
            .from(users)
            .where(
              and(
                eq(users.authIssuer, identity.issuer),
                eq(users.authSubject, identity.subject),
              ),
            )
            .limit(1);

          if (!existingUser) {
            throw httpError(
              500,
              "ACCOUNT_BOOTSTRAP_FAILED",
              "The local account could not be initialized.",
              true,
            );
          }

          userId = existingUser.id;
        }

        await transaction
          .insert(userSettings)
          .values({ userId, timezone: "UTC" })
          .onConflictDoNothing({ target: userSettings.userId });

        await transaction
          .insert(personas)
          .values({
            id: randomUUID(),
            userId,
            name: "Cantarella",
            voiceDirection: "default",
            customStyle: "",
          })
          .onConflictDoNothing({ target: personas.userId });

        await transaction
          .insert(conversations)
          .values({ id: randomUUID(), ownerUserId: userId })
          .onConflictDoNothing({ target: conversations.ownerUserId });

        return { isNewUser: createdUser !== undefined };
      });

      const account = await loadAccount(identity);

      if (!account) {
        throw accountNotInitialized();
      }

      return { account, isNewUser: result.isNewUser };
    },

    async getCurrent(identity) {
      const account = await loadAccount(identity);

      if (!account) {
        throw accountNotInitialized();
      }

      return account;
    },

    async completeOnboarding(identity, input) {
      await database.transaction(async (transaction) => {
        const [user] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.authIssuer, identity.issuer),
              eq(users.authSubject, identity.subject),
            ),
          )
          .limit(1);

        if (!user) {
          throw accountNotInitialized();
        }

        const now = new Date();

        await transaction
          .insert(userSettings)
          .values({ userId: user.id, timezone: input.timezone })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: { timezone: input.timezone, updatedAt: now },
          });

        await transaction
          .insert(personas)
          .values({
            id: randomUUID(),
            userId: user.id,
            name: input.persona.name,
            voiceDirection: input.persona.voiceDirection,
            customStyle: input.persona.customStyle,
            preferredUserName: input.persona.preferredUserName,
            endearmentPreference: input.persona.endearmentPreference,
            boundaries: input.persona.boundaries,
          })
          .onConflictDoUpdate({
            target: personas.userId,
            set: {
              name: input.persona.name,
              voiceDirection: input.persona.voiceDirection,
              customStyle: input.persona.customStyle,
              preferredUserName: input.persona.preferredUserName,
              endearmentPreference: input.persona.endearmentPreference,
              boundaries: input.persona.boundaries,
              version: sql`${personas.version} + 1`,
              updatedAt: now,
            },
          });

        await transaction
          .insert(conversations)
          .values({ id: randomUUID(), ownerUserId: user.id })
          .onConflictDoNothing({ target: conversations.ownerUserId });

        await transaction
          .update(users)
          .set({
            displayName: input.displayName,
            onboardingCompletedAt: now,
            updatedAt: now,
          })
          .where(eq(users.id, user.id));
      });

      const account = await loadAccount(identity);

      if (!account) {
        throw accountNotInitialized();
      }

      return account;
    },

    async updateSettings(identity, input) {
      await database.transaction(async (transaction) => {
        const [user] = await transaction
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.authIssuer, identity.issuer),
              eq(users.authSubject, identity.subject),
            ),
          )
          .limit(1)
          .for("update");

        if (!user) {
          throw accountNotInitialized();
        }

        const now = new Date();

        await transaction
          .update(users)
          .set({ displayName: input.displayName, updatedAt: now })
          .where(eq(users.id, user.id));

        await transaction
          .insert(userSettings)
          .values({ userId: user.id, timezone: input.timezone })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: { timezone: input.timezone, updatedAt: now },
          });

        await transaction
          .insert(personas)
          .values({
            id: randomUUID(),
            userId: user.id,
            name: input.persona.name,
            voiceDirection: input.persona.voiceDirection,
            customStyle: input.persona.customStyle,
            preferredUserName: input.persona.preferredUserName,
            endearmentPreference: input.persona.endearmentPreference,
            boundaries: input.persona.boundaries,
          })
          .onConflictDoUpdate({
            target: personas.userId,
            set: {
              name: input.persona.name,
              voiceDirection: input.persona.voiceDirection,
              customStyle: input.persona.customStyle,
              preferredUserName: input.persona.preferredUserName,
              endearmentPreference: input.persona.endearmentPreference,
              boundaries: input.persona.boundaries,
              version: sql`${personas.version} + 1`,
              updatedAt: now,
            },
          });
      });

      const account = await loadAccount(identity);

      if (!account) {
        throw accountNotInitialized();
      }

      return account;
    },
  };
}
