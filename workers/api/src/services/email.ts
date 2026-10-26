import { integerSetting, type ApiEnv } from "../env";
import { awsRequest, readBoundedBytes, type Fetcher } from "./aws";

export interface OutboundEmail {
  to: readonly string[];
  subject: string;
  text: string;
  html: string;
}

export class EmailDeliveryError extends Error {
  constructor() {
    super("SES rejected the email");
    this.name = "EmailDeliveryError";
  }
}

export function otpEmail(toEmail: string, otpCode: string, expiryMinutes = 10): OutboundEmail {
  if (!/^\d{6}$/.test(otpCode)) throw new Error("Invalid OTP code");
  const expiryMessage = `This code expires in ${expiryMinutes} minutes.`;
  return {
    to: [toEmail],
    subject: `Your UBC Discovery verification code: ${otpCode}`,
    text: `Your verification code is: ${otpCode}\n\n${expiryMessage}`,
    html: `<html>
<body style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
  <h2 style="color: #007AFF; margin-bottom: 8px;">UBC Discovery</h2>
  <p style="color: #333; font-size: 16px;">Your verification code is:</p>
  <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #007AFF;">${otpCode}</span>
  </div>
  <p style="color: #666; font-size: 14px;">${expiryMessage}</p>
  <p style="color: #999; font-size: 12px;">If you didn't request this code, you can safely ignore this email.</p>
</body>
</html>`,
  };
}

export async function sendEmail(
  env: ApiEnv,
  message: OutboundEmail,
  fetcher: Fetcher = fetch,
): Promise<string> {
  if (!env.EMAIL_SENDER_EMAIL) throw new EmailDeliveryError();
  try {
    const response = await awsRequest(
      env,
      "ses",
      `https://email.${env.AWS_REGION || "us-west-2"}.amazonaws.com/v2/email/outbound-emails`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          FromEmailAddress: env.EMAIL_SENDER_EMAIL,
          Destination: { ToAddresses: message.to },
          Content: {
            Simple: {
              Subject: { Data: message.subject, Charset: "UTF-8" },
              Body: {
                Text: { Data: message.text, Charset: "UTF-8" },
                Html: { Data: message.html, Charset: "UTF-8" },
              },
            },
          },
        }),
      },
      fetcher,
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new EmailDeliveryError();
    }
    const body: unknown = JSON.parse(
      new TextDecoder().decode(await readBoundedBytes(response.body, 64 * 1024)),
    );
    if (
      typeof body !== "object" ||
      body === null ||
      !("MessageId" in body) ||
      typeof body.MessageId !== "string" ||
      !body.MessageId
    ) {
      throw new EmailDeliveryError();
    }
    return body.MessageId;
  } catch {
    throw new EmailDeliveryError();
  }
}

export async function sendOtpEmail(
  env: ApiEnv,
  toEmail: string,
  otpCode: string,
  fetcher: Fetcher = fetch,
): Promise<void> {
  await sendEmail(
    env,
    otpEmail(toEmail, otpCode, integerSetting(env.OTP_EXPIRY_MINUTES, 10)),
    fetcher,
  );
}
