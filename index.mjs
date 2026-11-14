import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";

const PAY_TO = process.env.PAY_TO;            // ví nhận tiền (Base)
const BASE_URL = process.env.BASE_URL;        // vd https://ten-app.onrender.com
const PRICE = process.env.PRICE || "2000";    // 2000 = 0.002 USDC
const facilitator = "https://x402.org/facilitator";
if (!PAY_TO || !BASE_URL) throw new Error("Thiếu PAY_TO hoặc BASE_URL");

const offer = {
  x402Version: 2, error: "Payment required",
  resource: { url: `${BASE_URL}/paid`, description: "Returns BTC spot price and server time.", mimeType: "application/json", serviceName: "KID96 Crypto API" },
  accepts: [{ scheme: "exact", network: "eip155:8453", amount: PRICE,
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", payTo: PAY_TO,
    maxTimeoutSeconds: 120, extra: { name: "USD Coin", version: "2" } }],
};
const app = new Hono();
app.use("*", cors({ origin: "*", exposeHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE"] }));
app.get("/", (c) => c.json({ ok: true, paid: `${BASE_URL}/paid` }));
app.get("/openapi.json", (c) => c.json({ openapi: "3.0.3", info: { title: "KID96 Crypto API", version: "1.0.0" },
  servers: [{ url: BASE_URL }],
  paths: { "/paid": { post: { operationId: "paid", "x-payment-info": offer.accepts[0],
    responses: { "200": { description: "Paid response" }, "402": { description: "Payment required" } } } } } }));
app.post("/paid", async (c) => {
  const enc = c.req.header("PAYMENT-SIGNATURE");
  if (!enc) return c.json(offer, 402, { "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(offer)).toString("base64") });
  let payment; try { payment = JSON.parse(Buffer.from(enc,"base64").toString()); } catch { return c.json({ error: "Invalid payment" }, 400); }
  const body = JSON.stringify({ x402Version: 2, paymentPayload: payment, paymentRequirements: offer.accepts[0] });
  const h = { "content-type": "application/json" };
  const v = await fetch(`${facilitator}/verify`, { method: "POST", headers: h, body }); const vj = await v.json();
  if (!v.ok || !vj.isValid) return c.json({ error: "Payment verification failed" }, 402);
  const s = await fetch(`${facilitator}/settle`, { method: "POST", headers: h, body }); const sj = await s.json();
  if (!s.ok || !sj.success) return c.json({ error: "Payment settlement failed" }, 502);
  let btc = null; try { btc = (await (await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot")).json()).data.amount; } catch {}
  return c.json({ time: new Date().toISOString(), btcUsd: btc }, 200, { "PAYMENT-RESPONSE": Buffer.from(JSON.stringify(sj)).toString("base64") });
});
serve({ fetch: app.fetch, port: Number(process.env.PORT || 4242) });
