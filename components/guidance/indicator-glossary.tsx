import { guidanceIndicatorsByCategory } from "@/lib/guidance-content";
import { ImportanceTierLegend } from "@/components/shared/importance-badge";
import { IndicatorCard } from "./indicator-card";

export function IndicatorGlossary() {
  const entryIndicators = guidanceIndicatorsByCategory("entry");
  const positionIndicators = guidanceIndicatorsByCategory("position-management");
  const portfolioIndicators = guidanceIndicatorsByCategory("portfolio");

  return (
    <div className="flex flex-col gap-8">
      <ImportanceTierLegend />

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          Entry-Time Indicators
        </h3>
        <div className="flex flex-col gap-2">
          {entryIndicators.map((indicator) => (
            <IndicatorCard key={indicator.id} indicator={indicator} />
          ))}
        </div>
      </div>

      <div className="border-t-2 border-dashed border-border" />

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          Position-Management Indicators
        </h3>
        <div className="flex flex-col gap-2">
          {positionIndicators.map((indicator) => (
            <IndicatorCard key={indicator.id} indicator={indicator} />
          ))}
        </div>
      </div>

      <div className="border-t-2 border-dashed border-border" />

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-foreground">
          Portfolio-Level Indicators
        </h3>
        <div className="flex flex-col gap-2">
          {portfolioIndicators.map((indicator) => (
            <IndicatorCard key={indicator.id} indicator={indicator} />
          ))}
        </div>
      </div>
    </div>
  );
}
