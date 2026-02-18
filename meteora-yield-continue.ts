import { paidFetch } from "./index.ts";

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function safePaidFetch(
  path: string,
  opts?: { method?: string; body?: Record<string, unknown> },
  retries = 3,
): Promise<{ data: unknown; price: number }> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await paidFetch(path, opts);
      return { data: result.data, price: result.price };
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      const isRetryable = msg.includes("504") || msg.includes("500") || msg.includes("503") || msg.includes("429") || msg.includes("Too Many Requests");
      if (attempt < retries && isRetryable) {
        const backoff = (attempt + 1) * 5000;
        console.log(`  [retry ${attempt + 1}/${retries}] waiting ${backoff / 1000}s (${msg.substring(0, 80)})`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

const CALL_DELAY_MS = 5000;
let totalCost = 0;
let callCount = 0;

async function call(
  label: string,
  path: string,
  opts?: { method?: string; body?: Record<string, unknown> },
): Promise<unknown> {
  if (callCount > 0) {
    console.log(`  [throttle] waiting ${CALL_DELAY_MS / 1000}s...`);
    await sleep(CALL_DELAY_MS);
  }
  callCount++;

  console.log(`\n--- ${label} ---`);
  console.log(`  Request: ${opts?.method ?? "GET"} ${path}`);
  const start = Date.now();
  const { data, price } = await safePaidFetch(path, opts);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  totalCost += price;
  console.log(`  Cost: $${price.toFixed(4)} USDC | Latency: ${elapsed}s`);
  return data;
}

// ---------------------------------------------------------------
// Step 3: Top LPs by volume (7d -- only valid timeframes: 7d, 30d)
// ---------------------------------------------------------------

console.log("=".repeat(80));
console.log("CONTINUATION: STEPS 3 & 4 (Steps 1-2 already completed)");
console.log("=".repeat(80));

const topLPsData = await call(
  "Step 3: Top LPs by Volume (7d)",
  "/api/v1/meteora/lps/top?sort_by=volume&timeframe=7d&limit=10",
);
const topLPs = topLPsData as any[];

console.log(`\n  Top ${topLPs.length} LPs:`);
console.log("  " + "-".repeat(76));
for (let i = 0; i < topLPs.length; i++) {
  const lp = topLPs[i];
  console.log(`  #${i + 1} | ${lp.owner}`);
  console.log(`     Volume: $${Number(lp.total_volume_usd ?? 0).toLocaleString()} | Pools: ${lp.pool_count ?? "?"} | Events: ${lp.event_count ?? "?"} | Types: ${(lp.pool_types ?? []).join(", ")}`);
}

// ---------------------------------------------------------------
// Step 4: Full profile for top 3 LPs
// ---------------------------------------------------------------

console.log(`\n${"=".repeat(80)}`);
console.log("LP PROFILES (TOP 3)");
console.log("=".repeat(80));

const lpsForProfile = topLPs.slice(0, 3);

for (const lp of lpsForProfile) {
  const owner = lp.owner;
  try {
    const profileData = await call(
      `LP Profile: ${owner}`,
      "/api/v1/meteora/lps/profile",
      { method: "POST", body: { owner, pool_type: "all", events_limit: 20 } },
    );
    const profile = profileData as any;

    console.log(`\n  Owner: ${owner}`);
    if (profile.summary) {
      const s = profile.summary;
      console.log(`  Total Volume: $${Number(s.total_volume_usd ?? 0).toLocaleString()}`);
      console.log(`  Pool Count: ${s.pool_count ?? "?"}`);
      console.log(`  Event Count: ${s.event_count ?? "?"}`);
      console.log(`  Pool Types: ${(s.pool_types ?? []).join(", ")}`);
    }
    if (profile.pool_breakdown && Array.isArray(profile.pool_breakdown)) {
      console.log(`  Pool Breakdown (${profile.pool_breakdown.length} pools):`);
      for (const pb of profile.pool_breakdown.slice(0, 5)) {
        const pair =
          (pb.token_x && pb.token_y) ? `${pb.token_x}/${pb.token_y}` :
          (pb.token_a && pb.token_b) ? `${pb.token_a}/${pb.token_b}` :
          "?/?";
        console.log(`    - ${pb.pool_address} (${pb.pool_type ?? "?"})`);
        console.log(`      ${pair} | Vol: $${Number(pb.volume_usd ?? 0).toLocaleString()} | Events: ${pb.event_count ?? "?"}`);
      }
    }
    if (profile.recent_events && Array.isArray(profile.recent_events)) {
      console.log(`  Recent Events (last ${Math.min(profile.recent_events.length, 10)}):`);
      for (const ev of profile.recent_events.slice(0, 10)) {
        console.log(`    - ${ev.event_type} | $${Number(ev.usd_total ?? 0).toLocaleString()} | Pool: ${ev.pool_address} | ${ev.timestamp}`);
        if (ev.tx_id) console.log(`      TX: ${ev.tx_id}`);
      }
    }
  } catch (err: any) {
    console.log(`  Failed for ${owner}: ${err.message?.substring(0, 200)}`);
  }
}

// ---------------------------------------------------------------
// Summary
// ---------------------------------------------------------------

console.log(`\n${"=".repeat(80)}`);
console.log("COST SUMMARY (Steps 3-4 only)");
console.log("=".repeat(80));
console.log(`Total USDC spent this run: $${totalCost.toFixed(4)}`);
console.log(`API calls made: ${callCount}`);
console.log("=".repeat(80));
