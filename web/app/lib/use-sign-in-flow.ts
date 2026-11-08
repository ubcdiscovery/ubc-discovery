import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { useAuth } from "~/lib/auth";
import { SIGN_IN_ERROR_PARAM } from "~/lib/auth-client";
import { authErrorMessage, GOOGLE_SIGN_IN_FAILED } from "~/lib/auth-errors";

const RESEND_COOLDOWN_MS = 30_000;

type SignInStep = "email" | "code";

type OtpSendResponse = {
  expires_in_seconds: number;
};

export function useSignInFlow() {
  const { sendSignInCode, signInWithCode, redirectToGoogleSignIn } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<SignInStep>("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(() =>
    searchParams.has(SIGN_IN_ERROR_PARAM) ? GOOGLE_SIGN_IN_FAILED : "",
  );
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [replacementNotice, setReplacementNotice] = useState(false);

  const secondsRemaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const resendSeconds = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));
  const codeExpired = step === "code" && secondsRemaining === 0;

  useEffect(() => {
    if (step !== "code") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [step]);

  function enterCodeStep(nextEmail: string, response: OtpSendResponse, isReplacement: boolean) {
    const sentAt = Date.now();
    setEmail(nextEmail);
    setCode("");
    setNow(sentAt);
    setExpiresAt(sentAt + response.expires_in_seconds * 1000);
    setResendAvailableAt(sentAt + RESEND_COOLDOWN_MS);
    setReplacementNotice(isReplacement);
    setStep("code");
  }

  async function sendOtp() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;

    setLoading(true);
    setError("");
    try {
      const response = await sendSignInCode(normalizedEmail);
      enterCodeStep(normalizedEmail, response, false);
    } catch (cause) {
      setError(authErrorMessage(cause) ?? "");
    } finally {
      setLoading(false);
    }
  }

  async function resendOtp() {
    if (loading || resendSeconds > 0) return;

    setLoading(true);
    setError("");
    try {
      const response = await sendSignInCode(email);
      enterCodeStep(email, response, true);
    } catch (cause) {
      setError(authErrorMessage(cause) ?? "");
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp() {
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await signInWithCode(email, code);
    } catch (cause) {
      setError(authErrorMessage(cause) ?? "");
    } finally {
      setLoading(false);
    }
  }

  function changeEmail() {
    setStep("email");
    setCode("");
    setError("");
    setReplacementNotice(false);
  }

  async function continueWithGoogle() {
    setLoading(true);
    setError("");
    try {
      await redirectToGoogleSignIn();
    } catch (cause) {
      setError(authErrorMessage(cause) ?? "");
      setLoading(false);
    }
  }

  return {
    changeEmail,
    code,
    codeExpired,
    continueWithGoogle,
    email,
    error,
    loading,
    replacementNotice,
    resendOtp,
    resendSeconds,
    secondsRemaining,
    sendOtp,
    setCode,
    setEmail,
    step,
    verifyOtp,
  };
}
