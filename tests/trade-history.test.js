import test from "node:test"
import assert from "node:assert/strict"
import { buildClosedTradesFromTransactions, JOURNAL_VERSION } from "../worker/services/trade-history.js"
import { getClosedTrades } from "../worker/services/oanda.js"
import { getSignalsByOandaTradeIds } from "../worker/services/signals.js"
import { handleGetClosedTrades } from "../worker/routes/trades.js"

// Synthetic fixtures: never store real account IDs, credentials, or exports here.
const env = { OANDA_ACCOUNT_ID: "test-account", OANDA_API_TOKEN: "test-token" }
const time = (hour) => `2025-01-02T${hour}:00:00.000000000Z`
function opening(id = "200", tradeId = "900", units = "10000", price = "1.10000") {
  return {
    id, type: "ORDER_FILL", reason: "MARKET_ORDER", time: time("10"),
    instrument: "EUR_USD", units, price, orderID: "199", pl: "0.0000",
    tradeOpened: { tradeID: tradeId, units, price },
  }
}
function closing(id = "205", tradeId = "900", units = "-10000", price = "1.09900", pl = "-7.5000") {
  return {
    id, type: "ORDER_FILL", reason: "MARKET_ORDER_TRADE_CLOSE", time: time("12"),
    instrument: "EUR_USD", units, price, orderID: "204", pl,
    tradesClosed: [{ tradeID: tradeId, units, price, realizedPL: pl, financing: "0.0000" }],
  }
}
function example() {
  return [
    opening(),
    { id: "201", type: "TAKE_PROFIT_ORDER", tradeID: "900", price: "1.12000" },
    { id: "202", type: "STOP_LOSS_ORDER", tradeID: "900", price: "1.09000" },
    { id: "204", type: "MARKET_ORDER", reason: "TRADE_CLOSE", tradeClose: { tradeID: "900", units: "10000" } },
    closing(),
    { id: "206", type: "ORDER_CANCEL", orderID: "201", reason: "LINKED_TRADE_CLOSED" },
  ]
}
function mockBroker(t, transactions, last = "206") {
  const calls = []
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input)
    calls.push(url.pathname)
    assert.equal(options.method ?? "GET", "GET", "journal must never place or close orders")
    assert.equal(options.headers.Authorization, "Bearer test-token")
    if (url.pathname.endsWith("/summary")) return Response.json({ lastTransactionID: last })
    if (url.pathname.endsWith("/transactions/idrange")) {
      const from = BigInt(url.searchParams.get("from"))
      const to = BigInt(url.searchParams.get("to"))
      assert.ok(to - from < 1000n)
      return Response.json({ transactions: transactions.filter((tx) => BigInt(tx.id) >= from && BigInt(tx.id) <= to) })
    }
    // Reproduce the broker inconsistency: trade lookup fails despite valid fills.
    return Response.json({ errorCode: "NO_SUCH_TRADE", errorMessage: "Trade does not exist" }, { status: 404 })
  })
  return calls
}
function database(rows = []) {
  const queries = []
  return {
    queries,
    prepare(sql) {
      queries.push(sql)
      assert.doesNotMatch(sql, /bot_close_transaction_id/)
      assert.match(sql, /SELECT/)
      return { bind(...ids) {
        assert.ok(ids.length <= 100)
        return { async all() { return { results: rows.filter((row) => ids.includes(String(row.oanda_trade_id))) } } }
      } }
    },
  }
}

test("closed journal row is built from fills, not trade resources or transaction ID guesses", () => {
  const [trade] = buildClosedTradesFromTransactions(example())
  assert.equal(trade.id, "900")
  assert.equal(trade.state, "CLOSED")
  assert.equal(trade.currentUnits, "0")
  assert.equal(trade.price, "1.10000")
  assert.equal(trade.averageClosePrice, "1.09900")
  assert.equal(trade.realizedPL, "-7.5000")
  assert.equal(trade.closeTransactionId, "205")
  assert.equal(trade.closeReason, "MARKET_ORDER_TRADE_CLOSE")
  assert.equal(trade.stopLossOrder.price, "1.09000")
  assert.equal(trade.takeProfitOrder.price, "1.12000")
  assert.equal(trade.historySource, "transactions")
})

test("a close request without a filled exit does not close the trade", () => {
  assert.deepEqual(buildClosedTradesFromTransactions(example().filter((tx) => tx.id !== "205")), [])
})

test("partial exit stays open; final exit aggregates broker PL and weighted close price", () => {
  const partial = {
    id: "203", type: "ORDER_FILL", time: time("11"), instrument: "EUR_USD", reason: "MARKET_ORDER",
    price: "1.10100", tradeReduced: { tradeID: "900", units: "-4000", price: "1.10100", realizedPL: "3.0000", financing: "-0.0100" },
  }
  assert.deepEqual(buildClosedTradesFromTransactions([opening(), partial]), [])
  const [trade] = buildClosedTradesFromTransactions([opening(), partial, closing("205", "900", "-6000", "1.09900", "-4.5000")])
  assert.equal(trade.realizedPL, "-1.5000")
  assert.equal(Number(trade.averageClosePrice), 1.0998)
  assert.equal(trade.financing, "-0.0100")
  assert.deepEqual(trade.closingTransactionIDs, ["203", "205"])
})

test("SL and TP fills are handled independently of their close reasons", () => {
  for (const reason of ["STOP_LOSS_ORDER", "TAKE_PROFIT_ORDER", "TRAILING_STOP_LOSS_ORDER", "MARKET_ORDER_POSITION_CLOSEOUT"]) {
    const exit = { ...closing(), reason }
    assert.equal(buildClosedTradesFromTransactions([opening(), exit])[0].closeReason, reason)
  }
})

test("a position close can close multiple trades; per-trade P/L is not the order total", () => {
  const exit = closing("400", "900", "-10000", "1.09900", "-7.5000")
  exit.tradesClosed.push({ tradeID: "901", units: "-5000", price: "1.09900", realizedPL: "-3.7500", financing: "0" })
  exit.pl = "-11.2500"
  // The same order can also open a reverse trade, which is not closed history.
  exit.tradeOpened = { tradeID: "902", units: "-2000", price: "1.09900" }
  const trades = buildClosedTradesFromTransactions([opening(), opening("300", "901", "5000"), exit])
  assert.equal(trades.length, 2)
  assert.deepEqual(trades.map((trade) => trade.realizedPL).sort(), ["-3.7500", "-7.5000"])
})

test("short entries keep their entry direction and use per-trade execution prices", () => {
  const entry = opening("200", "900", "-10000")
  const exit = closing("205", "900", "10000")
  exit.price = "1.09800" // A GSLO-clamped per-trade price can differ from the fill.
  const [trade] = buildClosedTradesFromTransactions([entry, exit])
  assert.equal(trade.initialUnits, "-10000")
  assert.equal(trade.averageClosePrice, "1.09900")
})

test("daily financing and financing on reduction are added once, separately from P/L", () => {
  const daily = { id: "203", type: "DAILY_FINANCING", financing: "-100.0000", positionFinancings: [
    { financing: "-100.0000", openTradeFinancings: [{ tradeID: "900", financing: "-0.1234" }] },
  ] }
  const exit = closing()
  exit.tradesClosed[0].financing = "-0.0100"
  const [trade] = buildClosedTradesFromTransactions([opening(), daily, daily, exit])
  assert.equal(trade.financing, "-0.1334")
  assert.equal(trade.realizedPL, "-7.5000")
})

test("duplicate and unsorted transaction pages do not duplicate journal rows", () => {
  const rows = example()
  const before = JSON.stringify(rows)
  const trades = buildClosedTradesFromTransactions([...rows].reverse().concat(rows))
  assert.equal(trades.length, 1)
  assert.equal(JSON.stringify(rows), before)
})

test("large IDs are compared without Number precision loss; count is applied after reconstruction", () => {
  const rows = [opening("9007199254740993", "900"), closing("9007199254740994", "900"),
    opening("9007199254740995", "901"), closing("9007199254740996", "901")]
  assert.equal(buildClosedTradesFromTransactions(rows, 1)[0].id, "901")
})

test("incomplete entries, invalid monetary values, and missing reductions cause explicit errors", () => {
  assert.throws(() => buildClosedTradesFromTransactions([closing()]), /opening fill.*900/)
  const exit = closing()
  exit.tradesClosed[0].realizedPL = undefined
  assert.throws(() => buildClosedTradesFromTransactions([opening(), exit]), /realized P\/L/)
  assert.throws(() => buildClosedTradesFromTransactions([opening(), closing("205", "900", "-5000")]), /units do not reconcile/)
  assert.throws(() => buildClosedTradesFromTransactions(null), /not an array/)
})

test("journal service never calls the unavailable trade endpoint", async (t) => {
  const calls = mockBroker(t, example())
  const trades = await getClosedTrades(env)
  assert.equal(trades.length, 1)
  assert.equal(trades[0].id, "900")
  assert.deepEqual(calls, ["/v3/accounts/test-account/summary", "/v3/accounts/test-account/transactions/idrange"])
})

test("service pages the whole history, including an entry in an older page", async (t) => {
  const calls = mockBroker(t, [opening("999"), closing("2002")], "2002")
  assert.equal((await getClosedTrades(env))[0].id, "900")
  assert.equal(calls.length, 4)
})

test("failed and malformed transaction pages propagate instead of returning an incomplete list", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => String(url).endsWith("/summary")
    ? Response.json({ lastTransactionID: "206" })
    : Response.json({ errorMessage: "Upstream unavailable" }, { status: 503 }))
  await assert.rejects(getClosedTrades(env), /Upstream unavailable/)
  globalThis.fetch = async (url) => String(url).endsWith("/summary")
    ? Response.json({ lastTransactionID: "206" }) : Response.json({})
  await assert.rejects(getClosedTrades(env), /missing transactions/)
})

test("empty account works; missing summary cursor is an error rather than an empty journal", async (t) => {
  mockBroker(t, [], "0")
  assert.deepEqual(await getClosedTrades(env), [])
  globalThis.fetch = async () => Response.json({})
  await assert.rejects(getClosedTrades(env), /lastTransactionID/)
})

test("route preserves automated entry metadata for a market close and exposes source/version", async (t) => {
  mockBroker(t, example())
  const DB = database([{ oanda_trade_id: "900", signal_id: "test-signal", strategy_name: "Test Strategy", oanda_order_id: "199", requested_stop_loss: "1.08000" }])
  const response = await handleGetClosedTrades(new Request("https://example.test/api/oanda/trades/closed"), { ...env, DB })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  const data = await response.json()
  assert.equal(data.journalVersion, JOURNAL_VERSION)
  assert.equal(data.source, "oanda-transactions")
  assert.equal(data.trades[0].automated, true)
  assert.equal(data.trades[0].entryType, "Automated")
  assert.equal(data.trades[0].exitType, "Market Close")
  assert.equal(data.trades[0].stopLoss, "1.08000")
  assert.equal(data.trades[0].takeProfit, "1.12000")
})

test("no D1 signal does not remove a manual trade; metadata uses only base-schema columns", async (t) => {
  mockBroker(t, example())
  const response = await handleGetClosedTrades(new Request("https://example.test/api/oanda/trades/closed"), { ...env, DB: database() })
  const data = await response.json()
  assert.equal(data.count, 1)
  assert.equal(data.trades[0].entryType, "Manual")
})

test("metadata lookup batches parameters without losing any trade IDs", async () => {
  const rows = Array.from({ length: 205 }, (_, id) => ({ oanda_trade_id: String(id) }))
  const DB = database(rows)
  const map = await getSignalsByOandaTradeIds({ DB }, rows.map((row) => row.oanda_trade_id))
  assert.equal(map.size, 205)
  assert.equal(DB.queries.length, 3)
})
