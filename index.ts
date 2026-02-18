import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { toClientSvmSigner } from "@x402/svm";
import { getBase58Encoder, createKeyPairSignerFromBytes } from "@solana/kit";
import type { PaymentRequired, SettleResponse } from "@x402/core/types";
import { readFileSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

// --- Load keypair ---
const keypairPath = resolve(homedir(), "Da5CAQjYAGZ8woTeFcMPSixuV59EpWnEbrZ2bi6YgtzA.json");
const keypairBytes = JSON.parse(readFileSync(keypairPath, "utf-8")) as number[];
const bytes = new Uint8Array(keypairBytes);
const signer = await createKeyPairSignerFromBytes(bytes);

// --- Setup x402 client ---
const client = new x402Client();
registerExactSvmScheme(client, { signer: toClientSvmSigner(signer) });
const httpClient = new x402HTTPClient(client);

const BASE_URL = "https://agent.metengine.xyz";

export async function paidFetch(
  path: string,
  options?: { method?: string; body?: Record<string, unknown> },
): Promise<{ data: unknown; settlement: SettleResponse; price: number }> {
  const method = options?.method ?? "GET";
  const url = `${BASE_URL}${path}`;
  const fetchOpts: RequestInit = { method };
  if (options?.body) {
    fetchOpts.headers = { "Content-Type": "application/json" };
    fetchOpts.body = JSON.stringify(options.body);
  }

  // Step 1: Get 402 with price
  const initial = await fetch(url, fetchOpts);
  if (initial.status !== 402) throw new Error(`Expected 402, got ${initial.status}`);
  const bodyText = await initial.text();
  const body = JSON.parse(bodyText);

  // Step 2: Parse payment requirements
  const paymentRequired: PaymentRequired = httpClient.getPaymentRequiredResponse(
    (name) => initial.headers.get(name), body,
  );
  const rawAmount = Number(paymentRequired.accepts[0]!.amount);
  const price = rawAmount / 1_000_000; // USDC has 6 decimals

  // Step 3: Sign payment
  const paymentPayload = await httpClient.createPaymentPayload(paymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  // Step 4: Re-send with payment
  const paid = await fetch(url, {
    ...fetchOpts,
    headers: { ...fetchOpts.headers as Record<string, string>, ...paymentHeaders },
  });
  const paidText = await paid.text();
  if (paid.status !== 200) {
    throw new Error(`Payment failed (${paid.status}): ${paidText.substring(0, 500)}`);
  }
  const paidBody = JSON.parse(paidText) as { data: unknown };

  // Step 5: Extract settlement proof
  const settlement = httpClient.getPaymentSettleResponse(
    (name) => paid.headers.get(name),
  );

  return { data: paidBody.data, settlement, price };
}

// --- Test query ---
if (import.meta.main) {
  const endpoint = process.argv[2] ?? "/api/v1/platform/stats?timeframe=24h";
  console.log(`Querying: ${endpoint}\n`);

  try {
    const { data, settlement, price } = await paidFetch(endpoint);
    console.log(`Paid: $${price.toFixed(4)} USDC`);
    console.log(`Settlement TX: ${settlement?.transaction ?? "N/A"}`);
    console.log(`\nData:\n${JSON.stringify(data, null, 2)}`);
  } catch (err) {
    console.error("Error:", err);
    process.exit(1);
  }
}
