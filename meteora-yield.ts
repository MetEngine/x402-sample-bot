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
        const backoff = (attempt + 1) * 5000; // 5s, 10s, 15s
        console.log(`  [retry ${attempt + 1}/${retries}] ${path} -- waiting ${backoff / 1000}s (${msg.substring(0, 80)})`);
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

// Delay between API calls to avoid Solana RPC 429 rate limits
const CALL_DELAY_MS = 5000;

let totalCost = 0;

let callCount = 0;

async function call(
  label: string,
  path: string,
  opts?: { method?: string; body?: Record<string, unknown> },
): Promise<unknown> {
  // Rate-limit: wait between calls to avoid Solana RPC 429s
  if (callCount > 0) {
    console.log(`  [throttle] waiting ${CALL_DELAY_MS / 1000}s before next call...`);
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
// Step 1: Top pools by fees (fallback to volume if 500)
// ---------------------------------------------------------------

console.log("=".repeat(80));
console.log("METEORA YIELD ANALYSIS");
console.log("=".repeat(80));

let topPools: any[];
try {
  const data = await call(
    "Step 1: Top Pools by Fees (24h)",
    "/api/v1/meteora/pools/top?sort_by=fees&timeframe=24h&limit=10",
  );
  topPools = data as any[];
} catch (err: any) {
  console.log(`  sort_by=fees failed (${err.message?.substring(0, 80)}), falling back to sort_by=volume`);
  const data = await call(
    "Step 1 (Fallback): Top Pools by Volume (24h)",
    "/api/v1/meteora/pools/top?sort_by=volume&timeframe=24h&limit=10",
  );
  topPools = data as any[];
}

console.log(`\n  Top ${topPools.length} Pools:`);
console.log("  " + "-".repeat(76));
for (let i = 0; i < topPools.length; i++) {
  const p = topPools[i];
  const tokenPair =
    (p.token_x && p.token_y) ? `${p.token_x} / ${p.token_y}` :
    (p.token_a && p.token_b) ? `${p.token_a} / ${p.token_b}` :
    "unknown pair";
  console.log(`  #${i + 1} | ${p.pool_type ?? "?"} | ${tokenPair}`);
  console.log(`     Pool: ${p.pool_address}`);
  console.log(`     Volume: $${Number(p.volume_usd ?? 0).toLocaleString()} | Fees: $${Number(p.total_fees_usd ?? 0).toLocaleString()} | LPs: ${p.unique_lps ?? "?"} | Events: ${p.event_count ?? "?"}`);
}

// ---------------------------------------------------------------
// Step 2: Fee analysis for top 5 pools
// ---------------------------------------------------------------

const poolsForFeeAnalysis = topPools.slice(0, 5);
console.log(`\n${"=".repeat(80)}`);
console.log("FEE ANALYSIS FOR TOP 5 POOLS");
console.log("=".repeat(80));

const feeResults: Array<{ pool: any; fees: any }> = [];
for (const pool of poolsForFeeAnalysis) {
  const addr = pool.pool_address;
  const poolTypeParam = pool.pool_type ? `&pool_type=${pool.pool_type}` : "";
  try {
    const feeData = await call(
      `Fee Analysis: ${addr}`,
      `/api/v1/meteora/pools/fee-analysis?pool_address=${addr}${poolTypeParam}&timeframe=24h`,
    );
    feeResults.push({ pool, fees: feeData });
  } catch (err: any) {
    console.log(`  Failed for ${addr}: ${err.message?.substring(0, 120)}`);
    feeResults.push({ pool, fees: null });
  }
}

console.log(`\n  Fee Analysis Summary:`);
console.log("  " + "-".repeat(76));
for (const { pool, fees } of feeResults) {
  const tokenPair =
    (pool.token_x && pool.token_y) ? `${pool.token_x} / ${pool.token_y}` :
    (pool.token_a && pool.token_b) ? `${pool.token_a} / ${pool.token_b}` :
    "unknown pair";
  console.log(`\n  Pool: ${pool.pool_address}`);
  console.log(`  Pair: ${tokenPair} (${pool.pool_type ?? "?"})`);
  if (fees) {
    console.log(`  Total Fees Claimed (24h): $${Number(fees.total_fees_claimed ?? 0).toLocaleString()}`);
    console.log(`  Unique Claimers: ${fees.unique_claimers ?? "?"}`);
    if (fees.top_claimers && Array.isArray(fees.top_claimers)) {
      console.log(`  Top Fee Claimers:`);
      for (const c of fees.top_claimers.slice(0, 5)) {
        console.log(`    - ${c.owner ?? c.wallet ?? "?"}: $${Number(c.fees_claimed ?? c.total_fees ?? 0).toLocaleString()}`);
      }
    }

    // Flag DAMM v2 anomalous fee rates
    const volume = Number(pool.volume_usd ?? 0);
    const feesVal = Number(fees.total_fees_claimed ?? 0);
    if (volume > 0 && feesVal / volume > 0.20) {
      console.log(`  ** WARNING: Fee/Volume ratio is ${((feesVal / volume) * 100).toFixed(1)}% -- likely DAMM v2 anti-sniper fee artifact **`);
    }
  } else {
    console.log(`  Fee data unavailable.`);
  }
}

// ---------------------------------------------------------------
// Step 3: Top LPs by volume (24h)
// ---------------------------------------------------------------

console.log(`\n${"=".repeat(80)}`);
console.log("TOP LPs BY VOLUME (24h)");
console.log("=".repeat(80));

// Note: /meteora/lps/top only supports timeframe=7d or 30d (not 24h)
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
    console.log(`  Failed for ${owner}: ${err.message?.substring(0, 120)}`);
  }
}

// ---------------------------------------------------------------
// Summary
// ---------------------------------------------------------------

console.log(`\n${"=".repeat(80)}`);
console.log("COST SUMMARY");
console.log("=".repeat(80));
console.log(`Total USDC spent: $${totalCost.toFixed(4)}`);
console.log(`API calls made: ${1 + feeResults.length + 1 + lpsForProfile.length}`);
console.log("=".repeat(80));
