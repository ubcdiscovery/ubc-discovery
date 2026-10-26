import { ApiError } from "~/lib/api";
import { FIREBASE_CONFIG_MISSING_MESSAGE } from "~/lib/firebase";

type AuthError = Error & { code?: string };

const API_AUTH_ERROR_MESSAGES: Record<string, string> = {
  OTP_INVALID: "That code is incorrect. Check the email and try again.",
  OTP_EXPIRED: "That code has expired. Request a new code to continue.",
  OTP_TOO_MANY_ATTEMPTS: "Too many incorrect attempts. Request a new code to continue.",
  OTP_RATE_LIMITED: "Too many codes were requested. Wait 15 minutes before trying again.",
  OTP_DELIVERY_FAILED: "The sign-in email could not be sent. Try again shortly.",
};

const FIREBASE_AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/popup-blocked":
    "Your browser blocked the Google sign-in window. Allow pop-ups and try again.",
};

const SILENT_FIREBASE_AUTH_ERRORS = new Set([
  "auth/popup-closed-by-user",
  "auth/cancelled-popup-request",
]);

export function authErrorMessage(error: unknown): string | null {
  const authError = error as AuthError;

  if (error instanceof ApiError) {
    const message = error.code ? API_AUTH_ERROR_MESSAGES[error.code] : undefined;
    return (
      message ??
      (error.status >= 500
        ? "The sign-in service is temporarily unavailable. Try again shortly."
        : "Sign-in could not be completed. Try again.")
    );
  }

  if (authError?.code && SILENT_FIREBASE_AUTH_ERRORS.has(authError.code)) {
    return null;
  }
  if (authError?.code && FIREBASE_AUTH_ERROR_MESSAGES[authError.code]) {
    return FIREBASE_AUTH_ERROR_MESSAGES[authError.code];
  }

  if (error instanceof TypeError) {
    return "We could not reach the sign-in service. Check your connection and try again.";
  }
  if (authError?.message === FIREBASE_CONFIG_MISSING_MESSAGE) {
    return "Sign-in is not configured for this deployment. Contact the site administrator.";
  }
  return "Sign-in could not be completed. Try again.";
}
