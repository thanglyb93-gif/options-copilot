/**
 * Live analytics for tracked open positions: current contract lookup,
 * profit-captured %, theta-decay curve, ITM risk classification
 * ("sell the news" vs "real breakdown"), and the close-signal check.
 * Pure -- no API/DB calls; callers gather the raw chain/quote/closes
 * data (matches every other lib module's split in this codebase).
 */

import type { OptionsChainResult } from "./yahoo";
import type { OptionType } from "./options-math";
import { blackScholesPrice } from "./options-math";
import { assessContractReliability, type ChainContractQuoteLike } from "./flags";

export type TradeDirection = "put" | "call";

// ---------------------------------------------------------------------------
// Adjustable thresholds -- named constants, not magic numbers scattered
// through the functions below. All defaults, not fixed rules.
// ---------------------------------------------------------------------------

/** Close a cash-secured put once this % of max profit is captured. */
export const PROFIT_TARGET_CSP_PCT = 50;
/** Close a covered call once this % of max profit is captured (lower than CSP -- shares are still held either way). */
export const PROFIT_TARGET_CC_PCT = 40;
/** Secondary close trigger: once DTE falls to this level or below, regardless of profit captured. */
export const DTE_SECONDARY_TRIGGER_MIN = 21;
export const DTE_SECONDARY_TRIGGER_MAX = 25;

/** Sell-the-news signal thresholds. */
export const SELL_THE_NEWS_MIN_DTE = 14;
export const SELL_THE_NEWS_MAX_BREACH_PCT = 5;
/** Share of the last ~5 sessions' net move that must sit in the last 1-2 sessions to count as "concentrated." */
export const CONCENTRATED_MOVE_RATIO = 0.7;

/** Real-breakdown signal thresholds. */
export const REAL_BREAKDOWN_MAX_DTE = 10;
export const REAL_BREAKDOWN_MIN_BREACH_PCT = 10;
/** Share of the last ~10 sessions that must move in the adverse direction to count as "sustained." */
export const SUSTAINED_MOVE_RATIO = 0.6;

// ---------------------------------------------------------------------------
// 1. Current contract lookup -- respects Phase 7's market-hours fallback
// ---------------------------------------------------------------------------

export interface CurrentContractPrice {
  bid: number | null;
  ask: number | null;
  lastPrice: number | null;
  /** No live bid/ask because the market's closed -- lastPrice is standing in for it, same as the Strike Selector. */
  usingLastPriceFallback: boolean;
  /** Genuinely no usable price -- market's open and this contract has no real market. Never silently shown as $0. */
  unreliable: boolean;
  /** The actual number to use for buyback-cost math: live mid, or the lastPrice fallback, or null if unreliable. */
  referencePrice: number | null;
}

/** Locates the matching contract in a live chain fetch for this exact position. */
export function findCurrentContract(
  chain: OptionsChainResult,
  strike: number,
  expirationDate: string, // "YYYY-MM-DD"
  positionType: "covered_call" | "cash_secured_put"
): CurrentContractPrice | null {
  const expiration = chain.expirations.find(
    (e) => e.expirationDate.toISOString().slice(0, 10) === expirationDate
  );
  if (!expiration) return null;

  const list = positionType === "covered_call" ? expiration.calls : expiration.puts;
  const contract = list.find((c) => c.strike === strike);
  if (!contract) return null;

  const reliability = assessContractReliability(
    contract as ChainContractQuoteLike,
    chain.marketState
  );

  const hasLiveMarket = (contract.bid ?? 0) > 0 && (contract.ask ?? 0) > 0;
  const referencePrice =
    reliability.usingLastPriceFallback && contract.lastPrice != null
      ? contract.lastPrice
      : hasLiveMarket && contract.bid != null && contract.ask != null
        ? (contract.bid + contract.ask) / 2
        : null;

  return {
    bid: contract.bid ?? null,
    ask: contract.ask ?? null,
    lastPrice: contract.lastPrice ?? null,
    usingLastPriceFallback: reliability.usingLastPriceFallback,
    unreliable: reliability.unreliable,
    referencePrice,
  };
}

// ---------------------------------------------------------------------------
// 2. Profit captured
// ---------------------------------------------------------------------------

/** % of max profit already realized as the option's value has decayed. */
export function profitCaptured(premiumCollected: number, currentBuybackCost: number): number {
  if (premiumCollected <= 0) return 0;
  return ((premiumCollected - currentBuybackCost) / premiumCollected) * 100;
}

// ---------------------------------------------------------------------------
// 3. Theta decay curve
// ---------------------------------------------------------------------------

export interface DecayCurvePoint {
  dte: number;
  theoreticalValue: number;
}

/**
 * Walks DTE from `originalDte` down to 0, computing this position's own
 * theoretical option value at each step via Black-Scholes -- a real,
 * position-specific curve, not a hardcoded example table. Holds spot
 * price and IV constant across the walk deliberately: this illustrates
 * time decay in isolation, not a full price-path simulation.
 */
export function decayCurvePosition(
  strike: number,
  currentPrice: number,
  iv: number,
  originalDte: number,
  optionType: OptionType,
  riskFreeRate = 0.04
): DecayCurvePoint[] {
  const points: DecayCurvePoint[] = [];
  for (let d = originalDte; d >= 0; d--) {
    const theoreticalValue = blackScholesPrice({
      spot: currentPrice,
      strike,
      dte: d,
      volatility: iv,
      optionType,
      riskFreeRate,
    });
    points.push({ dte: d, theoreticalValue });
  }
  return points;
}

// ---------------------------------------------------------------------------
// 4. ITM risk classification -- "sell the news" vs "real breakdown"
// ---------------------------------------------------------------------------

export interface DailyCloseLike {
  date: string;
  close: number;
}

export type ItmClassification = "sell-the-news" | "real-breakdown" | "unclear";
export type RecommendedAction = "hold" | "close" | "monitor";

export interface ItmRiskClassificationResult {
  classification: ItmClassification;
  recommendedAction: RecommendedAction;
  /** Always populated -- this drives real decisions, never a bare verdict. */
  reasoning: string[];
  breachPct: number;
}

/** True if most of the last ~5 sessions' net move happened in just the last 1-2 sessions (a single-event reaction, not a trend). */
function isRecentMoveConcentrated(closes: DailyCloseLike[]): boolean {
  if (closes.length < 6) return false;
  const window = closes.slice(-6);
  const totalMove = window[window.length - 1].close - window[0].close;
  const last2SessionMove = window[window.length - 1].close - window[window.length - 3].close;
  if (Math.abs(totalMove) < 1e-9) return false;
  return Math.abs(last2SessionMove) / Math.abs(totalMove) >= CONCENTRATED_MOVE_RATIO;
}

/** True if a clear majority of the last ~10 sessions moved in the adverse direction (a trend, not a spike). */
function isSustainedMove(closes: DailyCloseLike[], direction: "down" | "up"): boolean {
  const window = closes.slice(-10);
  if (window.length < 5) return false;
  let adverseDays = 0;
  for (let i = 1; i < window.length; i++) {
    const moved = window[i].close - window[i - 1].close;
    if (direction === "down" ? moved < 0 : moved > 0) adverseDays++;
  }
  return adverseDays / (window.length - 1) >= SUSTAINED_MOVE_RATIO;
}

/**
 * Classifies an in-the-money position's move as a likely-to-fade
 * reaction vs. a genuine structural breakdown, using a simple scored
 * decision tree over the signals in the spec. Always returns reasoning
 * bullets -- this drives real close/hold decisions, never a bare verdict.
 */
export function itmRiskClassification(
  strike: number,
  currentPrice: number,
  dte: number,
  dailyCloses: DailyCloseLike[],
  earningsCooldownFlagged: boolean,
  direction: TradeDirection
): ItmRiskClassificationResult {
  const breach =
    direction === "put" ? (strike - currentPrice) / strike : (currentPrice - strike) / strike;
  const breachPct = breach * 100;

  const adverseDirection = direction === "put" ? "down" : "up";
  const adverseVerb = adverseDirection === "down" ? "decline" : "rally";
  const concentrated = isRecentMoveConcentrated(dailyCloses);
  const sustained = isSustainedMove(dailyCloses, adverseDirection);

  const reasoning: string[] = [
    `Strike breach: ${breachPct.toFixed(1)}% ${breachPct > 0 ? "in-the-money" : "not currently ITM"}.`,
    `${dte} days to expiration.`,
  ];

  let sellTheNewsScore = 0;
  let realBreakdownScore = 0;

  if (dte > SELL_THE_NEWS_MIN_DTE) {
    sellTheNewsScore++;
    reasoning.push(
      `DTE (${dte}) is above the ${SELL_THE_NEWS_MIN_DTE}-day sell-the-news threshold -- time for the move to fade.`
    );
  }
  if (breachPct < SELL_THE_NEWS_MAX_BREACH_PCT) {
    sellTheNewsScore++;
    reasoning.push(
      `Breach (${breachPct.toFixed(1)}%) is under the ${SELL_THE_NEWS_MAX_BREACH_PCT}% sell-the-news threshold.`
    );
  }
  if (concentrated) {
    sellTheNewsScore++;
    reasoning.push(
      "Recent move is concentrated in the last 1-2 sessions, consistent with a single-event reaction rather than a trend."
    );
  }

  if (dte < REAL_BREAKDOWN_MAX_DTE) {
    realBreakdownScore++;
    reasoning.push(
      `DTE (${dte}) is under the ${REAL_BREAKDOWN_MAX_DTE}-day real-breakdown threshold -- little time to recover.`
    );
  }
  if (breachPct > REAL_BREAKDOWN_MIN_BREACH_PCT) {
    realBreakdownScore++;
    reasoning.push(
      `Breach (${breachPct.toFixed(1)}%) exceeds the ${REAL_BREAKDOWN_MIN_BREACH_PCT}% real-breakdown threshold.`
    );
  }
  if (sustained) {
    realBreakdownScore++;
    reasoning.push(`The ${adverseVerb} is sustained across multiple recent sessions, not a single-day spike.`);
  }
  if (earningsCooldownFlagged && breachPct > 0) {
    realBreakdownScore++;
    reasoning.push(
      "Earnings-cooldown flag is active alongside a real breach -- a large move tied to a fundamental event, not noise."
    );
  }

  let classification: ItmClassification;
  let recommendedAction: RecommendedAction;

  if (realBreakdownScore >= 2 && realBreakdownScore > sellTheNewsScore) {
    classification = "real-breakdown";
    recommendedAction = "close";
  } else if (sellTheNewsScore >= 2 && sellTheNewsScore > realBreakdownScore) {
    classification = "sell-the-news";
    recommendedAction = "hold";
  } else {
    classification = "unclear";
    recommendedAction = "monitor";
    reasoning.push(
      "Signals are mixed -- neither a clear sell-the-news nor real-breakdown pattern. Monitor closely."
    );
  }

  return { classification, recommendedAction, reasoning, breachPct };
}

// ---------------------------------------------------------------------------
// 5. Close signal
// ---------------------------------------------------------------------------

export interface CloseSignalResult {
  shouldClose: boolean;
  reason: string | null;
}

/** Whether an open position has hit a profit-target or DTE close trigger. */
export function closeSignal(
  profitCapturedPct: number,
  dte: number,
  positionType: "covered_call" | "cash_secured_put"
): CloseSignalResult {
  const profitTarget = positionType === "cash_secured_put" ? PROFIT_TARGET_CSP_PCT : PROFIT_TARGET_CC_PCT;

  if (profitCapturedPct >= profitTarget) {
    return {
      shouldClose: true,
      reason: `Profit target reached: ${profitCapturedPct.toFixed(0)}% of max profit captured (threshold ${profitTarget}%).`,
    };
  }
  if (dte >= 0 && dte <= DTE_SECONDARY_TRIGGER_MAX) {
    return {
      shouldClose: true,
      reason: `DTE trigger: ${dte} days remaining (secondary trigger band ${DTE_SECONDARY_TRIGGER_MIN}-${DTE_SECONDARY_TRIGGER_MAX} DTE).`,
    };
  }
  return { shouldClose: false, reason: null };
}
