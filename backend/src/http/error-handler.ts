import { UnauthorizedError } from "express-oauth2-jwt-bearer";
import type { ErrorRequestHandler } from "express";

import { logger } from "../lib/logger.js";
import { HttpError } from "./http-error.js";

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _request,
  response,
  _next,
) => {
  if (error instanceof UnauthorizedError) {
    response.set(error.headers);
    response.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
        retryable: false,
      },
    });
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      },
    });
    return;
  }

  logger.error({ error }, "Unhandled HTTP error");
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      retryable: true,
    },
  });
};
