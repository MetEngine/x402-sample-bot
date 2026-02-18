import { paidFetch } from "./index.ts";

// Strategy: combine niche-experts (top wallets by category Sharpe) 
// + top-performers by ROI (high ROI = got in early)
// to identify consistently early, profitable wallets

const results: Record<string, unknown> = {};

// 1. Top performers by ROI this week (high ROI = early entries)
console.log("=== Top Performers by ROI (7d) ===\n");
const { data: roi, price: p1 } = await paidFetch("/api/v1/wallets/top-performers?timeframe=7d&metric=roi&min_trades=10&limit=25");
results.roi = roi;
console.log(`Cost: $${p1.toFixed(4)} USDC`);
console.log(JSON.stringify(roi, null, 2));

// 2. Niche experts across top categories (specialists who dominate a niche = early movers)
console.log("\n=== Niche Experts: Crypto ===\n");
const { data: crypto, price: p2 } = await paidFetch("/api/v1/wallets/niche-experts?category=Crypto&min_category_trades=10&sort_by=category_sharpe&limit=15");
results.crypto = crypto;
console.log(`Cost: $${p2.toFixed(4)} USDC`);
console.log(JSON.stringify(crypto, null, 2));

console.log("\n=== Niche Experts: Tech ===\n");
const { data: tech, price: p3 } = await paidFetch("/api/v1/wallets/niche-experts?category=Tech&min_category_trades=10&sort_by=category_sharpe&limit=15");
results.tech = tech;
console.log(`Cost: $${p3.toFixed(4)} USDC`);
console.log(JSON.stringify(tech, null, 2));

console.log(`\nTotal cost: $${(p1+p2+p3).toFixed(4)} USDC`);
