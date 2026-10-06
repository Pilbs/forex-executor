import test from "node:test"
import assert from "node:assert/strict"

import { validateSignal } from "../worker/validation/signal.js"
import { placeMarketOrder } from "../worker/services/oanda.js"

function eurPayload(overrides = {}) {
  return {
    signalId: "eurusd-test-1",
    strategyName: "EURUSD_LIVE_TEST",
    instrument: "EUR_USD",
    direction: "buy",
    units: 1000,
    stopLoss: 1.1500,
    takeProfit: 1.1700,
    ...overrides,
  }
}

test("EUR_USD is rejected until live execution is explicitly enabled", () => {
  const errors = validateSignal(eurPayload(), {})

  assert.ok(
    errors.includes("EUR_USD live execution is not enabled")
  )
})

test("EUR_USD preserves the default 10000 unit cap", () => {
  const env = {
    EUR_USD_LIVE_ENABLED: "true",
  }

  assert.deepEqual(
    validateSignal(eurPayload({ units: 10000 }), env),
    []
  )

  const tooLarge = validateSignal(
    eurPayload({ units: 10001 }),
    env
  )

  assert.ok(
    tooLarge.includes("units cannot exceed 10000 for EUR_USD")
  )
})

test("EUR_USD supports a configurable lower unit cap", () => {
  const errors = validateSignal(
    eurPayload({ units: 3001 }),
    {
      EUR_USD_LIVE_ENABLED: "true",
      EUR_USD_MAX_UNITS: "3000",
    }
  )

  assert.ok(
    errors.includes("units cannot exceed 3000 for EUR_USD")
  )
})

test("EUR_USD requires an initial stop loss for live execution", () => {
  const errors = validateSignal(
    eurPayload({ stopLoss: undefined }),
    { EUR_USD_LIVE_ENABLED: "true" }
  )

  assert.ok(
    errors.includes(
      "stopLoss is required for EUR_USD live execution"
    )
  )
})

test("EUR_USD orders use the live OANDA endpoint and live credentials", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })

    if (String(url).includes("/instruments?")) {
      return new Response(
        JSON.stringify({
          instruments: [
            {
              name: "EUR_USD",
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
        orderCreateTransaction: { id: "401" },
        orderFillTransaction: {
          id: "402",
          orderID: "401",
          price: "1.16000",
          time: "2026-10-06T12:00:00Z",
          tradeOpened: { tradeID: "403" },
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
        EUR_USD_LIVE_ENABLED: "true",
        OANDA_LIVE_API_TOKEN: "live-token",
        OANDA_LIVE_ACCOUNT_ID: "live-account",
      },
      {
        instrument: "EUR_USD",
        direction: "buy",
        requested_units: 1000,
        requested_stop_loss: 1.1500,
        requested_take_profit: 1.1700,
      }
    )

    assert.equal(result.tradeId, "403")
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
