# ReqKey Node.js SDK

The official TypeScript and Node.js SDK for API key validation, credit
metering, consumer rate limits, and correlated API traffic analytics with
ReqKey.

**Website:** [reqkey.com](https://reqkey.com) ·
**Documentation:** [reqkey.com/docs](https://reqkey.com/docs)

One npm package contains the shared async client and framework adapters. The
core has no framework dependency, and the package publishes both ESM and
CommonJS builds with complete TypeScript declarations.

## Supported integrations

| Application | Import | Integration |
|---|---|---|
| Plain Node.js `node:http` | `reqkey/node` | handler wrapper or Connect-style middleware |
| Express 4/5 | `reqkey/express` | middleware |
| Fastify 5 | `reqkey/fastify` | plugin |
| Koa 2/3 | `reqkey/koa` | middleware |
| NestJS 11 (Express or Fastify platform) | `reqkey/nestjs` | dynamic module or middleware |
| Next.js App Router | `reqkey/next` | route-handler wrapper |
| Next.js Pages Router | `reqkey/next` | API-handler wrapper |
| Scripts, workers, and custom servers | `reqkey` | direct async client |
| Other frameworks | `reqkey` | public framework-neutral middleware runtime |

Fastify and Koa are optional peer dependencies. Installing `reqkey` does not
install a web framework. Express shares the standard Node/Connect adapter and
also remains optional.

This release does not include dedicated Hapi, AdonisJS, Bun, Deno, or AWS
Lambda adapters. The direct client and public middleware runtime remain
available when a dedicated adapter is not.

## Requirements and installation

Node.js 20 or newer is required.

```bash
npm install reqkey
```

Install the framework separately when needed:

```bash
npm install reqkey express
npm install reqkey fastify
npm install reqkey koa
```

NestJS projects already have `@nestjs/common` and `@nestjs/core`; they only
need to add `reqkey`. Those Nest packages are optional peers and are not added
to non-Nest applications.

The package supports both module systems:

```ts
import { ReqKey } from "reqkey";
import { reqkey } from "reqkey/express";
```

```js
const { ReqKey } = require("reqkey");
const { reqkey } = require("reqkey/express");
```

## Complete Express integration

```ts
import express from "express";
import { reqkey } from "reqkey/express";
import type { ReqKeyExpressRequest } from "reqkey/express";

const app = express();

app.use(
  reqkey({
    // ReqKey project
    projectKey: process.env.REQKEY_PROJECT_KEY,
    apiId: "api_payments",

    // "validate", "ingest", or "both"
    mode: "both",
    enabled: true,

    // Where your consumer sends their ReqKey-issued key
    keyLocation: "header",
    keyName: "X-StartupName-Key",
    keyScheme: "raw",

    // Usage cost
    credits: 1,

    // No validation or analytics on these routes
    excludePaths: ["/health", "/docs/*", "/cron/*"],

    // Privacy-safe analytics defaults
    captureQueryParams: false,
    captureRequestHeaders: false,
    captureResponseHeaders: false,
    captureResponseBody: false,
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
```

The application makes no direct `/key/validate` or `/ingest` calls. The
middleware owns that internal work.

## Complete Fastify integration

Register the plugin before declaring the routes it should protect:

```ts
import Fastify, { type FastifyRequest } from "fastify";
import type { VerificationResult } from "reqkey";
import reqkey from "reqkey/fastify";

const app = Fastify();

await app.register(reqkey, {
  projectKey: process.env.REQKEY_PROJECT_KEY,
  apiId: "api_payments",
  mode: "both",
  keyName: "X-StartupName-Key",
  excludePaths: ["/health", "/docs/*"],
});

app.post("/payments", async (request) => {
  const decision = (request as FastifyRequest & {
    reqkey?: VerificationResult;
  }).reqkey;
  return {
    created: true,
    creditsRemaining: decision?.creditsRemaining,
  };
});

await app.listen({ port: 3000 });
```

## Complete Koa integration

```ts
import Koa from "koa";
import reqkey from "reqkey/koa";

const app = new Koa();

app.use(
  reqkey({
    projectKey: process.env.REQKEY_PROJECT_KEY,
    apiId: "api_payments",
    mode: "both",
    keyName: "X-StartupName-Key",
    excludePaths: ["/health"],
  }),
);

app.use((context) => {
  context.status = 201;
  context.body = {
    created: true,
    creditsRemaining: context.state.reqkey?.creditsRemaining,
  };
});

app.listen(3000);
```

## Complete NestJS integration

Import the global module once in the application module. The same integration
works with Nest's default Express platform and its Fastify platform:

```ts
import { Controller, Get, Module } from "@nestjs/common";
import type { VerificationResult } from "reqkey";
import {
  ReqKeyDecision,
  ReqKeyModule,
  ReqKeyRequestId,
} from "reqkey/nestjs";

@Controller("payments")
class PaymentsController {
  @Get()
  list(
    @ReqKeyDecision() decision: VerificationResult | undefined,
    @ReqKeyRequestId() requestId: string | undefined,
  ) {
    return {
      payments: [],
      requestId,
      creditsRemaining: decision?.creditsRemaining,
    };
  }
}

@Module({
  imports: [
    ReqKeyModule.forRoot({
      projectKey: process.env.REQKEY_PROJECT_KEY,
      apiId: "api_payments",
      mode: "both",
      keyName: "X-StartupName-Key",
      excludePaths: ["/health", "/docs/*"],
    }),
  ],
  controllers: [PaymentsController],
})
export class AppModule {}
```

For configuration services and secret managers, use the conventional async
module registration:

```ts
ReqKeyModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    projectKey: config.getOrThrow("REQKEY_PROJECT_KEY"),
    apiId: "api_payments",
  }),
});
```

`ReqKeyFailure()` exposes the error that caused a fail-open request. Advanced
applications can alternatively register `reqkeyNest(options)` through
`app.use()`. Nest Fastify middleware receives the raw Node request and response,
so the adapter remains platform-neutral while the parameter decorators find
state on either Nest request representation.

## Complete Next.js App Router integration

Wrap an individual route handler in `app/api/payments/route.ts`:

```ts
import { getReqKey, withReqKey } from "reqkey/next";

export const POST = withReqKey(
  async (request) => {
    const decision = getReqKey(request);
    return Response.json(
      {
        created: true,
        creditsRemaining: decision?.creditsRemaining,
      },
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
```

The decision is also attached as `request.reqkey` when the runtime allows the
request object to be extended. `getReqKey(request)` is the portable accessor.

`withReqKey` uses Web `Request` and `Response`, so the same wrapper can protect
server-side handlers with that contract. Project credentials must remain in a
server-only module and must never use a `NEXT_PUBLIC_` environment variable.

## Next.js Pages Router

```ts
import type { NextApiRequest, NextApiResponse } from "next";
import type { ReqKeyNodeRequest } from "reqkey/node";
import { withReqKeyPages } from "reqkey/next";

async function payments(request: NextApiRequest, response: NextApiResponse) {
  const protectedRequest = request as NextApiRequest & ReqKeyNodeRequest;
  response.status(201).json({
    created: true,
    creditsRemaining: protectedRequest.reqkey?.creditsRemaining,
  });
}

export default withReqKeyPages(payments, {
  projectKey: process.env.REQKEY_PROJECT_KEY,
  apiId: "api_payments",
});
```

This example also imports `ReqKeyNodeRequest` from `reqkey/node` so TypeScript
knows about the attached fields.

## Plain Node.js

Wrap a handler:

```ts
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
  },
);

createServer(handler).listen(3000);
```

Or use `createReqKeyMiddleware(options)` with any server that implements the
Connect `(request, response, next)` contract.

## Request lifecycle

With `mode: "both"`:

```text
consumer request
  -> extract consumer key
  -> await /key/validate
  -> denied: await /ingest, then return 401 / 402 / 403 / 429
  -> approved: run the application handler
  -> collect response metadata
  -> await /ingest with the validation requestId
  -> finish the response
```

Denied requests are recorded by default, including requests with a missing
key. Set `ingestDeniedRequests: false` to omit those events.

The Node/Express adapter streams response chunks normally but holds the final
`response.end()` until ingestion completes. Fastify records in `onSend`, Koa
records after downstream middleware, and the Next.js wrapper records before it
returns the response. Ingestion service errors do not replace your application
response.

Streaming response bodies are never fully buffered. Node/Express retains only
the first bounded text bytes for optional capture. Koa and Fastify omit body
capture for stream objects. Next.js only clones a response body when a safe,
small `Content-Length` is present; otherwise it records status and headers but
omits the body.

## Configuration

| Input | Default | Purpose |
|---|---:|---|
| `projectKey` | required | Server credential sent to ReqKey as a Bearer token. |
| `rootKey` | — | Backward-compatible alias for `projectKey`; never pass both. |
| `apiId` | required | ReqKey API being protected or observed. |
| `client` | — | Inject a compatible client; mutually exclusive with credentials. |
| `mode` | `"both"` | `"validate"`, `"ingest"`, or `"both"`. |
| `enabled` | `true` | Bypass the integration entirely when false. |
| `keyLocation` | `"header"` | `"header"`, `"query"`, or `"cookie"`. |
| `keyName` | `"X-API-Key"` | Consumer-facing header, query parameter, or cookie. |
| `keyScheme` | `"raw"` | `"raw"` or `"bearer"` for headers. |
| `getConsumerKey` | — | Sync or async custom key resolver. |
| `credits` | `1` | Static cost or sync/async cost resolver. |
| `excludePaths` | `[]` | Exact paths or trailing-`*` prefix patterns. |
| `skipMethods` | `["OPTIONS"]` | Methods that bypass ReqKey. |
| `shouldProtect` | — | Sync or async request-selection function. |
| `requestIdResolver` | — | Correlate ingest-only traffic with earlier validation. |
| `pathResolver` | request path | Normalize route/resource names. |
| `consumerNameResolver` | — | Resolve optional analytics display name. |
| `clientIpResolver` | peer address | Override IP extraction for trusted proxies. |
| `onError` | — | Receive validation or ingestion service failures. |
| `ingestDeniedRequests` | `true` | Record denied traffic in `"both"` mode. |
| `failureMode` | `"closed"` | Deny or allow when ReqKey is unavailable. |
| `errorMessages` | built in | Override customer-facing denial messages. |
| `baseUrl` | ReqKey API | Override the service URL, usually for tests. |
| `timeoutMs` | `2000` | Timeout for each ReqKey operation. |
| `fetch` | global fetch | Inject another standards-compatible fetch. |

Every resolver receives a normalized request:

```ts
interface MiddlewareRequest<TRaw> {
  raw: TRaw;              // native framework request/context
  method: string;
  url: URL;
  path: string;
  headers: Headers;
  query: URLSearchParams;
  cookies: ReadonlyMap<string, string>;
  clientIp?: string;
}
```

Resolvers may return a value or a promise.

## Choose validation, analytics, or both

Validation only:

```ts
reqkey({
  projectKey: process.env.REQKEY_PROJECT_KEY,
  apiId: "api_payments",
  mode: "validate",
});
```

Traffic analytics only:

```ts
reqkey({
  projectKey: process.env.REQKEY_PROJECT_KEY,
  apiId: "api_payments",
  mode: "ingest",
});
```

In ingest-only mode, the handler runs without ReqKey authentication and the
event is associated with `apiId`. If another component already validated the
request, provide its request ID:

```ts
reqkey({
  projectKey: process.env.REQKEY_PROJECT_KEY,
  apiId: "api_payments",
  mode: "ingest",
  requestIdResolver: ({ raw }) => raw.reqkeyRequestId,
});
```

## Choose where the consumer key comes from

Custom header, recommended:

```ts
keyLocation: "header",
keyName: "X-StartupName-Key",
keyScheme: "raw",
```

Authorization Bearer token:

```ts
keyLocation: "header",
keyName: "Authorization",
keyScheme: "bearer",
```

Query parameter:

```ts
keyLocation: "query",
keyName: "api_key",
```

Cookies use `keyLocation: "cookie"`. Query parameters are supported for
compatibility, but headers are recommended because URLs often enter browser,
proxy, and access logs.

A custom resolver can read another trusted source:

```ts
getConsumerKey: async ({ headers }) => headers.get("X-Custom-Key"),
```

Avoid reading the key from the request body. Authentication runs before the
endpoint, and consuming the body can interfere with downstream parsing.

## Exclude or select endpoints

```ts
excludePaths: ["/health", "/openapi.json", "/docs/*", "/cron/*"],
```

For full control:

```ts
shouldProtect: ({ path }) => path.startsWith("/api/"),
```

The same selection controls validation and ingestion. Excluded traffic is not
validated, charged, or recorded.

## Dynamic credit costs

```ts
credits: ({ method, path }) => {
  if (method === "POST" && path === "/images") return 5;
  if (path.startsWith("/reports/")) return 2;
  return 1;
},
```

Credit costs must be non-negative integers. The SDK deliberately does not
retry validation automatically because validation can deduct credits.

## Analytics capture and privacy

Metadata sent by default:

- validation `requestId` when available;
- `apiId`, method, normalized endpoint, response status, and handler latency;
- user agent;
- the extracted consumer key in the dedicated `apiKey` field so ReqKey can
  resolve the internal consumer.

Additional data is opt-in:

```ts
reqkey({
  projectKey: process.env.REQKEY_PROJECT_KEY,
  apiId: "api_payments",
  captureQueryParams: true,
  captureRequestHeaders: true,
  captureResponseHeaders: true,
  captureResponseBody: true,
  captureClientIp: true,
  excludedHeaders: ["X-RapidAPI-Proxy-Secret", "X-Vercel-OIDC-Token"],
});
```

Authorization, cookies, `Set-Cookie`, proxy authorization, common API-key
headers, and the configured consumer-key header are always removed from
captured headers. A query-string consumer key is removed from both `path` and
`queryParams`. Text response bodies are capped at 1,000 characters by the
adapter and again by the direct client. Binary, compressed, and streaming
bodies are omitted.

Client-IP capture is opt-in. The adapters prefer the framework/socket peer
address, then check common proxy headers only if the peer is missing. If a
trusted proxy overwrites a specific header, make that trust decision explicit:

```ts
captureClientIp: true,
clientIpResolver: ({ headers }) => headers.get("CF-Connecting-IP"),
```

Do not trust forwarding headers that clients can supply directly.

## Request state and response headers

After successful validation:

- Node and Express: `request.reqkey`, `request.reqkeyRequestId`;
- Fastify: `request.reqkey`, `request.reqkeyRequestId`;
- Koa: `context.state.reqkey`, `context.state.reqkeyRequestId`;
- NestJS: `@ReqKeyDecision()` and `@ReqKeyRequestId()` controller parameters;
- Next.js: `getReqKey(request)` and, when extensible, `request.reqkey`.

When fail-open is active, the service failure is available as
`reqkeyError` in the equivalent location or through `getReqKeyError(request)`
for Next.js.

Successful validation adds these response headers when values exist:

- `X-ReqKey-Request-ID`
- `X-ReqKey-Credits-Limit`
- `X-ReqKey-Credits-Remaining`
- `X-ReqKey-Validation-Time-Ms`

Only cross-origin browser code that must read these headers needs them in its
CORS `Access-Control-Expose-Headers` configuration.

## Availability behavior and alerts

Validation fails closed by default. A timeout, transport problem, or ReqKey
service error returns `503` without running the application handler.

```ts
failureMode: "open",
```

Fail-open applies only to ReqKey service errors. Invalid, disabled, exhausted,
forbidden, and rate-limited keys are always denied.

Use `onError` to connect your own alerting provider:

```ts
onError: async (event) => {
  await sendAlert({
    operation: event.operation,
    message: event.message,
    method: event.method,
    path: event.path,
    requestId: event.requestId,
    statusCode: event.statusCode,
  });
},
```

The event intentionally excludes API keys, project credentials, request
headers, query parameters, and bodies. Errors raised by the callback are
ignored so alerting cannot replace an application response.

## Direct async client

```ts
import { ReqKey } from "reqkey";

const client = ReqKey.fromEnv();
const decision = await client.verify("consumer_key_...", {
  apiId: "api_payments",
  credits: 1,
  resource: "/payments",
});

if (!decision.allowed) {
  console.log(decision.reason);
}
```

Direct ingestion:

```ts
await client.ingest({
  requestId: decision.requestId,
  apiId: "api_payments",
  method: "POST",
  path: "/payments",
  statusCode: 201,
  apiKey: "consumer_key_...",
  // consumerName: "rapidapi-user", // optional explicit override
  // consumerId: "consumer_...",    // fallback identity
});
```

The Node SDK is async-only because its HTTP APIs and supported frameworks are
asynchronous. `ReqKey.fromEnv()` reads `REQKEY_PROJECT_KEY`, then the legacy
`REQKEY_ROOT_KEY` fallback.

## Custom framework integration

`ReqKeyMiddlewareRuntime` and `createMiddlewareRequest` are exported from
`reqkey`. An adapter constructs a normalized request, calls `authorize()`,
attaches an allowed decision, runs its handler, and then calls `record()`.
Prefer a provided adapter when one exists because it
already handles response completion, body bounds, state, and denial behavior.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Run the full release check with:

```bash
npm run check
```

The test suite exercises the direct client, framework-neutral runtime, and
real Express, Fastify, Koa, and NestJS servers (on both Nest platforms), plus
the Next.js Web handler contract.

## Publishing checklist

The package is prepared for the unscoped npm name `reqkey`. Before the first
release:

1. Create the public `Req-Key/reqkey-node` GitHub repository and copy this
   directory as its repository root.
2. Confirm the `repository.url` in `package.json` matches that repository.
3. Run `npm run check` and inspect `npm pack --dry-run`.
4. Publish the initial package from an authorized npm account with
   `npm publish --access public`.
5. On npm, configure GitHub Actions trusted publishing for `release.yml` and
   the `npm` environment.
6. For later releases, update `package.json`, create the matching `vX.Y.Z`
   GitHub release, and let the release workflow publish through OIDC.

The release workflow checks that the GitHub tag matches `package.json`, uses
no long-lived npm publish token, and relies on npm's trusted-publishing
provenance.
