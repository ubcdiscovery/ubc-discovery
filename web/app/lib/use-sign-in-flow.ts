import { useEffect, useState } from "react";
import { api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { authErrorMessage } from "~/lib/auth-errors";
import { pendingGoogleLinkEmail } from "~/lib/firebase";

const RESEND_COOLDOWN_MS = 30_000;

type SignInStep = "email" | "code";

type OtpSendResponse = {
  expires_in_seconds: number;
};

export function useSignInFlow() {
  const { signInWithOtpToken, signInWithGoogle, firebaseReady, firebaseConfigError } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<SignInStep>("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
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

  function requireFirebaseReady() {
    if (!firebaseConfigError) return true;
    setError(firebaseConfigError);
    return false;
  }

  function enterCodeStep(
    nextEmail: string,
    response: OtpSendResponse,
    isReplacement: boolean,
  ) {
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
    if (!normalizedEmail || !requireFirebaseReady()) return;

    setLoading(true);
    setError("");
    try {
      const response = await api.auth.sendOtp(normalizedEmail);
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
      const response = await api.auth.sendOtp(email);
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
    if (!requireFirebaseReady()) return;

    setLoading(true);
    setError("");
    try {
      const response = await api.auth.verifyOtp(email, code);
      await signInWithOtpToken(response.firebase_custom_token);
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
    if (!requireFirebaseReady()) return;

    setLoading(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (cause) {
      const linkEmail = pendingGoogleLinkEmail(cause);
      if (!linkEmail) {
        setError(authErrorMessage(cause) ?? "");
        return;
      }

      try {
        const response = await api.auth.sendOtp(linkEmail);
        enterCodeStep(linkEmail, response, false);
        setError("Verify this email to connect Google to your existing account.");
      } catch (sendCause) {
        setError(authErrorMessage(sendCause) ?? "");
      }
    } finally {
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
    firebaseConfigError,
    firebaseReady,
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
