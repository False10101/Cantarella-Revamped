import type { RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import type { AccountService } from "../src/api/account/account.service.js";
import type { AccountSnapshot } from "../src/api/account/account.types.js";
import { createApiRouter } from "../src/api/router.js";
import { createApp } from "../src/app.js";

const incompleteAccount: AccountSnapshot = {
  id: "6ae44432-bfbd-42fe-896d-f9277473a347",
  name: null,
  email: null,
  timezone: "UTC",
  conversationId: "9f17b984-8291-49de-8830-36c3094fcb30",
  onboardingComplete: false,
  onboardingCompletedAt: null,
  persona: {
    name: "Cantarella",
    voiceDirection: "default",
    customStyle: "",
    preferredUserName: null,
    endearmentPreference: null,
    boundaries: [],
    version: 1,
  },
};

const injectVerifiedToken: RequestHandler = (request, _response, next) => {
  request.auth = {
    header: { alg: "RS256" },
    payload: {
      iss: "https://cantarella.test.auth0.com/",
      sub: "google-oauth2|user-123",
    },
    token: "test-token",
  };
  next();
};

function createTestService(): AccountService {
  return {
    login: vi.fn().mockResolvedValue({
      account: incompleteAccount,
      isNewUser: true,
    }),
    getCurrent: vi.fn().mockResolvedValue(incompleteAccount),
    completeOnboarding: vi.fn().mockResolvedValue({
      ...incompleteAccount,
      name: "Ian",
      timezone: "Asia/Bangkok",
      onboardingComplete: true,
      onboardingCompletedAt: "2026-08-03T08:00:00.000Z",
    }),
    updateSettings: vi.fn().mockResolvedValue({
      ...incompleteAccount,
      name: "Ian",
      timezone: "Asia/Bangkok",
      persona: {
        ...incompleteAccount.persona,
        voiceDirection: "playful",
        version: 2,
      },
    }),
  };
}

function createTestApp(accountService: AccountService) {
  return createApp({
    validateAccessToken: injectVerifiedToken,
    apiRouter: createApiRouter({ accountService }),
  });
}

describe("account login flow", () => {
  it("bootstraps the verified Auth0 identity", async () => {
    const accountService = createTestService();
    const response = await request(createTestApp(accountService)).post(
      "/api/v1/auth/login",
    );

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: incompleteAccount.id,
      isNewUser: true,
      onboardingRequired: true,
    });
    expect(accountService.login).toHaveBeenCalledWith({
      issuer: "https://cantarella.test.auth0.com/",
      subject: "google-oauth2|user-123",
    });
  });

  it("returns the current local account", async () => {
    const accountService = createTestService();
    const response = await request(createTestApp(accountService)).get(
      "/api/v1/me",
    );

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: incompleteAccount });
  });

  it("rejects invalid onboarding information before the service runs", async () => {
    const accountService = createTestService();
    const response = await request(createTestApp(accountService))
      .put("/api/v1/onboarding")
      .send({
        displayName: "Ian",
        timezone: "Not/A-Timezone",
        persona: { name: "Cantarella", customStyle: "blunt" },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_ONBOARDING");
    expect(accountService.completeOnboarding).not.toHaveBeenCalled();
  });

  it("completes onboarding with normalized optional fields", async () => {
    const accountService = createTestService();
    const response = await request(createTestApp(accountService))
      .put("/api/v1/onboarding")
      .send({
        displayName: "Ian",
        timezone: "Asia/Bangkok",
        persona: {
          name: "Cantarella",
          voiceDirection: "nurturing",
          customStyle: "blunt, teasing, concise",
          preferredUserName: "Ian",
          endearmentPreference: "",
          boundaries: ["never use emojis"],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.onboardingComplete).toBe(true);
    expect(accountService.completeOnboarding).toHaveBeenCalledWith(
      {
        issuer: "https://cantarella.test.auth0.com/",
        subject: "google-oauth2|user-123",
      },
      {
        displayName: "Ian",
        timezone: "Asia/Bangkok",
        persona: {
          name: "Cantarella",
          voiceDirection: "nurturing",
          customStyle: "blunt, teasing, concise",
          preferredUserName: "Ian",
          endearmentPreference: null,
          boundaries: ["never use emojis"],
        },
      },
    );
  });

  it("updates the existing account and persona settings", async () => {
    const accountService = createTestService();
    const response = await request(createTestApp(accountService))
      .put("/api/v1/settings")
      .send({
        displayName: "Ian",
        timezone: "Asia/Bangkok",
        persona: {
          name: "Cantarella",
          voiceDirection: "playful",
          customStyle: "Tease me about procrastinating.",
          preferredUserName: "Ian",
          endearmentPreference: "Use endearments only when they fit.",
          boundaries: ["Never use emojis"],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body.data.persona.version).toBe(2);
    expect(accountService.updateSettings).toHaveBeenCalledWith(
      {
        issuer: "https://cantarella.test.auth0.com/",
        subject: "google-oauth2|user-123",
      },
      {
        displayName: "Ian",
        timezone: "Asia/Bangkok",
        persona: {
          name: "Cantarella",
          voiceDirection: "playful",
          customStyle: "Tease me about procrastinating.",
          preferredUserName: "Ian",
          endearmentPreference: "Use endearments only when they fit.",
          boundaries: ["Never use emojis"],
        },
      },
    );
  });

  it("rejects invalid settings before the service runs", async () => {
    const accountService = createTestService();
    const response = await request(createTestApp(accountService))
      .put("/api/v1/settings")
      .send({
        displayName: "Ian",
        timezone: "Mars/Olympus_Mons",
        persona: { name: "Cantarella" },
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_SETTINGS");
    expect(accountService.updateSettings).not.toHaveBeenCalled();
  });
});
