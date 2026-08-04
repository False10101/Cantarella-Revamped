import { Router, type Request } from "express";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { HttpError } from "../../http/http-error.js";
import type { MemoryService } from "./memory.service.js";
import {
  createMemoryInputSchema,
  listMemoriesQuerySchema,
  memoryIdSchema,
  updateMemoryInputSchema,
} from "./memory.types.js";

function authenticatedIdentity(request: Request): AuthenticatedIdentity {
  if (!request.identity) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return request.identity;
}

function memoryId(value: string): string {
  const result = memoryIdSchema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, "INVALID_MEMORY_ID", "The memory ID is invalid.");
  }
  return result.data;
}

export function createMemoryRouter(memoryService: MemoryService): Router {
  const router = Router();

  router.get("/memories", async (request, response) => {
    const query = listMemoriesQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new HttpError(
        400,
        "INVALID_MEMORY_QUERY",
        "The memory query is invalid.",
      );
    }

    const records = await memoryService.list(
      authenticatedIdentity(request),
      query.data,
    );
    response.status(200).json({ data: { memories: records } });
  });

  router.post("/memories", async (request, response) => {
    const input = createMemoryInputSchema.safeParse(request.body);
    if (!input.success) {
      throw new HttpError(400, "INVALID_MEMORY", "The memory is invalid.");
    }

    const memory = await memoryService.create(
      authenticatedIdentity(request),
      input.data,
    );
    response.status(201).json({ data: { memory } });
  });

  router.patch("/memories/:memoryId", async (request, response) => {
    const input = updateMemoryInputSchema.safeParse(request.body);
    if (!input.success) {
      throw new HttpError(400, "INVALID_MEMORY", "The memory is invalid.");
    }

    const memory = await memoryService.update(
      authenticatedIdentity(request),
      memoryId(request.params.memoryId),
      input.data,
    );
    response.status(200).json({ data: { memory } });
  });

  router.delete("/memories/:memoryId", async (request, response) => {
    const memory = await memoryService.remove(
      authenticatedIdentity(request),
      memoryId(request.params.memoryId),
    );
    response.status(200).json({ data: { memory } });
  });

  return router;
}
