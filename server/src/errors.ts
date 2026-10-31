// Error type for endpoint failures; Hono's onError only honors Error
// instances, so {status, detail} plain objects must be classed.
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, detail: string) {
    super(detail);
    this.name = "HttpError";
    this.status = status;
  }
}

export function fail(status: number, detail: string): never {
  throw new HttpError(status, detail);
}
