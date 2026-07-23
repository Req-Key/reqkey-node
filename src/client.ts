import {
  ReqKeyAPIError,
  ReqKeyAuthenticationError,
  ReqKeyConfigurationError,
  ReqKeyTimeoutError,
  ReqKeyTransportError,
} from "./errors.js";
import {
  VerificationReason,
  type IngestOptions,
  type ReqKeyFetch,
  type ReqKeyOptions,
  type VerificationResult,
  type VerifyOptions,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.reqkey.com";
export const DEFAULT_TIMEOUT_MS = 2_000;
export const MAX_BODY_CHARACTERS = 1_000;
export const VERSION = "0.1.0";
export const USER_AGENT = `reqkey-node/${VERSION}`;

const DECISION_STATUS_CODES = new Set([200, 402, 403, 429]);

interface ResolvedClientOptions {
  projectKey: string;
  baseUrl: string;
  timeoutMs: number;
  fetch: ReqKeyFetch;
}

function resolveOptions(options: ReqKeyOptions): ResolvedClientOptions {
  if (options.projectKey !== undefined && options.rootKey !== undefined) {
    throw new ReqKeyConfigurationError("Pass projectKey or rootKey, not both.");
  }

  const projectKey = (options.projectKey ?? options.rootKey ?? "").trim();
  if (!projectKey) {
    throw new ReqKeyConfigurationError(
      "A ReqKey project key is required. Pass projectKey/rootKey or set " +
        "REQKEY_PROJECT_KEY/REQKEY_ROOT_KEY.",
    );
  }

  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  if (!baseUrl) {
    throw new ReqKeyConfigurationError("baseUrl cannot be empty.");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ReqKeyConfigurationError("timeoutMs must be greater than zero.");
  }

  const fetchImplementation = options.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new ReqKeyConfigurationError(
      "No fetch implementation is available. Use Node.js 20+ or pass fetch.",
    );
  }

  return { projectKey, baseUrl, timeoutMs, fetch: fetchImplementation };
}

function errorMessage(payload: Readonly<Record<string, unknown>>, fallback: string): string {
  for (const key of ["error", "message"] as const) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
  }
  return fallback;
}

async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new ReqKeyAPIError("ReqKey returned a non-JSON response.", {
      statusCode: response.status,
      cause,
    });
  }

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new ReqKeyAPIError("ReqKey returned an unexpected response body.", {
      statusCode: response.status,
    });
  }
  return payload as Record<string, unknown>;
}

function integer(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function reasonFor(status: number, payload: Readonly<Record<string, unknown>>): VerificationReason {
  if (status === 402) return VerificationReason.INSUFFICIENT_CREDITS;
  if (status === 403) return VerificationReason.FORBIDDEN;
  if (status === 429 || payload.rateLimited === true) return VerificationReason.RATE_LIMITED;
  if (payload.valid === true) return VerificationReason.VALID;
  if (status === 200) return VerificationReason.INVALID_KEY;
  return VerificationReason.DENIED;
}

async function verificationResult(response: Response): Promise<VerificationResult> {
  const payload = await jsonObject(response);

  if (response.status === 401) {
    throw new ReqKeyAuthenticationError(
      errorMessage(payload, "ReqKey rejected the project credential."),
      { statusCode: response.status, body: payload },
    );
  }
  if (!DECISION_STATUS_CODES.has(response.status)) {
    throw new ReqKeyAPIError(
      errorMessage(payload, `ReqKey returned HTTP ${response.status}.`),
      { statusCode: response.status, body: payload },
    );
  }

  const creditsRemaining = integer(payload.creditsRemaining);
  const creditsLimit = integer(payload.creditsLimit);
  const result: VerificationResult = {
    valid: payload.valid === true,
    allowed: payload.valid === true,
    reason: reasonFor(response.status, payload),
    statusCode: response.status,
    allowedApis: Array.isArray(payload.allowedApis)
      ? payload.allowedApis.map(String)
      : [],
    raw: payload,
    ...(typeof payload.requestId === "string" ? { requestId: payload.requestId } : {}),
    ...(typeof payload.message === "string" ? { message: payload.message } : {}),
    ...(typeof payload.apiId === "string" ? { apiId: payload.apiId } : {}),
    ...(typeof payload.apiName === "string" ? { apiName: payload.apiName } : {}),
    ...(typeof payload.resource === "string" ? { resource: payload.resource } : {}),
    ...(creditsRemaining === undefined ? {} : { creditsRemaining }),
    ...(creditsLimit === undefined ? {} : { creditsLimit }),
    ...(payload.rateLimit !== null &&
    typeof payload.rateLimit === "object" &&
    !Array.isArray(payload.rateLimit)
      ? { rateLimit: payload.rateLimit as Record<string, unknown> }
      : {}),
  };

  const retryAfter = numeric(payload.retryAfter) ?? numeric(response.headers.get("retry-after"));
  return retryAfter === undefined ? result : { ...result, retryAfter };
}

function verifyPayload(key: string, options: VerifyOptions): Record<string, unknown> {
  if (!key.trim()) {
    throw new ReqKeyConfigurationError("The consumer API key cannot be empty.");
  }
  const credits = options.credits ?? 1;
  if (!Number.isInteger(credits) || credits < 0) {
    throw new ReqKeyConfigurationError("credits must be a non-negative integer.");
  }
  return {
    key,
    credits,
    ...(options.apiId === undefined ? {} : { apiId: options.apiId }),
    ...(options.resource === undefined ? {} : { resource: options.resource }),
  };
}

function ingestPayload(options: IngestOptions): Record<string, unknown> {
  if (options.requestId !== undefined && !options.requestId.trim()) {
    throw new ReqKeyConfigurationError("requestId cannot be empty when provided.");
  }
  if (options.apiId !== undefined && !options.apiId.trim()) {
    throw new ReqKeyConfigurationError("apiId cannot be empty when provided.");
  }
  if (options.requestId === undefined && options.apiId === undefined) {
    throw new ReqKeyConfigurationError("Ingestion requires requestId, apiId, or both.");
  }

  const values: Record<string, unknown> = {
    requestId: options.requestId,
    apiId: options.apiId,
    method: options.method,
    endpoint: options.endpoint,
    path: options.path,
    statusCode: options.statusCode,
    latencyMs: options.latencyMs,
    clientIp: options.clientIp,
    userAgent: options.userAgent,
    userId: options.userId,
    consumerName: options.consumerName,
    apiKey: options.apiKey,
    consumerId: options.consumerId,
    queryParams: options.queryParams,
    requestHeaders: options.requestHeaders,
    responseHeaders: options.responseHeaders,
    requestBody: options.requestBody?.slice(0, MAX_BODY_CHARACTERS),
    responseBody: options.responseBody?.slice(0, MAX_BODY_CHARACTERS),
    timestamp:
      options.timestamp instanceof Date ? options.timestamp.toISOString() : options.timestamp,
  };

  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

export class ReqKey {
  readonly #config: ResolvedClientOptions;

  constructor(options: ReqKeyOptions) {
    this.#config = resolveOptions(options);
  }

  static fromEnv(options: Omit<ReqKeyOptions, "projectKey" | "rootKey"> = {}): ReqKey {
    const projectKey = process.env.REQKEY_PROJECT_KEY ?? process.env.REQKEY_ROOT_KEY;
    return new ReqKey({
      ...options,
      ...(projectKey === undefined ? {} : { projectKey }),
    });
  }

  async verify(key: string, options: VerifyOptions = {}): Promise<VerificationResult> {
    const response = await this.#post(
      "/key/validate",
      verifyPayload(key, options),
      "validation",
    );
    return verificationResult(response);
  }

  async ingest(options: IngestOptions): Promise<void> {
    const response = await this.#post("/ingest", ingestPayload(options), "ingestion");
    if (response.status !== 200 && response.status !== 202) {
      const body = await jsonObject(response);
      throw new ReqKeyAPIError(
        errorMessage(body, `ReqKey returned HTTP ${response.status}.`),
        { statusCode: response.status, body },
      );
    }
  }

  /** Present for lifecycle symmetry; the built-in fetch client owns no persistent resource. */
  close(): void {}

  async #post(
    path: string,
    body: Readonly<Record<string, unknown>>,
    operation: "validation" | "ingestion",
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#config.timeoutMs);

    try {
      return await this.#config.fetch(`${this.#config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.#config.projectKey}`,
          "Content-Type": "application/json",
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (cause) {
      if (controller.signal.aborted || isAbortError(cause)) {
        throw new ReqKeyTimeoutError(`The ReqKey ${operation} request timed out.`, {
          cause,
        });
      }
      throw new ReqKeyTransportError(`Could not reach ReqKey: ${errorText(cause)}`, {
        cause,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === "AbortError";
}

function errorText(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}
