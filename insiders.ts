import { paidFetch } from "./index.ts";

console.log("=== Polymarket Global Insider Candidates ===\n");
console.log("Endpoint: GET /api/v1/wallets/insiders");
console.log("Params: min_score=50, max_wallet_age_days=60, limit=50\n");

try {
  const { data, settlement, price } = await paidFetch(
    "/api/v1/wallets/insiders?limit=50&min_score=50&max_wallet_age_days=60"
  );

  console.log(`Paid: $${price.toFixed(4)} USDC`);
  console.log(`Settlement TX: ${settlement?.transaction ?? "N/A"}\n`);
  console.log(JSON.stringify(data, null, 2));
} catch (err) {
  console.error("Error:", err);
  process.exit(1);
}
