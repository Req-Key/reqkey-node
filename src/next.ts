import type { IncomingMessage, ServerResponse } from "node:http";
import { MAX_BODY_CHARACTERS } from "./client.js";
import type { ReqKeyError } from "./errors.js";
import {
  ReqKeyMiddlewareRuntime,
  createMiddlewareRequest,
  type MiddlewareOptions,
} from "./middleware.js";
import { withReqKey as withReqKeyNode, type NodeMiddlewareOptions } from "./node.js";
import type { VerificationResult } from "./types.js";

export type ReqKeyNextRequest = Request & {
  readonly reqkey?: VerificationResult;
  readonly reqkeyRequestId?: string;
  readonly reqkeyError?: ReqKeyError;
};

export type NextReqKeyOptions = MiddlewareOptions<Request>;
export type NextRouteHandler<TContext = unknown> = (
  request: ReqKeyNextRequest,
  context: TContext,
) => Response | Promise<Response>;

interface RequestState {
  decision?: VerificationResult;
  error?: ReqKeyError;
}

const requestStates = new WeakMap<Request, RequestState>();

/** Read the successful decision in a Next.js handler without relying on mutation. */
export function getReqKey(request: Request): VerificationResult | undefined {
  return requestStates.get(request)?.decision;
}

/** Read a validation service error when `failureMode: "open"` is enabled. */
export function getReqKeyError(request: Request): ReqKeyError | undefined {
  return requestStates.get(request)?.error;
}

/** Protect a Next.js App Router route handler or Web `Request`/`Response` handler. */
export function withReqKey<TContext = unknown>(
  handler: NextRouteHandler<TContext>,
  options: NextReqKeyOptions,
): NextRouteHandler<TContext> {
  const runtime = new ReqKeyMiddlewareRuntime<Request>(options);

  return async (request, context) => {
    const outcome = await runtime.authorize(
      createMiddlewareRequest({
        raw: request,
        method: request.method,
        url: new URL(request.url),
        headers: request.headers,
      }),
    );

    if (outcome.kind === "deny") {
      return Response.json(outcome.denial.body, {
        status: outcome.denial.statusCode,
        headers: outcome.denial.headers,
      });
    }
    if (outcome.kind === "skip") return handler(request, context);

    const state: RequestState = {
      ...(outcome.decision === undefined ? {} : { decision: outcome.decision }),
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
    };
    requestStates.set(request, state);
    attachRequestState(request, state);

    let response: Response;
    try {
      response = await handler(request, context);
    } catch (error) {
      if (runtime.mode !== "validate") {
        await runtime.record(outcome.state, { statusCode: 500 });
      }
      throw error;
    }

    if (!(response instanceof Response)) {
      throw new TypeError("A ReqKey-wrapped Next.js handler must return a Response.");
    }

    if (runtime.mode !== "validate") {
      const body = runtime.captureResponseBody
        ? await boundedWebResponseBody(response)
        : undefined;
      await runtime.record(outcome.state, {
        statusCode: response.status,
        headers: response.headers,
        ...(body === undefined ? {} : { body }),
      });
    }

    return withHeaders(response, outcome.responseHeaders);
  };
}

/** Protect a Next.js Pages Router API handler. */
export function withReqKeyPages<
  TRequest extends IncomingMessage,
  TResponse extends ServerResponse,
>(
  handler: (request: TRequest, response: TResponse) => unknown | Promise<unknown>,
  options: NodeMiddlewareOptions<TRequest>,
): (request: TRequest, response: TResponse) => Promise<void> {
  const wrapped = withReqKeyNode<TRequest>(
    (request, response) => handler(request, response as TResponse),
    options,
  );
  return (request, response) => wrapped(request, response);
}

export const reqkey = withReqKey;

function attachRequestState(request: Request, state: RequestState): void {
  try {
    if (state.decision !== undefined) {
      Object.defineProperty(request, "reqkey", { configurable: true, value: state.decision });
      Object.defineProperty(request, "reqkeyRequestId", {
        configurable: true,
        value: state.decision.requestId,
      });
    }
    if (state.error !== undefined) {
      Object.defineProperty(request, "reqkeyError", { configurable: true, value: state.error });
    }
  } catch {
    // Next.js may freeze request objects; the WeakMap accessors remain available.
  }
}

function withHeaders(
  response: Response,
  additional: Readonly<Record<string, string>>,
): Response {
  if (Object.keys(additional).length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(additional)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function boundedWebResponseBody(response: Response): Promise<string | undefined> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const textual =
    !contentType ||
    contentType.includes("json") ||
    contentType.includes("text/") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("x-www-form-urlencoded");
  if (!textual || response.body === null) return undefined;

  const rawLength = response.headers.get("content-length");
  if (rawLength === null) return undefined;
  const length = Number(rawLength);
  if (!Number.isFinite(length) || length < 0 || length > MAX_BODY_CHARACTERS * 4 + 4) {
    return undefined;
  }
  try {
    return (await response.clone().text()).slice(0, MAX_BODY_CHARACTERS);
  } catch {
    return undefined;
  }
}
