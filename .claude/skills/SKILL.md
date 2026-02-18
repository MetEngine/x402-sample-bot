# MetEngine Data Agent API – Complete Skill File

This is the authoritative skill manifest for Claude Code agents working with MetEngine's real-time smart money analytics API.

## Core Service Details

**MetEngine Data Agent** provides 63 endpoints spanning three platforms:
- **Polymarket** (27 endpoints): prediction market analytics
- **Hyperliquid** (18 endpoints): perpetual futures trader intelligence
- **Meteora** (18 endpoints): Solana LP/AMM pool analytics

**Base URL:** `https://agent.metengine.xyz`

**Payment:** x402 protocol on Solana Mainnet (USDC). No API keys required—payment IS authentication.

---

## Quick Start: Session Memory System

**Before making any API call**, check for `~/.claude/agents/metengine-memory.md`. This persistent file eliminates repetitive setup and saves ~80% of setup tokens by storing:

- Wallet keypair path and public address (never the private key)
- Confirmed installed packages (`@x402/core`, `@x402/svm`, `@solana/kit`)
- Working bootstrap code snippet (copy-paste ready)
- Endpoint performance history (timeouts, fallbacks, costs)
- Quirks and known issues

**Update rules:**
1. After first successful setup -> record wallet, packages, bootstrap code
2. After every API call -> append to Endpoint History (keep last 10 rows)
3. When using a fallback -> record in Fallbacks Learned section
4. At session end -> update Last Updated timestamp

New agents: Create the memory file after initial onboarding. Returning agents: Read memory first, skip setup if `installed: true`.

---

## Payment Flow (x402 on Solana Mainnet)

All paid endpoints follow a two-step handshake:

**Step 1 (Agent -> API):** Send initial request
- Returns: `402 Payment Required` with encoded price

**Step 2 (Agent -> Solana -> API):** Sign and re-send
- Agent signs payment locally using `@x402/core`
- Sends second request with `PAYMENT-SIGNATURE` header
- API verifies on-chain, executes query, settles payment
- Returns: `200` with data + settlement proof (tx hash)

**Key rule:** Payment only settles on successful `2xx` responses. Timeouts and errors incur no charge.

### Client Bootstrap (TypeScript/Bun)

```typescript
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { toClientSvmSigner } from "@x402/svm";
import { getBase58Encoder, createKeyPairSignerFromBytes } from "@solana/kit";

const bytes = getBase58Encoder().encode(process.env.SOLANA_PRIVATE_KEY!);
const signer = await createKeyPairSignerFromBytes(bytes);
const client = new x402Client();
registerExactSvmScheme(client, { signer: toClientSvmSigner(signer) });
const httpClient = new x402HTTPClient(client);
const BASE_URL = "https://agent.metengine.xyz";

async function paidFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const initial = await fetch(url, options);
  if (initial.status !== 402) throw new Error(`Expected 402, got ${initial.status}`);

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => initial.headers.get(name), await initial.json()
  );
  const price = Number(paymentRequired.accepts[0].amount);

  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const paid = await fetch(url, { ...options, headers: { ...paymentHeaders } });
  if (paid.status !== 200) throw new Error(`Payment failed: ${paid.status}`);

  const settlement = httpClient.getPaymentSettleResponse((name) => paid.headers.get(name));
  return { data: (await paid.json()).data, settlement, price };
}
```

Install dependencies: `bun add @x402/core @x402/svm @solana/kit`

---

## Pricing Structure

All prices in USDC on Solana Mainnet. Pricing endpoint (free, no payment):
```
GET https://agent.metengine.xyz/api/v1/pricing
```

**Tier base costs:**
- Light: $0.01
- Medium: $0.02
- Heavy: $0.05
- Whale: $0.08

**Multipliers applied:**
- Timeframe: 0.5x (1h) to 5.0x (365d/all)
- Limit scaling: `max(1, requested_limit / default_limit)`
- Category filter: 0.7x discount
- Condition_id / pool_address filter: 0.5x discount
- Smart_money_only: 0.7x discount

**Hard caps:** Floor $0.01 per request, ceiling $0.20 per request.

Special endpoints: `/markets/opportunities` capped at $0.15; `/wallets/copy-traders` capped at $0.12.

---

## Health & Monitoring

```
GET https://agent.metengine.xyz/health
```
Free endpoint. Returns component status (ClickHouse, Postgres, Redis), active request count, semaphore limits, and error stats.

---

## Display Rule: Full Addresses Always

Never truncate or trim wallet/contract addresses. Always show full addresses (e.g. `0x61276aba49117fd9299707d5d573652949d5c977`, not `0x6127...c977`). This applies to all hex addresses (Polymarket, Hyperliquid), base58 pubkeys (Meteora), condition_ids, token_ids, and tx hashes.

---

## Polymarket (27 Endpoints)

| # | Tier | Path | Purpose |
|----|------|------|---------|
| 1 | M | GET /api/v1/markets/trending | Volume spikes, timeframe filter |
| 2 | L | GET /api/v1/markets/search | Keyword/category/status, accepts Polymarket URLs |
| 3 | L | GET /api/v1/markets/categories | List categories with activity stats |
| 4 | L | GET /api/v1/platform/stats | Platform aggregates (volume, trades, wallets) |
| 5 | H | POST /api/v1/markets/intelligence | Smart money consensus, top wallets, signal analysis |
| 6 | L | GET /api/v1/markets/price-history | OHLCV time series per outcome |
| 7 | M | POST /api/v1/markets/sentiment | Sentiment time series with smart money overlay |
| 8 | M | POST /api/v1/markets/participants | Participant distribution by tier |
| 9 | H | POST /api/v1/markets/insiders | 7-signal behavioral insider detection |
| 10 | L | GET /api/v1/markets/trades | Chronological trade feed, side/min_usdc filter |
| 11 | W | GET /api/v1/markets/similar | Related markets by wallet overlap |
| 12 | W | GET /api/v1/markets/opportunities | Smart money vs price disagreement |
| 13 | H | GET /api/v1/markets/high-conviction | High-conviction bets (fallback for #12) |
| 14 | M | GET /api/v1/markets/capital-flow | Sector rotation, smart_money_only filter |
| 15 | M | GET /api/v1/trades/whales | Large trades, condition_id/category filter |
| 16 | M | GET /api/v1/markets/volume-heatmap | Volume by category/hour/day |
| 17 | H | POST /api/v1/wallets/profile | Full dossier: score, positions, trades |
| 18 | M | POST /api/v1/wallets/activity | Recent activity by timeframe |
| 19 | M | POST /api/v1/wallets/pnl-breakdown | Per-market PnL with best/worst trades |
| 20 | W | POST /api/v1/wallets/compare | 2-5 wallets side-by-side |
| 21 | W | POST /api/v1/wallets/copy-traders | Detect lag, detect overlap (max $0.12) |
| 22 | H | GET /api/v1/wallets/top-performers | Leaderboard (2x penalty without category) |
| 23 | H | GET /api/v1/wallets/niche-experts | Category specialists |
| 24 | L | GET /api/v1/markets/resolutions | Resolved markets + smart money accuracy |
| 25 | H | GET /api/v1/wallets/alpha-callers | Early traders on trending markets |
| 26 | M | GET /api/v1/markets/dumb-money | Low-score positions (contrarian) |
| 27 | H | GET /api/v1/wallets/insiders | Global insider candidates |

**Key quirks:**
- Wallet addresses MUST be lowercase.
- `/trades/whales` returns REDEEM trades (resolved payouts) with `price=1.00, side=REDEEM`. Filter by `side=BUY|SELL` to exclude.
- `/markets/opportunities` (504) -> fallback to `/markets/high-conviction`.
- Price = implied probability (0 to 1).

---

## Hyperliquid (18 Endpoints)

| # | Tier | Path | Purpose |
|----|------|------|---------|
| 28 | L | GET /api/v1/hl/platform/stats | Platform aggregates |
| 29 | M | GET /api/v1/hl/coins/trending | Trending by activity (use 7d if 24h empty) |
| 30 | L | GET /api/v1/hl/coins/list | All coins with 7d stats |
| 31 | M | GET /api/v1/hl/coins/volume-heatmap | Volume by coin/hour |
| 32 | H | GET /api/v1/hl/traders/leaderboard | Ranked by PnL/ROI/Sharpe/win_rate |
| 33 | H | POST /api/v1/hl/traders/profile | Full dossier (intermittent 500, use fallback) |
| 34 | W | POST /api/v1/hl/traders/compare | 2-5 traders |
| 35 | M | GET /api/v1/hl/traders/daily-pnl | Daily time series with streak tracking |
| 36 | M | POST /api/v1/hl/traders/pnl-by-coin | Per-coin PnL (realized only) |
| 37 | H | GET /api/v1/hl/traders/fresh-whales | New accounts with high volume |
| 38 | M | GET /api/v1/hl/trades/whales | Large trades, direction filter |
| 39 | L | GET /api/v1/hl/trades/feed | Chronological feed per coin |
| 40 | M | GET /api/v1/hl/trades/long-short-ratio | Directional ratio (returns zeros, reconstruct) |
| 41 | L | GET /api/v1/hl/smart-wallets/list | Smart wallet ranking |
| 42 | M | GET /api/v1/hl/smart-wallets/activity | Recent smart wallet trades |
| 43 | H | GET /api/v1/hl/smart-wallets/signals | Directional signals by coin (use 7d if 24h empty) |
| 44 | H | GET /api/v1/hl/pressure/pairs | Long/short pressure with positions |
| 45 | M | GET /api/v1/hl/pressure/summary | Cross-coin pressure snapshot |

**Key quirks:**
- `timeframe=24h` on endpoints #29, #43 often empty -> use `timeframe=7d`.
- `/hl/traders/profile` (500) -> fallback to `/hl/traders/leaderboard + /hl/traders/pnl-by-coin`.
- `/hl/trades/long-short-ratio` returns zeros -> reconstruct from `/hl/trades/whales` by counting side volume.
- Coin symbols uppercase only: `BTC`, not `BTC-USDC`.
- Trader addresses are 0x hex (case-insensitive).
- Realized PnL only (no unrealized).
- Smart threshold: score >= 85.

---

## Meteora (18 Endpoints)

| # | Tier | Path | Purpose |
|----|------|------|---------|
| 46 | M | GET /api/v1/meteora/pools/trending | Volume spikes (deduplicate by pool_address) |
| 47 | M | GET /api/v1/meteora/pools/top | Top by volume/LP count/fees |
| 48 | L | GET /api/v1/meteora/pools/search | Search by address or token name |
| 49 | M | GET /api/v1/meteora/pools/detail | Full pool metadata |
| 50 | L | GET /api/v1/meteora/pools/volume-history | Volume time series |
| 51 | L | GET /api/v1/meteora/pools/events | Chronological event feed |
| 52 | M | GET /api/v1/meteora/pools/fee-analysis | Fee claiming breakdown |
| 53 | H | GET /api/v1/meteora/lps/top | LP leaderboard (sort=volume, avoid sort=fees) |
| 54 | H | POST /api/v1/meteora/lps/profile | Full LP dossier |
| 55 | M | GET /api/v1/meteora/lps/whales | Large LP events |
| 56 | W | POST /api/v1/meteora/lps/compare | 2-5 LPs |
| 57 | M | GET /api/v1/meteora/positions/active | Active LP positions |
| 58 | L | GET /api/v1/meteora/positions/history | Position events (DLMM only) |
| 59 | L | GET /api/v1/meteora/platform/stats | Platform aggregates |
| 60 | M | GET /api/v1/meteora/platform/volume-heatmap | Volume by action/hour |
| 61 | L | GET /api/v1/meteora/platform/metengine-share | Routing share % |
| 62 | M | GET /api/v1/meteora/dca/pressure | Token accumulation pressure |
| 63 | H | GET /api/v1/meteora/pools/smart-wallet | Pools with highest smart LP activity |

**Key quirks:**
- `/meteora/lps/top?sort_by=fees` (500) -> fallback to `sort_by=volume`.
- DAMM v2 pools show high fee rates (30-50%) on new token launches -- separate from DLMM and flag.
- DLMM: `token_x`/`token_y`, PascalCase events (`AddLiquidity`, `RemoveLiquidity`).
- DAMM v2: `token_a`/`token_b`, snake_case events (`add_liquidity`, `remove_liquidity`).
- Addresses are Solana base58 pubkeys (case-sensitive).

---

## Performance Benchmarks

| Metric | Value |
|--------|-------|
| p50 latency | 800ms |
| p95 latency | 3s |
| p99 latency | 8s |
| Handler timeout | 60s (no charge) |
| Payment verification timeout | 5s |
| Max concurrent paid requests | 50 |

**Data freshness:**
- Polymarket trades: sub-minute
- Polymarket wallet scores: daily
- Hyperliquid trades: sub-minute
- Hyperliquid smart scores: continuous (formula-based)
- Meteora events: sub-minute
- Meteora LP scores: daily

---

## Error Handling & Fallbacks

| Status | Cause | Recovery |
|--------|-------|----------|
| 400 | Invalid params | Validate request JSON/query string |
| 402 | Payment verification failed | Check signer/nonce; sign and retry |
| 404 | Path not found | Verify endpoint in this document |
| 429 | Rate limit | Back off and retry |
| 500 | Server error | Retry once; use fallback endpoint |
| 503 | Capacity or payment service down | Check `Retry-After` header |
| 504 | Query timeout (no charge) | Narrow params or use fallback |

**Fallback map:**
- `/markets/opportunities` (504) -> `/markets/high-conviction`
- `/wallets/top-performers` (503 on 7d) -> try `timeframe=24h`
- `/markets/insiders` (timeout) -> `/markets/trades` with condition_id filter
- `/hl/coins/trending?timeframe=24h` (empty) -> `timeframe=7d`
- `/hl/traders/profile` (500) -> `/hl/traders/leaderboard + /hl/traders/pnl-by-coin`
- `/hl/trades/long-short-ratio` (zeros) -> reconstruct from `/hl/trades/whales`
- `/meteora/lps/top?sort_by=fees` (500) -> `sort_by=volume`

---

## Skill File Updates

Download latest weekly:
```bash
curl -sL https://www.metengine.xyz/skill.md -o .claude/agents/metengine-data-agent.md
```

Current version: **1.0.0**

---

## Wallet Security

- **NEVER** log, print, or display keypair file contents.
- **ONLY** store keypair file path and public address (base58) in memory.
- Load keypair at runtime directly into the signer without intermediate variables.

---

## What This API Does NOT Provide

1. Trade execution (read-only)
2. Real-time WebSocket streams
3. Historical backfill on demand
4. Unrealized PnL for Hyperliquid
5. Mark-to-market valuation for Meteora positions
6. Polymarket order book depth
7. Custom scoring models
8. Cross-platform wallet linking
9. Token price feeds (use oracle for that)
10. Any endpoints beyond these 63

---

## Example Workflow: Analyze a Polymarket Market

```typescript
const { data: markets } = await paidFetch(
  "/api/v1/markets/search?query=bitcoin&limit=5"
); // $0.01

const market = markets[0];
const { data: intel } = await paidFetch("/api/v1/markets/intelligence", {
  method: "POST",
  body: { condition_id: market.condition_id, top_n_wallets: 10 }
}); // $0.05

const { data: history } = await paidFetch(
  `/api/v1/markets/price-history?condition_id=${market.condition_id}&timeframe=7d`
); // $0.01

console.log(`Smart money favors: ${intel.smart_money.consensus_outcome}`);
console.log(`Total: $0.07 USDC spent, ~5 seconds`);
```

---

This document is current as of **version 1.0.0**. Check for updates weekly.
