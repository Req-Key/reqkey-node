import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Koa from "koa";
import supertest from "supertest";
import { reqkeyKoa } from "../src/koa.js";
import { FakeReqKey } from "./helpers.js";

describe("Koa adapter", () => {
  it("protects and records a Koa response", async () => {
    const client = new FakeReqKey();
    const app = new Koa();
    app.use(
      reqkeyKoa({
        client,
        apiId: "payments",
        captureResponseBody: true,
      }),
    );
    app.use((context) => {
      context.status = 201;
      context.body = {
        created: true,
        requestId: context.state.reqkey.requestId as string,
      };
    });

    const response = await supertest(app.callback())
      .get("/payments")
      .set("X-API-Key", "prod_consumer");

    assert.equal(response.status, 201);
    assert.equal(response.headers["x-reqkey-request-id"], "request_123");
    assert.deepEqual(response.body, { created: true, requestId: "request_123" });
    assert.equal(client.ingestCalls.length, 1);
    assert.equal(
      client.ingestCalls[0]?.responseBody,
      '{"created":true,"requestId":"request_123"}',
    );
  });

  it("does not call downstream middleware for a missing key", async () => {
    const client = new FakeReqKey();
    const app = new Koa();
    let called = false;
    app.use(reqkeyKoa({ client, apiId: "payments" }));
    app.use((context) => {
      called = true;
      context.body = { ok: true };
    });
    const response = await supertest(app.callback()).get("/payments");
    assert.equal(response.status, 401);
    assert.equal(called, false);
  });
});
