import { useEffect, useRef } from "react";
import { FcGoogle } from "react-icons/fc";
import { useSignInFlow } from "~/lib/use-sign-in-flow";

export function SignInForm() {
  const flow = useSignInFlow();
  const emailInput = useRef<HTMLInputElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (flow.step === "code") {
        codeInput.current?.focus();
      } else {
        emailInput.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [flow.step]);

  return (
    <div className="mt-6 flex flex-col gap-2.5 md:mt-7 md:gap-3.5">
      {flow.step === "email" ? (
        <>
          <button
            type="button"
            onClick={flow.continueWithGoogle}
            disabled={flow.loading || !flow.firebaseReady}
            className="flex cursor-pointer items-center justify-center gap-2.5 border border-ink bg-bg py-3.5 font-mono text-xs font-bold uppercase tracking-wider text-ink disabled:opacity-50 md:tracking-wide"
          >
            <FcGoogle aria-hidden="true" size={14} />
            Continue with Google
          </button>

          <div className="my-1.5 text-center font-mono text-xs uppercase tracking-wider text-muted md:my-1 md:flex md:items-center md:gap-2.5">
            <span className="hidden h-px flex-1 bg-rule-soft md:block" />
            <span className="md:hidden">- </span>
            or
            <span className="md:hidden"> -</span>
            <span className="hidden h-px flex-1 bg-rule-soft md:block" />
          </div>

          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              void flow.sendOtp();
            }}
          >
            <div className="contents md:block">
              <label
                htmlFor="auth-email"
                className="font-mono text-xs uppercase tracking-wide text-muted md:mb-1.5 md:block md:tracking-wider"
              >
                Email
              </label>
              <input
                ref={emailInput}
                id="auth-email"
                data-auth-email
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="you@anywhere.com"
                value={flow.email}
                onChange={(event) => flow.setEmail(event.target.value)}
                className="border border-ink bg-surface px-3.5 py-3 font-mono text-base text-ink outline-none md:w-full md:px-3 md:py-2.5 md:font-body md:text-sm md:placeholder:text-transparent"
              />
            </div>
            <div className="hidden text-xs text-muted md:block">
              We&rsquo;ll send you a sign-in code.
            </div>
            <div className="contents md:mt-3 md:flex md:justify-end md:border-t md:border-rule-soft md:pt-5">
              <button
                type="submit"
                disabled={flow.loading}
                className="cursor-pointer border border-accent bg-accent py-3.5 font-mono text-xs font-bold uppercase tracking-wider text-on-color disabled:opacity-50 md:px-6 md:py-3 md:tracking-wide"
              >
                <span className="md:hidden">
                  {flow.loading ? "Sending..." : "Send sign-in code →"}
                </span>
                <span className="hidden md:inline">
                  {flow.loading ? "Sending..." : "Continue with email →"}
                </span>
              </button>
            </div>
          </form>
        </>
      ) : (
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void flow.verifyOtp();
          }}
        >
          <p className="text-sm text-ink-soft">
            Enter the code sent to <strong className="text-ink">{flow.email}</strong>.
          </p>
          <div className="contents md:block">
            <label
              htmlFor="auth-code"
              className="font-mono text-xs uppercase tracking-wide text-muted md:mb-1.5 md:block md:tracking-wider"
            >
              Verification code
            </label>
            <input
              ref={codeInput}
              id="auth-code"
              data-auth-code
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              required
              placeholder="123456"
              value={flow.code}
              onChange={(event) =>
                flow.setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              className="border border-ink bg-surface px-3.5 py-3 text-center font-mono text-base tracking-otp text-ink outline-none md:w-full md:px-3 md:py-2.5 md:text-lg"
            />
          </div>
          {flow.codeExpired ? (
            <p role="alert" className="font-mono text-xs text-muted">
              This code has expired. Request a new one.
            </p>
          ) : (
            <p className="font-mono text-xs text-muted">
              Code expires in {Math.floor(flow.secondsRemaining / 60)}:
              {String(flow.secondsRemaining % 60).padStart(2, "0")}.
            </p>
          )}
          {flow.replacementNotice && (
            <p role="status" className="text-xs text-ink-soft">
              A new code was sent. Earlier codes no longer work.
            </p>
          )}
          <div className="contents md:mt-3 md:flex md:items-center md:justify-between md:border-t md:border-rule-soft md:pt-5">
            <button
              type="button"
              onClick={flow.changeEmail}
              className="order-2 cursor-pointer border-none bg-transparent font-mono text-xs uppercase tracking-wide text-muted md:order-1 md:font-bold"
            >
              ← Change email
            </button>
            <div className="contents md:order-2 md:flex md:items-center md:gap-4">
              <button
                type="button"
                onClick={flow.resendOtp}
                disabled={flow.loading || flow.resendSeconds > 0}
                className="order-1 cursor-pointer border-none bg-transparent font-mono text-xs font-bold uppercase tracking-wide text-accent disabled:cursor-not-allowed disabled:text-muted md:order-1"
              >
                {flow.resendSeconds > 0 ? (
                  <>
                    <span className="md:hidden">Resend code in {flow.resendSeconds}s</span>
                    <span className="hidden md:inline">Resend in {flow.resendSeconds}s</span>
                  </>
                ) : (
                  "Resend code"
                )}
              </button>
              <button
                type="submit"
                disabled={flow.loading || flow.codeExpired || flow.code.length !== 6}
                className="order-first cursor-pointer border border-accent bg-accent py-3.5 font-mono text-xs font-bold uppercase tracking-wider text-on-color disabled:opacity-50 md:order-2 md:px-6 md:py-3 md:tracking-wide"
              >
                {flow.loading ? "Verifying..." : "Verify →"}
              </button>
            </div>
          </div>
        </form>
      )}

      {flow.error && (
        <p role="alert" className="font-mono text-xs text-danger">
          {flow.error}
        </p>
      )}
      {flow.firebaseConfigError && !flow.error && (
        <p role="alert" className="font-mono text-xs text-danger">
          {flow.firebaseConfigError}
        </p>
      )}
    </div>
  );
}
