import test from "node:test"
import assert from "node:assert/strict"

import { validatePartialClose } from "../worker/validation/trade-management.js"
import { closeTradeUnits } from "../worker/services/oanda.js"

test("partial_close requires signal metadata and positive integer units", () => {
  assert.deepEqual(
    validatePartialClose({
      signalId: "sig-1",
      strategyName: "H02_GBPUSD_M15",
      units: 925,
    }),
    []
  )

  assert.ok(
    validatePartialClose({
      signalId: "sig-1",
      strategyName: "H02_GBPUSD_M15",
      units: 0,
    }).includes("units must be a positive integer")
  )
})

test("GBPUSD partial close uses live OANDA and is duplicate-safe", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })

    if (String(url).endsWith("/trades/123")) {
      return new Response(
        JSON.stringify({
          trade: { currentUnits: "1850" },
          lastTransactionID: "10",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    }

    return new Response(
      JSON.stringify({ lastTransactionID: "11" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )
  }

  try {
    const result = await closeTradeUnits(
      {
        GBP_USD_LIVE_ENABLED: "true",
        OANDA_LIVE_API_TOKEN: "live-token",
        OANDA_LIVE_ACCOUNT_ID: "live-account",
      },
      "123",
      925,
      "GBP_USD",
      1850
    )

    assert.equal(result.closedUnits, 925)
    assert.equal(calls.length, 2)
    assert.ok(calls.every((c) => c.url.startsWith("https://api-fxtrade.oanda.com/")))
    assert.equal(JSON.parse(calls[1].options.body).units, "925")
  } finally {
    globalThis.fetch = originalFetch
  }
})
