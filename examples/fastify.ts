import Fastify, { type FastifyRequest } from "fastify";
import type { VerificationResult } from "reqkey";
import reqkey from "reqkey/fastify";

const app = Fastify();

await app.register(reqkey, {
  projectKey: process.env.REQKEY_PROJECT_KEY,
  apiId: "api_payments",
  mode: "both",
  keyName: "X-StartupName-Key",
  excludePaths: ["/health"],
});

app.post("/payments", async (request) => {
  const decision = (request as FastifyRequest & { reqkey?: VerificationResult }).reqkey;
  return { created: true, creditsRemaining: decision?.creditsRemaining };
});

await app.listen({ port: 3000 });
