import { guidanceIndicatorsByCategory } from "@/lib/guidance-content";
import { IndicatorCard } from "./indicator-card";

export function IndicatorGlossary() {
  const entryIndicators = guidanceIndicatorsByCategory("entry");
  const positionIndicators = guidanceIndicatorsByCategory("position-management");

  return (
    <div className="flex flex-col gap-8">
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
        <p className="text-xs text-muted">
          Being built next. Documented here so the page structure is ready, but the underlying
          scoring logic doesn&rsquo;t exist yet — entries marked &ldquo;Planned&rdquo; describe the intended
          concept without inventing specific thresholds.
        </p>
        <div className="flex flex-col gap-2">
          {positionIndicators.map((indicator) => (
            <IndicatorCard key={indicator.id} indicator={indicator} />
          ))}
        </div>
      </div>
    </div>
  );
}
