/**
 * Live analytics for tracked open positions: current contract lookup,
 * profit-captured %, theta-decay curve, ITM risk classification
 * ("sell the news" vs "real breakdown"), and the close-signal check.
 * Pure -- no API/DB calls; callers gather the raw chain/quote/closes
 * data (matches every other lib module's split in this codebase).
 */

import type { OptionsChainResult } from "./yahoo";
import type { OptionType } from "./options-math";
import { blackScholesPrice, cashSecuredPutPL, coveredCallPL } from "./options-math";
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
// 3. Profit history -- one $ P/L line in two segments: REAL (reconstructed
// from actual historical closes, entry through today) and PROJECTED (today
// through expiration, price held flat at today's actual level). Replaces
// Phase 20's four theoretical EM-scenario lines, which real usage found
// less useful than seeing what actually happened plus one simple forward
// look.
// ---------------------------------------------------------------------------

export interface ProfitHistoryPoint {
  day: number;
  profitDollars: number;
}

export interface ProfitHistoryResult {
  /** Actual reconstructed P/L, day 0 (entry) through today (inclusive) -- solid segment. */
  real: ProfitHistoryPoint[];
  /** Forward projection, today (inclusive, same point as real's last entry) through expiration, price held flat at today's actual level -- dashed segment. */
  projected: ProfitHistoryPoint[];
}

export interface ProfitHistoryClose {
  date: string; // "YYYY-MM-DD"
  close: number;
}

export interface ProfitHistoryInput {
  strike: number;
  /**
   * IV held constant for the whole walk (both segments). In practice
   * this is the position's current chain IV, standing in for a true
   * historical entry-time IV -- no per-contract IV history is stored,
   * so this is the best available anchor (same simplification the
   * Phase 20 scenario lines used). Real IV would also drift day to
   * day; modeling that adds real complexity for a modest accuracy
   * gain over this simpler, clearly-labeled approximation.
   */
  entryIv: number;
  /** Full days from entry to expiration (not remaining DTE). */
  totalDte: number;
  /** Today's day-offset from entry, clamped to [0, totalDte]. */
  daysElapsed: number;
  /** Per-share premium collected. */
  premiumCollected: number;
  contracts: number;
  positionType: "covered_call" | "cash_secured_put";
  /** Covered call only. */
  costBasis: number | null;
  /** Covered call only -- actual owned shares, which may not exactly equal contracts * 100. */
  sharesOwned: number | null;
  /** Real daily closes covering at least [opened_at, today] -- already fetched elsewhere for entry-price lookup, not a new data source. */
  closes: ProfitHistoryClose[];
  openedAtIso: string;
  /** Today's live underlying price -- anchors the flat projected segment. */
  currentPrice: number;
  /** Today's real (non-theoretical) $ profit -- reused verbatim as the boundary point between segments, not recomputed via Black-Scholes, so the two segments meet without a visual jump. */
  todayProfitDollars: number;
  riskFreeRate?: number;
}

function daysBetweenDates(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10) + "T00:00:00Z").getTime();
  const to = new Date(toIso.slice(0, 10) + "T00:00:00Z").getTime();
  return Math.round((to - from) / (24 * 60 * 60 * 1000));
}

/**
 * $ profit at a given underlying price and remaining DTE -- the same
 * direction-aware formula for both segments: option leg alone for a
 * cash-secured put, option leg plus stock leg (net covered P/L) for a
 * covered call. Never the option leg alone for a covered position.
 */
function profitAtPrice(
  price: number,
  remainingDte: number,
  strike: number,
  entryIv: number,
  optionType: OptionType,
  premiumCollected: number,
  contracts: number,
  positionType: "covered_call" | "cash_secured_put",
  costBasis: number | null,
  sharesOwned: number | null,
  riskFreeRate: number
): number {
  const theoreticalOptionValue = blackScholesPrice({
    spot: price,
    strike,
    dte: remainingDte,
    volatility: entryIv,
    optionType,
    riskFreeRate,
  });
  const optionLegProfit = (premiumCollected - theoreticalOptionValue) * 100 * contracts;

  if (positionType !== "covered_call") return optionLegProfit;
  const stockProfit = costBasis != null && sharesOwned != null ? (price - costBasis) * sharesOwned : 0;
  return optionLegProfit + stockProfit;
}

/**
 * Builds the real (entry-to-today, from actual historical closes) and
 * projected (today-to-expiration, price held flat) segments of the
 * Profit History chart.
 *
 * Real segment: for each actual trading-day close strictly before
 * today, reconstructs that day's option value via Black-Scholes at
 * that day's real price and remaining DTE (entry IV held constant),
 * then converts to $ profit. Non-trading days (weekends/holidays)
 * simply have no close and are skipped, not fabricated. Today itself
 * is appended using the real, already-computed current $ profit
 * (todayProfitDollars) rather than a Black-Scholes reconstruction, so
 * the line reflects the actual live market quote at the boundary.
 *
 * Projected segment: starts at that same today point, then walks
 * forward to expiration with the underlying held flat at today's
 * actual price, recomputing Black-Scholes value at each shrinking DTE.
 */
export function generateProfitHistory(input: ProfitHistoryInput): ProfitHistoryResult {
  const {
    strike,
    entryIv,
    totalDte,
    daysElapsed,
    premiumCollected,
    contracts,
    positionType,
    costBasis,
    sharesOwned,
    closes,
    openedAtIso,
    currentPrice,
    todayProfitDollars,
    riskFreeRate = 0.04,
  } = input;

  const optionType: OptionType = positionType === "covered_call" ? "call" : "put";
  const today = Math.max(0, Math.min(daysElapsed, totalDte));

  const real: ProfitHistoryPoint[] = [];
  for (const c of closes) {
    const day = daysBetweenDates(openedAtIso, c.date);
    if (day < 0 || day >= today) continue;
    const profitDollars = profitAtPrice(
      c.close,
      totalDte - day,
      strike,
      entryIv,
      optionType,
      premiumCollected,
      contracts,
      positionType,
      costBasis,
      sharesOwned,
      riskFreeRate
    );
    real.push({ day, profitDollars });
  }
  real.sort((a, b) => a.day - b.day);
  real.push({ day: today, profitDollars: todayProfitDollars });

  const projected: ProfitHistoryPoint[] = [{ day: today, profitDollars: todayProfitDollars }];
  for (let day = today + 1; day <= totalDte; day++) {
    const profitDollars = profitAtPrice(
      currentPrice,
      totalDte - day,
      strike,
      entryIv,
      optionType,
      premiumCollected,
      contracts,
      positionType,
      costBasis,
      sharesOwned,
      riskFreeRate
    );
    projected.push({ day, profitDollars });
  }

  return { real, projected };
}

export interface ProfitTrajectoryTodayMarker {
  day: number;
  profitDollars: number;
}

/**
 * The chart's one real (non-theoretical) data point: today's actual P/L,
 * reusing the already-computed live figures (netCoveredPL for a covered
 * call, optionLegPL for a cash-secured put) rather than recomputing
 * anything.
 */
export function todayMarkerForPosition(
  daysElapsed: number,
  positionType: "covered_call" | "cash_secured_put",
  netCoveredPL: number | null,
  optionLegPL: number | null
): ProfitTrajectoryTodayMarker | null {
  const profitDollars = positionType === "covered_call" ? netCoveredPL : optionLegPL;
  if (profitDollars == null) return null;
  return { day: Math.max(0, daysElapsed), profitDollars };
}

/**
 * Max profit at expiration (settlement exactly at strike) -- reuses the
 * same P/L formulas lib/options-math.ts already provides for the
 * pre-trade Strike Selector, rather than a new max-profit calculation.
 * Powers the chart's "100% target" reference line.
 */
export function maxProfitForPosition(
  positionType: "covered_call" | "cash_secured_put",
  strike: number,
  premiumCollected: number,
  contracts: number,
  costBasis: number | null,
  sharesOwned: number | null
): number | null {
  const totalPremium = premiumCollected * 100 * contracts;
  if (positionType === "cash_secured_put") {
    return cashSecuredPutPL(strike, strike, totalPremium, 100 * contracts);
  }
  if (costBasis == null || sharesOwned == null) return null;
  return coveredCallPL(strike, strike, costBasis, sharesOwned, totalPremium);
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
// 4b. Assignment opportunity cost -- quantified comparison for an
// in-the-money position: what assignment locks in vs. what closing now
// (and either buying fresh, for a put, or keeping the shares, for a
// call) would look like. Purely factual numbers + a descriptive
// narrative -- never a directive. Complements itmRiskClassification
// above (hold/close read), doesn't replace it.
// ---------------------------------------------------------------------------

function fmtDollars(value: number): string {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export interface AssignmentOpportunityCostPut {
  positionType: "cash_secured_put";
  ifAssigned: {
    /** strike - premiumCollected, per share. */
    effectiveCostBasis: number;
  };
  ifCloseNow: {
    /** Total $ -- (premiumCollected - costToCloseNow) * 100 * contracts. Likely negative (a loss) for an ITM put. This is the actual cost of closing -- always shown explicitly, never left implied by the derived deltas below. */
    realizedPL: number;
    /** Per share -- currentPrice, if shares were bought fresh at today's price instead. */
    hypotheticalFreshBasis: number;
  };
  /** effectiveCostBasis - hypotheticalFreshBasis, per share. Positive means assignment leaves a worse (higher) cost basis than closing now and buying fresh. */
  costBasisDelta: number;
  /** The cash/capital side of the comparison, distinct from the cost-basis (per-share) comparison above -- both matter, neither replaces the other. */
  capital: {
    /** Total $ -- (strike - costToCloseNow) * 100 * contracts. Cash returned to available balance after buying back the put: strike * 100 * contracts was reserved at entry, costToCloseNow * 100 * contracts is spent to close. */
    capitalFreedIfCloseNow: number;
    /** Total $ -- currentPrice * 100 * contracts. Cost to immediately buy the same share count fresh at today's price instead of via assignment. */
    ifRebuyFreshShares: number;
    /** capitalFreedIfCloseNow - ifRebuyFreshShares. Positive means cash left over after closing and rebuying fresh; negative means additional cash would be needed beyond what closing frees. */
    netCashDelta: number;
  };
  narrative: string;
  capitalNarrative: string;
}

export interface AssignmentOpportunityCostCall {
  positionType: "covered_call";
  ifAssigned: {
    /** Per share -- the strike, capped. */
    proceeds: number;
    /** Total $ -- (strike - costBasis) * shares + premiumCollected * 100 * contracts (same formula as maxProfitForPosition). */
    realizedGain: number;
  };
  ifCloseNow: {
    /** Total $, option leg only -- (premiumCollected - costToCloseNow) * 100 * contracts. Likely negative (a loss) for an ITM call. This is the actual cost of closing -- always shown explicitly, never left implied by the derived figures below. */
    realizedPL: number;
    /** Total $ -- currentPrice * sharesOwned, value of the shares retained. */
    sharesRetainedValue: number;
  };
  /** Total $ -- (currentPrice - strike) * sharesOwned. Upside left on the table if assigned instead of closing and keeping the shares. */
  upsideForgoneIfAssigned: number;
  /**
   * A simpler parallel note than the put's capital object -- a covered
   * call's cash flow shape is different (no reserved cash to "free up");
   * assignment is a cash INFLOW (shares called away for cash), closing
   * is not (shares simply stay retained).
   */
  capital: {
    /**
     * Total $ -- strike * sharesOwned. Cash received if assigned (shares
     * called away). Uses the actual owned share count, matching
     * realizedGain/sharesRetainedValue's existing convention -- not a
     * bare strike * 100 * contracts, since sharesOwned may not exactly
     * equal that (see the ifAssigned.realizedGain field above).
     */
    cashReceivedIfAssigned: number;
    /** Always 0 -- closing now generates no cash inflow; the shares are retained instead. */
    cashReceivedIfCloseNow: number;
  };
  narrative: string;
  capitalNarrative: string;
}

export type AssignmentOpportunityCostResult = AssignmentOpportunityCostPut | AssignmentOpportunityCostCall;

/**
 * Only meaningful once a position is genuinely in-the-money, not at a
 * razor-thin breach -- reuses itmRiskClassification's own
 * SELL_THE_NEWS_MAX_BREACH_PCT threshold as that "meaningful" cutoff
 * (rather than inventing a new one), and takes `breachPct` as an input
 * computed by that same function, not recomputed here.
 */
export function assignmentOpportunityCost(
  positionType: "covered_call" | "cash_secured_put",
  strike: number,
  premiumCollected: number,
  contracts: number,
  costBasis: number | null,
  sharesOwned: number | null,
  currentPrice: number,
  costToCloseNow: number,
  breachPct: number
): AssignmentOpportunityCostResult | null {
  if (breachPct <= SELL_THE_NEWS_MAX_BREACH_PCT) return null;

  const totalPremium = premiumCollected * 100 * contracts;
  const realizedPLOption = (premiumCollected - costToCloseNow) * 100 * contracts;

  if (positionType === "cash_secured_put") {
    const effectiveCostBasis = strike - premiumCollected;
    const hypotheticalFreshBasis = currentPrice;
    const costBasisDelta = effectiveCostBasis - hypotheticalFreshBasis;

    const deltaWord = costBasisDelta > 0 ? "a higher (worse)" : costBasisDelta < 0 ? "a lower (better)" : "the same";
    const narrative =
      `Closing now realizes a ${fmtDollars(Math.abs(realizedPLOption))} ${realizedPLOption >= 0 ? "gain" : "loss"} on the option ` +
      `and leaves a fresh cost basis of ${fmtDollars(hypotheticalFreshBasis)} if shares were bought at today's price, ` +
      `versus an effective cost basis of ${fmtDollars(effectiveCostBasis)} if assigned instead -- ` +
      `${fmtDollars(Math.abs(costBasisDelta))} ${deltaWord} basis than buying fresh.`;

    const capitalFreedIfCloseNow = (strike - costToCloseNow) * 100 * contracts;
    const ifRebuyFreshShares = currentPrice * 100 * contracts;
    const netCashDelta = capitalFreedIfCloseNow - ifRebuyFreshShares;
    const cashWord = netCashDelta > 0 ? "left over" : netCashDelta < 0 ? "additional cash needed" : "exactly enough";
    const capitalNarrative =
      `Closing now frees ${fmtDollars(capitalFreedIfCloseNow)} of the ${fmtDollars(strike * 100 * contracts)} reserved for this put ` +
      `(strike value minus the ${fmtDollars(costToCloseNow * 100 * contracts)} buyback cost); buying the same ${100 * contracts} shares ` +
      `fresh at today's price would cost ${fmtDollars(ifRebuyFreshShares)} -- a net cash difference of ${fmtDollars(Math.abs(netCashDelta))} (${cashWord}) ` +
      `versus assignment, which instead applies the reserved cash directly at the strike.`;

    return {
      positionType: "cash_secured_put",
      ifAssigned: { effectiveCostBasis },
      ifCloseNow: { realizedPL: realizedPLOption, hypotheticalFreshBasis },
      costBasisDelta,
      capital: { capitalFreedIfCloseNow, ifRebuyFreshShares, netCashDelta },
      narrative,
      capitalNarrative,
    };
  }

  if (costBasis == null || sharesOwned == null) return null;

  const realizedGain = coveredCallPL(strike, strike, costBasis, sharesOwned, totalPremium);
  const sharesRetainedValue = currentPrice * sharesOwned;
  const upsideForgoneIfAssigned = (currentPrice - strike) * sharesOwned;

  const narrative =
    `If assigned, proceeds are capped at the ${fmtDollars(strike)} strike for a locked-in realized gain of ${fmtDollars(realizedGain)}. ` +
    `Closing the call now instead realizes a ${fmtDollars(Math.abs(realizedPLOption))} ${realizedPLOption >= 0 ? "gain" : "loss"} on the option ` +
    `while keeping the shares (currently worth ${fmtDollars(sharesRetainedValue)}), leaving ${fmtDollars(upsideForgoneIfAssigned)} ` +
    `of additional upside in play if the price keeps rising past the strike.`;

  const cashReceivedIfAssigned = strike * sharesOwned;
  const capitalNarrative =
    `If assigned, ${fmtDollars(cashReceivedIfAssigned)} in cash is received as the shares are called away at the strike. ` +
    `Closing now instead generates no cash inflow -- the shares stay retained, worth ${fmtDollars(sharesRetainedValue)} at today's price.`;

  return {
    positionType: "covered_call",
    ifAssigned: { proceeds: strike, realizedGain },
    ifCloseNow: { realizedPL: realizedPLOption, sharesRetainedValue },
    upsideForgoneIfAssigned,
    capital: { cashReceivedIfAssigned, cashReceivedIfCloseNow: 0 },
    narrative,
    capitalNarrative,
  };
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
