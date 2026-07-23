import "reflect-metadata";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import supertest from "supertest";
import type { VerificationResult } from "../src/index.js";
import { ReqKeyDecision, ReqKeyModule } from "../src/nestjs.js";
import { FakeReqKey } from "./helpers.js";

function testModule(client: FakeReqKey) {
  @Controller()
  class PaymentsController {
    @Get()
    root(@ReqKeyDecision() decision: VerificationResult | undefined) {
      return { root: true, requestId: decision?.requestId };
    }

    @Get("payments")
    payments(@ReqKeyDecision() decision: VerificationResult | undefined) {
      return { created: true, requestId: decision?.requestId };
    }
  }

  @Module({
    imports: [
      ReqKeyModule.forRoot({
        client,
        apiId: "payments",
        captureResponseBody: true,
      }),
    ],
    controllers: [PaymentsController],
  })
  class TestModule {}

  return TestModule;
}

describe("NestJS adapter", () => {
  it("protects NestJS with the default Express platform", async () => {
    const client = new FakeReqKey();
    const app = await NestFactory.create(testModule(client), { logger: false });
    await app.init();
    try {
      const response = await supertest(app.getHttpServer())
        .get("/payments")
        .set("X-API-Key", "prod_consumer");
      assert.equal(response.status, 200);
      assert.equal(response.headers["x-reqkey-request-id"], "request_123");
      assert.deepEqual(response.body, { created: true, requestId: "request_123" });
      assert.equal(client.verifyCalls.length, 1);
      assert.equal(client.ingestCalls.length, 1);
      assert.equal(
        client.ingestCalls[0]?.responseBody,
        '{"created":true,"requestId":"request_123"}',
      );
    } finally {
      await app.close();
    }
  });

  it("protects NestJS with its Fastify platform", async () => {
    const client = new FakeReqKey();
    const app = await NestFactory.create<NestFastifyApplication>(
      testModule(client),
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/",
        headers: { "x-api-key": "prod_consumer" },
      });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers["x-reqkey-request-id"], "request_123");
      assert.deepEqual(response.json(), { root: true, requestId: "request_123" });
      assert.equal(client.verifyCalls.length, 1);
      assert.equal(client.ingestCalls.length, 1);
    } finally {
      await app.close();
    }
  });

  it("denies missing keys before the controller", async () => {
    const client = new FakeReqKey();
    const app = await NestFactory.create(testModule(client), { logger: false });
    await app.init();
    try {
      const response = await supertest(app.getHttpServer()).get("/payments");
      assert.equal(response.status, 401);
      assert.equal(response.body.error, "missing_api_key");
      assert.equal(client.verifyCalls.length, 0);
      assert.equal(client.ingestCalls.length, 1);
    } finally {
      await app.close();
    }
  });
});
