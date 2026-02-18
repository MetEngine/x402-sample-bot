import { paidFetch } from "./index.ts";

// Fallback: pressure endpoints returned all zeros.
// Reconstruct directional bias from:
//   1. /hl/trades/whales (count buy-side vs sell-side volume per coin)
//   2. /hl/smart-wallets/signals?timeframe=7d (aggregated smart wallet directional signals)
//
// Hyperliquid raw data uses:
//   side: "A" = taker bought (aggressor on ask side = bullish pressure)
//   side: "B" = taker sold (aggressor on bid side = bearish pressure)
//   direction: "A"/"B"/"S" -- maps to position direction but not using documented names

interface WhaleTrade {
  trader: string;
  coin: string;
  side: string;
  direction: string;
  price: number;
  size: number;
  usd_value: number;
  closed_pnl: number;
  timestamp: string;
  smart_score: number;
}

interface SmartSignal {
  coin: string;
  direction: string;
  smart_wallet_count: number;
  total_volume: number;
  avg_score: number;
  top_traders: Array<Record<string, unknown>>;
}

async function main() {
  console.log("=== Hyperliquid Directional Bias (Fallback from pressure endpoints) ===");
  console.log("Note: pressure/pairs and pressure/summary returned all zeros.");
  console.log("Reconstructing from whale trades and smart wallet signals.\n");

  // Call both fallback endpoints in parallel
  const [whalesResult, signalsResult] = await Promise.all([
    paidFetch("/api/v1/hl/trades/whales?min_usd=50000&timeframe=24h&limit=200").catch((err) => {
      console.error("trades/whales error:", err.message);
      return null;
    }),
    paidFetch("/api/v1/hl/smart-wallets/signals?timeframe=7d&min_score=60&limit=50").catch((err) => {
      console.error("smart-wallets/signals error:", err.message);
      return null;
    }),
  ]);

  // === Whale Trades Analysis ===
  if (whalesResult) {
    console.log("--- Whale Trades (>=50k USD, last 24h) ---");
    console.log(`Cost: $${whalesResult.price.toFixed(4)} USDC`);
    console.log(`Settlement TX: ${whalesResult.settlement?.transaction ?? "N/A"}\n`);

    const trades = whalesResult.data as WhaleTrade[];
    console.log(`Total whale trades: ${trades.length}\n`);

    // Show unique side/direction values for reference
    const sides = new Set(trades.map((t) => t.side));
    const directions = new Set(trades.map((t) => t.direction));
    console.log(`Side values found: ${[...sides].join(", ")}`);
    console.log(`Direction values found: ${[...directions].join(", ")}\n`);

    // Aggregate by coin using side field:
    //   "A" = taker buy (bullish/long pressure)
    //   "B" = taker sell (bearish/short pressure)
    const coinAgg = new Map<string, {
      buyVolume: number;   // side=A
      sellVolume: number;  // side=B
      buyCount: number;
      sellCount: number;
      trades: WhaleTrade[];
    }>();

    for (const t of trades) {
      if (!coinAgg.has(t.coin)) {
        coinAgg.set(t.coin, { buyVolume: 0, sellVolume: 0, buyCount: 0, sellCount: 0, trades: [] });
      }
      const agg = coinAgg.get(t.coin)!;
      agg.trades.push(t);

      if (t.side === "A") {
        agg.buyVolume += t.usd_value;
        agg.buyCount++;
      } else if (t.side === "B") {
        agg.sellVolume += t.usd_value;
        agg.sellCount++;
      }
    }

    // Sort by absolute imbalance
    const sorted = [...coinAgg.entries()].sort(([, a], [, b]) => {
      const imbalanceA = Math.abs(a.buyVolume - a.sellVolume);
      const imbalanceB = Math.abs(b.buyVolume - b.sellVolume);
      return imbalanceB - imbalanceA;
    });

    console.log("Coins sorted by whale trade volume imbalance (buy/A vs sell/B):\n");

    for (const [coin, agg] of sorted) {
      const totalVolume = agg.buyVolume + agg.sellVolume;
      const imbalance = agg.buyVolume - agg.sellVolume;
      const direction = imbalance > 0 ? "BUY-HEAVY (bullish)" : imbalance < 0 ? "SELL-HEAVY (bearish)" : "NEUTRAL";
      const buyPct = totalVolume > 0 ? ((agg.buyVolume / totalVolume) * 100).toFixed(1) : "0.0";
      const sellPct = totalVolume > 0 ? ((agg.sellVolume / totalVolume) * 100).toFixed(1) : "0.0";
      const ratio = agg.sellVolume > 0
        ? (agg.buyVolume / agg.sellVolume).toFixed(2)
        : agg.buyVolume > 0 ? "Inf" : "N/A";

      console.log(`  ${coin}`);
      console.log(`    Buy volume (A):  $${agg.buyVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}  (${buyPct}%)  [${agg.buyCount} trades]`);
      console.log(`    Sell volume (B): $${agg.sellVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}  (${sellPct}%)  [${agg.sellCount} trades]`);
      console.log(`    Net imbalance:   $${Math.abs(imbalance).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${direction}`);
      console.log(`    Buy/Sell ratio:  ${ratio}`);
      console.log(`    Total volume:    $${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

      // Show top 5 trades by USD value for this coin
      const topTrades = [...agg.trades].sort((a, b) => b.usd_value - a.usd_value).slice(0, 5);
      console.log(`    Top ${topTrades.length} trades:`);
      for (const t of topTrades) {
        const sideLabel = t.side === "A" ? "BUY" : t.side === "B" ? "SELL" : t.side;
        console.log(`      ${sideLabel} | $${t.usd_value.toLocaleString(undefined, { maximumFractionDigits: 0 })} | ${t.coin}@${t.price} | dir=${t.direction} | trader: ${t.trader} | score: ${t.smart_score} | closed_pnl: $${t.closed_pnl.toLocaleString()} | ${t.timestamp}`);
      }
      console.log();
    }

    // Summary table
    console.log("\n=== IMBALANCE SUMMARY TABLE ===\n");
    console.log("Coin              | Buy Vol ($)     | Sell Vol ($)    | Imbalance ($)   | Direction      | B/S Ratio");
    console.log("------------------|-----------------|-----------------|-----------------|----------------|----------");
    for (const [coin, agg] of sorted) {
      const imbalance = agg.buyVolume - agg.sellVolume;
      const direction = imbalance > 0 ? "BUY-HEAVY" : imbalance < 0 ? "SELL-HEAVY" : "NEUTRAL";
      const ratio = agg.sellVolume > 0
        ? (agg.buyVolume / agg.sellVolume).toFixed(2)
        : agg.buyVolume > 0 ? "Inf" : "N/A";
      console.log(
        `${coin.padEnd(18)}| ${agg.buyVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(15)} | ${agg.sellVolume.toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(15)} | ${Math.abs(imbalance).toLocaleString(undefined, { maximumFractionDigits: 0 }).padStart(15)} | ${direction.padEnd(14)} | ${ratio}`
      );
    }

    // Print full raw JSON
    console.log("\n\n--- Whale trades raw JSON ---");
    console.log(JSON.stringify(trades, null, 2));
  }

  // === Smart Wallet Signals ===
  if (signalsResult) {
    console.log("\n--- Smart Wallet Directional Signals (7d, score>=60) ---");
    console.log(`Cost: $${signalsResult.price.toFixed(4)} USDC`);
    console.log(`Settlement TX: ${signalsResult.settlement?.transaction ?? "N/A"}\n`);

    const signals = signalsResult.data as SmartSignal[];
    console.log(`Total signals: ${signals.length}\n`);

    if (signals.length === 0) {
      console.log("(No signals returned -- this endpoint often returns empty on shorter timeframes.)");
    } else {
      // Sort by total volume
      const sorted = [...signals].sort((a, b) => b.total_volume - a.total_volume);

      for (const s of sorted) {
        console.log(`  ${s.coin}`);
        console.log(`    Direction:          ${s.direction}`);
        console.log(`    Smart wallet count: ${s.smart_wallet_count}`);
        console.log(`    Total volume:       $${s.total_volume.toLocaleString()}`);
        console.log(`    Avg score:          ${s.avg_score}`);
        if (s.top_traders && s.top_traders.length > 0) {
          console.log(`    Top traders:`);
          for (const tr of s.top_traders) {
            console.log(`      ${JSON.stringify(tr)}`);
          }
        }
        console.log();
      }

      // Print full raw signals
      console.log("\n--- Smart wallet signals raw JSON ---");
      console.log(JSON.stringify(signals, null, 2));
    }
  }

  // --- Total cost ---
  const totalCost = (whalesResult?.price ?? 0) + (signalsResult?.price ?? 0);
  console.log(`\n=== Total cost: $${totalCost.toFixed(4)} USDC ===`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
