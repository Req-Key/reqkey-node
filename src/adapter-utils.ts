import { MAX_BODY_CHARACTERS } from "./client.js";

const MAX_CAPTURE_BYTES = MAX_BODY_CHARACTERS * 4 + 4;

export class ResponseBodyCapture {
  readonly #enabled: boolean;
  readonly #chunks: Uint8Array[] = [];
  #size = 0;

  constructor(enabled: boolean) {
    this.#enabled = enabled;
  }

  add(value: unknown, encoding?: BufferEncoding): void {
    if (!this.#enabled || value === undefined || value === null || this.#size >= MAX_CAPTURE_BYTES) {
      return;
    }
    let bytes: Uint8Array;
    if (typeof value === "string") {
      bytes = Buffer.from(value, encoding);
    } else if (value instanceof Uint8Array) {
      bytes = value;
    } else {
      return;
    }
    const remaining = MAX_CAPTURE_BYTES - this.#size;
    const captured = bytes.subarray(0, remaining);
    this.#chunks.push(captured);
    this.#size += captured.byteLength;
  }

  text(headers: Headers): string | undefined {
    if (!this.#enabled || !isTextual(headers)) return undefined;
    const encoding = headers.get("content-encoding")?.toLowerCase();
    if (encoding && encoding !== "identity") return undefined;
    return Buffer.concat(this.#chunks.map((chunk) => Buffer.from(chunk)))
      .toString("utf8")
      .slice(0, MAX_BODY_CHARACTERS);
  }
}

export function isTextual(headers: Headers): boolean {
  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  return (
    !contentType ||
    contentType.includes("json") ||
    contentType.includes("text/") ||
    contentType.includes("xml") ||
    contentType.includes("javascript") ||
    contentType.includes("x-www-form-urlencoded")
  );
}

export function bodyFromValue(value: unknown, headers: Headers): string | undefined {
  if (!isTextual(headers)) return undefined;
  if (typeof value === "string") return value.slice(0, MAX_BODY_CHARACTERS);
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("utf8").slice(0, MAX_BODY_CHARACTERS);
  }
  if (value !== null && typeof value === "object" && !isReadableStream(value)) {
    try {
      return JSON.stringify(value).slice(0, MAX_BODY_CHARACTERS);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function isReadableStream(value: object): boolean {
  return "pipe" in value || "getReader" in value || Symbol.asyncIterator in value;
}
