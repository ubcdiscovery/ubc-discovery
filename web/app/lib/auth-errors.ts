import { ApiError } from "~/lib/api";

export const GOOGLE_SIGN_IN_FAILED = "Google sign-in could not be completed. Try again.";

const API_AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_OTP: "That code is incorrect. Check the email and try again.",
  OTP_EXPIRED: "That code has expired. Request a new code to continue.",
  TOO_MANY_ATTEMPTS: "Too many incorrect attempts. Request a new code to continue.",
  OTP_RATE_LIMITED: "Too many codes were requested. Wait 15 minutes before trying again.",
  OTP_DELIVERY_FAILED: "The sign-in email could not be sent. Try again shortly.",
  INVALID_EMAIL: "Enter a valid email address.",
};

export function authErrorMessage(error: unknown): string | null {
  if (error instanceof ApiError) {
    const message = error.code ? API_AUTH_ERROR_MESSAGES[error.code] : undefined;
    if (message) return message;
    if (error.status === 429) return "Too many attempts. Wait a few minutes and try again.";
    return error.status >= 500
      ? "The sign-in service is temporarily unavailable. Try again shortly."
      : "Sign-in could not be completed. Try again.";
  }
  if (error instanceof TypeError) {
    return "We could not reach the sign-in service. Check your connection and try again.";
  }
  return "Sign-in could not be completed. Try again.";
}
