/**
 * Decision-support flags for covered calls / cash-secured puts. No API/DB
 * calls -- unit-testable in isolation.
 */

export interface DailyClose {
  date: string; // ISO date
  close: number;
}

export interface EarningsCooldownResult {
  flagged: boolean;
  percentMove: number | null;
}

/**
 * Flags a >15% price move over the trailing 10 trading days, using daily
 * closes sorted oldest-to-newest. Requires at least 11 closes (10 days of
 * movement); returns percentMove: null if there isn't enough history.
 */
export function earningsCooldownFlag(
  closes: DailyClose[],
  thresholdPercent = 15
): EarningsCooldownResult {
  if (closes.length < 11) {
    return { flagged: false, percentMove: null };
  }

  const recent = closes.slice(-11);
  const priorClose = recent[0].close;
  const latestClose = recent[recent.length - 1].close;

  if (priorClose === 0) {
    return { flagged: false, percentMove: null };
  }

  const percentMove = ((latestClose - priorClose) / priorClose) * 100;

  return {
    flagged: Math.abs(percentMove) > thresholdPercent,
    percentMove,
  };
}

/** Whether |delta| falls within the target band (default 0.20-0.30). */
export function deltaBandFlag(
  delta: number,
  min = 0.2,
  max = 0.3
): boolean {
  const absDelta = Math.abs(delta);
  return absDelta >= min && absDelta <= max;
}

/** Whether days-to-expiration falls within the target band (default 30-45). */
export function dteBandFlag(dte: number, min = 30, max = 45): boolean {
  return dte >= min && dte <= max;
}

export interface ContractQuoteLike {
  bid?: number | null;
  ask?: number | null;
  impliedVolatility?: number | null;
}

/**
 * Flags a contract's IV (and anything derived from it, like delta/theta)
 * as unreliable. Two independent sources of garbage observed against real
 * data: (1) contracts with no live two-sided market (bid and ask both
 * zero/absent) get a stale or placeholder IV from Yahoo rather than a
 * real market-implied one, producing degenerate Black-Scholes greeks;
 * (2) even quoted contracts occasionally show implausible IV (>200%),
 * typically deep-ITM or otherwise illiquid strikes.
 */
export function unreliableIvFlag(
  contract: ContractQuoteLike,
  threshold = 2.0
): boolean {
  const hasLiveMarket = (contract.bid ?? 0) > 0 && (contract.ask ?? 0) > 0;
  if (!hasLiveMarket) return true;

  const iv = contract.impliedVolatility;
  if (iv == null || iv <= 0 || iv > threshold) return true;

  return false;
}

export interface ChainContractQuoteLike extends ContractQuoteLike {
  lastPrice?: number | null;
}

export interface ContractReliability {
  /** Genuinely no usable pricing signal -- flag it in the UI as before. */
  unreliable: boolean;
  /**
   * No live bid/ask, but the market is closed (so that's expected) and
   * there's a real last-traded price to fall back on for premium/greeks.
   */
  usingLastPriceFallback: boolean;
}

/**
 * Market-hours-aware version of unreliableIvFlag, used for the options
 * chain table. A contract with no live bid/ask is only "unreliable" if the
 * market is actually open right now (a real data-quality problem) -- when
 * the market is closed, zeroed-out bid/ask is expected, and the contract's
 * lastPrice (if any) is used as a best-effort stand-in instead of flagging
 * the row broken.
 */
export function assessContractReliability(
  contract: ChainContractQuoteLike,
  marketState: string | undefined,
  threshold = 2.0
): ContractReliability {
  const hasLiveMarket = (contract.bid ?? 0) > 0 && (contract.ask ?? 0) > 0;
  const marketOpen = marketState === "REGULAR";
  const hasLastPriceFallback =
    !hasLiveMarket && !marketOpen && (contract.lastPrice ?? 0) > 0;

  if (!hasLiveMarket && !hasLastPriceFallback) {
    return { unreliable: true, usingLastPriceFallback: false };
  }

  const iv = contract.impliedVolatility;
  const ivSane = iv != null && iv > 0 && iv <= threshold;

  return { unreliable: !ivSane, usingLastPriceFallback: hasLastPriceFallback };
}
