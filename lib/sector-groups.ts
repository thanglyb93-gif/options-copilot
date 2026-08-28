/**
 * Sector/peer-group config for the Screener's relative-strength
 * comparison. A maintainable data map, not logic scattered across
 * files -- adding coverage for a new ticker (or a new group) is one
 * entry here, nothing else to touch. Any ticker not listed below still
 * works everywhere relative strength is computed: it just falls back to
 * broad-market-only comparison (SPY), with no sector comparison, rather
 * than erroring (see lib/relative-strength.ts).
 */

export interface SectorGroup {
  name: string;
  /** Every ticker considered a peer in this group (including the ticker being evaluated, if it's a member -- callers exclude the ticker itself when averaging peer returns). */
  peers: string[];
  /** Sector/theme ETF proxy used as an additional real-world benchmark alongside SPY. */
  benchmarkEtf: string;
}

export const SECTOR_GROUPS: Record<string, SectorGroup> = {
  semiconductors: {
    name: "Semiconductors",
    peers: ["MU", "MRVL", "INTC", "CRDO"],
    benchmarkEtf: "SOXX",
  },
  "ai-infrastructure": {
    name: "AI Infrastructure",
    peers: ["CRWV", "NBIS", "IREN"],
    benchmarkEtf: "SMH",
  },
  "megacap-tech": {
    name: "Megacap Tech",
    peers: ["META", "NVDA"],
    benchmarkEtf: "QQQ",
  },
  "enterprise-software": {
    name: "Enterprise Software & Data",
    peers: ["PLTR", "RBRK"],
    benchmarkEtf: "IGV",
  },
  "space-aerospace": {
    name: "Space & Aerospace",
    peers: ["RKLB", "SPCX"],
    benchmarkEtf: "ARKX",
  },
};

/** Reverse index, built once from SECTOR_GROUPS -- the only place ticker -> group lookups happen. */
const TICKER_TO_GROUP_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(SECTOR_GROUPS).flatMap(([key, group]) => group.peers.map((ticker) => [ticker, key]))
);

/** The sector group a ticker belongs to, or null if it isn't covered by any defined group yet. */
export function sectorGroupForTicker(ticker: string): SectorGroup | null {
  const key = TICKER_TO_GROUP_KEY[ticker.toUpperCase()];
  return key ? SECTOR_GROUPS[key] : null;
}

/** The ticker's peers within its group, excluding itself. Empty array if the ticker has no defined group. */
export function peerTickersFor(ticker: string): string[] {
  const group = sectorGroupForTicker(ticker);
  if (!group) return [];
  const upper = ticker.toUpperCase();
  return group.peers.filter((p) => p.toUpperCase() !== upper);
}
