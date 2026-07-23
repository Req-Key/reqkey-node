import {
  VerificationReason,
  type IngestOptions,
  type ReqKeyClient,
  type VerificationResult,
  type VerifyOptions,
} from "../src/index.js";

export class FakeReqKey implements ReqKeyClient {
  result: VerificationResult | Error;
  readonly verifyCalls: Array<{ key: string; options: VerifyOptions }> = [];
  readonly ingestCalls: IngestOptions[] = [];
  ingestDelayMs = 0;

  constructor(result: VerificationResult | Error = allowedResult()) {
    this.result = result;
  }

  async verify(key: string, options: VerifyOptions = {}): Promise<VerificationResult> {
    this.verifyCalls.push({ key, options });
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }

  async ingest(options: IngestOptions): Promise<void> {
    if (this.ingestDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.ingestDelayMs));
    }
    this.ingestCalls.push(options);
  }
}

export function allowedResult(): VerificationResult {
  return {
    valid: true,
    allowed: true,
    reason: VerificationReason.VALID,
    statusCode: 200,
    requestId: "request_123",
    creditsRemaining: 99,
    creditsLimit: 100,
    allowedApis: ["payments"],
    raw: { valid: true },
  };
}

export function deniedResult(
  reason: VerificationResult["reason"],
  statusCode: number,
  retryAfter?: number,
): VerificationResult {
  return {
    valid: false,
    allowed: false,
    reason,
    statusCode,
    allowedApis: [],
    raw: { valid: false },
    ...(retryAfter === undefined ? {} : { retryAfter }),
  };
}
