import { paidFetch } from "./index.ts";

interface PressureCoin {
  coin: string;
  long_pressure: number;
  short_pressure: number;
  long_avg_entry: number;
  short_avg_entry: number;
  long_smart_count: number;
  short_smart_count: number;
  smart_positions: Array<Record<string, unknown>>;
}

interface PressureSummaryCoin {
  coin: string;
  long_pressure: number;
  short_pressure: number;
  long_percent: number;
  short_percent: number;
  long_avg_entry: number;
  short_avg_entry: number;
}

async function main() {
  console.log("=== Hyperliquid Long/Short Pressure Analysis ===\n");

  // Call both endpoints in parallel
  const [pairsResult, summaryResult] = await Promise.all([
    paidFetch("/api/v1/hl/pressure/pairs").catch((err) => {
      console.error("pressure/pairs error:", err.message);
      return null;
    }),
    paidFetch("/api/v1/hl/pressure/summary").catch((err) => {
      console.error("pressure/summary error:", err.message);
      return null;
    }),
  ]);

  // --- Pressure Pairs (Heavy tier) ---
  if (pairsResult) {
    console.log(`--- pressure/pairs ---`);
    console.log(`Cost: $${pairsResult.price.toFixed(4)} USDC`);
    console.log(`Settlement TX: ${pairsResult.settlement?.transaction ?? "N/A"}\n`);

    const pairsData = pairsResult.data as { coins: PressureCoin[] };
    const coins = pairsData.coins ?? [];

    // Sort by absolute imbalance (difference between long and short pressure)
    const sorted = [...coins].sort((a, b) => {
      const imbalanceA = Math.abs(a.long_pressure - a.short_pressure);
      const imbalanceB = Math.abs(b.long_pressure - b.short_pressure);
      return imbalanceB - imbalanceA;
    });

    console.log(`Coins returned: ${sorted.length}`);
    console.log(`Sorted by biggest long/short imbalance:\n`);

    for (const coin of sorted) {
      const imbalance = coin.long_pressure - coin.short_pressure;
      const direction = imbalance > 0 ? "LONG-HEAVY" : imbalance < 0 ? "SHORT-HEAVY" : "NEUTRAL";
      const ratio =
        coin.short_pressure > 0
          ? (coin.long_pressure / coin.short_pressure).toFixed(2)
          : coin.long_pressure > 0
            ? "Inf"
            : "N/A";

      console.log(`  ${coin.coin}`);
      console.log(`    Long pressure:  ${coin.long_pressure.toLocaleString()}`);
      console.log(`    Short pressure: ${coin.short_pressure.toLocaleString()}`);
      console.log(`    Imbalance:      ${Math.abs(imbalance).toLocaleString()} (${direction})`);
      console.log(`    L/S ratio:      ${ratio}`);
      console.log(`    Long avg entry:  ${coin.long_avg_entry}`);
      console.log(`    Short avg entry: ${coin.short_avg_entry}`);
      console.log(`    Smart longs:  ${coin.long_smart_count}  |  Smart shorts: ${coin.short_smart_count}`);

      if (coin.smart_positions && coin.smart_positions.length > 0) {
        console.log(`    Smart positions (${coin.smart_positions.length}):`);
        for (const pos of coin.smart_positions) {
          console.log(`      ${JSON.stringify(pos)}`);
        }
      }
      console.log();
    }

    // Print full raw JSON for completeness
    console.log(`\n--- pressure/pairs raw JSON ---`);
    console.log(JSON.stringify(pairsData, null, 2));
  }

  // --- Pressure Summary (Medium tier) ---
  if (summaryResult) {
    console.log(`\n--- pressure/summary ---`);
    console.log(`Cost: $${summaryResult.price.toFixed(4)} USDC`);
    console.log(`Settlement TX: ${summaryResult.settlement?.transaction ?? "N/A"}\n`);

    const summaryData = summaryResult.data as { coins: PressureSummaryCoin[] };
    const coins = summaryData.coins ?? [];

    // Sort by biggest percentage imbalance
    const sorted = [...coins].sort((a, b) => {
      const imbalanceA = Math.abs((a.long_percent ?? 50) - (a.short_percent ?? 50));
      const imbalanceB = Math.abs((b.long_percent ?? 50) - (b.short_percent ?? 50));
      return imbalanceB - imbalanceA;
    });

    console.log(`Coins returned: ${sorted.length}`);
    console.log(`Sorted by biggest percentage imbalance:\n`);

    for (const coin of sorted) {
      const pctImbalance = (coin.long_percent ?? 50) - (coin.short_percent ?? 50);
      const direction = pctImbalance > 0 ? "LONG-HEAVY" : pctImbalance < 0 ? "SHORT-HEAVY" : "NEUTRAL";

      console.log(`  ${coin.coin}`);
      console.log(`    Long:  ${coin.long_pressure?.toLocaleString() ?? "N/A"} (${coin.long_percent?.toFixed(1) ?? "?"}%)`);
      console.log(`    Short: ${coin.short_pressure?.toLocaleString() ?? "N/A"} (${coin.short_percent?.toFixed(1) ?? "?"}%)`);
      console.log(`    Imbalance: ${Math.abs(pctImbalance).toFixed(1)}% ${direction}`);
      console.log(`    Long avg entry:  ${coin.long_avg_entry ?? "N/A"}`);
      console.log(`    Short avg entry: ${coin.short_avg_entry ?? "N/A"}`);
      console.log();
    }

    // Print full raw JSON
    console.log(`\n--- pressure/summary raw JSON ---`);
    console.log(JSON.stringify(summaryData, null, 2));
  }

  // --- Total cost ---
  const totalCost = (pairsResult?.price ?? 0) + (summaryResult?.price ?? 0);
  console.log(`\n=== Total cost: $${totalCost.toFixed(4)} USDC ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
