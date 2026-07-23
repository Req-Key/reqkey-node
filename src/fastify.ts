import type {
  FastifyPluginAsync,
  FastifyPluginOptions,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { bodyFromValue } from "./adapter-utils.js";
import {
  ReqKeyMiddlewareRuntime,
  createMiddlewareRequest,
  type AllowOutcome,
  type AuthorizationOutcome,
  type MiddlewareOptions,
} from "./middleware.js";
import type { ReqKeyError } from "./errors.js";
import type { VerificationResult } from "./types.js";

const REQUEST_STATE = Symbol("reqkey.fastify.state");

type ReqKeyFastifyRequest = FastifyRequest & {
  reqkey?: VerificationResult;
  reqkeyRequestId?: string;
  reqkeyError?: ReqKeyError;
  [REQUEST_STATE]?: AuthorizationOutcome<FastifyRequest>;
};

export type FastifyReqKeyOptions = MiddlewareOptions<FastifyRequest> & FastifyPluginOptions;

const plugin: FastifyPluginAsync<FastifyReqKeyOptions> = async (fastify, options) => {
  const runtime = new ReqKeyMiddlewareRuntime<FastifyRequest>(options);

  if (!fastify.hasRequestDecorator("reqkey")) fastify.decorateRequest("reqkey");
  if (!fastify.hasRequestDecorator("reqkeyRequestId")) {
    fastify.decorateRequest("reqkeyRequestId");
  }
  if (!fastify.hasRequestDecorator("reqkeyError")) fastify.decorateRequest("reqkeyError");

  fastify.addHook("onRequest", async (request, reply) => {
    const publicRequest = request as ReqKeyFastifyRequest;
    const outcome = await runtime.authorize(toMiddlewareRequest(request));
    publicRequest[REQUEST_STATE] = outcome;

    if (outcome.kind === "skip") return;
    if (outcome.kind === "deny") {
      reply.code(outcome.denial.statusCode);
      reply.headers(outcome.denial.headers);
      return reply.send(outcome.denial.body);
    }

    if (outcome.decision !== undefined) {
      publicRequest.reqkey = outcome.decision;
      if (outcome.decision.requestId !== undefined) {
        publicRequest.reqkeyRequestId = outcome.decision.requestId;
      }
    }
    if (outcome.error !== undefined) publicRequest.reqkeyError = outcome.error;
    reply.headers(outcome.responseHeaders);
  });

  fastify.addHook("onSend", async (request, reply, payload) => {
    const outcome = (request as ReqKeyFastifyRequest)[REQUEST_STATE];
    if (outcome?.kind !== "allow" || runtime.mode === "validate") return payload;

    const headers = responseHeaders(reply);
    const body = runtime.captureResponseBody ? bodyFromValue(payload, headers) : undefined;
    await runtime.record((outcome as AllowOutcome<FastifyRequest>).state, {
      statusCode: reply.statusCode,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    return payload;
  });
};

/** Fastify plugin. Register it before declaring the routes it should protect. */
export const reqkeyFastify = plugin;
export const reqkey = plugin;
export default plugin;

// The marker used by Fastify to make a plugin apply to the parent scope. This
// keeps the adapter dependency-free while preserving normal `register()` usage.
Object.defineProperty(plugin, Symbol.for("skip-override"), { value: true });
Object.defineProperty(plugin, Symbol.for("fastify.display-name"), {
  value: "reqkey",
});

function toMiddlewareRequest(request: FastifyRequest) {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(request.headers)) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(name, value);
    } else {
      headers.set(name, raw);
    }
  }
  const protocol = request.protocol || "http";
  const host = request.host || headers.get("host") || "localhost";
  return createMiddlewareRequest({
    raw: request,
    method: request.method,
    url: new URL(request.url, `${protocol}://${host}`),
    headers,
    ...(request.ip ? { clientIp: request.ip } : {}),
  });
}

function responseHeaders(reply: FastifyReply): Headers {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(reply.getHeaders())) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(name, String(value));
    } else {
      headers.set(name, String(raw));
    }
  }
  return headers;
}
