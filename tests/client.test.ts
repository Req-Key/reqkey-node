import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ReqKey,
  ReqKeyAuthenticationError,
  ReqKeyConfigurationError,
  ReqKeyTimeoutError,
  VerificationReason,
  type ReqKeyFetch,
} from "../src/index.js";

describe("ReqKey client", () => {
  it("uses the current validation API contract", async () => {
    const client = new ReqKey({
      projectKey: "reqkey_test",
      baseUrl: "https://api.reqkey.test/",
      fetch: async (input, init) => {
        assert.equal(String(input), "https://api.reqkey.test/key/validate");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer reqkey_test");
        assert.deepEqual(JSON.parse(String(init?.body)), {
          key: "prod_consumer",
          credits: 2,
          apiId: "payments",
          resource: "/payments",
        });
        return Response.json({
          valid: true,
          requestId: "request_123",
          creditsRemaining: 98,
          creditsLimit: 100,
          allowedApis: ["payments"],
        });
      },
    });

    const result = await client.verify("prod_consumer", {
      apiId: "payments",
      credits: 2,
      resource: "/payments",
    });

    assert.equal(result.allowed, true);
    assert.equal(result.reason, VerificationReason.VALID);
    assert.equal(result.requestId, "request_123");
    assert.equal(result.creditsRemaining, 98);
    assert.deepEqual(result.allowedApis, ["payments"]);
  });

  it("returns stable denial reasons", async () => {
    const cases = [
      [200, { valid: false }, VerificationReason.INVALID_KEY],
      [402, { valid: false }, VerificationReason.INSUFFICIENT_CREDITS],
      [403, { valid: false }, VerificationReason.FORBIDDEN],
      [429, { valid: false, retryAfter: 3 }, VerificationReason.RATE_LIMITED],
    ] as const;

    for (const [status, payload, reason] of cases) {
      const client = new ReqKey({
        rootKey: "reqkey_test",
        fetch: async () => Response.json(payload, { status }),
      });
      const result = await client.verify("prod_consumer");
      assert.equal(result.allowed, false);
      assert.equal(result.reason, reason);
    }
  });

  it("raises an authentication error for a rejected project key", async () => {
    const client = new ReqKey({
      projectKey: "bad",
      fetch: async () => Response.json({ error: "Invalid project key" }, { status: 401 }),
    });
    await assert.rejects(() => client.verify("consumer"), ReqKeyAuthenticationError);
  });

  it("validates credit costs before making a request", async () => {
    let called = false;
    const client = new ReqKey({
      projectKey: "test",
      fetch: async () => {
        called = true;
        return Response.json({ valid: true });
      },
    });
    await assert.rejects(
      () => client.verify("consumer", { credits: -1 }),
      ReqKeyConfigurationError,
    );
    assert.equal(called, false);
  });

  it("ingests by API ID and truncates bodies", async () => {
    let payload: Record<string, unknown> = {};
    const client = new ReqKey({
      projectKey: "test",
      fetch: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return Response.json({ success: true }, { status: 202 });
      },
    });
    await client.ingest({
      apiId: "payments",
      method: "POST",
      consumerName: "rapidapi-user",
      apiKey: "consumer",
      responseBody: "x".repeat(1_200),
    });
    assert.equal(payload.apiId, "payments");
    assert.equal(payload.consumerName, "rapidapi-user");
    assert.equal(String(payload.responseBody).length, 1_000);
  });

  it("turns an aborted fetch into a timeout error", async () => {
    const hangingFetch: ReqKeyFetch = async (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    const client = new ReqKey({
      projectKey: "test",
      timeoutMs: 5,
      fetch: hangingFetch,
    });
    await assert.rejects(() => client.verify("consumer"), ReqKeyTimeoutError);
  });
});
