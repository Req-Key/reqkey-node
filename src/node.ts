import type { IncomingMessage, ServerResponse } from "node:http";
import { ResponseBodyCapture } from "./adapter-utils.js";
import {
  ReqKeyMiddlewareRuntime,
  createMiddlewareRequest,
  type AuthorizationOutcome,
  type MiddlewareOptions,
} from "./middleware.js";
import type { ReqKeyError } from "./errors.js";
import type { VerificationResult } from "./types.js";

export type ReqKeyNodeRequest = IncomingMessage & {
  reqkey?: VerificationResult;
  reqkeyRequestId?: string;
  reqkeyError?: ReqKeyError;
};

export type NodeNext = (error?: unknown) => unknown;

export type NodeMiddleware<TRequest extends IncomingMessage = ReqKeyNodeRequest> = (
  request: TRequest,
  response: ServerResponse,
  next: NodeNext,
) => Promise<void>;

export type NodeHandler<TRequest extends IncomingMessage = ReqKeyNodeRequest> = (
  request: TRequest,
  response: ServerResponse,
) => unknown | Promise<unknown>;

export type NodeMiddlewareOptions<TRequest extends IncomingMessage = ReqKeyNodeRequest> =
  MiddlewareOptions<TRequest>;

/** Connect-compatible middleware for `node:http`, Express, and similar servers. */
export function createReqKeyMiddleware<
  TRequest extends IncomingMessage = ReqKeyNodeRequest,
>(options: NodeMiddlewareOptions<TRequest>): NodeMiddleware<TRequest> {
  const runtime = new ReqKeyMiddlewareRuntime<TRequest>(options);

  return async (request, response, next) => {
    let outcome: AuthorizationOutcome<TRequest>;
    try {
      outcome = await runtime.authorize(toMiddlewareRequest(request));
    } catch (error) {
      next(error);
      return;
    }

    if (outcome.kind === "skip") {
      next();
      return;
    }
    if (outcome.kind === "deny") {
      sendDenial(response, outcome.denial);
      return;
    }

    const publicRequest = request as TRequest & ReqKeyNodeRequest;
    if (outcome.decision !== undefined) {
      publicRequest.reqkey = outcome.decision;
      if (outcome.decision.requestId !== undefined) {
        publicRequest.reqkeyRequestId = outcome.decision.requestId;
      }
    }
    if (outcome.error !== undefined) publicRequest.reqkeyError = outcome.error;
    for (const [name, value] of Object.entries(outcome.responseHeaders)) {
      response.setHeader(name, value);
    }

    if (runtime.mode !== "validate") {
      interceptResponse(response, runtime, outcome);
    }

    try {
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Wrap a plain `node:http` handler without adopting a middleware framework. */
export function withReqKey<
  TRequest extends IncomingMessage = ReqKeyNodeRequest,
>(
  handler: NodeHandler<TRequest>,
  options: NodeMiddlewareOptions<TRequest>,
): (request: TRequest, response: ServerResponse) => Promise<void> {
  const middleware = createReqKeyMiddleware(options);
  return async (request, response) => {
    try {
      await new Promise<void>((resolve, reject) => {
        let nextCalled = false;
        void middleware(request, response, (error) => {
          nextCalled = true;
          if (error !== undefined) {
            reject(error);
            return;
          }
          void Promise.resolve(handler(request, response)).then(() => resolve(), reject);
        }).then(
          () => {
            if (!nextCalled) resolve();
          },
          reject,
        );
      });
    } catch (error) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

function toMiddlewareRequest<TRequest extends IncomingMessage>(request: TRequest) {
  const headers = new Headers();
  if (request.rawHeaders.length > 0) {
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
      const name = request.rawHeaders[index];
      const value = request.rawHeaders[index + 1];
      if (name !== undefined && value !== undefined) headers.append(name, value);
    }
  } else {
    for (const [name, raw] of Object.entries(request.headers)) {
      if (raw === undefined) continue;
      if (Array.isArray(raw)) {
        for (const value of raw) headers.append(name, value);
      } else {
        headers.set(name, raw);
      }
    }
  }

  const originalUrl = (request as IncomingMessage & { originalUrl?: string }).originalUrl;
  const path = originalUrl ?? request.url ?? "/";
  const encrypted = Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted);
  const protocol = encrypted ? "https" : "http";
  const host = headers.get("host") ?? "localhost";
  const url = new URL(path, `${protocol}://${host}`);

  return createMiddlewareRequest({
    raw: request,
    method: request.method ?? "GET",
    url,
    headers,
    ...(request.socket.remoteAddress === undefined
      ? {}
      : { clientIp: request.socket.remoteAddress }),
  });
}

function sendDenial(
  response: ServerResponse,
  denial: AuthorizationOutcome["kind"] extends never ? never : {
    statusCode: number;
    headers: Readonly<Record<string, string>>;
    body: Readonly<{ error: string; message: string }>;
  },
): void {
  const body = JSON.stringify(denial.body);
  response.statusCode = denial.statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  for (const [name, value] of Object.entries(denial.headers)) response.setHeader(name, value);
  response.end(body);
}

function interceptResponse<TRequest extends IncomingMessage>(
  response: ServerResponse,
  runtime: ReqKeyMiddlewareRuntime<TRequest>,
  outcome: Extract<AuthorizationOutcome<TRequest>, { kind: "allow" }>,
): void {
  const capture = new ResponseBodyCapture(runtime.captureResponseBody);
  type WritableChunk = string | Uint8Array;
  type Write = (
    chunk: WritableChunk,
    encoding?: BufferEncoding,
    callback?: () => void,
  ) => boolean;
  type End = (
    chunk?: WritableChunk,
    encoding?: BufferEncoding,
    callback?: () => void,
  ) => ServerResponse;
  const originalWrite = response.write.bind(response) as Write;
  const originalEnd = response.end.bind(response) as End;
  let finalizing = false;
  let finalized = false;

  const record = async (): Promise<void> => {
    if (finalized) return;
    finalized = true;
    const headers = headersFromResponse(response);
    const body = capture.text(headers);
    await runtime.record(outcome.state, {
      statusCode: response.statusCode,
      headers,
      ...(body === undefined ? {} : { body }),
    });
  };

  response.write = ((
    chunk: unknown,
    encoding?: BufferEncoding | (() => void),
    callback?: () => void,
  ) => {
    const resolvedEncoding = typeof encoding === "string" ? encoding : undefined;
    const resolvedCallback = typeof encoding === "function" ? encoding : callback;
    capture.add(chunk, resolvedEncoding);
    return originalWrite(chunk as WritableChunk, resolvedEncoding, resolvedCallback);
  }) as typeof response.write;

  response.end = ((
    chunk?: unknown,
    encoding?: BufferEncoding | (() => void),
    callback?: () => void,
  ) => {
    if (finalizing) return response;
    finalizing = true;
    const resolvedChunk = typeof chunk === "function" ? undefined : chunk;
    const resolvedEncoding = typeof encoding === "string" ? encoding : undefined;
    const resolvedCallback =
      typeof chunk === "function"
        ? (chunk as () => void)
        : typeof encoding === "function"
          ? encoding
          : callback;
    capture.add(resolvedChunk, resolvedEncoding);

    void (async () => {
      try {
        await record();
      } finally {
        originalEnd(
          resolvedChunk as WritableChunk | undefined,
          resolvedEncoding,
          resolvedCallback,
        );
      }
    })().catch(() => undefined);
    return response;
  }) as typeof response.end;

  response.once("close", () => {
    if (!finalizing) void record().catch(() => undefined);
  });
}

function headersFromResponse(response: ServerResponse): Headers {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(response.getHeaders())) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(name, String(value));
    } else {
      headers.set(name, String(raw));
    }
  }
  return headers;
}

export const reqkey = createReqKeyMiddleware;
export const reqkeyMiddleware = createReqKeyMiddleware;
