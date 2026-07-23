import { getReqKey, withReqKey } from "reqkey/next";

export const POST = withReqKey(
  async (request) => {
    const decision = getReqKey(request);
    return Response.json(
      { created: true, creditsRemaining: decision?.creditsRemaining },
      { status: 201 },
    );
  },
  {
    projectKey: process.env.REQKEY_PROJECT_KEY,
    apiId: "api_payments",
    mode: "both",
    keyName: "X-StartupName-Key",
  },
);
