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
