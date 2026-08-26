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
