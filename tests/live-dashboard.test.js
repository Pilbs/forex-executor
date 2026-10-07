import test from "node:test"
import assert from "node:assert/strict"

import {
  getLiveAccountSummary,
  getLiveOpenTrades,
  getLiveClosedTrades,
} from "../worker/services/oanda.js"

function liveEnv() {
  return {
    OANDA_LIVE_API_TOKEN: "dummy",
    OANDA_LIVE_ACCOUNT_ID: "account",
  }
}

test("live account summary uses the live OANDA endpoint", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })

    return new Response(
      JSON.stringify({
        account: {
          id: "account",
          currency: "GBP",
          balance: "500.00",
          NAV: "500.00",
          openTradeCount: 0,
          openPositionCount: 0,
          pendingOrderCount: 0,
        },
        lastTransactionID: "1",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  try {
    const result = await getLiveAccountSummary(liveEnv())

    assert.equal(result.account.id, "account")
    assert.equal(calls.length, 1)
    assert.equal(
      calls[0].url,
      "https://api-fxtrade.oanda.com/v3/accounts/account/summary"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("live open trades use the live OANDA endpoint", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })

    return new Response(
      JSON.stringify({
        trades: [
          {
            id: "10",
            instrument: "GBP_USD",
            currentUnits: "1",
            price: "1.30000",
          },
        ],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  try {
    const trades = await getLiveOpenTrades(liveEnv())

    assert.equal(trades.length, 1)
    assert.equal(trades[0].instrument, "GBP_USD")
    assert.equal(
      calls[0].url,
      "https://api-fxtrade.oanda.com/v3/accounts/account/openTrades"
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("live closed-trade journal reads live transaction history", async () => {
  const originalFetch = globalThis.fetch
  const calls = []

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })

    if (String(url).endsWith("/summary")) {
      return new Response(
        JSON.stringify({
          account: { id: "account" },
          lastTransactionID: "1",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    }

    return new Response(
      JSON.stringify({ transactions: [] }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    )
  }

  try {
    const trades = await getLiveClosedTrades(liveEnv())

    assert.deepEqual(trades, [])
    assert.equal(calls.length, 2)
    assert.ok(
      calls.every((call) =>
        call.url.startsWith("https://api-fxtrade.oanda.com/")
      )
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
