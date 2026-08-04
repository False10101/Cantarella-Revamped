import { Router, type Request } from "express";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { HttpError } from "../../http/http-error.js";
import type { AccountService } from "./account.service.js";
import {
  accountSettingsInputSchema,
  onboardingInputSchema,
} from "./account.types.js";

function authenticatedIdentity(request: Request): AuthenticatedIdentity {
  if (!request.identity) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return request.identity;
}

export function createAccountRouter(accountService: AccountService): Router {
  const router = Router();

  router.post("/auth/login", async (request, response) => {
    const result = await accountService.login(authenticatedIdentity(request));

    response.status(200).json({
      data: {
        ...result.account,
        isNewUser: result.isNewUser,
        onboardingRequired: !result.account.onboardingComplete,
      },
    });
  });

  router.get("/me", async (request, response) => {
    const account = await accountService.getCurrent(
      authenticatedIdentity(request),
    );

    response.status(200).json({ data: account });
  });

  router.put("/onboarding", async (request, response) => {
    const input = onboardingInputSchema.safeParse(request.body);

    if (!input.success) {
      throw new HttpError(
        400,
        "INVALID_ONBOARDING",
        "The onboarding information is invalid.",
      );
    }

    const account = await accountService.completeOnboarding(
      authenticatedIdentity(request),
      input.data,
    );

    response.status(200).json({ data: account });
  });

  router.put("/settings", async (request, response) => {
    const input = accountSettingsInputSchema.safeParse(request.body);

    if (!input.success) {
      throw new HttpError(
        400,
        "INVALID_SETTINGS",
        "The account settings are invalid.",
      );
    }

    const account = await accountService.updateSettings(
      authenticatedIdentity(request),
      input.data,
    );

    response.status(200).json({ data: account });
  });

  return router;
}
