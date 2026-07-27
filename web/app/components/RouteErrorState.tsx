import { Link } from "react-router";

type RouteErrorStateProps = {
  eyebrow: string;
  title: string;
  description: string;
  retry?: boolean;
  link?: {
    label: string;
    to: string;
  };
};

export function RouteErrorState({
  eyebrow,
  title,
  description,
  retry = false,
  link,
}: RouteErrorStateProps) {
  return (
    <section
      className="min-h-[calc(100vh-160px)] px-4.5 py-12 md:px-8 md:py-20 flex items-start md:items-center justify-center"
      role="alert"
    >
      <div className="w-full max-w-3xl border border-ink bg-surface">
        <div className="flex items-center justify-between gap-4 px-4 py-2.5 border-b border-ink font-mono text-[10px] tracking-wider uppercase">
          <span className="text-muted">{eyebrow}</span>
          <span className="text-accent" aria-hidden="true">
            ●
          </span>
        </div>

        <div className="px-5 py-9 md:px-10 md:py-12">
          <h1 className="max-w-2xl font-display font-extrabold text-4xl md:text-[64px] text-ink tracking-[-1.5px] md:tracking-[-2px] leading-[0.95] text-balance">
            {title}
          </h1>
          <p className="mt-5 max-w-xl text-base/relaxed text-ink-soft">
            {description}
          </p>

          <div className="mt-7 flex flex-col sm:flex-row gap-2.5">
            {retry && (
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-5 py-3 border border-accent bg-accent text-white font-mono text-[11px] font-bold tracking-wider uppercase cursor-pointer"
              >
                Try again
              </button>
            )}
            {link && (
              <Link
                to={link.to}
                className="px-5 py-3 border border-ink bg-bg text-ink font-mono text-[11px] font-bold tracking-wider uppercase text-center no-underline"
              >
                {link.label}
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
