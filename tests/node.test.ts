import assert from "node:assert/strict";
import { createServer } from "node:http";
import { describe, it } from "node:test";
import { withReqKey } from "../src/node.js";
import { FakeReqKey } from "./helpers.js";

describe("plain Node.js adapter", () => {
  it("wraps a node:http handler", async () => {
    const client = new FakeReqKey();
    const server = createServer(
      withReqKey(
        (request, response) => {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ requestId: request.reqkey?.requestId }));
        },
        { client, apiId: "payments" },
      ),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert.ok(address && typeof address === "object");

    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/payments`, {
        headers: { "X-API-Key": "prod_consumer" },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-reqkey-request-id"), "request_123");
      assert.deepEqual(await response.json(), { requestId: "request_123" });
      assert.equal(client.ingestCalls.length, 1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
