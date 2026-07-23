import type * as Koa from "koa";
import { bodyFromValue } from "./adapter-utils.js";
import {
  ReqKeyMiddlewareRuntime,
  createMiddlewareRequest,
  type MiddlewareOptions,
} from "./middleware.js";

export type KoaReqKeyOptions = MiddlewareOptions<Koa.Context>;
export type KoaReqKeyMiddleware = (context: Koa.Context, next: Koa.Next) => Promise<void>;

export function reqkeyKoa(options: KoaReqKeyOptions): KoaReqKeyMiddleware {
  const runtime = new ReqKeyMiddlewareRuntime<Koa.Context>(options);

  return async (context, next) => {
    const outcome = await runtime.authorize(toMiddlewareRequest(context));
    if (outcome.kind === "skip") {
      await next();
      return;
    }
    if (outcome.kind === "deny") {
      context.status = outcome.denial.statusCode;
      for (const [name, value] of Object.entries(outcome.denial.headers)) {
        context.set(name, value);
      }
      context.body = outcome.denial.body;
      return;
    }

    if (outcome.decision !== undefined) {
      context.state.reqkey = outcome.decision;
      context.state.reqkeyRequestId = outcome.decision.requestId;
    }
    if (outcome.error !== undefined) context.state.reqkeyError = outcome.error;
    for (const [name, value] of Object.entries(outcome.responseHeaders)) {
      context.set(name, value);
    }

    try {
      await next();
    } catch (error) {
      if (runtime.mode !== "validate") {
        await runtime.record(outcome.state, {
          statusCode: 500,
          headers: responseHeaders(context),
        });
      }
      throw error;
    }

    if (runtime.mode !== "validate") {
      const headers = responseHeaders(context);
      const body = runtime.captureResponseBody
        ? bodyFromValue(context.body, headers)
        : undefined;
      await runtime.record(outcome.state, {
        statusCode: context.status,
        headers,
        ...(body === undefined ? {} : { body }),
      });
    }
  };
}

export const reqkey = reqkeyKoa;
export const reqkeyMiddleware = reqkeyKoa;
export default reqkeyKoa;

function toMiddlewareRequest(context: Koa.Context) {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(context.headers)) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(name, value);
    } else {
      headers.set(name, String(raw));
    }
  }
  return createMiddlewareRequest({
    raw: context,
    method: context.method,
    url: new URL(context.originalUrl, `${context.protocol}://${context.host}`),
    headers,
    ...(context.ip ? { clientIp: context.ip } : {}),
  });
}

function responseHeaders(context: Koa.Context): Headers {
  const headers = new Headers();
  for (const [name, raw] of Object.entries(context.response.headers)) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const value of raw) headers.append(name, String(value));
    } else {
      headers.set(name, String(raw));
    }
  }
  return headers;
}
