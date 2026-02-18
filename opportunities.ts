import { paidFetch } from "./index.ts";

const PRIMARY = "/api/v1/markets/opportunities?min_signal_strength=moderate&min_smart_wallets=3&limit=20";
const FALLBACK = "/api/v1/markets/high-conviction?min_smart_wallets=5&min_avg_score=65&limit=20";

async function tryWithRetry(
  path: string,
  label: string,
  retries = 1,
): Promise<{ data: unknown; settlement: unknown; price: number } | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (attempt > 0) {
        console.log(`  Retry ${attempt}/${retries} for ${label}...`);
        await new Promise((r) => setTimeout(r, 3000));
      }
      console.log(`  Calling: ${path}`);
      const result = await paidFetch(path);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const isTimeout = msg.includes("504") || msg.includes("timeout") || msg.includes("503");
      if (isTimeout && attempt < retries) {
        console.log(`  Got timeout/503/504, will retry...`);
        continue;
      }
      if (isTimeout) {
        console.log(`  ${label} failed after ${attempt + 1} attempt(s): ${msg.substring(0, 120)}`);
        return null;
      }
      throw err;
    }
  }
  return null;
}

async function run() {
  console.log("=== Smart Money Opportunities ===\n");

  // Try primary endpoint with 1 retry
  console.log("[1/2] Trying /markets/opportunities ...");
  let result = await tryWithRetry(PRIMARY, "opportunities", 1);
  let endpointUsed = PRIMARY;

  // Fallback to high-conviction
  if (!result) {
    console.log("\n[2/2] Falling back to /markets/high-conviction ...");
    endpointUsed = FALLBACK;
    result = await tryWithRetry(FALLBACK, "high-conviction", 1);
  }

  if (!result) {
    console.error("\nBoth endpoints timed out. Server may be under heavy load.");
    console.error("Try again in a few minutes, or use a narrower query.");
    process.exit(1);
  }

  console.log(`\nEndpoint used: ${endpointUsed}`);
  console.log(`Paid: $${result.price.toFixed(4)} USDC`);
  console.log(`Settlement: ${JSON.stringify(result.settlement)}`);
  console.log(`\n--- Full Response Data ---\n`);
  console.log(JSON.stringify(result.data, null, 2));
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
