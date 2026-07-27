import { Link } from "react-router";

export function OnboardingTop({
  step,
  total,
  onBack,
}: {
  step: number;
  total: number;
  onBack?: () => void;
}) {
  return (
    <div className="px-4.5 py-4 flex items-center justify-between border-b border-rule-soft md:hidden">
      <button
        onClick={onBack}
        className={`bg-transparent border-none cursor-pointer font-mono text-[11px] font-bold tracking-wide uppercase p-0 ${
          step > 1 ? "text-ink" : "text-transparent"
        }`}
      >
        ← Back
      </button>
      <div className="flex items-center gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1 transition-all ${i < step ? "w-6 bg-accent" : "w-4 bg-rule-soft"}`}
          />
        ))}
      </div>
      <span className="font-mono text-[10.5px] text-muted tracking-wide uppercase">
        Step {step}/{total}
      </span>
    </div>
  );
}

export function OnboardingFooter({
  canContinue,
  onSkip,
  onContinue,
  ctaLabel = "Continue",
  detail,
}: {
  canContinue: boolean;
  onSkip?: () => void;
  onContinue: () => void;
  ctaLabel?: string;
  detail?: string;
}) {
  return (
    <div className="fixed bottom-0 inset-x-0 px-4.5 py-3.5 pb-7 bg-bg border-t border-rule-soft flex flex-col gap-2 md:hidden z-50">
      {detail && (
        <div className="font-mono text-[10px] text-muted tracking-wide uppercase text-center">
          {detail}
        </div>
      )}
      <div className="flex gap-2">
        {onSkip && (
          <button
            onClick={onSkip}
            className="px-4 py-3 border border-ink bg-transparent text-ink cursor-pointer font-mono text-[11px] font-bold tracking-wide uppercase"
          >
            Skip
          </button>
        )}
        <button
          onClick={onContinue}
          disabled={!canContinue}
          className={`flex-1 py-3 px-4 border font-mono text-[11px] font-bold tracking-wide uppercase ${
            canContinue
              ? "border-accent bg-accent text-white cursor-pointer"
              : "border-rule-soft bg-rule-soft text-muted cursor-not-allowed"
          }`}
        >
          {ctaLabel} →
        </button>
      </div>
    </div>
  );
}

export function OnboardingDesktopShell({
  step,
  total,
  kicker,
  title,
  subtitle,
  sideTitle = (
    <>
      Welcome.
      <br />
      Let&rsquo;s set you up.
    </>
  ),
  sideBody = "This takes about a minute. We use what you tell us to rank your For you feed.",
  canContinue,
  ctaLabel = "Continue",
  onContinue,
  onBack,
  onSkip,
  children,
}: {
  step: number;
  total: number;
  kicker: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  sideTitle?: React.ReactNode;
  sideBody?: string;
  canContinue: boolean;
  ctaLabel?: string;
  onContinue: () => void;
  onBack?: () => void;
  onSkip?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="hidden md:grid grid-cols-[5fr_7fr] min-h-screen bg-bg text-ink font-body">
      <aside className="bg-ink text-bg p-8 flex flex-col relative overflow-hidden">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="size-7.5 bg-bg text-ink flex items-center justify-center font-display font-extrabold text-sm tracking-tight">
            UBC
          </div>
          <span className="font-display font-extrabold text-xl tracking-tight">
            DISCOVERY
          </span>
        </Link>

        <div className="mt-10 font-mono text-[11px] text-bg opacity-60 tracking-wide uppercase">
          Step {step} of {total}
        </div>
        <div className="flex gap-1 mt-2">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={`flex-1 h-1 ${i < step ? "bg-accent" : "bg-white/20"}`}
            />
          ))}
        </div>

        <h2 className="mt-9 font-display font-extrabold text-[56px] text-bg tracking-tighter leading-none">
          {sideTitle}
        </h2>
        {sideBody && (
          <p className="mt-3.5 text-base/relaxed text-bg opacity-70 max-w-95">
            {sideBody}
          </p>
        )}

        <div className="mt-auto pt-6 font-mono text-[11px] text-bg opacity-50 tracking-wide uppercase">
          You can change all of this on your profile later
        </div>
      </aside>

      <main className="p-8 px-14 flex flex-col">
        <div className="flex justify-between items-center mb-7">
          <button
            onClick={onBack}
            disabled={step <= 1}
            className={`bg-transparent border-none font-mono text-[11px] font-bold tracking-wide uppercase p-0 ${
              step > 1 ? "text-ink cursor-pointer" : "text-transparent"
            }`}
          >
            ← Back
          </button>
          {onSkip && (
            <button
              onClick={onSkip}
              className="bg-transparent border-none cursor-pointer font-mono text-[11px] font-bold text-muted tracking-wide uppercase p-0"
            >
              Skip this step
            </button>
          )}
        </div>

        <div className="flex-1 max-w-130">
          <div className="font-mono text-[10px] text-accent font-bold tracking-wide uppercase">
            {kicker}
          </div>
          <h1 className="my-2 font-display font-extrabold text-5xl text-ink tracking-tighter leading-none">
            {title}
          </h1>
          {subtitle && (
            <p className="mb-7 text-base/relaxed text-ink-soft">
              {subtitle}
            </p>
          )}
          {children}
        </div>

        <div className="flex justify-end gap-2.5 mt-7 pt-5 border-t border-rule-soft">
          <button
            onClick={onContinue}
            disabled={!canContinue}
            className={`px-6 py-3 border font-mono text-[11px] font-bold tracking-wide uppercase ${
              canContinue
                ? "border-accent bg-accent text-white cursor-pointer"
                : "border-rule-soft bg-rule-soft text-muted cursor-not-allowed"
            }`}
          >
            {ctaLabel} →
          </button>
        </div>
      </main>
    </div>
  );
}
