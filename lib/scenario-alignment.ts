/**
 * Alignment check between two EXISTING signals -- SMA trend classification
 * (lib/trend.ts, already powering the ticker Overview) and the AI-derived
 * directional lean (lib/briefing.ts, already powering Market Read) -- for
 * a position that's meaningfully in-the-money. This is explicitly NOT a
 * forecast, probability, or prediction of future price movement: it is
 * backward-looking context (what has the stock actually been doing, and
 * what has recent news actually said) presented for the user's own
 * judgment. No new momentum math is computed here -- both inputs are
 * reused verbatim from their existing sources. Pure -- no API/DB calls;
 * the caller gathers trend/lean data from the existing pipelines.
 */

import type { TrendClassification } from "./trend";
import type { DirectionalLean } from "./briefing";

export type ScenarioAlignmentLabel = "aligned" | "conflicting" | "insufficient";

export interface ScenarioAlignmentResult {
  trendClassification: TrendClassification | null;
  lean: DirectionalLean;
  leanRationale: string;
  /**
   * Whether trend and lean point the same direction ("aligned"),
   * opposite directions ("conflicting"), or there isn't a clear enough
   * read from one or both to say ("insufficient" -- trend is mixed, or
   * lean is neutral/mixed). Purely describes agreement between the two
   * existing signals; it is not itself a forecast.
   */
  alignment: ScenarioAlignmentLabel;
  /**
   * Plain-language read of what this alignment means for THIS specific
   * position (a put wants the stock to hold up; a call being assigned
   * locks in a capped gain) -- context for interpreting the alignment
   * label, not an additional data point.
   */
  interpretation: string;
  /** Present only when a recent large earnings-driven move is active for this stock. */
  caveat?: string;
}

function trendScore(trend: TrendClassification | null): -1 | 0 | 1 {
  if (trend === "uptrend") return 1;
  if (trend === "downtrend") return -1;
  return 0; // mixed or unknown -- no clear directional read
}

function leanScore(lean: DirectionalLean): -1 | 0 | 1 {
  if (lean === "bullish") return 1;
  if (lean === "bearish") return -1;
  return 0; // neutral or mixed -- no clear directional read
}

/**
 * Position-type-specific plain-language interpretation. A put seller's
 * risk-relevant direction is the stock NOT falling through the strike
 * below; a call seller's is the stock NOT rallying (uncapped) through
 * the strike above -- these are genuinely different framings even when
 * the underlying trend/lean data is the same, so put and call get
 * distinct sentences rather than one generic "aligned/conflicting" line.
 */
function interpretForPosition(
  direction: "put" | "call",
  trend: TrendClassification | null,
  lean: DirectionalLean,
  alignment: ScenarioAlignmentLabel
): string {
  const bullishOrNeutral = lean === "bullish" || lean === "neutral";
  const bearishOrMixed = lean === "bearish" || lean === "mixed";

  if (direction === "put") {
    const favorableForHolding = (trend === "uptrend" || trend === "mixed") && bullishOrNeutral;
    const unfavorableForHolding = trend === "downtrend" && bearishOrMixed;
    if (favorableForHolding) {
      return "Nothing here points toward the stock falling further -- the more favorable combination for continuing to hold this put.";
    }
    if (unfavorableForHolding) {
      return "Both trend and recent news lean toward further downside -- the less favorable combination for holding this put.";
    }
    if (alignment === "conflicting") {
      return "Trend and recent news point in different directions for this put -- each has a clear read on its own, but they disagree with each other.";
    }
    return "Trend or sentiment (or both) doesn't have a clear enough read to say anything either way for this put.";
  }

  const favorableForClosing = trend === "uptrend" && bullishOrNeutral;
  const favorableForAssignment = trend === "downtrend" && bearishOrMixed;
  if (favorableForClosing) {
    return "Trend and recent news both lean toward the stock continuing higher -- closing (rather than being assigned) would preserve more of that potential upside.";
  }
  if (favorableForAssignment) {
    return "Trend and recent news both lean toward the rally stalling or reversing -- assignment would lock in the gain already priced in rather than risk giving it back.";
  }
  if (alignment === "conflicting") {
    return "Trend and recent news point in different directions for this call -- each has a clear read on its own, but they disagree with each other.";
  }
  return "Trend or sentiment (or both) doesn't have a clear enough read to say anything either way for this call.";
}

/**
 * direction: which leg is being sold ("put" for a cash-secured put,
 * "call" for a covered call). trendClassification: from
 * lib/trend.ts's classifyTrend, computed elsewhere -- not recomputed
 * here. lean/leanRationale: from the existing directional-lean briefing
 * (lib/briefing.ts), also computed elsewhere. earningsCooldownFlagged:
 * from the existing earnings-cooldown check (lib/flags.ts).
 */
export function scenarioAlignment(
  direction: "put" | "call",
  trendClassification: TrendClassification | null,
  lean: DirectionalLean,
  leanRationale: string,
  earningsCooldownFlagged: boolean
): ScenarioAlignmentResult {
  const tScore = trendScore(trendClassification);
  const lScore = leanScore(lean);

  let alignment: ScenarioAlignmentLabel;
  if (tScore === 0 || lScore === 0) {
    alignment = "insufficient";
  } else if (tScore === lScore) {
    alignment = "aligned";
  } else {
    alignment = "conflicting";
  }

  const interpretation = interpretForPosition(direction, trendClassification, lean, alignment);

  const caveat = earningsCooldownFlagged
    ? "A recent large earnings-driven move is active for this stock -- trend continuation is less reliable near catalysts like this."
    : undefined;

  return { trendClassification, lean, leanRationale, alignment, interpretation, caveat };
}
