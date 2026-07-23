import { createServer } from "node:http";
import { withReqKey } from "reqkey/node";

const handler = withReqKey(
  (request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({ ok: true, requestId: request.reqkey?.requestId }),
    );
  },
  {
    projectKey: process.env.REQKEY_PROJECT_KEY,
    apiId: "api_payments",
    mode: "both",
    excludePaths: ["/health"],
  },
);

createServer(handler).listen(3000);
