import type { ReactNode } from "react";

// Building blocks for long-form text pages such as the privacy policy.

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="border-b border-ink pb-2 font-display text-2xl font-bold tracking-tight text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function Subhead({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 font-mono text-xs font-semibold tracking-wide text-ink uppercase">
      {children}
    </h3>
  );
}

export function Paragraph({ children }: { children: ReactNode }) {
  return <p className="mt-4 font-body text-base/relaxed text-ink-soft">{children}</p>;
}

export function List({ children }: { children: ReactNode }) {
  return (
    <ul className="mt-3 space-y-2 font-body text-base/relaxed text-ink-soft [&>li]:relative [&>li]:pl-6 [&>li]:before:absolute [&>li]:before:left-0 [&>li]:before:font-bold [&>li]:before:text-accent [&>li]:before:content-['→']">
      {children}
    </ul>
  );
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent underline underline-offset-2"
    >
      {children}
    </a>
  );
}

/** A bordered list of terms and their explanations. `mono` keeps terms such as cookie names as written. */
export function TermList({
  terms,
  mono = false,
}: {
  terms: { term: string; detail: string }[];
  mono?: boolean;
}) {
  return (
    <dl className="mt-4 divide-y divide-rule-soft border border-ink">
      {terms.map(({ term, detail }) => (
        <div key={term} className="grid gap-1 p-3 md:grid-cols-[14rem_1fr] md:gap-4">
          <dt
            className={`font-mono text-xs font-semibold text-ink ${mono ? "break-all" : "tracking-wide uppercase"}`}
          >
            {term}
          </dt>
          <dd className="font-body text-sm/relaxed text-ink-soft">{detail}</dd>
        </div>
      ))}
    </dl>
  );
}
