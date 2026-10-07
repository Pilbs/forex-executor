import test from "node:test"
import assert from "node:assert/strict"

import { validateSignal } from "../worker/validation/signal.js"
import {
  validateUpdateBracket,
  validateClose,
} from "../worker/validation/trade-management.js"
import {
  placeMarketOrder,
  updateTradeBracketFromOffsets,
  closeTrade,
} from "../worker/services/oanda.js"

function liveEnv(overrides = {}) {
  return {
    EUR_USD_LIVE_ENABLED: "true",
    EUR_USD_MAX_UNITS: "3000",
    GBP_USD_LIVE_ENABLED: "true",
    GBP_CAD_LIVE_ENABLED: "true",
    GBP_CAD_MAX_UNITS: "3000",
    OANDA_LIVE_API_TOKEN: "live-token",
    OANDA_LIVE_ACCOUNT_ID: "live-account",
    ...overrides,
  }
}

function v5Entry(overrides = {}) {
  return {
    action: "entry",
    version: "v5",
    signalId: "H02-GBPUSD-M15-test-L",
    strategyName: "H02_GBPUSD_M15",
    instrument: "GBP_USD",
    direction: "buy",
    units: 1850,
    stopDistance: 0.01,
    targetDistance: 0.02,
    ...overrides,
  }
}

test("LVBR v5 entry validates distances and strategy/instrument pairing", () => {
  assert.deepEqual(
    validateSignal(v5Entry(), liveEnv()),
    []
  )

  assert.ok(
    validateSignal(
      v5Entry({
        instrument: "EUR_USD",
      }),
      liveEnv()
    ).includes(
      "strategyName H02_GBPUSD_M15 must use instrument GBP_USD"
    )
  )

  assert.ok(
    validateSignal(
      v5Entry({
        stopDistance: undefined,
      }),
      liveEnv()
    ).includes(
      "stopDistance must be a positive number for v5"
    )
  )

  assert.ok(
    validateSignal(
      v5Entry({
        stopLoss: 1.2,
      }),
      liveEnv()
    ).includes(
      "v5 entry must not send stopLoss"
    )
  )
})

test("LVBR v5 trade-management payloads validate offsets and close metadata", () => {
  assert.deepEqual(
    validateUpdateBracket({
      action: "update_bracket",
      version: "v5",
      signalId: "sig-1",
      strategyName: "H02_GBPUSD_M15",
      instrument: "GBP_USD",
      stopOffsetFromEntry: 0.001,
      targetOffsetFromEntry: 0.01,
    }),
    []
  )

  assert.deepEqual(
    validateClose({
      action: "close",
      version: "v5",
      signalId: "sig-1",
      strategyName: "H02_GBPUSD_M15",
      instrument: "GBP_USD",
      direction: "long",
      reason: "time_progress",
    }),
    []
  )

  assert.ok(
    validateClose({
      action: "close",
      version: "v5",
      signalId: "sig-1",
      strategyName: "H02_GBPUSD_M15",
      instrument: "GBP_USD",
      direction: "buy",
      reason: "time_progress",
    }).includes(
      "direction must be long or short for v5 close"
    )
  )
})

test("LVBR v5 long entry anchors SL and TP to the actual OANDA fill", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
    })

    if (String(url).includes("/instruments?")) {
      return new Response(
        JSON.stringify({
          instruments: [
            {
              name: "GBP_USD",
              minimumTradeSize: "1",
              maximumOrderUnits: "1000000",
              displayPrecision: 5,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    if (
      String(url).endsWith("/orders") &&
      options.method === "POST"
    ) {
      return new Response(
        JSON.stringify({
          orderCreateTransaction: {
            id: "100",
          },
          orderFillTransaction: {
            id: "101",
            orderID: "100",
            price: "1.30000",
            time: "2026-10-07T12:00:00Z",
            tradeOpened: {
              tradeID: "102",
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    if (
      String(url).endsWith("/trades/102/orders") &&
      options.method === "PUT"
    ) {
      return new Response(
        JSON.stringify({
          lastTransactionID: "103",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    throw new Error(
      `Unexpected fetch: ${options.method ?? "GET"} ${url}`
    )
  }

  try {
    const payload = v5Entry()

    const result = await placeMarketOrder(
      liveEnv(),
      {
        instrument: payload.instrument,
        direction: payload.direction,
        requested_units: payload.units,
        requested_stop_loss: null,
        requested_take_profit: null,
        webhook_payload: JSON.stringify(payload),
      }
    )

    assert.equal(result.tradeId, "102")
    assert.equal(result.price, "1.30000")
    assert.equal(result.stopLoss, "1.29000")
    assert.equal(result.takeProfit, "1.32000")
    assert.equal(calls.length, 3)

    const marketOrder = JSON.parse(
      calls[1].options.body
    ).order

    assert.equal(
      marketOrder.stopLossOnFill,
      undefined
    )
    assert.equal(
      marketOrder.takeProfitOnFill,
      undefined
    )

    const bracket = JSON.parse(
      calls[2].options.body
    )

    assert.equal(
      bracket.stopLoss.price,
      "1.29000"
    )
    assert.equal(
      bracket.takeProfit.price,
      "1.32000"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("LVBR v5 short entry anchors SL and TP to the actual OANDA fill", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
    })

    if (String(url).includes("/instruments?")) {
      return new Response(
        JSON.stringify({
          instruments: [
            {
              name: "GBP_CAD",
              minimumTradeSize: "1",
              maximumOrderUnits: "1000000",
              displayPrecision: 5,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    if (
      String(url).endsWith("/orders") &&
      options.method === "POST"
    ) {
      return new Response(
        JSON.stringify({
          orderCreateTransaction: {
            id: "200",
          },
          orderFillTransaction: {
            id: "201",
            orderID: "200",
            price: "1.80000",
            time: "2026-10-07T12:00:00Z",
            tradeOpened: {
              tradeID: "202",
            },
          },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    if (
      String(url).endsWith("/trades/202/orders") &&
      options.method === "PUT"
    ) {
      return new Response(
        JSON.stringify({
          lastTransactionID: "203",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    throw new Error(
      `Unexpected fetch: ${options.method ?? "GET"} ${url}`
    )
  }

  try {
    const payload = v5Entry({
      signalId: "H02-GBPCAD-M15-test-S",
      strategyName: "H02_GBPCAD_M15",
      instrument: "GBP_CAD",
      direction: "sell",
      units: 1500,
    })

    const result = await placeMarketOrder(
      liveEnv(),
      {
        instrument: payload.instrument,
        direction: payload.direction,
        requested_units: payload.units,
        requested_stop_loss: null,
        requested_take_profit: null,
        webhook_payload: JSON.stringify(payload),
      }
    )

    assert.equal(result.tradeId, "202")
    assert.equal(result.stopLoss, "1.81000")
    assert.equal(result.takeProfit, "1.78000")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("LVBR v5 bracket updates use the OANDA trade entry, not TradingView entry", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
    })

    if (String(url).endsWith("/trades/303")) {
      return new Response(
        JSON.stringify({
          trade: {
            id: "303",
            price: "1.31000",
            state: "OPEN",
          },
          lastTransactionID: "10",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    if (String(url).endsWith("/trades/303/orders")) {
      return new Response(
        JSON.stringify({
          lastTransactionID: "11",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    throw new Error(
      `Unexpected fetch: ${options.method ?? "GET"} ${url}`
    )
  }

  try {
    const result =
      await updateTradeBracketFromOffsets(
        liveEnv(),
        "303",
        "buy",
        0.002,
        0.01,
        "GBP_USD"
      )

    assert.equal(result.entryPrice, "1.31000")
    assert.equal(result.stopLoss, "1.31200")
    assert.equal(result.takeProfit, "1.32000")

    const bracket = JSON.parse(
      calls[1].options.body
    )

    assert.equal(
      bracket.stopLoss.price,
      "1.31200"
    )
    assert.equal(
      bracket.takeProfit.price,
      "1.32000"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("LVBR v5 rejects a long TP at or below the actual OANDA entry", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
    })

    return new Response(
      JSON.stringify({
        trade: {
          id: "404",
          price: "1.31000",
          state: "OPEN",
        },
        lastTransactionID: "20",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
  }

  try {
    await assert.rejects(
      () =>
        updateTradeBracketFromOffsets(
          liveEnv(),
          "404",
          "buy",
          -0.005,
          -0.001,
          "GBP_USD"
        ),
      /Rejected long take-profit at or below actual OANDA entry/
    )

    assert.equal(calls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("full close is duplicate-safe when OANDA already reports the trade closed", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({
      url: String(url),
      options,
    })

    return new Response(
      JSON.stringify({
        trade: {
          id: "505",
          price: "1.31000",
          state: "CLOSED",
        },
        lastTransactionID: "30",
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      }
    )
  }

  try {
    const result = await closeTrade(
      liveEnv(),
      "505",
      "GBP_USD"
    )

    assert.equal(result.alreadyClosed, true)
    assert.equal(calls.length, 1)
  } finally {
    globalThis.fetch = originalFetch
  }
})
