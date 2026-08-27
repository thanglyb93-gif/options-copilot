/**
 * Typed content for the Guidance page. Threshold descriptions are
 * generated from the actual scoring constants (lib/entry-score.ts,
 * lib/expected-move.ts, lib/flags.ts) rather than duplicated as separate
 * prose -- change a constant there and the text here changes with it.
 * Adding an indicator (e.g. the probability-of-touch / liquidity-score
 * work planned for the next phase) is one new array entry, not a
 * page rewrite.
 */

import {
  CATALYST_MIN_HEADLINES,
  CATALYST_RECENCY_WINDOW_DAYS,
  HV_FALLBACK_MIN_SAMPLES,
  IV_HISTORY_MIN_ROWS,
  IV_PERCENTILE_BANDS,
  TIER_BANDS,
} from "./entry-score";
import { CUSHION_SCORE_BANDS } from "./expected-move";
import { DELTA_BAND_MAX, DELTA_BAND_MIN, DTE_BAND_MAX, DTE_BAND_MIN } from "./flags";

export type IndicatorCategory = "entry" | "position-management";

export interface GuidanceIndicator {
  /** Slug, used as the glossary card's anchor id for cross-linking from the flow diagrams. */
  id: string;
  name: string;
  category: IndicatorCategory;
  whatItMeasures: string;
  howCalculated: string;
  interpretHigh: string;
  interpretLow: string;
  whereItAppears: string;
  /** Set only for indicators described but not yet implemented. */
  status?: "planned";
}

/** Formats a top-down, first-match-wins band list generically -- shared by every banded score in the app. */
function formatBands<T extends { min: number }>(bands: readonly T[], axisLabel: string, valueOf: (b: T) => string): string {
  const parts = bands.map((b) =>
    Number.isFinite(b.min) ? `≥ ${b.min} ${axisLabel} → ${valueOf(b)}` : `otherwise → ${valueOf(b)}`
  );
  return `Checked top-down, first match wins: ${parts.join(" · ")}.`;
}

const ivBandsText = formatBands(IV_PERCENTILE_BANDS, "percentile", (b) => `${b.score.toFixed(1)} pts`);
const cushionBandsText = formatBands(CUSHION_SCORE_BANDS, "EM multiple", (b) => `${b.score.toFixed(1)} pts`);
const tierBandsText = formatBands(TIER_BANDS, "total (0-6)", (b) => b.tier);

export const GUIDANCE_INDICATORS: GuidanceIndicator[] = [
  // ---------------------------------------------------------------------
  // Entry-time indicators
  // ---------------------------------------------------------------------
  {
    id: "iv-percentile",
    name: "IV Percentile",
    category: "entry",
    whatItMeasures:
      "Where the stock's current implied volatility sits relative to its own trailing history -- how \"rich\" options premiums are right now, specifically for this stock, not the market in general.",
    howCalculated: `Percentile rank of today's at-the-money implied volatility against real daily IV snapshots collected for this ticker since it was added to the watchlist. Needs ${IV_HISTORY_MIN_ROWS} real snapshot days before it's trusted -- before that, HV Percentile drives the score instead (see below), clearly labeled as an approximation. Feeds the IV component of the Entry Score: ${ivBandsText}`,
    interpretHigh: "Options premiums are unusually rich for this stock right now -- more compensation for the risk of selling a covered call or cash-secured put.",
    interpretLow: "Premiums are cheap relative to this stock's own history -- selling here collects less for the same risk.",
    whereItAppears: "Ticker Overview (Volatility section) and Entry Score card (IV Component row).",
  },
  {
    id: "hv-percentile",
    name: "HV Percentile",
    category: "entry",
    whatItMeasures:
      "Where the stock's realized (historical) 30-day volatility sits relative to its own trailing ~1-year distribution -- a real, independent read on how choppy the stock's actual price action has been, not a stand-in for IV.",
    howCalculated: `Percentile rank of the current 30-day historical volatility against a rolling series of 30-day HV values, computed purely from daily closes -- available immediately, no waiting period, unlike IV Percentile (which needs ${IV_HISTORY_MIN_ROWS} accumulated calendar days). The rolling series itself needs at least ${HV_FALLBACK_MIN_SAMPLES} samples before it's trusted.`,
    interpretHigh: "The stock has been unusually choppy or volatile lately relative to its own recent history.",
    interpretLow: "Recent price action has been unusually calm for this stock.",
    whereItAppears:
      "Ticker Overview (Volatility section, permanently) and Entry Score card (IV Component -- drives the score while IV Percentile is immature, and stays visible alongside it afterward, since a divergence between the two is itself useful signal).",
  },
  {
    id: "technical-em-cushion",
    name: "Technical / EM Cushion",
    category: "entry",
    whatItMeasures:
      "How far a specific strike sits from the current price, measured in multiples of the stock's expected move to expiration -- the higher the cushion, the more room the stock has to move before that strike is threatened.",
    howCalculated: `Expected move = price × IV × √(DTE / 365). Cushion = (price − strike) / expected move for a put, (strike − price) / expected move for a call. Banded into the Technical component of the Entry Score: ${cushionBandsText}`,
    interpretHigh: "A cushion of 2.0x or more means the strike sits well outside the stock's statistically expected range -- safer, typically at the cost of lower premium.",
    interpretLow: "A cushion near or below 0 means the strike is already at or past the current price relative to the expected move -- meaningfully higher assignment risk.",
    whereItAppears: "Strike Selector results panel (EM Cushion stat) and Entry Score card (Technical row, once a strike is selected).",
  },
  {
    id: "structural-confirmation",
    name: "Structural Confirmation",
    category: "entry",
    whatItMeasures:
      "Whether a selected strike also sits on the safe side of a real chart-level reference (50-day SMA, or the 90-day high/low) -- a second, independent check beyond the purely statistical EM cushion.",
    howCalculated:
      "Support reference for a put: the 50-day SMA if price is currently above it, otherwise the 90-day low. Resistance reference for a call: the 50-day SMA if price is currently below it, otherwise the 90-day high. Confirmed when the strike sits beyond that reference on the safe side (below support for a put, above resistance for a call).",
    interpretHigh: "Confirmed (✓) -- the strike has both a statistical (expected-move) and a structural (chart-level) reason to hold.",
    interpretLow: "Not confirmed -- the strike may still carry EM cushion, but lacks a technical-level reason to hold; worth a closer look.",
    whereItAppears: "Shown as a ✓ badge next to EM Cushion, in both the Strike Selector results panel and the Entry Score card.",
  },
  {
    id: "events",
    name: "Events",
    category: "entry",
    whatItMeasures:
      "Two combined reads: whether a market-moving catalyst is imminent or recent (earnings, elevated headline volume), and whether the AI-synthesized directional lean from recent news supports or opposes the specific trade direction under consideration.",
    howCalculated: `Catalyst score (0 or 1 pt): 1 if earnings occurred within the last ${CATALYST_RECENCY_WINDOW_DAYS} days, or if ${CATALYST_MIN_HEADLINES}+ recent company headlines exist absent that; else 0. Alignment score (0, 0.5, or 1 pt): 1 if the news-derived directional lean favors the trade direction or is neutral, 0.5 if the lean is genuinely mixed, 0 (and explicitly flagged as opposing) if the lean actively works against the trade.`,
    interpretHigh: "No imminent surprise catalyst working against the position, and the news-derived lean supports (or doesn't oppose) the trade direction.",
    interpretLow: "A directional lean flagged as opposing the trade means the evidence actively argues against selling this specific direction right now -- worth a second look before proceeding.",
    whereItAppears: "Entry Score card (Events row) and the ticker's Market Read section (the \"Net read\" conclusion is the same underlying directional lean).",
  },
  {
    id: "assignment-probability",
    name: "Assignment Probability",
    category: "entry",
    whatItMeasures:
      "A rough estimate of the probability a specific contract expires in-the-money (and the seller gets assigned), read directly off the option's delta.",
    howCalculated:
      "|delta| × 100%, rounded -- delta already approximates probability of expiring ITM under Black-Scholes, so this is a display step, not a separate model. Delta itself is computed via Black-Scholes from the contract's strike, DTE, and implied volatility (or a volatility solved from lastPrice when live bid/ask aren't available).",
    interpretHigh: "A real chance of assignment -- fine if you're comfortable being assigned, less so if the goal is specifically to keep the shares or avoid buying in.",
    interpretLow: "The contract is more likely to expire worthless -- favorable for a seller collecting premium with lower odds of the underlying event happening.",
    whereItAppears: "Strike Selector results panel (Assignment Probability stat card).",
  },
  {
    id: "entry-score",
    name: "Entry Score composite + tier mapping",
    category: "entry",
    whatItMeasures:
      "The single combined 0-6 recommendation for a specific ticker, direction, and (once picked) strike -- the one number every other entry-time indicator here feeds into.",
    howCalculated: `Ticker-level partial (0-4, strike-independent) = IV component (0-2) + Events catalyst score (0-1) + Events alignment score (0-1). Completed to the full 0-6 once a strike is selected, by adding that contract's Technical/EM Cushion score (0-2). The total maps to a tier label: ${tierBandsText}`,
    interpretHigh: "A SELL tier means the combined evidence -- volatility pricing, catalyst/directional risk, and strike cushion -- favors selling premium here.",
    interpretLow: "A DON'T SELL or CONSIDER SKIPPING tier means the combined evidence doesn't support this specific trade right now, even if one individual component looks fine in isolation.",
    whereItAppears: "Entry Score cards (Put Score / Call Score, the large number and tier badge at the top of each card).",
  },

  // ---------------------------------------------------------------------
  // Position-management indicators
  // ---------------------------------------------------------------------
  {
    id: "net-covered-position-pl",
    name: "Net Covered-Position P/L",
    category: "position-management",
    whatItMeasures:
      "The real, combined profit/loss of holding the underlying shares plus having sold a covered call against them -- stock leg and option leg together, not the option premium alone (which by itself can look fine while the position as a whole is underwater).",
    howCalculated:
      "Stock P/L = (current price − cost basis) × shares. Option P/L (this leg) = premium collected. Net = the two summed. Cost basis is either prefilled from a tracked open position for the ticker, or entered manually. When cost basis exceeds the current price, a plain-language note flags the position as currently underwater on the stock leg.",
    interpretHigh: "A positive net figure means the combined stock + premium position is currently ahead, even if one leg alone looks worse.",
    interpretLow: "A negative net figure means the stock loss currently outweighs the premium collected -- selling a call while underwater is a materially different situation than selling one at a gain, which is why this is surfaced explicitly rather than left for the option premium alone to imply.",
    whereItAppears: "Strike Selector results panel, once a Sell Call direction and a cost basis are set. (Currently lives in the entry/strike-selection flow -- a dedicated open-position tracker with live monitoring is planned; see below.)",
  },
  {
    id: "profit-captured-pct",
    name: "Profit-Captured %",
    category: "position-management",
    status: "planned",
    whatItMeasures:
      "For an open, tracked position: what percentage of the maximum possible profit on that trade has already been realized as the option's value has decayed -- the standard signal for \"this trade has done its job, consider closing.\"",
    howCalculated: "Not yet implemented. Planned: (premium collected − current option value) / premium collected, tracked against a configurable close-it-here threshold.",
    interpretHigh: "Not yet live.",
    interpretLow: "Not yet live.",
    whereItAppears: "Planned for a Positions page (currently a placeholder) once open-position tracking is built.",
  },
  {
    id: "theta-decay-curve",
    name: "Theta Decay Curve position",
    category: "position-management",
    status: "planned",
    whatItMeasures:
      "Where an open position sits on the option's time-decay curve -- decay accelerates as expiration nears, so this is meant to flag when remaining theta benefit no longer justifies remaining gamma/event risk.",
    howCalculated: "Not yet implemented. Planned: derived from the same Black-Scholes theta already computed per-contract (lib/options-math.ts), tracked against a configurable DTE trigger.",
    interpretHigh: "Not yet live.",
    interpretLow: "Not yet live.",
    whereItAppears: "Planned for a Positions page (currently a placeholder) once open-position tracking is built.",
  },
  {
    id: "itm-classification",
    name: "ITM Classification (Sell-the-News vs Real Breakdown)",
    category: "position-management",
    status: "planned",
    whatItMeasures:
      "For an open position that's gone in-the-money against the seller, whether the move looks like a short-lived reaction (\"sell the news\") likely to fade, versus a genuine structural breakdown of the level that was supposed to hold.",
    howCalculated: "Not yet implemented. Planned: likely combining recent-headline context (already gathered for the Market Read/briefing) with the structural reference levels already computed in lib/structural-levels.ts.",
    interpretHigh: "Not yet live.",
    interpretLow: "Not yet live.",
    whereItAppears: "Planned for a Positions page (currently a placeholder) once open-position tracking is built.",
  },
  {
    id: "close-signal",
    name: "Close Signal",
    category: "position-management",
    status: "planned",
    whatItMeasures:
      "The position-management equivalent of the Entry Score tier -- a single combined Close / Hold / Monitor recommendation for an open position, synthesizing Net Covered P/L, Profit-Captured %, Theta Decay Curve position, and (for ITM positions) the Sell-the-News vs Real-Breakdown read.",
    howCalculated: "Not yet implemented -- depends on the four indicators above.",
    interpretHigh: "Not yet live.",
    interpretLow: "Not yet live.",
    whereItAppears: "Planned for a Positions page (currently a placeholder) once open-position tracking is built.",
  },
];

export function guidanceIndicatorsByCategory(category: IndicatorCategory): GuidanceIndicator[] {
  return GUIDANCE_INDICATORS.filter((i) => i.category === category);
}

export function guidanceIndicatorById(id: string): GuidanceIndicator | undefined {
  return GUIDANCE_INDICATORS.find((i) => i.id === id);
}

// ---------------------------------------------------------------------
// Shared band-threshold text, exposed for the Methodology section and
// flow diagrams so they don't hand-format their own copies either.
// ---------------------------------------------------------------------

export const DELTA_BAND_TEXT = `${DELTA_BAND_MIN.toFixed(2)}–${DELTA_BAND_MAX.toFixed(2)} absolute delta`;
export const DTE_BAND_TEXT = `${DTE_BAND_MIN}–${DTE_BAND_MAX} days to expiration`;

// ---------------------------------------------------------------------
// Flow diagrams -- each is a list of "stages," where a stage with more
// than one box means those checks happen in parallel before the flow
// converges. Boxes with a `targetId` matching a GUIDANCE_INDICATORS id
// link to that glossary entry.
// ---------------------------------------------------------------------

export interface FlowBoxDef {
  label: string;
  targetId?: string;
  /** Styled distinctly (dashed, muted) -- describes a step that isn't live yet. */
  planned?: boolean;
}

export const ENTRY_FLOW_STAGES: FlowBoxDef[][] = [
  [{ label: "Select ticker" }],
  [
    { label: "IV / HV Percentile", targetId: "iv-percentile" },
    { label: "Technical / EM Cushion", targetId: "technical-em-cushion" },
    { label: "Events", targetId: "events" },
  ],
  [{ label: "Entry Score total", targetId: "entry-score" }],
  [{ label: "Tier recommendation", targetId: "entry-score" }],
  [{ label: "Select strike / DTE" }],
  [
    { label: "Assignment Probability", targetId: "assignment-probability" },
    { label: "EM Cushion", targetId: "technical-em-cushion" },
  ],
  [{ label: "Decide" }],
];

/**
 * Conceptual -- there's no open-position tracker yet (see the
 * position-management indicators above), so every step past the first
 * is marked planned except Net Covered P/L, whose math is real today
 * even though it's currently surfaced pre-trade in the Strike Selector
 * rather than from a live tracked position.
 */
export const EXIT_FLOW_STAGES: FlowBoxDef[][] = [
  [{ label: "Open position", planned: true }],
  [{ label: "Monitor Net Covered P/L", targetId: "net-covered-position-pl" }],
  [{ label: "Profit-Captured % vs. threshold", targetId: "profit-captured-pct", planned: true }],
  [{ label: "DTE vs. trigger", targetId: "theta-decay-curve", planned: true }],
  [
    {
      label: "If ITM: Sell-the-News vs. Real Breakdown",
      targetId: "itm-classification",
      planned: true,
    },
  ],
  [{ label: "Close / Hold / Monitor recommendation", targetId: "close-signal", planned: true }],
];
