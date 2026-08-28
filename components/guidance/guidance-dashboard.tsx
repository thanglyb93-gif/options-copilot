import { Section } from "@/components/ticker/section";
import { ENTRY_FLOW_STAGES, EXIT_FLOW_STAGES, DELTA_BAND_TEXT, DTE_BAND_TEXT } from "@/lib/guidance-content";
import { IndicatorGlossary } from "./indicator-glossary";
import { FlowDiagram } from "./flow-diagram";
import { LeanAccuracySummary } from "./lean-accuracy-summary";

export function GuidanceDashboard() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-mono text-xl font-semibold text-foreground">Guidance</h1>

      <Section title="What this tool does">
        <p className="text-sm leading-relaxed text-foreground">
          options-copilot is systematic, evidence-based decision support for selling covered
          calls and cash-secured puts specifically — not a prediction engine, and not a
          guarantee of outcome. Every score and flag on this site is a transparent function of
          real market data (implied and historical volatility, technical levels, option greeks,
          recent news) checked against fixed, documented thresholds. It exists to make the
          inputs to that decision explicit and consistent, not to remove your judgment from it.
        </p>
      </Section>

      <Section title="Indicator Glossary">
        <IndicatorGlossary />
      </Section>

      <Section title="Entry Flow">
        <p className="mb-3 text-xs text-muted">
          How a ticker becomes a strike selection. Click any box to jump to that indicator below.
        </p>
        <FlowDiagram stages={ENTRY_FLOW_STAGES} />
      </Section>

      <Section title="Exit Flow">
        <p className="mb-3 text-xs text-muted">
          How an open position becomes a close/hold decision. Click any box to jump to that
          indicator below.
        </p>
        <FlowDiagram stages={EXIT_FLOW_STAGES} />
      </Section>

      <Section title="Methodology">
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-foreground">
          <p>
            <strong>Delta/DTE band targeting.</strong> This tool targets contracts within a{" "}
            {DELTA_BAND_TEXT} range and a {DTE_BAND_TEXT} window — a widely used starting point
            among options sellers, balancing meaningful premium against a manageable probability
            of assignment, with enough time to expiration to collect a full cycle of theta decay
            without holding through the sharpest gamma risk right before expiry.
          </p>
          <p>
            <strong>IV-percentile-based timing.</strong> Selling options is fundamentally selling
            volatility. The Entry Score&rsquo;s IV Percentile component encodes the standard
            premium-selling principle that these strategies tend to perform better, on average,
            when implied volatility is elevated relative to a stock&rsquo;s own history — you&rsquo;re
            compensated more for the same statistical risk. HV Percentile applies the same lens
            to realized price action, available immediately rather than after weeks of snapshot
            accumulation.
          </p>
          <p>
            <strong>Expected-move-based strike cushion.</strong> Rather than picking strikes by a
            fixed dollar or percentage distance, the Technical/EM Cushion component measures
            distance in units of the stock&rsquo;s own statistically expected move to expiration — a
            strike that&rsquo;s &ldquo;far enough away&rdquo; for a low-volatility stock may be dangerously close
            for a high-volatility one, and this normalizes for that automatically.
          </p>
          <p>
            <strong>Profit-target exit discipline and theta-decay-aware timing.</strong>{" "}
            Once a position is open, the standard practical discipline among premium sellers is
            to close early once a large share of the maximum profit has already been captured,
            rather than holding for the last few cents while decay slows and event risk remains —
            and separately, to reassess as DTE shrinks, since theta decay is not linear and
            accelerates in the final weeks. Profit-Captured % and Theta Decay Curve position
            (see Position-Management indicators above) are how this tool systematizes that
            discipline on the Positions page.
          </p>
          <p>
            <strong>Sell-the-news vs. real-breakdown framework.</strong> When a position moves
            in-the-money against the seller, the standard question is whether the move is a
            short-lived reaction likely to fade (a &ldquo;sell the news&rdquo; pop or dip) or a genuine break
            of the technical level the trade was premised on. Conflating the two leads to either
            panicking out of a position that was fine, or holding through a real structural
            change — the ITM Classification indicator is designed to make that distinction
            explicit rather than left to intuition in the moment.
          </p>
          <p className="text-xs text-muted">
            All of the above are configurable defaults and decision-support heuristics drawn from
            well-established options-selling practice — not predictions, and not guarantees of
            any specific outcome.
          </p>
        </div>
      </Section>

      <Section title="Track Record">
        <p className="mb-2 text-xs text-muted">
          How often the briefing&rsquo;s directional lean (bullish/bearish) has held up 10 trading
          days later, tracked automatically each time a briefing regenerates.
        </p>
        <LeanAccuracySummary />
      </Section>
    </div>
  );
}
