import { ReqKey } from "./client.js";
import { ReqKeyConfigurationError, ReqKeyError } from "./errors.js";
import {
  VerificationReason,
  type ReqKeyClient,
  type ReqKeyOptions,
  type VerificationResult,
} from "./types.js";

export type MiddlewareMode = "validate" | "ingest" | "both";
export type FailureMode = "closed" | "open";
export type KeyLocation = "header" | "query" | "cookie";
export type KeyScheme = "raw" | "bearer";
export type ErrorCode =
  | "missing_api_key"
  | "invalid_api_key"
  | "insufficient_credits"
  | "access_denied"
  | "rate_limited"
  | "reqkey_unavailable";

type MaybePromise<T> = T | Promise<T>;
type Resolver<TRaw, T> = (request: MiddlewareRequest<TRaw>) => MaybePromise<T>;

export const DEFAULT_ERROR_MESSAGES: Readonly<Record<ErrorCode, string>> = {
  missing_api_key: "An API key is required.",
  invalid_api_key: "The API key is invalid or inactive.",
  insufficient_credits: "The API key has insufficient credits.",
  access_denied: "The API key is not allowed to access this API.",
  rate_limited: "The API key has exceeded its rate limit.",
  reqkey_unavailable: "API key verification is temporarily unavailable.",
};

const DEFAULT_EXCLUDED_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
]);

const PROXY_CLIENT_IP_HEADERS = [
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "x-vercel-forwarded-for",
  "fly-client-ip",
  "fastly-client-ip",
  "x-azure-clientip",
  "x-appengine-user-ip",
  "cloudfront-viewer-address",
  "forwarded",
] as const;

export interface MiddlewareRequest<TRaw = unknown> {
  readonly raw: TRaw;
  readonly method: string;
  readonly url: URL;
  readonly path: string;
  readonly headers: Headers;
  readonly query: URLSearchParams;
  readonly cookies: ReadonlyMap<string, string>;
  readonly clientIp?: string;
}

export interface MiddlewareErrorEvent {
  readonly operation: "validate" | "ingest";
  readonly error: ReqKeyError;
  readonly message: string;
  readonly method: string;
  readonly path: string;
  readonly requestId?: string;
  readonly statusCode?: number;
}

export interface MiddlewareOptions<TRaw = unknown> extends ReqKeyOptions {
  apiId: string;
  client?: ReqKeyClient;
  mode?: MiddlewareMode;
  enabled?: boolean;
  keyLocation?: KeyLocation;
  keyName?: string;
  keyScheme?: KeyScheme;
  getConsumerKey?: Resolver<TRaw, string | null | undefined>;
  credits?: number | Resolver<TRaw, number>;
  excludePaths?: readonly string[];
  skipMethods?: readonly string[];
  shouldProtect?: Resolver<TRaw, boolean>;
  requestIdResolver?: Resolver<TRaw, string | null | undefined>;
  pathResolver?: Resolver<TRaw, string>;
  consumerNameResolver?: Resolver<TRaw, string | null | undefined>;
  clientIpResolver?: Resolver<TRaw, string | null | undefined>;
  onError?: (event: MiddlewareErrorEvent) => MaybePromise<void>;
  ingestDeniedRequests?: boolean;
  errorMessages?: Partial<Record<ErrorCode, string>>;
  captureQueryParams?: boolean;
  captureRequestHeaders?: boolean;
  captureResponseHeaders?: boolean;
  captureResponseBody?: boolean;
  captureClientIp?: boolean;
  captureUserAgent?: boolean;
  excludedHeaders?: readonly string[];
  failureMode?: FailureMode;
}

export interface DenialResponse {
  readonly statusCode: 401 | 402 | 403 | 429 | 503;
  readonly error: ErrorCode;
  readonly message: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<{ error: ErrorCode; message: string }>;
}

export interface AuthorizationState<TRaw = unknown> {
  readonly request: MiddlewareRequest<TRaw>;
  readonly requestStartedAt: number;
  readonly handlerStartedAt: number;
  readonly consumerKey?: string;
  readonly decision?: VerificationResult;
}

interface BaseOutcome<TRaw> {
  readonly state: AuthorizationState<TRaw>;
  readonly responseHeaders: Readonly<Record<string, string>>;
}

export interface SkipOutcome<TRaw = unknown> extends BaseOutcome<TRaw> {
  readonly kind: "skip";
}

export interface AllowOutcome<TRaw = unknown> extends BaseOutcome<TRaw> {
  readonly kind: "allow";
  readonly decision?: VerificationResult;
  readonly error?: ReqKeyError;
}

export interface DenyOutcome<TRaw = unknown> extends BaseOutcome<TRaw> {
  readonly kind: "deny";
  readonly denial: DenialResponse;
}

export type AuthorizationOutcome<TRaw = unknown> =
  | SkipOutcome<TRaw>
  | AllowOutcome<TRaw>
  | DenyOutcome<TRaw>;

export interface MiddlewareResponse {
  statusCode: number;
  headers?: Headers | Readonly<Record<string, string | number | readonly string[] | undefined>>;
  body?: string;
  latencyMs?: number;
}

interface ResolvedOptions<TRaw> {
  apiId: string;
  client: ReqKeyClient;
  mode: MiddlewareMode;
  enabled: boolean;
  keyLocation: KeyLocation;
  keyName: string;
  keyScheme: KeyScheme;
  getConsumerKey?: Resolver<TRaw, string | null | undefined>;
  credits: number | Resolver<TRaw, number>;
  excludePaths: readonly string[];
  skipMethods: ReadonlySet<string>;
  shouldProtect?: Resolver<TRaw, boolean>;
  requestIdResolver?: Resolver<TRaw, string | null | undefined>;
  pathResolver?: Resolver<TRaw, string>;
  consumerNameResolver?: Resolver<TRaw, string | null | undefined>;
  clientIpResolver?: Resolver<TRaw, string | null | undefined>;
  onError?: (event: MiddlewareErrorEvent) => MaybePromise<void>;
  ingestDeniedRequests: boolean;
  errorMessages: Readonly<Record<ErrorCode, string>>;
  captureQueryParams: boolean;
  captureRequestHeaders: boolean;
  captureResponseHeaders: boolean;
  captureResponseBody: boolean;
  captureClientIp: boolean;
  captureUserAgent: boolean;
  excludedHeaders: ReadonlySet<string>;
  failureMode: FailureMode;
}

/**
 * Framework-neutral authorization and analytics engine used by every adapter.
 * It is public so unsupported frameworks can integrate without duplicating the
 * ReqKey protocol or privacy behavior.
 */
export class ReqKeyMiddlewareRuntime<TRaw = unknown> {
  readonly #options: ResolvedOptions<TRaw>;

  constructor(options: MiddlewareOptions<TRaw>) {
    this.#options = resolveMiddlewareOptions(options);
  }

  get mode(): MiddlewareMode {
    return this.#options.mode;
  }

  get captureResponseBody(): boolean {
    return this.#options.captureResponseBody;
  }

  async authorize(request: MiddlewareRequest<TRaw>): Promise<AuthorizationOutcome<TRaw>> {
    const requestStartedAt = performance.now();
    if (!this.#options.enabled || !(await this.#appliesTo(request))) {
      return {
        kind: "skip",
        state: { request, requestStartedAt, handlerStartedAt: performance.now() },
        responseHeaders: {},
      };
    }

    const consumerKey = await this.#consumerKey(request);
    let decision: VerificationResult | undefined;
    let validationTimeMs: number | undefined;
    let validationError: ReqKeyError | undefined;

    if (this.#options.mode === "validate" || this.#options.mode === "both") {
      if (consumerKey === undefined) {
        const state: AuthorizationState<TRaw> = {
          request,
          requestStartedAt,
          handlerStartedAt: performance.now(),
        };
        const denial = this.#denialResponse(401, "missing_api_key");
        await this.#ingestDenied(state, denial);
        return { kind: "deny", state, denial, responseHeaders: {} };
      }

      const validationStartedAt = performance.now();
      try {
        decision = await this.#options.client.verify(consumerKey, {
          apiId: this.#options.apiId,
          credits: await this.#creditCost(request),
          resource: await this.#resourcePath(request),
        });
        validationTimeMs = performance.now() - validationStartedAt;
      } catch (error) {
        validationTimeMs = performance.now() - validationStartedAt;
        if (!(error instanceof ReqKeyError)) throw error;
        validationError = error;
        await this.#notifyError(request, "validate", error, undefined, 503);
        if (this.#options.failureMode === "closed") {
          const state: AuthorizationState<TRaw> = {
            request,
            requestStartedAt,
            handlerStartedAt: performance.now(),
            consumerKey,
          };
          const denial = this.#denialResponse(503, "reqkey_unavailable");
          return { kind: "deny", state, denial, responseHeaders: {} };
        }
      }

      if (decision !== undefined && !decision.valid) {
        const state: AuthorizationState<TRaw> = {
          request,
          requestStartedAt,
          handlerStartedAt: performance.now(),
          consumerKey,
          decision,
        };
        const denial = this.#decisionDenial(decision);
        await this.#ingestDenied(state, denial);
        return {
          kind: "deny",
          state,
          denial,
          responseHeaders: decisionHeaders(decision, validationTimeMs),
        };
      }
    }

    const state: AuthorizationState<TRaw> = {
      request,
      requestStartedAt,
      handlerStartedAt: performance.now(),
      ...(consumerKey === undefined ? {} : { consumerKey }),
      ...(decision === undefined ? {} : { decision }),
    };
    return {
      kind: "allow",
      state,
      responseHeaders: decisionHeaders(decision, validationTimeMs),
      ...(decision === undefined ? {} : { decision }),
      ...(validationError === undefined ? {} : { error: validationError }),
    };
  }

  async record(state: AuthorizationState<TRaw>, response: MiddlewareResponse): Promise<void> {
    if (this.#options.mode === "validate") return;
    await this.#ingestSafely(state, response);
  }

  async #appliesTo(request: MiddlewareRequest<TRaw>): Promise<boolean> {
    if (this.#options.skipMethods.has(request.method.toUpperCase())) return false;
    if (this.#options.excludePaths.some((pattern) => pathMatches(request.path, pattern))) {
      return false;
    }
    return this.#options.shouldProtect === undefined
      ? true
      : Boolean(await this.#options.shouldProtect(request));
  }

  async #consumerKey(request: MiddlewareRequest<TRaw>): Promise<string | undefined> {
    let value: string | null | undefined;
    if (this.#options.getConsumerKey !== undefined) {
      value = await this.#options.getConsumerKey(request);
    } else if (this.#options.keyLocation === "header") {
      value = request.headers.get(this.#options.keyName);
    } else if (this.#options.keyLocation === "query") {
      value = request.query.get(this.#options.keyName);
    } else {
      value = request.cookies.get(this.#options.keyName);
    }

    if (value === null || value === undefined || !value.trim()) return undefined;
    const trimmed = value.trim();
    if (this.#options.keyScheme === "raw") return trimmed;
    const match = /^Bearer\s+(.+)$/i.exec(trimmed);
    return match?.[1]?.trim() || undefined;
  }

  async #creditCost(request: MiddlewareRequest<TRaw>): Promise<number> {
    const value =
      typeof this.#options.credits === "function"
        ? await this.#options.credits(request)
        : this.#options.credits;
    if (!Number.isInteger(value) || value < 0) {
      throw new ReqKeyConfigurationError(
        "The credits resolver must return a non-negative integer.",
      );
    }
    return value;
  }

  async #resourcePath(request: MiddlewareRequest<TRaw>): Promise<string> {
    const value =
      this.#options.pathResolver === undefined
        ? request.path
        : await this.#options.pathResolver(request);
    if (!value) {
      throw new ReqKeyConfigurationError("The path resolver returned an empty path.");
    }
    return value;
  }

  async #ingestDenied(
    state: AuthorizationState<TRaw>,
    denial: DenialResponse,
  ): Promise<void> {
    if (this.#options.mode !== "both" || !this.#options.ingestDeniedRequests) return;
    await this.#ingestSafely(state, {
      statusCode: denial.statusCode,
      headers: { "content-type": "application/json", ...denial.headers },
      ...(this.#options.captureResponseBody
        ? { body: JSON.stringify(denial.body) }
        : {}),
      latencyMs: Math.round(performance.now() - state.requestStartedAt),
    });
  }

  async #ingestSafely(
    state: AuthorizationState<TRaw>,
    response: MiddlewareResponse,
  ): Promise<void> {
    const { request, decision, consumerKey } = state;
    let requestId = decision?.requestId;

    try {
      const resourcePath = await this.#resourcePath(request);
      const capturedQuery = this.#capturedQuery(request);
      const path = capturedQuery.serialized
        ? `${resourcePath}?${capturedQuery.serialized}`
        : resourcePath;
      const consumerName = await this.#resolvedString(
        this.#options.consumerNameResolver,
        request,
      );
      const clientIp = await this.#clientIp(request);
      if (requestId === undefined && this.#options.requestIdResolver !== undefined) {
        requestId =
          (await this.#resolvedString(this.#options.requestIdResolver, request)) ?? undefined;
      }
      const userAgent = this.#options.captureUserAgent
        ? request.headers.get("user-agent") ?? undefined
        : undefined;

      await this.#options.client.ingest({
        apiId: this.#options.apiId,
        ...(requestId === undefined ? {} : { requestId }),
        method: request.method,
        endpoint: resourcePath,
        path,
        statusCode: response.statusCode,
        latencyMs:
          response.latencyMs ?? Math.round(performance.now() - state.handlerStartedAt),
        ...(clientIp === undefined ? {} : { clientIp }),
        ...(userAgent === undefined ? {} : { userAgent }),
        ...(consumerName === undefined ? {} : { consumerName }),
        ...(consumerKey === undefined ? {} : { apiKey: consumerKey }),
        ...(capturedQuery.values === undefined
          ? {}
          : { queryParams: capturedQuery.values }),
        ...(this.#options.captureRequestHeaders
          ? { requestHeaders: this.#filteredHeaders(request.headers) }
          : {}),
        ...(this.#options.captureResponseHeaders
          ? { responseHeaders: this.#filteredHeaders(toHeaders(response.headers)) }
          : {}),
        ...(this.#options.captureResponseBody && response.body !== undefined
          ? { responseBody: response.body }
          : {}),
      });
    } catch (error) {
      if (!(error instanceof ReqKeyError)) throw error;
      await this.#notifyError(
        request,
        "ingest",
        error,
        requestId,
        response.statusCode,
      );
    }
  }

  async #clientIp(request: MiddlewareRequest<TRaw>): Promise<string | undefined> {
    if (!this.#options.captureClientIp) return undefined;
    if (this.#options.clientIpResolver !== undefined) {
      return (await this.#resolvedString(this.#options.clientIpResolver, request)) ?? undefined;
    }
    if (request.clientIp?.trim()) return request.clientIp.trim();
    return clientIpFromHeaders(request.headers);
  }

  async #resolvedString(
    resolver: Resolver<TRaw, string | null | undefined> | undefined,
    request: MiddlewareRequest<TRaw>,
  ): Promise<string | undefined> {
    if (resolver === undefined) return undefined;
    const value = await resolver(request);
    return value?.trim() || undefined;
  }

  #capturedQuery(request: MiddlewareRequest<TRaw>): {
    values?: Readonly<Record<string, string>>;
    serialized: string;
  } {
    if (!this.#options.captureQueryParams) return { serialized: "" };
    const safe = new URLSearchParams();
    const values: Record<string, string> = {};
    for (const [key, value] of request.query) {
      if (this.#options.keyLocation === "query" && key === this.#options.keyName) continue;
      safe.append(key, value);
      values[key] = value;
    }
    return { values, serialized: safe.toString() };
  }

  #filteredHeaders(headers: Headers): Record<string, string> {
    return Object.fromEntries(
      [...headers].filter(([name]) => !this.#options.excludedHeaders.has(name.toLowerCase())),
    );
  }

  #decisionDenial(decision: VerificationResult): DenialResponse {
    if (decision.reason === VerificationReason.INSUFFICIENT_CREDITS) {
      return this.#denialResponse(402, "insufficient_credits");
    }
    if (decision.reason === VerificationReason.RATE_LIMITED) {
      const headers =
        decision.retryAfter === undefined
          ? undefined
          : { "Retry-After": String(Math.max(0, Math.trunc(decision.retryAfter))) };
      return this.#denialResponse(429, "rate_limited", headers);
    }
    if (decision.reason === VerificationReason.FORBIDDEN) {
      return this.#denialResponse(403, "access_denied");
    }
    return this.#denialResponse(401, "invalid_api_key");
  }

  #denialResponse(
    statusCode: DenialResponse["statusCode"],
    error: ErrorCode,
    headers: Readonly<Record<string, string>> = {},
  ): DenialResponse {
    const message = this.#options.errorMessages[error];
    return { statusCode, error, message, headers, body: { error, message } };
  }

  async #notifyError(
    request: MiddlewareRequest<TRaw>,
    operation: "validate" | "ingest",
    error: ReqKeyError,
    requestId: string | undefined,
    statusCode: number | undefined,
  ): Promise<void> {
    if (this.#options.onError === undefined) return;
    const event: MiddlewareErrorEvent = {
      operation,
      error,
      message: error.message,
      method: request.method,
      path: request.path,
      ...(requestId === undefined ? {} : { requestId }),
      ...(statusCode === undefined ? {} : { statusCode }),
    };
    try {
      await this.#options.onError(event);
    } catch {
      // Alerting must never replace an application response.
    }
  }
}

function resolveMiddlewareOptions<TRaw>(
  options: MiddlewareOptions<TRaw>,
): ResolvedOptions<TRaw> {
  if (!options.apiId.trim()) {
    throw new ReqKeyConfigurationError("apiId cannot be empty.");
  }
  const mode = options.mode ?? "both";
  if (!(["validate", "ingest", "both"] as const).includes(mode)) {
    throw new ReqKeyConfigurationError("mode must be 'validate', 'ingest', or 'both'.");
  }
  const keyLocation = options.keyLocation ?? "header";
  if (!(["header", "query", "cookie"] as const).includes(keyLocation)) {
    throw new ReqKeyConfigurationError("keyLocation must be 'header', 'query', or 'cookie'.");
  }
  const keyScheme = options.keyScheme ?? "raw";
  if (!(["raw", "bearer"] as const).includes(keyScheme)) {
    throw new ReqKeyConfigurationError("keyScheme must be 'raw' or 'bearer'.");
  }
  if (keyLocation !== "header" && keyScheme !== "raw") {
    throw new ReqKeyConfigurationError(
      "Query-parameter and cookie keys must use the raw scheme.",
    );
  }
  const failureMode = options.failureMode ?? "closed";
  if (!(["closed", "open"] as const).includes(failureMode)) {
    throw new ReqKeyConfigurationError("failureMode must be 'closed' or 'open'.");
  }
  const credits = options.credits ?? 1;
  if (typeof credits !== "function" && (!Number.isInteger(credits) || credits < 0)) {
    throw new ReqKeyConfigurationError(
      "credits must be a non-negative integer or a function.",
    );
  }
  if (
    options.client !== undefined &&
    (options.projectKey !== undefined || options.rootKey !== undefined)
  ) {
    throw new ReqKeyConfigurationError("Pass client or projectKey/rootKey, not both.");
  }

  const keyName = options.keyName ?? "X-API-Key";
  const excludedHeaders = new Set(DEFAULT_EXCLUDED_HEADERS);
  excludedHeaders.add(keyName.toLowerCase());
  for (const name of options.excludedHeaders ?? []) excludedHeaders.add(name.toLowerCase());

  const client =
    options.client ??
    new ReqKey({
      ...(options.projectKey === undefined ? {} : { projectKey: options.projectKey }),
      ...(options.rootKey === undefined ? {} : { rootKey: options.rootKey }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });

  return {
    apiId: options.apiId,
    client,
    mode,
    enabled: options.enabled ?? true,
    keyLocation,
    keyName,
    keyScheme,
    credits,
    excludePaths: options.excludePaths ?? [],
    skipMethods: new Set((options.skipMethods ?? ["OPTIONS"]).map((value) => value.toUpperCase())),
    ingestDeniedRequests: options.ingestDeniedRequests ?? true,
    errorMessages: { ...DEFAULT_ERROR_MESSAGES, ...options.errorMessages },
    captureQueryParams: options.captureQueryParams ?? false,
    captureRequestHeaders: options.captureRequestHeaders ?? false,
    captureResponseHeaders: options.captureResponseHeaders ?? false,
    captureResponseBody: options.captureResponseBody ?? false,
    captureClientIp: options.captureClientIp ?? false,
    captureUserAgent: options.captureUserAgent ?? true,
    excludedHeaders,
    failureMode,
    ...(options.getConsumerKey === undefined
      ? {}
      : { getConsumerKey: options.getConsumerKey }),
    ...(options.shouldProtect === undefined
      ? {}
      : { shouldProtect: options.shouldProtect }),
    ...(options.requestIdResolver === undefined
      ? {}
      : { requestIdResolver: options.requestIdResolver }),
    ...(options.pathResolver === undefined ? {} : { pathResolver: options.pathResolver }),
    ...(options.consumerNameResolver === undefined
      ? {}
      : { consumerNameResolver: options.consumerNameResolver }),
    ...(options.clientIpResolver === undefined
      ? {}
      : { clientIpResolver: options.clientIpResolver }),
    ...(options.onError === undefined ? {} : { onError: options.onError }),
  };
}

export function createMiddlewareRequest<TRaw>(options: {
  raw: TRaw;
  method: string;
  url: URL;
  headers?: Headers;
  clientIp?: string;
}): MiddlewareRequest<TRaw> {
  const headers = options.headers ?? new Headers();
  return {
    raw: options.raw,
    method: options.method.toUpperCase(),
    url: options.url,
    path: options.url.pathname,
    headers,
    query: options.url.searchParams,
    cookies: parseCookies(headers.get("cookie")),
    ...(options.clientIp === undefined ? {} : { clientIp: options.clientIp }),
  };
}

export function decisionHeaders(
  decision: VerificationResult | undefined,
  validationTimeMs: number | undefined,
): Record<string, string> {
  return {
    ...(decision?.requestId ? { "X-ReqKey-Request-ID": decision.requestId } : {}),
    ...(decision?.creditsLimit === undefined
      ? {}
      : { "X-ReqKey-Credits-Limit": String(decision.creditsLimit) }),
    ...(decision?.creditsRemaining === undefined
      ? {}
      : { "X-ReqKey-Credits-Remaining": String(decision.creditsRemaining) }),
    ...(validationTimeMs === undefined
      ? {}
      : { "X-ReqKey-Validation-Time-Ms": validationTimeMs.toFixed(3) }),
  };
}

function pathMatches(path: string, pattern: string): boolean {
  return pattern.endsWith("*") ? path.startsWith(pattern.slice(0, -1)) : path === pattern;
}

function parseCookies(value: string | null): ReadonlyMap<string, string> {
  const cookies = new Map<string, string>();
  if (!value) return cookies;
  for (const pair of value.split(";")) {
    const index = pair.indexOf("=");
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    const raw = pair.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies.set(name, decodeURIComponent(raw));
    } catch {
      cookies.set(name, raw);
    }
  }
  return cookies;
}

function toHeaders(
  value: MiddlewareResponse["headers"],
): Headers {
  if (value instanceof Headers) return value;
  const headers = new Headers();
  for (const [name, raw] of Object.entries(value ?? {})) {
    if (raw === undefined) continue;
    if (Array.isArray(raw)) {
      for (const item of raw) headers.append(name, item);
    } else {
      headers.set(name, String(raw));
    }
  }
  return headers;
}

function clientIpFromHeaders(headers: Headers): string | undefined {
  for (const name of PROXY_CLIENT_IP_HEADERS) {
    const value = headers.get(name);
    if (!value) continue;
    const candidates =
      name === "forwarded"
        ? [...value.matchAll(/(?:^|[;,])\s*for=("?[^;,]+"?)/gi)].map((match) => match[1] ?? "")
        : value.split(",");
    for (const raw of candidates) {
      const candidate = normalizeIp(raw);
      if (candidate !== undefined) return candidate;
    }
  }
  return undefined;
}

function normalizeIp(value: string): string | undefined {
  let candidate = value.trim().replace(/^"|"$/g, "");
  if (!candidate || candidate.toLowerCase() === "unknown" || candidate.startsWith("_")) {
    return undefined;
  }
  if (candidate.startsWith("[")) {
    const end = candidate.indexOf("]");
    if (end > 0) candidate = candidate.slice(1, end);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) {
    const octets = candidate.split(".").map(Number);
    return octets.every((part) => part >= 0 && part <= 255) ? candidate : undefined;
  }
  return /^[0-9a-f:.%]+$/i.test(candidate) && candidate.includes(":")
    ? candidate
    : undefined;
}
