import assert from "node:assert/strict";
import { describe, it } from "node:test";
import express, { type Request } from "express";
import supertest from "supertest";
import { reqkey } from "../src/express.js";
import type { ReqKeyNodeRequest } from "../src/node.js";
import { FakeReqKey } from "./helpers.js";

describe("Express adapter", () => {
  it("protects a route, exposes the decision, and ingests before release", async () => {
    const client = new FakeReqKey();
    client.ingestDelayMs = 10;
    const app = express();
    app.use(
      reqkey({
        client,
        apiId: "payments",
        captureResponseBody: true,
        captureResponseHeaders: true,
      }),
    );
    app.get("/payments", (request, response) => {
      const decision = (request as Request & ReqKeyNodeRequest).reqkey;
      response.status(201).json({ created: true, requestId: decision?.requestId });
    });

    const response = await supertest(app)
      .get("/payments")
      .set("X-API-Key", "prod_consumer");

    assert.equal(response.status, 201);
    assert.equal(response.headers["x-reqkey-request-id"], "request_123");
    assert.deepEqual(response.body, { created: true, requestId: "request_123" });
    assert.equal(client.ingestCalls.length, 1);
    assert.equal(client.ingestCalls[0]?.statusCode, 201);
    assert.equal(
      client.ingestCalls[0]?.responseBody,
      '{"created":true,"requestId":"request_123"}',
    );
  });

  it("returns the configured JSON denial without running the route", async () => {
    const client = new FakeReqKey();
    const app = express();
    let called = false;
    app.use(
      reqkey({
        client,
        apiId: "payments",
        errorMessages: { missing_api_key: "Send X-Startup-Key." },
      }),
    );
    app.get("/payments", (_request, response) => {
      called = true;
      response.json({ ok: true });
    });

    const response = await supertest(app).get("/payments");
    assert.equal(response.status, 401);
    assert.deepEqual(response.body, {
      error: "missing_api_key",
      message: "Send X-Startup-Key.",
    });
    assert.equal(called, false);
    assert.equal(client.ingestCalls[0]?.statusCode, 401);
  });

  it("supports dynamic credits and Bearer authentication", async () => {
    const client = new FakeReqKey();
    const app = express();
    app.use(
      reqkey({
        client,
        apiId: "payments",
        mode: "validate",
        keyName: "Authorization",
        keyScheme: "bearer",
        credits: (request) => (request.path === "/reports" ? 5 : 1),
      }),
    );
    app.get("/reports", (_request, response) => response.json({ ok: true }));

    const response = await supertest(app)
      .get("/reports")
      .set("Authorization", "Bearer prod_consumer");
    assert.equal(response.status, 200);
    assert.deepEqual(client.verifyCalls[0], {
      key: "prod_consumer",
      options: { apiId: "payments", credits: 5, resource: "/reports" },
    });
    assert.equal(client.ingestCalls.length, 0);
  });
});
