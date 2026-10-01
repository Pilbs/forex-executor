import test from "node:test"
import assert from "node:assert/strict"

import { validateSignal } from "../worker/validation/signal.js"
import { placeMarketOrder } from "../worker/services/oanda.js"

function gbpPayload(overrides = {}) {
  return {
    signalId: "gbpusd-test-1",
    strategyName: "H02_GBPUSD_M15",
    instrument: "GBP_USD",
    direction: "buy",
    units: 1850,
    stopLoss: 1.3000,
    takeProfit: 1.3200,
    ...overrides,
  }
}

test("GBP_USD is rejected until live execution is explicitly enabled", () => {
  const errors = validateSignal(gbpPayload(), {})

  assert.ok(
    errors.includes("GBP_USD live execution is not enabled")
  )
})

test("GBP_USD enforces the hard 3000 unit cap", () => {
  const env = {
    GBP_USD_LIVE_ENABLED: "true",
  }

  assert.deepEqual(
    validateSignal(gbpPayload({ units: 3000 }), env),
    []
  )

  const tooLarge = validateSignal(
    gbpPayload({ units: 3001 }),
    env
  )

  assert.ok(
    tooLarge.includes("units cannot exceed 3000 for GBP_USD")
  )
})

test("GBP_USD requires an initial stop loss", () => {
  const errors = validateSignal(
    gbpPayload({ stopLoss: undefined }),
    { GBP_USD_LIVE_ENABLED: "true" }
  )

  assert.ok(
    errors.includes(
      "stopLoss is required for GBP_USD live execution"
    )
  )
})

test("GBP_USD orders use the live OANDA endpoint and live credentials", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })

    if (String(url).includes("/instruments?")) {
      return new Response(
        JSON.stringify({
          instruments: [
            {
              name: "GBP_USD",
              minimumTradeSize: "1",
              maximumOrderUnits: "1000000",
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    return new Response(
      JSON.stringify({
        orderCreateTransaction: { id: "301" },
        orderFillTransaction: {
          id: "302",
          orderID: "301",
          price: "1.31000",
          time: "2026-10-01T07:00:00Z",
          tradeOpened: { tradeID: "303" },
        },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  try {
    const result = await placeMarketOrder(
      {
        GBP_USD_LIVE_ENABLED: "true",
        OANDA_LIVE_API_TOKEN: "live-token",
        OANDA_LIVE_ACCOUNT_ID: "live-account",
      },
      {
        instrument: "GBP_USD",
        direction: "buy",
        requested_units: 1850,
        requested_stop_loss: 1.3000,
        requested_take_profit: 1.3200,
      }
    )

    assert.equal(result.tradeId, "303")
    assert.equal(calls.length, 2)
    assert.ok(
      calls.every((call) =>
        call.url.startsWith("https://api-fxtrade.oanda.com/")
      )
    )
    assert.equal(
      calls[0].options.headers.Authorization,
      "Bearer live-token"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
