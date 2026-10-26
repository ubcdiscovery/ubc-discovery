export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: unknown,
  ) {
    super(typeof detail === "string" ? detail : "API request failed");
    this.name = "ApiError";
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiError)
    return Response.json({ detail: error.detail }, { status: error.status });
  // Do not expose provider responses, SQL parameters, tokens, or credentials.
  return Response.json({ detail: "Internal Server Error" }, { status: 500 });
}
