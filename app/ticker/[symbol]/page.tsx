export default function TickerPage({
  params,
}: {
  params: { symbol: string };
}) {
  const symbol = params.symbol.toUpperCase();

  return (
    <div className="flex max-w-2xl flex-col gap-2">
      <h1 className="text-lg font-semibold text-foreground">
        <span className="font-mono">{symbol}</span>
      </h1>
      <p className="text-sm text-muted">Decision screen coming in phase 3.</p>
    </div>
  );
}
