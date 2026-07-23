/** Base class for all errors raised by the ReqKey SDK. */
export class ReqKeyError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** Raised when the SDK is configured with invalid values. */
export class ReqKeyConfigurationError extends ReqKeyError {}

/** Raised when ReqKey cannot be reached. */
export class ReqKeyTransportError extends ReqKeyError {}

/** Raised when a request to ReqKey exceeds its configured timeout. */
export class ReqKeyTimeoutError extends ReqKeyTransportError {}

/** Raised when ReqKey returns a response that is not an access decision. */
export class ReqKeyAPIError extends ReqKeyError {
  readonly statusCode: number;
  readonly body: Readonly<Record<string, unknown>>;

  constructor(
    message: string,
    options: {
      statusCode: number;
      body?: Readonly<Record<string, unknown>>;
      cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.statusCode = options.statusCode;
    this.body = options.body ?? {};
  }
}

/** Raised when the project credential is missing, invalid, or expired. */
export class ReqKeyAuthenticationError extends ReqKeyAPIError {}
