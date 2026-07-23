import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ReqKeyMiddlewareRuntime,
  ReqKeyTransportError,
  VerificationReason,
} from "../src/index.js";
import { createMiddlewareRequest } from "../src/middleware.js";
import { FakeReqKey, allowedResult, deniedResult } from "./helpers.js";

function request(url = "https://service.test/protected", headers: HeadersInit = {}) {
  return createMiddlewareRequest({
    raw: { framework: "test" },
    method: "GET",
    url: new URL(url),
    headers: new Headers(headers),
    clientIp: "127.0.0.1",
  });
}

describe("middleware runtime", () => {
  it("validates, exposes decision headers, and records correlated metadata", async () => {
    const client = new FakeReqKey();
    const runtime = new ReqKeyMiddlewareRuntime({
      client,
      apiId: "payments",
      captureQueryParams: true,
      captureRequestHeaders: true,
      captureResponseHeaders: true,
      captureResponseBody: true,
    });
    const outcome = await runtime.authorize(
      request("https://service.test/protected?page=2", {
        "X-API-Key": "prod_consumer",
        "X-Safe": "visible",
        "User-Agent": "test-agent",
      }),
    );
    assert.equal(outcome.kind, "allow");
    if (outcome.kind !== "allow") return;
    assert.equal(outcome.responseHeaders["X-ReqKey-Request-ID"], "request_123");
    assert.deepEqual(client.verifyCalls[0], {
      key: "prod_consumer",
      options: { apiId: "payments", credits: 1, resource: "/protected" },
    });

    await runtime.record(outcome.state, {
      statusCode: 201,
      headers: new Headers({ "content-type": "application/json", "x-safe": "yes" }),
      body: '{"ok":true}',
    });
    const event = client.ingestCalls[0];
    assert.equal(event?.requestId, "request_123");
    assert.equal(event?.apiKey, "prod_consumer");
    assert.equal(event?.path, "/protected?page=2");
    assert.deepEqual(event?.queryParams, { page: "2" });
    assert.equal(event?.requestHeaders?.["x-safe"], "visible");
    assert.equal(event?.requestHeaders?.["x-api-key"], undefined);
    assert.equal(event?.responseBody, '{"ok":true}');
  });

  it("redacts a query-string consumer key from captured analytics", async () => {
    const client = new FakeReqKey();
    const runtime = new ReqKeyMiddlewareRuntime({
      client,
      apiId: "payments",
      keyLocation: "query",
      keyName: "startup_key",
      captureQueryParams: true,
    });
    const outcome = await runtime.authorize(
      request("https://service.test/protected?startup_key=secret&page=2"),
    );
    assert.equal(outcome.kind, "allow");
    if (outcome.kind !== "allow") return;
    await runtime.record(outcome.state, { statusCode: 200 });
    assert.equal(client.verifyCalls[0]?.key, "secret");
    assert.equal(client.ingestCalls[0]?.path, "/protected?page=2");
    assert.deepEqual(client.ingestCalls[0]?.queryParams, { page: "2" });
  });

  it("records missing and denied keys before returning a denial", async () => {
    const missingClient = new FakeReqKey();
    const missingRuntime = new ReqKeyMiddlewareRuntime({
      client: missingClient,
      apiId: "payments",
    });
    const missing = await missingRuntime.authorize(request());
    assert.equal(missing.kind, "deny");
    assert.equal(missingClient.ingestCalls[0]?.statusCode, 401);

    const limitedClient = new FakeReqKey(
      deniedResult(VerificationReason.RATE_LIMITED, 429, 4),
    );
    const limitedRuntime = new ReqKeyMiddlewareRuntime({
      client: limitedClient,
      apiId: "payments",
    });
    const limited = await limitedRuntime.authorize(
      request("https://service.test/protected", { "X-API-Key": "consumer" }),
    );
    assert.equal(limited.kind, "deny");
    if (limited.kind === "deny") {
      assert.equal(limited.denial.statusCode, 429);
      assert.equal(limited.denial.headers["Retry-After"], "4");
    }
    assert.equal(limitedClient.ingestCalls[0]?.apiKey, "consumer");
  });

  it("supports fail-open and reports a privacy-safe error event", async () => {
    const client = new FakeReqKey(new ReqKeyTransportError("offline"));
    const events: string[] = [];
    const runtime = new ReqKeyMiddlewareRuntime({
      client,
      apiId: "payments",
      failureMode: "open",
      onError: (event) => {
        assert.equal("request" in event, false);
        events.push(`${event.operation}:${event.path}:${event.message}`);
      },
    });
    const outcome = await runtime.authorize(
      request("https://service.test/protected", { "X-API-Key": "secret" }),
    );
    assert.equal(outcome.kind, "allow");
    if (outcome.kind !== "allow") return;
    assert.ok(outcome.error instanceof ReqKeyTransportError);
    assert.deepEqual(events, ["validate:/protected:offline"]);
    await runtime.record(outcome.state, { statusCode: 200 });
    assert.equal(client.ingestCalls[0]?.requestId, undefined);
    assert.equal(client.ingestCalls[0]?.apiId, "payments");
  });

  it("skips configured paths and methods", async () => {
    const client = new FakeReqKey(allowedResult());
    const runtime = new ReqKeyMiddlewareRuntime({
      client,
      apiId: "payments",
      excludePaths: ["/health", "/public/*"],
    });
    assert.equal((await runtime.authorize(request("https://service.test/health"))).kind, "skip");
    assert.equal(
      (await runtime.authorize(request("https://service.test/public/docs"))).kind,
      "skip",
    );
    assert.equal(client.verifyCalls.length, 0);
  });
});
