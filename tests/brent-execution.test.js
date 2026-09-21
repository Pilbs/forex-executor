import test from "node:test"
import assert from "node:assert/strict"

import { validateSignal } from "../worker/validation/signal.js"
import { placeMarketOrder } from "../worker/services/oanda.js"

function brentPayload(overrides = {}) {
  return {
    signalId: "brent-test-1",
    strategyName: "BrentTest",
    instrument: "BCO_USD",
    direction: "buy",
    units: 1,
    stopLoss: 70,
    takeProfit: 75,
    ...overrides,
  }
}

test("BCO_USD is rejected until live execution is explicitly enabled", () => {
  const errors = validateSignal(brentPayload(), {})

  assert.ok(
    errors.includes("BCO_USD live execution is not enabled")
  )
})

test("BCO_USD requires an explicit unit cap", () => {
  const errors = validateSignal(
    brentPayload(),
    { BCO_USD_LIVE_ENABLED: "true" }
  )

  assert.ok(
    errors.includes(
      "BCO_USD_MAX_UNITS must be configured as a positive integer"
    )
  )
})

test("BCO_USD enforces the configured unit cap and stop loss", () => {
  const env = {
    BCO_USD_LIVE_ENABLED: "true",
    BCO_USD_MAX_UNITS: "2",
  }

  assert.deepEqual(
    validateSignal(brentPayload({ units: 2 }), env),
    []
  )

  const tooLarge = validateSignal(
    brentPayload({ units: 3 }),
    env
  )
  assert.ok(
    tooLarge.includes("units cannot exceed 2 for BCO_USD")
  )

  const withoutStop = validateSignal(
    brentPayload({ stopLoss: undefined }),
    env
  )
  assert.ok(
    withoutStop.includes(
      "stopLoss is required for BCO_USD live execution"
    )
  )
})

test("BCO_USD orders use the live OANDA endpoint and live credentials", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })

    if (String(url).includes("/instruments?")) {
      return new Response(
        JSON.stringify({
          instruments: [
            {
              name: "BCO_USD",
              minimumTradeSize: "1",
              maximumOrderUnits: "1000",
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
        orderCreateTransaction: { id: "101" },
        orderFillTransaction: {
          id: "102",
          orderID: "101",
          price: "72.50",
          time: "2026-09-21T19:00:00Z",
          tradeOpened: { tradeID: "103" },
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
        BCO_USD_LIVE_ENABLED: "true",
        OANDA_LIVE_API_TOKEN: "live-token",
        OANDA_LIVE_ACCOUNT_ID: "live-account",
      },
      {
        instrument: "BCO_USD",
        direction: "buy",
        requested_units: 1,
        requested_stop_loss: 70,
        requested_take_profit: 75,
      }
    )

    assert.equal(result.tradeId, "103")
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

test("EUR_USD orders keep using the existing practice OANDA profile", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })

    return new Response(
      JSON.stringify({
        orderCreateTransaction: { id: "201" },
        orderFillTransaction: {
          id: "202",
          orderID: "201",
          price: "1.15000",
          time: "2026-09-21T19:00:00Z",
          tradeOpened: { tradeID: "203" },
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
        OANDA_API_TOKEN: "practice-token",
        OANDA_ACCOUNT_ID: "practice-account",
      },
      {
        instrument: "EUR_USD",
        direction: "sell",
        requested_units: 1000,
        requested_stop_loss: 1.16,
        requested_take_profit: 1.14,
      }
    )

    assert.equal(result.tradeId, "203")
    assert.equal(calls.length, 1)
    assert.ok(
      calls[0].url.startsWith(
        "https://api-fxpractice.oanda.com/"
      )
    )
    assert.equal(
      calls[0].options.headers.Authorization,
      "Bearer practice-token"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
