export function SubmissionSent({
  title,
  onSubmitAnother,
}: {
  title: string;
  onSubmitAnother: () => void;
}) {
  return (
    <section className="border border-ink p-5.5 md:p-8">
      <div className="font-mono text-xs font-bold tracking-wider text-accent uppercase">
        Submitted
      </div>
      <h2 className="mt-2 font-display text-3xl leading-none font-extrabold tracking-tight text-ink md:text-4xl">
        {title} is with the reviewers.
      </h2>
      <p className="mt-3 max-w-135 text-sm/relaxed text-ink-soft md:text-base/relaxed">
        We check every listing before it reaches Discover. You can follow its
        status below. If something needs fixing, the reason shows up there too.
      </p>
      <button
        onClick={onSubmitAnother}
        className="mt-5 cursor-pointer border border-ink bg-transparent px-4 py-3 font-mono text-xs font-bold tracking-wider text-ink uppercase"
      >
        Submit another event
      </button>
    </section>
  );
}
