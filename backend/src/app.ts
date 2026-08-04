import cors from "cors";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { RequestHandler } from "express";

import { createApiRouter } from "./api/router.js";
import {
  attachAuthenticatedIdentity,
  createAccessTokenValidator,
} from "./auth/auth0.js";
import { errorHandler } from "./http/error-handler.js";
import { logger } from "./lib/logger.js";

export interface CreateAppOptions {
  validateAccessToken?: RequestHandler;
  apiRouter?: RequestHandler;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger,
      quietReqLogger: true,
      autoLogging: {
        ignore: (request) => request.url === "/ping",
      },
      serializers: {
        request: (request) => ({
          method: request.method,
          url: request.url,
        }),
        response: (response) => ({
          statusCode: response.statusCode,
        }),
      },
      customSuccessMessage: (request, response, responseTime) =>
        `${request.method} ${request.url} ${response.statusCode} ${responseTime}ms`,
      customErrorMessage: (request, response, error) =>
        `${request.method} ${request.url} ${response.statusCode} ${error.message}`,
    }),
  );
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "64kb" }));

  app.get("/ping", (_request, response) => {
    response.status(200).json({ data: { status: "ok" } });
  });

  const validateAccessToken =
    options.validateAccessToken ?? createAccessTokenValidator();
  const apiRouter = options.apiRouter ?? createApiRouter();
  app.use(
    "/api/v1",
    validateAccessToken,
    attachAuthenticatedIdentity,
    apiRouter,
  );

  app.use(errorHandler);

  return app;
}
