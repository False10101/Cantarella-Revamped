import { Router, type Request } from "express";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { httpError, type HttpError } from "../../http/http-error.js";
import type { UsageService } from "./usage.service.js";

function authenticatedIdentity(request: Request): AuthenticatedIdentity {
  if (!request.identity) {
    throw httpError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return request.identity;
}

export function createUsageRouter(usageService: UsageService): Router {
  const router = Router();

  router.get("/usage/costs", async (request, response) => {
    const overview = await usageService.getOverview(
      authenticatedIdentity(request),
    );

    response.status(200).json({ data: overview });
  });

  return router;
}
