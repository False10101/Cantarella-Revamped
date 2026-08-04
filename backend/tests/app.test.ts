import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const allowTestRequest = (_request: unknown, _response: unknown, next: () => void) =>
  next();

describe("GET /ping", () => {
  it("returns the public health response", async () => {
    const response = await request(
      createApp({ validateAccessToken: allowTestRequest }),
    ).get("/ping");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ok" } });
  });
});
