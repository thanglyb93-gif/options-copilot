/**
 * Structural support/resistance check against a strike. Pure -- no
 * API/DB calls. Callers pass in already-computed SMA50 and 90-day
 * high/low (see lib/yahoo.ts's simpleMovingAverage / computeThreeMonthRange)
 * rather than raw historicals, keeping this module decoupled from data
 * fetching.
 */

import type { TradeDirection } from "./entry-score";

export interface OperativeReference {
  value: number;
  label: string;
}

/** The support reference to check a put strike against. */
export function operativeSupportRef(
  currentPrice: number,
  sma50: number | null,
  ninetyDayLow: number | null
): OperativeReference | null {
  if (sma50 != null && currentPrice >= sma50) {
    return { value: sma50, label: "50-day SMA" };
  }
  if (ninetyDayLow != null) {
    return { value: ninetyDayLow, label: "90-day low" };
  }
  if (sma50 != null) {
    return { value: sma50, label: "50-day SMA" };
  }
  return null;
}

/** The resistance reference to check a call strike against. */
export function operativeResistanceRef(
  currentPrice: number,
  sma50: number | null,
  ninetyDayHigh: number | null
): OperativeReference | null {
  if (sma50 != null && currentPrice <= sma50) {
    return { value: sma50, label: "50-day SMA" };
  }
  if (ninetyDayHigh != null) {
    return { value: ninetyDayHigh, label: "90-day high" };
  }
  if (sma50 != null) {
    return { value: sma50, label: "50-day SMA" };
  }
  return null;
}

export interface StructuralConfirmationResult {
  confirmed: boolean;
  referenceLabel: string;
}

/**
 * Whether `strike` sits on the safe side of the operative reference --
 * below support for a put, above resistance for a call.
 */
export function structuralConfirmation(
  strike: number,
  operativeRef: OperativeReference,
  direction: TradeDirection
): StructuralConfirmationResult {
  const confirmed =
    direction === "put" ? strike < operativeRef.value : strike > operativeRef.value;
  return { confirmed, referenceLabel: operativeRef.label };
}
