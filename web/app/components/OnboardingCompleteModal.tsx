import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router";

type OnboardingCompleteNotice = {
  preferredName: string;
};

function readNotice(value: unknown): OnboardingCompleteNotice | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("onboardingComplete" in value)
  ) {
    return null;
  }
  const notice = value.onboardingComplete;
  if (
    typeof notice !== "object" ||
    notice === null ||
    !("preferredName" in notice) ||
    typeof notice.preferredName !== "string"
  ) {
    return null;
  }
  return { preferredName: notice.preferredName };
}

export function OnboardingCompleteModal() {
  const location = useLocation();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<OnboardingCompleteNotice | null>(null);

  useEffect(() => {
    const nextNotice = readNotice(location.state);
    if (!nextNotice) return;

    setNotice(nextNotice);
    const nextState =
      typeof location.state === "object" && location.state !== null
        ? { ...location.state }
        : {};
    delete nextState.onboardingComplete;
    navigate(
      `${location.pathname}${location.search}${location.hash}`,
      {
        replace: true,
        state: Object.keys(nextState).length > 0 ? nextState : null,
      }
    );
  }, [
    location.hash,
    location.pathname,
    location.search,
    location.state,
    navigate,
  ]);

  useEffect(() => {
    if (!notice) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNotice(null);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [notice]);

  if (!notice) return null;

  return (
    <div
      className="fixed inset-0 z-110 flex items-center justify-center bg-ink/55 p-5"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setNotice(null);
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-complete-title"
        className="w-full max-w-130 border-2 border-ink bg-bg p-6 shadow-[6px_6px_0_var(--color-ink)] md:p-8"
      >
        <div className="flex size-12 items-center justify-center bg-accent font-display text-2xl font-extrabold text-white">
          ✓
        </div>
        <div className="mt-5 font-mono text-[10px] font-bold uppercase tracking-wider text-accent">
          Profile complete
        </div>
        <h2
          id="onboarding-complete-title"
          className="mt-2 font-display text-4xl font-extrabold leading-none tracking-tight text-ink md:text-5xl"
        >
          You&rsquo;re in, {notice.preferredName}.
        </h2>
        <p className="mt-4 text-sm/relaxed text-ink-soft md:text-[15px]">
          Your For you feed now reflects your interests and will keep improving
          as you save and rate events.
        </p>
        <button
          type="button"
          autoFocus
          onClick={() => setNotice(null)}
          className="mt-6 w-full border border-accent bg-accent px-4 py-3 font-mono text-[11px] font-bold uppercase tracking-wider text-white"
        >
          Start exploring
        </button>
      </section>
    </div>
  );
}
