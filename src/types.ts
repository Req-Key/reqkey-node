export const VerificationReason = {
  VALID: "valid",
  INVALID_KEY: "invalid_key",
  INSUFFICIENT_CREDITS: "insufficient_credits",
  FORBIDDEN: "forbidden",
  RATE_LIMITED: "rate_limited",
  DENIED: "denied",
} as const;

export type VerificationReason =
  (typeof VerificationReason)[keyof typeof VerificationReason];

export interface VerificationResult {
  readonly valid: boolean;
  readonly allowed: boolean;
  readonly reason: VerificationReason;
  readonly statusCode: number;
  readonly requestId?: string;
  readonly message?: string;
  readonly apiId?: string;
  readonly apiName?: string;
  readonly resource?: string;
  readonly creditsRemaining?: number;
  readonly creditsLimit?: number;
  readonly allowedApis: readonly string[];
  readonly retryAfter?: number;
  readonly rateLimit?: Readonly<Record<string, unknown>>;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface VerifyOptions {
  apiId?: string;
  credits?: number;
  resource?: string;
}

export interface IngestOptions {
  requestId?: string;
  apiId?: string;
  method?: string;
  endpoint?: string;
  path?: string;
  statusCode?: number;
  latencyMs?: number;
  clientIp?: string;
  userAgent?: string;
  userId?: string;
  consumerName?: string;
  apiKey?: string;
  consumerId?: string;
  queryParams?: Readonly<Record<string, unknown>>;
  requestHeaders?: Readonly<Record<string, string>>;
  responseHeaders?: Readonly<Record<string, string>>;
  requestBody?: string;
  responseBody?: string;
  timestamp?: Date | string;
}

export type ReqKeyFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface ReqKeyOptions {
  projectKey?: string | undefined;
  /** Backward-compatible alias for `projectKey`. Do not pass both. */
  rootKey?: string | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  /** Injectable fetch implementation, primarily for custom runtimes and tests. */
  fetch?: ReqKeyFetch | undefined;
}

export interface ReqKeyClient {
  verify(key: string, options?: VerifyOptions): Promise<VerificationResult>;
  ingest(options: IngestOptions): Promise<void>;
}
