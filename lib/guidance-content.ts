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
  SKEW_SCORE_BANDS,
  SKEW_UNFAVORABLE_SCORE,
  TIER_BANDS,
} from "./entry-score";
import { CUSHION_SCORE_BANDS } from "./expected-move";
import { DELTA_BAND_MAX, DELTA_BAND_MIN, DTE_BAND_MAX, DTE_BAND_MIN } from "./flags";
import { SPREAD_MODERATE_MAX_PCT, SPREAD_TIGHT_MAX_PCT } from "./options-math";
import { SKEW_FLAT_THRESHOLD, TERM_STRUCTURE_THRESHOLD_PCT } from "./volatility";
import { RSI_OVERBOUGHT_THRESHOLD, RSI_OVERSOLD_THRESHOLD, RSI_PERIOD } from "./trend";
import { MIN_OPEN_POSITIONS_FOR_PORTFOLIO_SUMMARY } from "./portfolio-analytics";
import {
  PRIMARY_LOOKBACK_DAYS,
  STRUCTURAL_TREND_LOOKBACK_DAYS,
  SUITABILITY_OUTPERFORM_THRESHOLD_PCT,
  SUITABILITY_UNDERPERFORM_THRESHOLD_PCT,
} from "./relative-strength";
import {
  DTE_SECONDARY_TRIGGER_MAX,
  DTE_SECONDARY_TRIGGER_MIN,
  PROFIT_TARGET_CC_PCT,
  PROFIT_TARGET_CSP_PCT,
  REAL_BREAKDOWN_MAX_DTE,
  REAL_BREAKDOWN_MIN_BREACH_PCT,
  SELL_THE_NEWS_MAX_BREACH_PCT,
  SELL_THE_NEWS_MIN_DTE,
} from "./position-analytics";

export type IndicatorCategory = "entry" | "position-management" | "portfolio";

/**
 * How much weight a beginner should give this indicator when making a
 * decision -- NOT a measure of computational complexity or how recently
 * it was added. "core" drives a top-level score or a close/hold action
 * directly; "supporting" meaningfully informs a specific choice (which
 * contract to fill) without itself being a scored input; "context" is
 * useful background to read alongside the above, not itself thresholded
 * into a decision.
 */
export type ImportanceTier = "core" | "supporting" | "context";

export const IMPORTANCE_TIER_DESCRIPTIONS: Record<ImportanceTier, string> = {
  core: "Directly drives the Entry Score or a position's close/hold decision -- understand these first.",
  supporting: "Meaningfully informs a specific choice (which contract to fill) without being a top-level score input.",
  context: "Useful background to read alongside the above -- not itself a scored or thresholded decision input.",
};

export interface GuidanceIndicator {
  /** Slug, used as the glossary card's anchor id for cross-linking from the flow diagrams. */
  id: string;
  name: string;
  category: IndicatorCategory;
  importanceTier: ImportanceTier;
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
const tierBandsText = formatBands(TIER_BANDS, "total (0-10)", (b) => b.tier);
const skewBandsText = formatBands(SKEW_SCORE_BANDS, "pts of favorable-direction skew", (b) => `${b.score.toFixed(1)} pts`);

export const GUIDANCE_INDICATORS: GuidanceIndicator[] = [
  // ---------------------------------------------------------------------
  // Entry-time indicators
  // ---------------------------------------------------------------------
  {
    id: "iv-percentile",
    name: "IV Percentile",
    category: "entry",
    importanceTier: "core",
    whatItMeasures:
      "Where the stock's current implied volatility sits relative to its own trailing history -- how \"rich\" options premiums are right now, specifically for this stock, not the market in general.",
    howCalculated: `Percentile rank of today's at-the-money implied volatility against real daily IV snapshots collected for this ticker since it was added to the watchlist. Needs ${IV_HISTORY_MIN_ROWS} real snapshot days before it's trusted -- before that, HV Percentile drives the score instead (see below), clearly labeled as an approximation. Feeds the IV component of the Entry Score: ${ivBandsText}`,
    interpretHigh: "Options premiums are unusually rich for this stock right now -- more compensation for the risk of selling a covered call or cash-secured put.",
    interpretLow: "Premiums are cheap relative to this stock's own history -- selling here collects less for the same risk.",
    whereItAppears: "Ticker Overview (Volatility section), Entry Score card (IV Component row), and Dashboard watchlist card (IV Rank stat -- same underlying calculation, compact display).",
  },
  {
    id: "hv-percentile",
    name: "HV Percentile",
    category: "entry",
    importanceTier: "core",
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
    importanceTier: "core",
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
    importanceTier: "core",
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
    importanceTier: "core",
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
    importanceTier: "supporting",
    whatItMeasures:
      "A rough estimate of the probability a specific contract expires in-the-money (and the seller gets assigned), read directly off the option's delta.",
    howCalculated:
      "|delta| × 100%, rounded -- delta already approximates probability of expiring ITM under Black-Scholes, so this is a display step, not a separate model. Delta itself is computed via Black-Scholes from the contract's strike, DTE, and implied volatility (or a volatility solved from lastPrice when live bid/ask aren't available).",
    interpretHigh: "A real chance of assignment -- fine if you're comfortable being assigned, less so if the goal is specifically to keep the shares or avoid buying in.",
    interpretLow: "The contract is more likely to expire worthless -- favorable for a seller collecting premium with lower odds of the underlying event happening.",
    whereItAppears: "Strike Selector results panel (Assignment Probability stat card).",
  },
  {
    id: "probability-of-touch",
    name: "Probability of Touch",
    category: "entry",
    importanceTier: "supporting",
    whatItMeasures:
      "The approximate probability the underlying trades through this strike at any point before expiration -- not just where it lands at expiry, which is what Assignment Probability (delta) already measures. A contract can have low assignment probability at expiration while still carrying a meaningful chance of testing the strike intraday somewhere along the way.",
    howCalculated:
      "The standard trader's rule-of-thumb approximation: roughly double the option's delta, i.e. min(2 × |delta|, 1). This is explicitly an approximation, not a true barrier-option calculation, and is capped at 100% since the raw 2x formula can exceed it for high-delta contracts.",
    interpretHigh: "A real chance the underlying tests this strike before expiration, even if the odds of finishing past it are lower -- relevant if early-close or rolling decisions matter to you, not just the expiration outcome.",
    interpretLow: "The underlying is unlikely to trade through this strike at any point before expiration, not just unlikely to finish past it.",
    whereItAppears: "Strike Selector results panel, as a secondary line beneath Assignment Probability.",
  },
  {
    id: "liquidity-spread-score",
    name: "Liquidity / Spread Score",
    category: "entry",
    importanceTier: "supporting",
    whatItMeasures:
      "How tight a specific contract's bid-ask spread is -- a read on execution quality (how much you'd likely give up filling near the mid price), independent of the contract's premium size or assignment risk.",
    howCalculated: `Spread % = (ask − bid) / mid price × 100, banded top-down: < ${SPREAD_TIGHT_MAX_PCT}% → tight · ≤ ${SPREAD_MODERATE_MAX_PCT}% → moderate · otherwise → wide. Returns no label at all (rather than a fabricated one) when there's no genuinely live two-sided market -- bid/ask missing, zero, or crossed, e.g. under Phase 7's market-closed lastPrice fallback.`,
    interpretHigh: "A wide spread means real slippage risk -- filling at the quoted mid price is optimistic, and a limit order may sit unfilled or need real concessions.",
    interpretLow: "A tight spread means the market is genuinely liquid at that strike -- filling close to the quoted mid price is realistic.",
    whereItAppears: "Strike Selector results panel, as a spread annotation on the premium line, alongside the contract's raw Open Interest -- both speak to the same underlying question (is this contract actually tradeable).",
  },
  {
    id: "open-interest",
    name: "Open Interest",
    category: "entry",
    importanceTier: "context",
    whatItMeasures:
      "How many contracts of a specific strike are currently open -- a raw liquidity/interest signal, read alongside the bid-ask spread to judge whether a contract is actually tradeable at a fair price.",
    howCalculated: "Reported directly from the options chain (Yahoo) per contract -- no calculation, just surfaced data.",
    interpretHigh: "Higher open interest generally means a more actively-traded contract -- easier to enter and exit near the quoted price.",
    interpretLow: "Low open interest is a liquidity warning sign, especially combined with a wide spread -- fills may be difficult or require real price concessions.",
    whereItAppears: "Strike Selector results panel, alongside the spread annotation on the premium line.",
  },
  {
    id: "put-call-ratio",
    name: "Put/Call Ratio",
    category: "entry",
    importanceTier: "context",
    whatItMeasures:
      "A sentiment/positioning gauge: how much open put interest exists relative to open call interest across a chain -- above 1 skews put-heavy (consistent with hedging or bearish positioning), below 1 skews call-heavy (consistent with bullish or speculative positioning). Directional color, not a scored input.",
    howCalculated:
      "Sum of put open interest / sum of call open interest across the nearest expiration's chain (same expiration Max Pain uses). Null when there's no call open interest to divide by, rather than a fabricated 0.",
    interpretHigh: "A ratio above 1 means more open put interest than call interest -- can reflect hedging or bearish positioning, but can also just reflect heavy covered-call/cash-secured-put writing rather than a directional call, so read it as color, not a signal on its own.",
    interpretLow: "A ratio below 1 means more open call interest -- consistent with bullish or speculative positioning.",
    whereItAppears: "Dashboard watchlist card (P/C stat).",
  },
  {
    id: "max-pain",
    name: "Max Pain",
    category: "entry",
    importanceTier: "context",
    whatItMeasures:
      "The strike price at which option holders, in aggregate, would lose the most money if the underlying settled there at expiration -- a commonly-watched reference level some traders believe price gravitates toward near expiration. A heuristic, not a scientifically predictive one.",
    howCalculated:
      "For each candidate strike, sums (settlement − strike) × call open interest for strikes below settlement plus (strike − settlement) × put open interest for strikes above -- the strike that minimizes that total payout to holders is max pain. Computed from the nearest expiration's open interest.",
    interpretHigh: "Price trading notably above max pain -- some traders read this as mild downward pull into expiration; a commonly-cited pattern, not a guarantee, since open interest and price action can both shift right up to expiry.",
    interpretLow: "Price trading notably below max pain -- the same heuristic reads as mild upward pull; same caveat applies.",
    whereItAppears: "Dashboard watchlist card (Max Pain stat) and Strike Selector results panel (\"Max pain for this expiration\" line, nearest expiration only).",
  },
  {
    id: "iv-term-structure",
    name: "IV Term Structure",
    category: "entry",
    importanceTier: "supporting",
    whatItMeasures:
      "Whether near-term implied volatility is elevated relative to further-out expirations (backwardation, usually a sign the market is pricing in a near-term event like earnings), the normal shape where further-out IV is richer (contango), or roughly flat -- a read on where in time the market's uncertainty is concentrated, independent of the overall IV Percentile level.",
    howCalculated: `Relative difference = (near-term ATM IV − far-term ATM IV) / far-term ATM IV × 100, comparing front-month ATM IV against a ~60-90 DTE ATM IV. Classified: > ${TERM_STRUCTURE_THRESHOLD_PCT}% → backwardation · < -${TERM_STRUCTURE_THRESHOLD_PCT}% → contango · otherwise → flat.`,
    interpretHigh: "Backwardation -- near-term IV is meaningfully richer than further out, consistent with a priced-in near-term catalyst; the extra premium is compensation for that flagged risk, not free money.",
    interpretLow: "Contango -- the normal shape, further-out IV richer than near-term, with nothing unusual being priced into the near term specifically.",
    whereItAppears: "Ticker Overview (Volatility section), as an added interpretive line alongside the existing SMA-trend and IV/HV Percentile sentences.",
  },
  {
    id: "volatility-skew",
    name: "Volatility Skew",
    category: "entry",
    importanceTier: "core",
    whatItMeasures:
      "Whether downside puts or upside calls are priced richer in implied volatility at the front-month expiration -- a read on which direction the options market is paying up to protect against or speculate on, independent of the overall IV level. Direction-aware Entry Score input as of Phase 24: skew that pays you more for the exact risk your trade takes on (put-skewed for a put sale, call-skewed for a call sale) scores higher; skew working against your trade direction scores 0.",
    howCalculated: `Compares the ~25-delta put's IV against the ~25-delta call's IV (closest available |delta| to 0.25 on each side) at the front-month expiration, using deltas already computed via Black-Scholes. Skew = put IV − call IV, classified: > ${(SKEW_FLAT_THRESHOLD * 100).toFixed(0)} pts → put-skewed · < -${(SKEW_FLAT_THRESHOLD * 100).toFixed(0)} pts → call-skewed · otherwise → flat. Returns no reading at all on a thin chain with no real ~25-delta contract on one side, rather than a misleading number -- the Skew component of the Entry Score is then null with a note, not a fabricated score. When the skew leans favorable for the trade direction, banded by magnitude: ${skewBandsText} Flat skew scores the bottom band (0.5) regardless of direction; skew leaning against the trade direction scores ${SKEW_UNFAVORABLE_SCORE}.`,
    interpretHigh: "Put-skewed -- downside protection is priced richer than upside, the normal/common shape, consistent with hedging demand. Favorable (higher-scoring) for a put sale, unfavorable for a call sale.",
    interpretLow: "Call-skewed -- upside calls are priced richer than downside puts, less common, consistent with speculative or FOMO-driven demand. Favorable for a call sale, unfavorable for a put sale.",
    whereItAppears: "Ticker Overview (Volatility section, informational) and Entry Score card (Skew row, scored and direction-aware).",
  },
  {
    id: "relative-strength",
    name: "Relative Strength",
    category: "entry",
    importanceTier: "core",
    whatItMeasures:
      "How a stock's actual price performance compares to the broad market (SPY) and, when a peer group is defined, to its sector peers -- plus a longer-horizon structural read on its price shape. Built as the direct fix for a real mistake (an OKLO assignment that turned into a loss) where a stock was traded on tactical merits alone without ever checking whether it was fundamentally sound relative to its peers. Ticker-level Entry Score input as of Phase 24, same category as IV Percentile and Events -- identical for the Put and Call score for a given ticker.",
    howCalculated: `Primary window: total return over the trailing ${PRIMARY_LOOKBACK_DAYS} days ("6 months"). vsMarket = ticker return − SPY return. vsSector = ticker return − average return of its defined peer basket (lib/sector-groups.ts) -- null, not fabricated, for a ticker with no defined group. Structural trend: swing-high/swing-low pattern over a separate, longer trailing ${STRUCTURAL_TREND_LOOKBACK_DAYS}-day window, classified higher-highs-higher-lows (healthy), lower-highs-lower-lows (deteriorating), or mixed. Scored: both vsMarket and vsSector clearly positive (> ${SUITABILITY_OUTPERFORM_THRESHOLD_PCT} pts) with healthy structure → 2.0 · both clearly negative (< ${SUITABILITY_UNDERPERFORM_THRESHOLD_PCT} pts) with deteriorating structure → 0 · either clearly negative → 0.5 · at least one clearly positive with structure not deteriorating → 1.5 · otherwise (roughly inline, or a positive read undercut by deteriorating structure) → 1.0. A missing sector comparison is treated as neutral, not positive -- it can't by itself unlock the top band.`,
    interpretHigh: "The stock has genuinely outpaced both the market and its own peers over a real 6-month window, with a healthy higher-highs-higher-lows price structure -- the fundamental-soundness check this component exists to force before a trade, not just a tactical entry signal.",
    interpretLow: "The stock has lagged the market and/or its peers with a deteriorating price structure -- exactly the pattern the OKLO mistake missed by evaluating a trade on tactical merits alone.",
    whereItAppears: "Screener page (full breakdown, before a ticker is even added to the watchlist) and Entry Score card (Relative Strength row).",
  },
  {
    id: "rsi",
    name: "RSI (informational)",
    category: "entry",
    importanceTier: "context",
    whatItMeasures:
      "Standard momentum read on how far and fast the stock has moved recently -- context for the user to read alongside trend/skew/term-structure, not a scoring input. Deliberately excluded from the Entry Score, which keeps its three components (IV, Technical/EM Cushion, Events) unchanged.",
    howCalculated: `Standard Wilder-smoothed ${RSI_PERIOD}-period RSI computed from the same daily closes already fetched for the SMA trend line -- no new data source. Classified: > ${RSI_OVERBOUGHT_THRESHOLD} → overbought · < ${RSI_OVERSOLD_THRESHOLD} → oversold · otherwise → neutral (with an "approaching" qualifier when close to either threshold).`,
    interpretHigh: "Overbought -- the stock has moved up sharply/persistently in the recent window; worth reading alongside the trend line, not a standalone signal to act on.",
    interpretLow: "Oversold -- the stock has moved down sharply/persistently in the recent window; same caveat, context rather than a trigger.",
    whereItAppears: "Ticker Overview (Volatility section), as an added interpretive line alongside the trend/skew/term-structure sentences.",
  },
  {
    id: "trend",
    name: "SMA Trend",
    category: "entry",
    importanceTier: "context",
    whatItMeasures:
      "Whether the stock is trading above or below its 20/50/200-day simple moving averages -- a basic, widely-used read on the prevailing price trend, informational alongside RSI/skew/term-structure rather than a scoring input.",
    howCalculated:
      "Compares current price against each of the 20/50/200-day SMAs (computed from the same daily closes used everywhere else). Above all three -- uptrend. Below all three -- downtrend. Split -- mixed, naming which SMAs price sits above/below.",
    interpretHigh: "Above all three SMAs -- a confirmed uptrend by this simple measure.",
    interpretLow: "Below all three SMAs -- a confirmed downtrend by this simple measure.",
    whereItAppears: "Ticker Overview (top of the Overview section, directly under the quote header stats).",
  },
  {
    id: "entry-score",
    name: "Entry Score composite + tier mapping",
    category: "entry",
    importanceTier: "core",
    whatItMeasures:
      "The single combined 0-10 recommendation for a specific ticker, direction, and (once picked) strike -- the one number every other entry-time indicator here feeds into. Expanded from a 0-6, 3-component score to 0-10 across 5 components in Phase 24, promoting Volatility Skew from informational-only to scored and adding Relative Strength.",
    howCalculated: `Ticker-level partial (0-8, strike-independent) = IV component (0-2) + Events catalyst score (0-1) + Events alignment score (0-1) + Skew (0-2) + Relative Strength (0-2). Completed to the full 0-10 once a strike is selected, by adding that contract's Technical/EM Cushion score (0-2). The total maps to a tier label: ${tierBandsText}`,
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
    importanceTier: "core",
    whatItMeasures:
      "The real, combined profit/loss of holding the underlying shares plus having sold a covered call against them -- stock leg and option leg together, not the option premium alone (which by itself can look fine while the position as a whole is underwater).",
    howCalculated:
      "Stock P/L = (current price − cost basis) × shares. Option P/L (this leg) = premium collected. Net = the two summed. Cost basis is either prefilled from a tracked open position for the ticker, or entered manually. When cost basis exceeds the current price, a plain-language note flags the position as currently underwater on the stock leg.",
    interpretHigh: "A positive net figure means the combined stock + premium position is currently ahead, even if one leg alone looks worse.",
    interpretLow: "A negative net figure means the stock loss currently outweighs the premium collected -- selling a call while underwater is a materially different situation than selling one at a gain, which is why this is surfaced explicitly rather than left for the option premium alone to imply.",
    whereItAppears: "Positions page (Net Covered-Position P/L card on each open position, live-monitored) only. The Strike Selector's pre-trade preview deliberately does NOT show this blended figure -- before the call is actually sold, blending the shares' pre-existing unrealized P/L into one number with the premium made selling the call look like it caused a loss (it can't -- premium is strictly additive on top of already-owned shares). The Strike Selector instead shows the shares' P/L separately as context alongside the two actual outcomes of selling the call (assigned / not assigned).",
  },
  {
    id: "profit-captured-pct",
    name: "Profit-Captured %",
    category: "position-management",
    importanceTier: "core",
    whatItMeasures:
      "For an open, tracked position: what percentage of the maximum possible profit on that trade has already been realized as the option's value has decayed -- the standard signal for \"this trade has done its job, consider closing.\"",
    howCalculated: `(premium collected − current buyback cost) / premium collected × 100, displayed as "X% of 100% max profit" -- this line is scoped to the option leg's own decay, not a claim about the whole position's profit. The separate policy threshold that actually triggers the "Consider closing" alert (${PROFIT_TARGET_CSP_PCT}% for cash-secured puts, ${PROFIT_TARGET_CC_PCT}% for covered calls, lower since shares are held either way) is shown on that alert, not conflated into this line anymore (Phase 21).`,
    interpretHigh: "Most of the trade's max profit has already been captured -- the standard signal to consider closing early rather than holding for the last few cents while event risk remains.",
    interpretLow: "Most of the option's value is still intact -- little decayed yet, generally too early to close on profit-target grounds alone.",
    whereItAppears: "Positions page (progress bar on each open position card, labeled \"Profit Captured: X% of 100% max profit\").",
  },
  {
    id: "profit-history",
    name: "Profit History",
    category: "position-management",
    importanceTier: "supporting",
    whatItMeasures:
      "How an open position's actual net $ profit has evolved since entry, plus one simple forward look -- real reconstructed history (solid), not a theoretical scenario, followed by a single flat-price projection (dashed) to expiration. Replaces Phase 20's four theoretical EM-scenario lines, which real usage found less useful than seeing what actually happened plus one clearly-labeled forward look.",
    howCalculated:
      "Real segment: for each actual trading-day close from entry to today, recomputes that day's option value via Black-Scholes at that day's real price and remaining DTE (entry IV held constant throughout -- a simplification; real IV would also drift). Converts to $ profit the same direction-aware way as everywhere else: option leg alone for a cash-secured put, option leg plus stock leg (net covered P/L) for a covered call. Projected segment: continues from today's real $ profit, walking forward to expiration with the underlying held flat at today's actual price.",
    interpretHigh: "The real (solid) segment sits at or above zero and the projected (dashed) segment continues upward or flat toward the 100% target line -- tracking well so far, with no adverse move currently priced in even under a flat-price assumption.",
    interpretLow: "The real segment shows a sharp recent drop, or the projected segment sits well below the close-target line even assuming price holds flat -- worth a closer look at the ITM Classification and Close Signal reads.",
    whereItAppears: "Positions page (Profit History chart on each open position card).",
  },
  {
    id: "assignment-opportunity-cost",
    name: "Assignment Opportunity Cost",
    category: "position-management",
    importanceTier: "core",
    whatItMeasures:
      "For a meaningfully in-the-money position: a quantified, factual comparison of what assignment locks in versus what closing the position now would look like -- effective cost basis and capital freed for a put, forgone upside and cash-flow shape for a call -- plus a Trend & Sentiment Context sub-section reading recent price trend against the AI-derived news lean (explicitly not a forecast). Complements the ITM Classification's hold/close read with the concrete dollar math, but is deliberately never phrased as a recommendation -- only stated numbers, their implications, and the underlying evidence.",
    howCalculated: `Only computed once a position is meaningfully ITM -- reuses itmRiskClassification's own breach computation and its ${SELL_THE_NEWS_MAX_BREACH_PCT}% threshold as the "meaningful" cutoff, rather than a new one. Cash-secured put: effective cost basis if assigned = strike − premium collected, versus a hypothetical fresh cost basis (today's price) and the realized P/L if closed now instead; costBasisDelta = assigned basis − fresh basis (positive means assignment leaves a worse/higher basis). Capital picture: capital freed if closed now = (strike − buyback cost) × 100 × contracts, versus the cost to rebuy the same shares fresh at today's price; netCashDelta is the difference. Covered call: locked-in realized gain if assigned (proceeds capped at the strike) versus the option-leg P/L if closed now while keeping the shares; upsideForgoneIfAssigned = (current price − strike) × shares owned. Capital picture: cash received if assigned = strike × shares owned, versus $0 if closed now (shares simply retained). Trend & Sentiment Context reuses the existing SMA-trend classification (lib/trend.ts, the same logic behind the ticker Overview) and the existing AI directional lean (lib/briefing.ts, the same one behind Market Read) -- no new momentum math or new AI call. "Aligned" means trend and lean point the same direction; "conflicting" means they disagree; "insufficient" means one or both don't have a clear enough read (mixed trend, or neutral/mixed lean). Flags a caveat when the earnings-cooldown flag is active, since a recent large earnings move makes trend continuation less reliable.`,
    interpretHigh: "A large positive cost-basis delta (put) or a large upside-forgone figure (call) means the two paths differ substantially in dollar terms -- worth weighing deliberately rather than defaulting to whichever happens passively.",
    interpretLow: "A cost-basis delta near zero (put) or a small upside-forgone figure (call) means the two paths are close in dollar terms -- the choice matters less financially either way.",
    whereItAppears: "Positions page, as a dedicated panel below the ITM Classification card (with a Trend & Sentiment Context sub-section), only shown when the position is meaningfully ITM.",
  },
  {
    id: "itm-classification",
    name: "ITM Classification (Sell-the-News vs Real Breakdown)",
    category: "position-management",
    importanceTier: "core",
    whatItMeasures:
      "For an open position that's gone in-the-money against the seller, whether the move looks like a short-lived reaction (\"sell the news\") likely to fade, versus a genuine structural breakdown of the level that was supposed to hold.",
    howCalculated: `A scored decision tree over strike breach %, DTE, and recent price action. Sell-the-news points: DTE above ${SELL_THE_NEWS_MIN_DTE} days, breach under ${SELL_THE_NEWS_MAX_BREACH_PCT}%, and the recent move concentrated in the last 1-2 sessions (a single-event reaction). Real-breakdown points: DTE under ${REAL_BREAKDOWN_MAX_DTE} days, breach over ${REAL_BREAKDOWN_MIN_BREACH_PCT}%, the adverse move sustained across multiple recent sessions, or an active earnings-cooldown flag alongside a real breach. Whichever score reaches 2+ and leads wins; a tie or no clear leader classifies as "unclear" (recommended action: monitor).`,
    interpretHigh: "Classified Real Breakdown -- sustained adverse move and/or high urgency (low DTE, large breach); recommended action is typically close.",
    interpretLow: "Classified Sell-the-News -- a concentrated, likely-to-fade reaction with enough DTE and small enough breach to hold through; recommended action is typically hold.",
    whereItAppears: "Positions page, shown as a red-bordered alert card (with reasoning bullets) only when an open position is currently in-the-money.",
  },
  {
    id: "close-signal",
    name: "Close Signal",
    category: "position-management",
    importanceTier: "core",
    whatItMeasures:
      "A combined close-consider alert for an open position -- fires when either the profit target or the DTE trigger is hit, whichever comes first. (Does not currently fold in Net Covered P/L or the ITM Sell-the-News/Real-Breakdown read, which are surfaced as their own separate signals alongside this one rather than merged into a single unified verdict.)",
    howCalculated: `Fires when Profit-Captured % reaches its target (see Profit-Captured %) OR DTE falls to ${DTE_SECONDARY_TRIGGER_MIN}-${DTE_SECONDARY_TRIGGER_MAX} days or below -- whichever triggers first.`,
    interpretHigh: "Triggered -- a real close-consider signal has fired, surfaced as a yellow alert with the specific reason (profit target or DTE trigger).",
    interpretLow: "Not triggered -- neither condition has fired yet, no action prompted on this basis.",
    whereItAppears: "Positions page, shown as a yellow alert banner on an open position card when triggered.",
  },

  // ---------------------------------------------------------------------
  // Portfolio-level indicators
  // ---------------------------------------------------------------------
  {
    id: "beta-weighted-portfolio-delta",
    name: "Beta-Weighted Portfolio Delta",
    category: "portfolio",
    importanceTier: "context",
    whatItMeasures:
      "The aggregate directional exposure of every open written option position combined, expressed as an equivalent number of SPY shares -- how much your whole book currently moves with the broad market, not a per-ticker or per-position read.",
    howCalculated:
      "For each open position: current delta via Black-Scholes from that position's own strike, DTE, underlying price, and IV, then negated -- every position tracked here is a SOLD option, so the seller's actual exposure is the opposite sign of the raw long-option delta (a short call leans short, a short put leans long). Each position's contribution = -delta × contracts × 100 × (underlying price / SPY price) × the stock's beta, summed across positions. " +
      `Only computed and shown once ${MIN_OPEN_POSITIONS_FOR_PORTFOLIO_SUMMARY}+ positions are open -- below that, a single position's beta-weighted delta isn't a meaningful "portfolio" read.`,
    interpretHigh: "A positive total means your book leans net long the market -- a market-wide selloff would tend to hurt more than help, roughly in proportion to the equivalent SPY share count.",
    interpretLow: "A negative total means your book leans net short the market -- a market-wide rally would tend to hurt more than help.",
    whereItAppears: "Positions page, in a summary bar above the individual position cards (visible only at 2+ open positions), collapsed by default with an expandable per-position breakdown.",
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
    { label: "Skew", targetId: "volatility-skew" },
    { label: "Relative Strength", targetId: "relative-strength" },
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
 * The full open-position tracking pipeline (Positions page) has been
 * live since Phase 11 -- every step below is real, not conceptual. No
 * `planned` flags remain on this flow.
 */
export const EXIT_FLOW_STAGES: FlowBoxDef[][] = [
  [{ label: "Open position" }],
  [{ label: "Monitor Net Covered P/L", targetId: "net-covered-position-pl" }],
  [{ label: "Profit-Captured % vs. threshold", targetId: "profit-captured-pct" }],
  [{ label: "DTE vs. trigger", targetId: "profit-history" }],
  [{ label: "Assignment Opportunity Cost (if ITM)", targetId: "assignment-opportunity-cost" }],
  [
    {
      label: "If ITM: Sell-the-News vs. Real Breakdown",
      targetId: "itm-classification",
    },
  ],
  [{ label: "Close / Hold / Monitor recommendation", targetId: "close-signal" }],
];
