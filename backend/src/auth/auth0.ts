import {
  auth,
  InvalidTokenError,
  type AuthOptions,
} from "express-oauth2-jwt-bearer";
import type { RequestHandler } from "express";

import { getEnvironment } from "../config/env.js";

export interface Auth0Configuration {
  audience: string;
  domain: string;
}

function issuerBaseUrlFromDomain(domain: string): string {
  const domainWithoutProtocol = domain
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");

  return `https://${domainWithoutProtocol}/`;
}

export function createAccessTokenValidator(
  configuration?: Auth0Configuration,
): RequestHandler {
  const environment = configuration ? undefined : getEnvironment();
  const issuerBaseUrl = issuerBaseUrlFromDomain(
    configuration?.domain ?? environment!.AUTH0_DOMAIN,
  );
  const audience = configuration?.audience ?? environment!.AUTH0_AUDIENCE;

  const options: AuthOptions = {
    authRequired: true,
    audience,
    issuerBaseURL: issuerBaseUrl,
    tokenSigningAlg: "RS256",
    clockTolerance: 5,
  };

  return auth(options);
}

export const attachAuthenticatedIdentity: RequestHandler = (
  request,
  _response,
  next,
) => {
  const issuer = request.auth?.payload.iss;
  const subject = request.auth?.payload.sub;

  if (typeof issuer !== "string" || typeof subject !== "string") {
    next(new InvalidTokenError("The access token is missing required identity claims"));
    return;
  }

  request.identity = { issuer, subject };
  next();
};
