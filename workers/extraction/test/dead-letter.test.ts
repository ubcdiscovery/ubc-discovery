import { describe, expect, it } from "vite-plus/test";
import { consume } from "../src/index";
import { first, environment, message, batch, json, aiRun, httpMock } from "./fixtures";

describe("terminal reporting", () => {
  it("marks exhausted processing terminal before allowing Cloudflare to dead-letter", async () => {
    const a = message(first, 5),
      http = httpMock();
    http.mockResolvedValueOnce(json({}, 503)).mockResolvedValueOnce(json({ status: "terminal" }));
    await consume(batch([a]), environment(), http);
    expect(String(http.mock.calls[1][0])).toContain("/terminal");
    expect(a.retry).toHaveBeenCalledOnce();
    expect(a.ack).not.toHaveBeenCalled();
  });

  it("durably records dead-letter failure without invoking AI", async () => {
    const a = message(first),
      env = environment(),
      http = httpMock();
    http.mockResolvedValueOnce(json({ status: "terminal" }));
    await consume(batch([a], "ubc-discovery-extraction-dlq"), env, http);
    expect(http).toHaveBeenCalledOnce();
    expect(aiRun(env)).not.toHaveBeenCalled();
    expect(String(http.mock.calls[0][0])).toContain("/terminal");
    expect(JSON.parse(http.mock.calls[0][1]!.body as string).generation).toBe(1);
    expect(a.ack).toHaveBeenCalledOnce();
  });

  it("leaves the DLQ message pending if terminal reporting fails", async () => {
    const a = message(first),
      http = httpMock();
    http.mockRejectedValueOnce(new Error("API unavailable"));
    await consume(batch([a], "ubc-discovery-extraction-dlq"), environment(), http);
    expect(a.ack).not.toHaveBeenCalled();
    expect(a.retry).toHaveBeenCalledWith({ delaySeconds: 600 });
  });
});
