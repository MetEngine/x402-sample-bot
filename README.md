# MetEngine Data Agent

Smart money is moving on Polymarket, Hyperliquid, and Meteora right now. Your agent can now see them. 

MetEngine is 63 endpoints of real-time on-chain intelligence across three platforms. Insider wallet detection. Smart money consensus. LP profiling. Trader leaderboards. Capital flow. None of it exists anywhere else with this level of customization and depth. Your agent queries it, pays per request in USDC, and gets structured data back in under a second.

No API keys. No subscriptions. No onboarding. Your wallet is your access.

**Base URL:** `https://agent.metengine.xyz`

One command to install the agent:

```bash
curl -sL https://www.metengine.xyz/skill.md -o .claude/agents/metengine-data-agent.md
```


---

## What Your Agent Gets

| Platform | Endpoints | What's Available |
|----------|-----------|-----------------|
| **Polymarket** | 27 | Smart money consensus, insider detection, wallet profiling, copy-trader signals, capital flow, sentiment, opportunities |
| **Hyperliquid** | 18 | Trader leaderboards, PnL breakdowns, smart wallet signals, directional pressure, fresh whale detection, per-coin analysis |
| **Meteora** | 18 | Pool trending, LP profiling, fee analysis, DCA pressure, smart wallet concentration, position tracking |

Every endpoint is customizable. Filter by timeframe, wallet tier, category, pool address, limit. The [full reference](https://www.metengine.xyz/skill.md) documents all 63 endpoints with parameters and response shapes.

---

## How Payment Works

MetEngine uses the [x402 protocol](https://x402.org). HTTP 402 has been reserved since 1997. This is that use.

Every request follows a two-step handshake:

1. Agent sends request → receives `402 Payment Required` with the price for that query
2. Agent signs USDC payment on Solana → resends with `PAYMENT-SIGNATURE` header → gets data back

No registration. No billing dashboard. Any agent with a funded Solana wallet can call it programmatically from first contact to paid response — no human in the loop.

**Payment only settles on `200` responses. Timeouts cost nothing.**

### Pricing

| Tier | Cost | Query Types |
|------|------|------------|
| Light | $0.01 | Market search, price history, platform stats, event feeds |
| Medium | $0.02 | Trending markets, whale trades, sentiment, volume heatmaps |
| Heavy | $0.05 | Smart money intelligence, wallet profiles, leaderboards, insider detection |
| Whale | $0.08 | Cross-wallet comparison, copy-trader analysis |

Floor: $0.01. Ceiling: $0.20.

---

## Setup

Fund a Solana wallet with USDC. Set the private key:

```bash
export SOLANA_PRIVATE_KEY=your_base58_private_key
```

Install dependencies:

```bash
bun add @x402/core @x402/svm @solana/kit
```

### Client Bootstrap

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

async function paidFetch(path: string, options: RequestInit = {}) {
  const url = `${BASE_URL}${path}`;
  const initial = await fetch(url, options);
  if (initial.status !== 402) throw new Error(`Expected 402, got ${initial.status}`);

  const paymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => initial.headers.get(name), await initial.json()
  );
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const paid = await fetch(url, { ...options, headers: { ...paymentHeaders } });
  if (paid.status !== 200) throw new Error(`Payment failed: ${paid.status}`);

  const settlement = httpClient.getPaymentSettleResponse((name) => paid.headers.get(name));
  return { data: (await paid.json()).data, settlement };
}
```

---

## Example: Polymarket Smart Money Analysis

```typescript
// Find the market ($0.01)
const { data: markets } = await paidFetch("/api/v1/markets/search?query=bitcoin&limit=5");

// Get smart money consensus: which wallets are positioned, what they favor, signal strength ($0.05)
const { data: intel } = await paidFetch("/api/v1/markets/intelligence", {
  method: "POST",
  body: JSON.stringify({ condition_id: markets[0].condition_id, top_n_wallets: 10 })
});

// 7-day price history ($0.01)
const { data: history } = await paidFetch(
  `/api/v1/markets/price-history?condition_id=${markets[0].condition_id}&timeframe=7d`
);

console.log(`Smart money favors: ${intel.smart_money.consensus_outcome}`);
// Total: $0.07 USDC
```

---

## Using with LLMs

### Claude Code

One command installs the full skill. Claude handles endpoint selection, payment execution, fallback routing, and address normalization automatically.

```bash
curl -sL https://www.metengine.xyz/skill.md -o .claude/agents/metengine-data-agent.md
```

Ask in plain language:
```
"What are the top smart money positions on Polymarket right now?"
"Profile this Hyperliquid trader: 0xabc..."
"Which Meteora pools have the highest smart LP concentration?"
```

### GPT, Gemini, or Custom Agents

Pass the [skill file](https://www.metengine.xyz/skill.md) as system context. It gives your model all 63 endpoints, parameters, response shapes, fallback maps, and known quirks.

```typescript
const skill = await fetch("https://www.metengine.xyz/skill.md").then(r => r.text());
// inject as system prompt alongside the paidFetch bootstrap
```

---

## Gotchas

- **Polymarket wallet addresses must be lowercase.** Mixed case returns empty results with no error.
- **`/trades/whales` includes REDEEM trades.** Resolved market payouts come through as whale trades with `side=REDEEM`. Filter `side=BUY` or `side=SELL` — this is the most common source of garbage output.
- **`/hl/coins/trending?timeframe=24h` is usually empty.** Use `timeframe=7d`.
- **`/meteora/lps/top?sort_by=fees` 500s.** Use `sort_by=volume`.
- **`/markets/opportunities` 504s under load.** Fall back to `/markets/high-conviction`.

---

## Limitations

- Read-only. No trade execution.
- No real-time WebSocket streams.
- No cross-platform wallet linking. Addresses are separate per platform.
---
