export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-xs font-medium uppercase tracking-wide text-muted">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Labeled sub-group within a Section -- e.g. the Strike Selector's
 * "Direction" / "Enter Your Desired Option" / "Summary" / "Making
 * Decisions" steps, or the Overview's "Fundamentals" / "Trend &
 * Relative Performance" / "Volatility & Structure" groups. An underline
 * rather than Section's own bordered box, so nested groups read as
 * distinct steps without stacking boxes-in-a-box.
 */
export function SubsectionHeader({ title }: { title: string }) {
  return (
    <h3 className="border-b border-border pb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground/80">
      {title}
    </h3>
  );
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded bg-white/5"
          style={{ width: `${70 - i * 12}%` }}
        />
      ))}
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return <p className="text-sm text-red-400">{message}</p>;
}
