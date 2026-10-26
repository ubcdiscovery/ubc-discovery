import { describe, expect, it, vi } from "vite-plus/test";
import type { ApiEnv } from "../src/env";
import { EmailDeliveryError, otpEmail, sendOtpEmail } from "../src/services/email";

const env = {
  AWS_ACCESS_KEY_ID: "example",
  AWS_SECRET_ACCESS_KEY: "example",
  AWS_REGION: "us-west-2",
  EMAIL_SENDER_EMAIL: "hello@example.com",
  OTP_EXPIRY_MINUTES: "10",
} as ApiEnv;

describe("SES OTP delivery", () => {
  it("preserves the existing email content and exact SES v2 JSON contract", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ MessageId: "accepted" }));
    await sendOtpEmail(env, "member@example.com", "123456", fetcher);
    const request = fetcher.mock.calls[0]![0] as Request;
    expect(request.url).toBe("https://email.us-west-2.amazonaws.com/v2/email/outbound-emails");
    const body = (await request.json()) as {
      FromEmailAddress: string;
      Destination: unknown;
      Content: { Simple: { Subject: unknown; Body: { Text: unknown; Html: { Data: string } } } };
    };
    expect(body.FromEmailAddress).toBe("hello@example.com");
    expect(body.Destination).toEqual({ ToAddresses: ["member@example.com"] });
    expect(body.Content.Simple.Subject).toEqual({
      Data: "Your UBC Discovery verification code: 123456",
      Charset: "UTF-8",
    });
    expect(body.Content.Simple.Body.Text).toEqual({
      Data: "Your verification code is: 123456\n\nThis code expires in 10 minutes.",
      Charset: "UTF-8",
    });
    expect(body.Content.Simple.Body.Html.Data).toContain(
      '<span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #007AFF;">123456</span>',
    );
  });
  it("does not retry rejection or expose provider diagnostics", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ Message: "private provider data" }, { status: 429 }));
    await expect(sendOtpEmail(env, "member@example.com", "123456", fetcher)).rejects.toThrow(
      EmailDeliveryError,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects malformed OTP content before creating HTML", () => {
    expect(() => otpEmail("member@example.com", "<script>")).toThrow("Invalid OTP code");
  });
});
