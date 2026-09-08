/**
 * Phase 35 -- Roll Calculator: what does rolling an open position up (or
 * out) actually cost/pay, and how much more room does the new strike
 * buy? Discussed as a concept back in the very first NBIS lesson but
 * never built -- real trade-history losses (CRCL, OKLO, NBIS) came from
 * buying back deep-ITM calls with no visibility into the roll
 * alternative. Reuses the exact same buyback-cost lookup
 * (lib/position-analytics.ts's findCurrentContract), EM Cushion,
 * structural confirmation, and Black-Scholes machinery already used
 * throughout the app -- no parallel scoring system. Pure -- no API/DB
 * calls; callers gather the live chain/SMA/range data.
 *
 * Deliberately does NOT apply Phase 34's momentum-adjusted cushion
 * buffer to the new call contract's score -- that adjustment needs a
 * full relative-strength evaluation (SPY + peer historicals), which
 * would meaningfully expand this feature's I/O for a comparison tool
 * whose main numbers are the credit/debit and EM Cushion, not the Entry
 * Score. The new contract's raw EM Cushion is still shown either way.
 */

import type { OptionsChainResult } from "./yahoo";
import type { TradeDirection } from "./entry-score";
import { findCurrentContract } from "./position-analytics";
import {
  assignmentProbabilityLabel,
  effectiveIvAndDelta,
  referencePremium,
  type OptionType,
} from "./options-math";
import { cushionScore, expectedMove, strikeCushion } from "./expected-move";
import {
  operativeResistanceRef,
  operativeSupportRef,
  structuralConfirmation,
  type OperativeReference,
  type StructuralConfirmationResult,
} from "./structural-levels";

export interface RollCurrentPosition {
  positionType: "covered_call" | "cash_secured_put";
  strike: number;
  expirationDate: string; // "YYYY-MM-DD"
  premiumCollected: number; // per share
  contracts: number;
}

export interface RollLiveChainData {
  chain: OptionsChainResult;
  underlyingPrice: number;
  sma50: number | null;
  ninetyDayLow: number | null;
  ninetyDayHigh: number | null;
}

export interface NewPositionMetrics {
  strike: number;
  expirationDate: string;
  dte: number;
  /** Per-share premium for the new contract -- the credit received for selling it. Null when there's no reliable market. */
  premium: number | null;
  emCushion: number | null;
  cushionScore: number | null;
  structuralConfirmation: StructuralConfirmationResult | null;
  assignmentProbability: string | null;
  ivUnreliable: boolean;
  usingLastPriceFallback: boolean;
}

export interface RollComparison {
  /** Per-share buyback cost of the CURRENT contract -- same lookup/fallback as the existing "close now" figure. Null when there's no reliable market. */
  costToCloseCurrent: number | null;
  currentContractUnreliable: boolean;
  currentUsingLastPriceFallback: boolean;
  /** Per-share premium for the NEW contract. Null when there's no reliable market. */
  creditFromNewContract: number | null;
  /**
   * Total $ across the position's full contract count --
   * (creditFromNewContract - costToCloseCurrent) * 100 * contracts.
   * Positive = paid to roll (a net credit); negative = it costs money to
   * roll (a net debit). Same total-$ convention as realizedLossOnCurrentLeg
   * below, so the two are directly comparable. Null when either leg's
   * price is unreliable.
   */
  netRollCreditOrDebit: number | null;
  /**
   * Total $ -- the actual cost/gain of closing the CURRENT leg right
   * now, before any roll. Identical formula to app/api/positions'
   * optionLegPL: (premiumCollected - costToCloseCurrent) * 100 *
   * contracts. Negative = a loss, the typical case this feature targets.
   */
  realizedLossOnCurrentLeg: number | null;
  newPositionMetrics: NewPositionMetrics | null;
}

function daysToExpirationFromToday(expirationDateIso: string): number {
  const ms = new Date(`${expirationDateIso}T00:00:00Z`).getTime() - Date.now();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

export function computeRoll(
  currentPosition: RollCurrentPosition,
  newStrike: number,
  newExpiration: string,
  liveChainData: RollLiveChainData
): RollComparison {
  const direction: TradeDirection = currentPosition.positionType === "covered_call" ? "call" : "put";
  const optionType: OptionType = direction;

  // 1. Cost to close the CURRENT contract.
  const currentContract = findCurrentContract(
    liveChainData.chain,
    currentPosition.strike,
    currentPosition.expirationDate,
    currentPosition.positionType
  );
  const costToCloseCurrent = currentContract?.referencePrice ?? null;

  const realizedLossOnCurrentLeg =
    costToCloseCurrent != null
      ? (currentPosition.premiumCollected - costToCloseCurrent) * 100 * currentPosition.contracts
      : null;

  // 2 & 4. New contract lookup + its EM Cushion / structural / assignment-probability metrics.
  const newExpirationEntry = liveChainData.chain.expirations.find(
    (e) => e.expirationDate.toISOString().slice(0, 10) === newExpiration
  );
  const newContractList = newExpirationEntry
    ? optionType === "call"
      ? newExpirationEntry.calls
      : newExpirationEntry.puts
    : [];
  const newContract = newContractList.find((c) => c.strike === newStrike) ?? null;

  let newPositionMetrics: NewPositionMetrics | null = null;
  let creditFromNewContract: number | null = null;

  if (newExpirationEntry && newContract) {
    const dte = daysToExpirationFromToday(newExpiration);
    const { effectiveIv, ivUnreliable, usingLastPriceFallback, delta } = effectiveIvAndDelta(
      newContract,
      optionType,
      liveChainData.underlyingPrice,
      dte,
      liveChainData.chain.marketState
    );

    creditFromNewContract = referencePremium({
      bid: newContract.bid ?? null,
      ask: newContract.ask ?? null,
      lastPrice: newContract.lastPrice ?? null,
      usingLastPriceFallback,
    });

    let emCushionValue: number | null = null;
    let cushionScoreValue: number | null = null;
    if (!ivUnreliable && effectiveIv != null) {
      const em = expectedMove(liveChainData.underlyingPrice, effectiveIv, dte);
      emCushionValue = strikeCushion(liveChainData.underlyingPrice, newStrike, em, direction);
      cushionScoreValue = cushionScore(emCushionValue);
    }

    const operativeRef: OperativeReference | null =
      direction === "put"
        ? operativeSupportRef(liveChainData.underlyingPrice, liveChainData.sma50, liveChainData.ninetyDayLow)
        : operativeResistanceRef(liveChainData.underlyingPrice, liveChainData.sma50, liveChainData.ninetyDayHigh);

    newPositionMetrics = {
      strike: newStrike,
      expirationDate: newExpiration,
      dte,
      premium: creditFromNewContract,
      emCushion: emCushionValue,
      cushionScore: cushionScoreValue,
      structuralConfirmation: operativeRef ? structuralConfirmation(newStrike, operativeRef, direction) : null,
      assignmentProbability: delta != null ? assignmentProbabilityLabel(delta) : null,
      ivUnreliable,
      usingLastPriceFallback,
    };
  }

  // 3. Net roll credit/debit -- total $, directly comparable to realizedLossOnCurrentLeg.
  const netRollCreditOrDebit =
    creditFromNewContract != null && costToCloseCurrent != null
      ? (creditFromNewContract - costToCloseCurrent) * 100 * currentPosition.contracts
      : null;

  return {
    costToCloseCurrent,
    currentContractUnreliable: currentContract?.unreliable ?? true,
    currentUsingLastPriceFallback: currentContract?.usingLastPriceFallback ?? false,
    creditFromNewContract,
    netRollCreditOrDebit,
    realizedLossOnCurrentLeg,
    newPositionMetrics,
  };
}
