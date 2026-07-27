import { useEffect, useState } from "react";
import { FcGoogle } from "react-icons/fc";
import { Link } from "react-router";
import { api } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { authErrorMessage } from "~/lib/auth-errors";
import { pendingGoogleLinkEmail } from "~/lib/firebase";

export function meta() {
  return [{ title: "Sign In — UBC Discovery" }];
}

function FirebaseConfigWarning({ message }: { message: string }) {
  return <p className="text-xs text-[#D63A2E] font-mono">{message}</p>;
}

export default function SignIn() {
  const {
    signInWithOtpToken,
    signInWithGoogle,
    firebaseReady,
    firebaseConfigError,
  } = useAuth();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [replacementNotice, setReplacementNotice] = useState(false);
  const secondsRemaining = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const resendSeconds = Math.max(0, Math.ceil((resendAvailableAt - now) / 1000));
  const codeExpired = step === "code" && secondsRemaining === 0;

  function focusVisible(selector: string) {
    window.requestAnimationFrame(() => {
      const input = Array.from(document.querySelectorAll<HTMLInputElement>(selector))
        .find((element) => element.offsetParent !== null);
      input?.focus();
    });
  }

  useEffect(() => {
    if (step !== "code") return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [step]);

  useEffect(() => {
    focusVisible(step === "code" ? "[data-auth-code]" : "[data-auth-email]");
  }, [step]);

  function requireFirebaseReady() {
    if (!firebaseConfigError) return true;
    setError(firebaseConfigError);
    return false;
  }

  async function handleSendOtp(event: React.FormEvent) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    if (!requireFirebaseReady()) return;
    setEmail(normalizedEmail);
    setLoading(true);
    setError("");
    try {
      const response = await api.auth.sendOtp(normalizedEmail);
      const sentAt = Date.now();
      setNow(sentAt);
      setExpiresAt(sentAt + response.expires_in_seconds * 1000);
      setResendAvailableAt(sentAt + 30_000);
      setReplacementNotice(false);
      setStep("code");
    } catch (e: any) {
      setError(authErrorMessage(e) ?? "");
    } finally {
      setLoading(false);
    }
  }

  async function handleResendOtp() {
    if (loading || resendSeconds > 0) return;
    setLoading(true);
    setError("");
    try {
      const response = await api.auth.sendOtp(email);
      const sentAt = Date.now();
      setNow(sentAt);
      setExpiresAt(sentAt + response.expires_in_seconds * 1000);
      setResendAvailableAt(sentAt + 30_000);
      setCode("");
      setReplacementNotice(true);
    } catch (e: any) {
      setError(authErrorMessage(e) ?? "");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the six-digit code from your email.");
      focusVisible("[data-auth-code]");
      return;
    }
    if (!requireFirebaseReady()) return;
    setLoading(true);
    setError("");
    try {
      const res = await api.auth.verifyOtp(email, code);
      await signInWithOtpToken(res.firebase_custom_token);
    } catch (e: any) {
      setError(authErrorMessage(e) ?? "");
    } finally {
      setLoading(false);
    }
  }

  function handleChangeEmail() {
    setStep("email");
    setCode("");
    setError("");
    setReplacementNotice(false);
    focusVisible("[data-auth-email]");
  }

  async function handleGoogleSignIn() {
    if (!requireFirebaseReady()) return;
    setLoading(true);
    setError("");
    try {
      await signInWithGoogle();
    } catch (e: any) {
      const linkEmail = pendingGoogleLinkEmail(e);
      if (linkEmail) {
        setEmail(linkEmail);
        try {
          const response = await api.auth.sendOtp(linkEmail);
          const sentAt = Date.now();
          setNow(sentAt);
          setExpiresAt(sentAt + response.expires_in_seconds * 1000);
          setResendAvailableAt(sentAt + 30_000);
          setStep("code");
          setError(
            "Verify this email to connect Google to your existing account."
          );
        } catch (sendError) {
          setError(authErrorMessage(sendError) ?? "");
        }
      } else {
        setError(authErrorMessage(e) ?? "");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg text-ink font-body">
      {/* Mobile */}
      <div className="md:hidden">
        <div className="border-b-2 border-ink">
          <div className="px-4.5 py-2 flex items-baseline gap-2">
            <Link to="/" className="flex items-baseline gap-2">
              <span className="px-1.5 py-0.5 bg-ink text-bg font-mono text-xs font-bold tracking-wider">
                UBC
              </span>
              <span className="font-display text-lg font-bold text-ink tracking-tight">
                DISCOVERY
              </span>
            </Link>
          </div>
        </div>

        <div className="px-5.5 pt-7">
          <div className="font-mono text-xs text-accent font-bold tracking-wider uppercase">
            Join UBC Discovery
          </div>
          <h1 className="mt-2 font-display font-extrabold text-5xl text-ink tracking-tighter leading-[0.92]">
            Sign in
            <br />
            to make it
            <br />
            yours.
          </h1>
          <p className="mt-3.5 text-sm/relaxed text-ink-soft">
            Save events. Rate them. Unlock the re-ranked For You feed.
          </p>

          <div className="mt-6 flex flex-col gap-2.5">
            {step === "email" ? (
              <>
                <button
                  onClick={handleGoogleSignIn}
                  disabled={loading || !firebaseReady}
                  className="py-3.5 border border-ink bg-bg text-ink cursor-pointer flex items-center justify-center gap-2.5 font-mono text-xs font-bold tracking-wider uppercase disabled:opacity-50"
                >
                  <FcGoogle aria-hidden="true" size={14} />
                  CONTINUE WITH GOOGLE
                </button>
                <div className="font-mono text-xs text-muted tracking-wider uppercase my-1.5 text-center">
                  — OR —
                </div>
                <form className="contents" onSubmit={handleSendOtp} noValidate={false}>
                  <label htmlFor="mobile-auth-email" className="font-mono text-xs text-muted tracking-wide uppercase">
                    EMAIL
                  </label>
                  <input
                    id="mobile-auth-email"
                    data-auth-email
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    placeholder="you@anywhere.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="px-3.5 py-3 border border-ink bg-surface font-mono text-base text-ink outline-none"
                  />
                  <button
                    type="submit"
                    disabled={loading}
                    className="py-3.5 border border-accent bg-accent text-white cursor-pointer font-mono text-xs font-bold tracking-wider uppercase disabled:opacity-50"
                  >
                    {loading ? "SENDING..." : "SEND SIGN-IN CODE →"}
                  </button>
                </form>
              </>
            ) : (
              <form className="contents" onSubmit={handleVerifyOtp}>
                <p className="text-sm text-ink-soft">
                  Enter the code sent to <strong className="text-ink">{email}</strong>.
                </p>
                <label htmlFor="mobile-auth-code" className="font-mono text-xs text-muted tracking-wide uppercase">
                  VERIFICATION CODE
                </label>
                <input
                  id="mobile-auth-code"
                  data-auth-code
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  required
                  placeholder="123456"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="px-3.5 py-3 border border-ink bg-surface font-mono text-base text-ink outline-none tracking-[0.5em] text-center"
                />
                <p className="font-mono text-xs text-muted">
                  {codeExpired
                    ? "This code has expired. Request a new one."
                    : `Code expires in ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}.`}
                </p>
                {replacementNotice && (
                  <p className="text-xs text-ink-soft">
                    A new code was sent. Earlier codes no longer work.
                  </p>
                )}
                <button
                  type="submit"
                  disabled={loading || codeExpired || code.length !== 6}
                  className="py-3.5 border border-accent bg-accent text-white cursor-pointer font-mono text-xs font-bold tracking-wider uppercase disabled:opacity-50"
                >
                  {loading ? "VERIFYING..." : "VERIFY →"}
                </button>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={loading || resendSeconds > 0}
                  className="font-mono text-xs text-accent font-bold tracking-wide uppercase bg-transparent border-none cursor-pointer disabled:text-muted disabled:cursor-not-allowed"
                >
                  {resendSeconds > 0 ? `Resend code in ${resendSeconds}s` : "Resend code"}
                </button>
                <button
                  type="button"
                  onClick={handleChangeEmail}
                  className="font-mono text-xs text-muted tracking-wide uppercase bg-transparent border-none cursor-pointer"
                >
                  ← Change email
                </button>
              </form>
            )}

            {error && (
              <p className="text-xs text-[#D63A2E] font-mono">{error}</p>
            )}
            {firebaseConfigError && !error && (
              <FirebaseConfigWarning message={firebaseConfigError} />
            )}
          </div>

          <div className="mt-7 p-3 border border-dashed border-ink text-xs/relaxed text-muted">
            An independent student project for the UBC community. Not affiliated
            with UBC.
          </div>
        </div>
      </div>

      {/* Desktop — split layout */}
      <div className="hidden md:grid grid-cols-[5fr_7fr] min-h-screen">
        <aside className="bg-ink text-bg p-8 flex flex-col relative overflow-hidden">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="size-7.5 bg-bg text-ink flex items-center justify-center font-display font-extrabold text-sm tracking-tight">
              UBC
            </div>
            <span className="font-display font-extrabold text-xl tracking-tight">
              DISCOVERY
            </span>
          </Link>

          <h2 className="mt-10 font-display font-extrabold text-6xl text-bg tracking-tighter leading-none">
            One place.
            <br />
            Every event on campus.
          </h2>
          <p className="mt-3.5 text-base/relaxed text-bg opacity-70 max-w-95">
            UBC Discovery pulls events from official UBC channels, AMS clubs,
            and community organizers — filterable by what you&rsquo;re into.
          </p>

          <div className="mt-auto pt-6 font-mono text-xs text-bg opacity-50 tracking-wide uppercase">
            You can change all of this on your profile later
          </div>
        </aside>

        <main className="p-8 px-14 flex flex-col">
          <div className="flex-1 max-w-130">
            <div className="font-mono text-xs text-accent font-bold tracking-wide uppercase">
              Sign in
            </div>
            <h1 className="my-2 font-display font-extrabold text-5xl text-ink tracking-tighter leading-none">
              Sign in to save events,
              <br />
              rate them, and tune your feed.
            </h1>

            <div className="mt-7 flex flex-col gap-3.5">
              {step === "email" ? (
                <>
                  <button
                    onClick={handleGoogleSignIn}
                    disabled={loading || !firebaseReady}
                    className="py-3.5 border border-ink bg-bg text-ink cursor-pointer flex items-center justify-center gap-2.5 font-mono text-xs font-bold tracking-wide uppercase disabled:opacity-50"
                  >
                    <FcGoogle aria-hidden="true" size={14} />
                    Continue with Google
                  </button>

                  <div className="font-mono text-xs text-muted tracking-wider uppercase my-1 text-center flex items-center gap-2.5">
                    <span className="flex-1 h-px bg-rule-soft" />
                    or
                    <span className="flex-1 h-px bg-rule-soft" />
                  </div>
                  <form className="contents" onSubmit={handleSendOtp}>
                    <div>
                      <label htmlFor="desktop-auth-email" className="font-mono text-xs text-muted tracking-wider uppercase mb-1.5 block">
                        Email
                      </label>
                      <input
                        id="desktop-auth-email"
                        data-auth-email
                        type="email"
                        inputMode="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3 py-2.5 border border-ink bg-surface font-body text-sm text-ink outline-none"
                      />
                    </div>
                    <div className="text-xs text-muted">
                      We&rsquo;ll send you a sign-in code.
                    </div>
                    <div className="flex justify-end mt-3 pt-5 border-t border-rule-soft">
                      <button
                        type="submit"
                        disabled={loading}
                        className="px-6 py-3 border border-accent bg-accent text-white cursor-pointer font-mono text-xs font-bold tracking-wide uppercase disabled:opacity-50"
                      >
                        {loading ? "Sending..." : "Continue with email →"}
                      </button>
                    </div>
                  </form>
                </>
              ) : (
                <form className="contents" onSubmit={handleVerifyOtp}>
                  <p className="text-sm text-ink-soft">
                    Enter the code sent to <strong className="text-ink">{email}</strong>.
                  </p>
                  <div>
                    <label htmlFor="desktop-auth-code" className="font-mono text-xs text-muted tracking-wider uppercase mb-1.5 block">
                      Verification code
                    </label>
                    <input
                      id="desktop-auth-code"
                      data-auth-code
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      required
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="w-full px-3 py-2.5 border border-ink bg-surface font-mono text-lg text-ink outline-none tracking-[0.5em] text-center"
                    />
                  </div>
                  <p className="font-mono text-xs text-muted">
                    {codeExpired
                      ? "This code has expired. Request a new one."
                      : `Code expires in ${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, "0")}.`}
                  </p>
                  {replacementNotice && (
                    <p className="text-xs text-ink-soft">
                      A new code was sent. Earlier codes no longer work.
                    </p>
                  )}
                  <div className="flex justify-between items-center mt-3 pt-5 border-t border-rule-soft">
                    <button
                      type="button"
                      onClick={handleChangeEmail}
                      className="font-mono text-xs text-muted font-bold tracking-wide uppercase bg-transparent border-none cursor-pointer"
                    >
                      ← Change email
                    </button>
                    <div className="flex items-center gap-4">
                      <button
                        type="button"
                        onClick={handleResendOtp}
                        disabled={loading || resendSeconds > 0}
                        className="font-mono text-xs text-accent font-bold tracking-wide uppercase bg-transparent border-none cursor-pointer disabled:text-muted disabled:cursor-not-allowed"
                      >
                        {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                      </button>
                      <button
                        type="submit"
                        disabled={loading || codeExpired || code.length !== 6}
                        className="px-6 py-3 border border-accent bg-accent text-white cursor-pointer font-mono text-xs font-bold tracking-wide uppercase disabled:opacity-50"
                      >
                        {loading ? "Verifying..." : "Verify →"}
                      </button>
                    </div>
                  </div>
                </form>
              )}

              {error && (
                <p className="text-xs text-[#D63A2E] font-mono">{error}</p>
              )}
              {firebaseConfigError && !error && (
                <FirebaseConfigWarning message={firebaseConfigError} />
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
