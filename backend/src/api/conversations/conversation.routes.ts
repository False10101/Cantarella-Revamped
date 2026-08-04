import { Router, type Request } from "express";

import type { AuthenticatedIdentity } from "../../auth/identity.js";
import { conversationEvents } from "../../events/conversation-events.js";
import { HttpError } from "../../http/http-error.js";
import type { ConversationService } from "./conversation.service.js";
import {
  conversationIdSchema,
  messageHistoryQuerySchema,
  sendMessageInputSchema,
} from "./conversation.types.js";

function authenticatedIdentity(request: Request): AuthenticatedIdentity {
  if (!request.identity) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return request.identity;
}

function parseConversationId(value: string): string {
  const result = conversationIdSchema.safeParse(value);

  if (!result.success) {
    throw new HttpError(
      400,
      "INVALID_CONVERSATION_ID",
      "The conversation ID is invalid.",
    );
  }

  return result.data;
}

export function createConversationRouter(
  conversationService: ConversationService,
): Router {
  const router = Router();

  router.get("/conversations/primary", async (request, response) => {
    const conversation = await conversationService.getPrimary(
      authenticatedIdentity(request),
    );

    response.status(200).json({ data: conversation });
  });

  router.get(
    "/conversations/:conversationId/messages",
    async (request, response) => {
      const conversationId = parseConversationId(
        request.params.conversationId,
      );
      const query = messageHistoryQuerySchema.safeParse(request.query);

      if (!query.success) {
        throw new HttpError(
          400,
          "INVALID_MESSAGE_HISTORY_QUERY",
          "The message history query is invalid.",
        );
      }

      const page = await conversationService.getMessages(
        authenticatedIdentity(request),
        conversationId,
        { before: query.data.before, limit: query.data.limit },
      );

      response.status(200).json({ data: page });
    },
  );

  router.get(
    "/conversations/:conversationId/events",
    async (request, response) => {
      const conversationId = parseConversationId(
        request.params.conversationId,
      );

      await conversationService.assertOwnership(
        authenticatedIdentity(request),
        conversationId,
      );

      response.status(200);
      response.set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      response.flushHeaders();
      response.write(`event: connected\ndata: ${JSON.stringify({ conversationId })}\n\n`);

      const unsubscribe = conversationEvents.subscribe(
        conversationId,
        (event) => {
          response.write(
            `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
          );
        },
      );
      const heartbeat = setInterval(() => {
        response.write(": heartbeat\n\n");
      }, 15_000);

      request.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        response.end();
      });
    },
  );

  router.post(
    "/conversations/:conversationId/messages",
    async (request, response) => {
      const conversationId = parseConversationId(
        request.params.conversationId,
      );
      const input = sendMessageInputSchema.safeParse(request.body);

      if (!input.success) {
        throw new HttpError(
          400,
          "INVALID_MESSAGE",
          "The message is invalid.",
        );
      }

      const result = await conversationService.saveUserMessage(
        authenticatedIdentity(request),
        conversationId,
        input.data,
      );

      response.status(202).json({ data: result });
    },
  );

  return router;
}
