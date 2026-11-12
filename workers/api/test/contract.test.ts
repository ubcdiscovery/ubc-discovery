import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { createApp } from "../src/app";
import type { ApiEnv } from "../src/env";

interface Specification {
  paths: Record<string, Record<string, unknown>>;
}
const methods = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
function operations(specification: Specification) {
  return Object.entries(specification.paths)
    .flatMap(([path, values]) =>
      Object.keys(values)
        .filter((method) => methods.has(method))
        .map((method) => `${method.toUpperCase()} ${path}`),
    )
    .sort();
}

describe("Python API migration contract", () => {
  it("retains every existing REST method and path", async () => {
    const baseline: Specification = JSON.parse(
      readFileSync(join(import.meta.dirname, "fixtures/python-openapi.json"), "utf8"),
    );
    const response = await createApp({} as ApiEnv).handle(
      new Request("http://localhost/openapi.json"),
    );
    expect(response.status).toBe(200);
    const actual = operations((await response.json()) as Specification);
    const retired = [
      "POST /auth/otp/send",
      "POST /auth/otp/verify",
      "POST /auth/ubc-verify/send",
      "POST /auth/ubc-verify/confirm",
      // Scheduled recovery was removed: capture-ready and replay send to the Queue directly.
      "GET /extraction/recovery",
      "POST /extraction/dispatched",
    ];
    expect(
      operations(baseline).filter(
        (operation) => !actual.includes(operation) && !retired.includes(operation),
      ),
    ).toEqual([]);
  });
});
