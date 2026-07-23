import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify, { type FastifyRequest } from "fastify";
import { reqkeyFastify } from "../src/fastify.js";
import type { VerificationResult } from "../src/index.js";
import { FakeReqKey } from "./helpers.js";

describe("Fastify adapter", () => {
  it("applies to routes declared after plugin registration", async () => {
    const client = new FakeReqKey();
    const app = Fastify();
    await app.register(reqkeyFastify, {
      client,
      apiId: "payments",
      captureResponseBody: true,
    });
    app.get("/payments", async (request) => ({
      ok: true,
      requestId: (request as FastifyRequest & { reqkey?: VerificationResult }).reqkey
        ?.requestId,
    }));

    const response = await app.inject({
      method: "GET",
      url: "/payments",
      headers: { "x-api-key": "prod_consumer" },
    });
    await app.close();

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["x-reqkey-request-id"], "request_123");
    assert.deepEqual(response.json(), { ok: true, requestId: "request_123" });
    assert.equal(client.verifyCalls.length, 1);
    assert.equal(client.ingestCalls.length, 1);
    assert.equal(client.ingestCalls[0]?.responseBody, response.body);
  });

  it("denies a missing key in onRequest", async () => {
    const client = new FakeReqKey();
    const app = Fastify();
    await app.register(reqkeyFastify, { client, apiId: "payments" });
    app.get("/payments", async () => ({ ok: true }));

    const response = await app.inject({ method: "GET", url: "/payments" });
    await app.close();

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "missing_api_key");
    assert.equal(client.verifyCalls.length, 0);
    assert.equal(client.ingestCalls.length, 1);
  });
});
