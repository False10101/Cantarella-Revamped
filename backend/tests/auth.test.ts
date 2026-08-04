import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import {
  attachAuthenticatedIdentity,
  createAccessTokenValidator,
} from "../src/auth/auth0.js";
import { createApp } from "../src/app.js";
import { errorHandler } from "../src/http/error-handler.js";

describe("Auth0 API boundary", () => {
  it("keeps the health endpoint public", async () => {
    const response = await request(
      createApp({
        validateAccessToken: createAccessTokenValidator({
          audience: "https://api.cantarella.test",
          domain: "cantarella.test.auth0.com",
        }),
      }),
    ).get("/ping");

    expect(response.status).toBe(200);
  });

  it("rejects an API request without a bearer token", async () => {
    const response = await request(
      createApp({
        validateAccessToken: createAccessTokenValidator({
          audience: "https://api.cantarella.test",
          domain: "cantarella.test.auth0.com",
        }),
      }),
    ).get("/api/v1/anything");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Authentication required.",
        retryable: false,
      },
    });
  });
});

describe("attachAuthenticatedIdentity", () => {
  it("copies only verified issuer and subject claims", async () => {
    const injectVerifiedClaims: RequestHandler = (request, _response, next) => {
      request.auth = {
        header: { alg: "RS256" },
        payload: {
          iss: "https://cantarella.test.auth0.com/",
          sub: "auth0|user-123",
        },
        token: "test-token",
      };
      next();
    };

    const app = express();
    app.get(
      "/identity",
      injectVerifiedClaims,
      attachAuthenticatedIdentity,
      (request, response) => {
        response.json({ data: request.identity });
      },
    );
    app.use(errorHandler);

    const response = await request(app).get("/identity");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        issuer: "https://cantarella.test.auth0.com/",
        subject: "auth0|user-123",
      },
    });
  });

  it("rejects a verified token without a subject claim", async () => {
    const injectIncompleteClaims: RequestHandler = (request, _response, next) => {
      request.auth = {
        header: { alg: "RS256" },
        payload: { iss: "https://cantarella.test.auth0.com/" },
        token: "test-token",
      };
      next();
    };

    const app = express();
    app.get(
      "/identity",
      injectIncompleteClaims,
      attachAuthenticatedIdentity,
      (_request, response) => {
        response.status(204).end();
      },
    );
    app.use(errorHandler);

    const response = await request(app).get("/identity");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHORIZED");
  });
});
