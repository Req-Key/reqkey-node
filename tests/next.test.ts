import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getReqKey, withReqKey } from "../src/next.js";
import { FakeReqKey } from "./helpers.js";

describe("Next.js adapter", () => {
  it("wraps an App Router handler and exposes the decision", async () => {
    const client = new FakeReqKey();
    const handler = withReqKey(
      (request: Request) => {
        const result = getReqKey(request);
        const body = JSON.stringify({ ok: true, requestId: result?.requestId });
        return new Response(body, {
          status: 201,
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(body)),
          },
        });
      },
      { client, apiId: "payments", captureResponseBody: true },
    );

    const response = await handler(
      new Request("https://service.test/payments", {
        headers: { "X-API-Key": "prod_consumer" },
      }),
      undefined,
    );

    assert.equal(response.status, 201);
    assert.equal(response.headers.get("x-reqkey-request-id"), "request_123");
    assert.deepEqual(await response.json(), { ok: true, requestId: "request_123" });
    assert.equal(client.ingestCalls[0]?.responseBody, '{"ok":true,"requestId":"request_123"}');
  });

  it("returns a Web Response denial for missing keys", async () => {
    const client = new FakeReqKey();
    const handler = withReqKey(
      () => Response.json({ shouldNotRun: true }),
      { client, apiId: "payments" },
    );
    const response = await handler(
      new Request("https://service.test/payments"),
      undefined,
    );
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "missing_api_key",
      message: "An API key is required.",
    });
    assert.equal(client.ingestCalls.length, 1);
  });
});
