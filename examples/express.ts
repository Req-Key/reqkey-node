import express from "express";
import { reqkey } from "reqkey/express";
import type { ReqKeyExpressRequest } from "reqkey/express";

const app = express();

app.use(
  reqkey({
    projectKey: process.env.REQKEY_PROJECT_KEY,
    apiId: "api_payments",
    mode: "both",
    keyName: "X-StartupName-Key",
    excludePaths: ["/health"],
  }),
);

app.post("/payments", (request, response) => {
  const decision = (request as ReqKeyExpressRequest).reqkey;
  response.status(201).json({
    created: true,
    creditsRemaining: decision?.creditsRemaining,
  });
});

app.listen(3000);
