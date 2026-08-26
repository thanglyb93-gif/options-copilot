import { TickerDashboard } from "@/components/ticker/ticker-dashboard";

export default function TickerPage({
  params,
}: {
  params: { symbol: string };
}) {
  return <TickerDashboard symbol={params.symbol.toUpperCase()} />;
}
