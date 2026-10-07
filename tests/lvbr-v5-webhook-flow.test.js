import test from "node:test"
import assert from "node:assert/strict"

import { handleTradingViewWebhook } from "../worker/routes/tradingview.js"

function createFakeDb() {
  const rows = []
  let nextId = 1

  function rowById(id) {
    return rows.find((row) => row.id === Number(id)) ?? null
  }

  function prepared(sql) {
    const normalized = sql.replace(/\s+/g, " ").trim()
    let args = []

    return {
      bind(...values) {
        args = values
        return this
      },

      async run() {
        if (normalized.startsWith("INSERT INTO trade_signals")) {
          const [
            idempotencyKey,
            signalId,
            strategyName,
            instrument,
            direction,
            requestedUnits,
            requestedStopLoss,
            requestedTakeProfit,
            webhookPayload,
          ] = args

          const duplicate = rows.find(
            (row) =>
              row.idempotency_key === idempotencyKey ||
              (
                row.strategy_name === strategyName &&
                row.signal_id === signalId
              )
          )

          if (duplicate) {
            return {
              meta: {
                changes: 0,
              },
            }
          }

          rows.push({
            id: nextId++,
            idempotency_key: idempotencyKey,
            signal_id: signalId,
            strategy_name: strategyName,
            instrument,
            direction,
            requested_units: requestedUnits,
            requested_stop_loss: requestedStopLoss,
            requested_take_profit: requestedTakeProfit,
            webhook_payload: webhookPayload,
            execution_status: "received",
            oanda_order_id: null,
            oanda_trade_id: null,
            oanda_error_code: null,
            oanda_error_message: null,
            bot_close_transaction_id: null,
            received_at: "2026-10-07 12:00:00",
            executed_at: null,
            updated_at: "2026-10-07 12:00:00",
          })

          return {
            meta: {
              changes: 1,
            },
          }
        }

        if (
          normalized.includes(
            "SET execution_status = 'processing'"
          )
        ) {
          const [id] = args
          const row = rowById(id)

          if (!row || row.execution_status !== "received") {
            return {
              meta: {
                changes: 0,
              },
            }
          }

          row.execution_status = "processing"

          return {
            meta: {
              changes: 1,
            },
          }
        }

        if (
          normalized.includes(
            "SET execution_status = 'executed'"
          )
        ) {
          const [orderId, tradeId, id] = args
          const row = rowById(id)

          if (!row) {
            return {
              meta: {
                changes: 0,
              },
            }
          }

          row.execution_status = "executed"
          row.oanda_order_id = orderId
          row.oanda_trade_id = tradeId
          row.executed_at = "2026-10-07 12:00:01"

          return {
            meta: {
              changes: 1,
            },
          }
        }

        if (
          normalized.includes(
            "SET execution_status = 'failed'"
          )
        ) {
          const [errorCode, errorMessage, id] = args
          const row = rowById(id)

          if (row) {
            row.execution_status = "failed"
            row.oanda_error_code = errorCode
            row.oanda_error_message = errorMessage
          }

          return {
            meta: {
              changes: row ? 1 : 0,
            },
          }
        }

        if (
          normalized.includes(
            "SET bot_close_transaction_id = ?"
          )
        ) {
          const [closeTransactionId, id] = args
          const row = rowById(id)

          if (row) {
            row.bot_close_transaction_id =
              closeTransactionId
          }

          return {
            meta: {
              changes: row ? 1 : 0,
            },
          }
        }

        throw new Error(
          `Unsupported fake D1 run SQL: ${normalized}`
        )
      },

      async first() {
        if (
          normalized.includes(
            "WHERE idempotency_key = ?"
          )
        ) {
          const [idempotencyKey] = args

          return rows.find(
            (row) =>
              row.idempotency_key === idempotencyKey
          ) ?? null
        }

        if (
          normalized.includes(
            "WHERE id = ?"
          )
        ) {
          return rowById(args[0])
        }

        if (
          normalized.includes(
            "WHERE strategy_name = ?"
          ) &&
          normalized.includes(
            "AND signal_id = ?"
          )
        ) {
          const [strategyName, signalId] = args

          return rows.find(
            (row) =>
              row.strategy_name === strategyName &&
              row.signal_id === signalId
          ) ?? null
        }

        throw new Error(
          `Unsupported fake D1 first SQL: ${normalized}`
        )
      },

      async all() {
        return {
          results: [],
        }
      },
    }
  }

  return {
    rows,
    prepare: prepared,
  }
}

function createContext() {
  const promises = []

  return {
    promises,
    waitUntil(promise) {
      promises.push(promise)
    },
    async drain() {
      await Promise.all(promises)
      promises.length = 0
    },
  }
}

function createOandaMock() {
  const calls = []
  const trades = new Map()
  let nextOrderId = 1000
  let nextTradeId = 2000
  let nextTransactionId = 3000

  const fillPrices = {
    EUR_USD: 1.10000,
    GBP_USD: 1.30000,
    GBP_CAD: 1.80000,
  }

  const fetchMock = async (url, options = {}) => {
    const href = String(url)
    const method = options.method ?? "GET"

    calls.push({
      url: href,
      method,
      body: options.body ?? null,
    })

    if (
      href.includes("/instruments?") &&
      method === "GET"
    ) {
      const parsedUrl = new URL(href)
      const instrument =
        parsedUrl.searchParams.get("instruments")

      return new Response(
        JSON.stringify({
          instruments: [
            {
              name: instrument,
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
      href.endsWith("/orders") &&
      method === "POST"
    ) {
      const order = JSON.parse(options.body).order
      const orderId = String(nextOrderId++)
      const tradeId = String(nextTradeId++)
      const transactionId =
        String(nextTransactionId++)
      const price =
        fillPrices[order.instrument]

      if (!price) {
        throw new Error(
          `Missing mocked fill price for ${order.instrument}`
        )
      }

      trades.set(tradeId, {
        id: tradeId,
        instrument: order.instrument,
        price: price.toFixed(5),
        state: "OPEN",
        currentUnits: String(
          Math.abs(Number(order.units))
        ),
      })

      return new Response(
        JSON.stringify({
          orderCreateTransaction: {
            id: orderId,
          },
          orderFillTransaction: {
            id: transactionId,
            orderID: orderId,
            price: price.toFixed(5),
            time: "2026-10-07T12:00:00Z",
            tradeOpened: {
              tradeID: tradeId,
            },
          },
          lastTransactionID: transactionId,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    const tradeMatch = href.match(
      /\/trades\/([^/]+)$/
    )

    if (
      tradeMatch &&
      method === "GET"
    ) {
      const trade = trades.get(
        tradeMatch[1]
      )

      if (!trade) {
        return new Response(
          JSON.stringify({
            errorMessage: "Trade not found",
          }),
          {
            status: 404,
            headers: {
              "Content-Type": "application/json",
            },
          }
        )
      }

      return new Response(
        JSON.stringify({
          trade,
          lastTransactionID:
            String(nextTransactionId - 1),
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    const bracketMatch = href.match(
      /\/trades\/([^/]+)\/orders$/
    )

    if (
      bracketMatch &&
      method === "PUT"
    ) {
      const trade = trades.get(
        bracketMatch[1]
      )

      if (!trade || trade.state !== "OPEN") {
        return new Response(
          JSON.stringify({
            errorMessage: "Trade is not open",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
            },
          }
        )
      }

      const transactionId =
        String(nextTransactionId++)

      return new Response(
        JSON.stringify({
          lastTransactionID: transactionId,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        }
      )
    }

    const closeMatch = href.match(
      /\/trades\/([^/]+)\/close$/
    )

    if (
      closeMatch &&
      method === "PUT"
    ) {
      const trade = trades.get(
        closeMatch[1]
      )

      if (!trade || trade.state !== "OPEN") {
        return new Response(
          JSON.stringify({
            errorMessage: "Trade is not open",
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
            },
          }
        )
      }

      const body = JSON.parse(
        options.body
      )

      const transactionId =
        String(nextTransactionId++)

      if (body.units === "ALL") {
        trade.currentUnits = "0"
        trade.state = "CLOSED"
      } else {
        const remaining =
          Math.abs(
            Number(trade.currentUnits)
          ) -
          Number(body.units)

        trade.currentUnits =
          String(remaining)

        if (remaining <= 0) {
          trade.currentUnits = "0"
          trade.state = "CLOSED"
        }
      }

      return new Response(
        JSON.stringify({
          orderFillTransaction: {
            id: transactionId,
          },
          lastTransactionID:
            transactionId,
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
      `Unexpected mocked OANDA request: ${method} ${href}`
    )
  }

  return {
    calls,
    trades,
    fetchMock,
  }
}

function createEnv(db) {
  return {
    DB: db,
    ALLOW_TEST_ENDPOINTS: "true",

    EUR_USD_LIVE_ENABLED: "true",
    EUR_USD_MAX_UNITS: "5000",

    GBP_USD_LIVE_ENABLED: "true",

    GBP_CAD_LIVE_ENABLED: "true",
    GBP_CAD_MAX_UNITS: "5000",

    OANDA_LIVE_API_TOKEN: "test-live-token",
    OANDA_LIVE_ACCOUNT_ID: "test-live-account",
  }
}

function request(payload) {
  return new Request(
    "https://example.test/api/webhook/tradingview",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  )
}

async function postWebhook(
  env,
  ctx,
  payload
) {
  const response =
    await handleTradingViewWebhook(
      request(payload),
      env,
      ctx
    )

  const body = await response.json()

  await ctx.drain()

  return {
    status: response.status,
    body,
  }
}

function entryPayload({
  instrument,
  strategyName,
  signalId,
  direction = "buy",
  units = 1800,
}) {
  return {
    action: "entry",
    version: "v5",
    signalId,
    strategyName,
    instrument,
    direction,
    units,
    stopDistance: 0.01000,
    targetDistance: 0.02000,
    enabled: {
      progressiveLock: true,
      maxGiveback: true,
      partialTP: true,
      timeProgressExit: true,
    },
  }
}

const instruments = [
  {
    instrument: "EUR_USD",
    strategyName: "H02_EURUSD_M15",
    signalId: "H02-EURUSD-M15-sim-L",
    expectedFill: "1.10000",
    expectedStop: "1.09000",
    expectedTarget: "1.12000",
  },
  {
    instrument: "GBP_USD",
    strategyName: "H02_GBPUSD_M15",
    signalId: "H02-GBPUSD-M15-sim-L",
    expectedFill: "1.30000",
    expectedStop: "1.29000",
    expectedTarget: "1.32000",
  },
  {
    instrument: "GBP_CAD",
    strategyName: "H02_GBPCAD_M15",
    signalId: "H02-GBPCAD-M15-sim-L",
    expectedFill: "1.80000",
    expectedStop: "1.79000",
    expectedTarget: "1.82000",
  },
]

for (const scenario of instruments) {
  test(
    `${scenario.instrument} v5 webhook entry reaches OANDA with fill-anchored bracket`,
    async () => {
      const db = createFakeDb()
      const ctx = createContext()
      const oanda =
        createOandaMock()
      const env = createEnv(db)
      const originalFetch =
        globalThis.fetch

      globalThis.fetch =
        oanda.fetchMock

      try {
        const result = await postWebhook(
          env,
          ctx,
          entryPayload({
            instrument:
              scenario.instrument,
            strategyName:
              scenario.strategyName,
            signalId:
              scenario.signalId,
          })
        )

        assert.equal(
          result.status,
          202
        )
        assert.equal(
          result.body.accepted,
          true
        )

        assert.equal(
          db.rows.length,
          1
        )
        assert.equal(
          db.rows[0].execution_status,
          "executed"
        )

        const storedPayload =
          JSON.parse(
            db.rows[0].webhook_payload
          )

        assert.equal(
          storedPayload.version,
          "v5"
        )
        assert.equal(
          storedPayload.enabled
            .timeProgressExit,
          true
        )

        const orderCall =
          oanda.calls.find(
            (call) =>
              call.method === "POST" &&
              call.url.endsWith(
                "/orders"
              )
          )

        const order =
          JSON.parse(
            orderCall.body
          ).order

        assert.equal(
          order.stopLossOnFill,
          undefined
        )
        assert.equal(
          order.takeProfitOnFill,
          undefined
        )

        const bracketCall =
          oanda.calls.find(
            (call) =>
              call.method === "PUT" &&
              call.url.endsWith(
                `/trades/${db.rows[0].oanda_trade_id}/orders`
              )
          )

        const bracket =
          JSON.parse(
            bracketCall.body
          )

        assert.equal(
          oanda.trades.get(
            db.rows[0].oanda_trade_id
          ).price,
          scenario.expectedFill
        )
        assert.equal(
          bracket.stopLoss.price,
          scenario.expectedStop
        )
        assert.equal(
          bracket.takeProfit.price,
          scenario.expectedTarget
        )
      } finally {
        globalThis.fetch =
          originalFetch
      }
    }
  )
}

test("v5 duplicate entry does not place a second OANDA market order", async () => {
  const db = createFakeDb()
  const ctx = createContext()
  const oanda = createOandaMock()
  const env = createEnv(db)
  const originalFetch =
    globalThis.fetch

  globalThis.fetch =
    oanda.fetchMock

  try {
    const payload = entryPayload({
      instrument: "GBP_USD",
      strategyName:
        "H02_GBPUSD_M15",
      signalId:
        "H02-GBPUSD-M15-duplicate-L",
    })

    const first = await postWebhook(
      env,
      ctx,
      payload
    )

    const second = await postWebhook(
      env,
      ctx,
      payload
    )

    assert.equal(
      first.status,
      202
    )
    assert.equal(
      second.status,
      200
    )
    assert.equal(
      second.body.duplicate,
      true
    )

    const marketOrders =
      oanda.calls.filter(
        (call) =>
          call.method === "POST" &&
          call.url.endsWith("/orders")
      )

    assert.equal(
      marketOrders.length,
      1
    )
  } finally {
    globalThis.fetch =
      originalFetch
  }
})

test("v5 webhook bracket update, partial close and time-progress close stay tied to the original trade", async () => {
  const db = createFakeDb()
  const ctx = createContext()
  const oanda = createOandaMock()
  const env = createEnv(db)
  const originalFetch =
    globalThis.fetch

  globalThis.fetch =
    oanda.fetchMock

  try {
    const payload = entryPayload({
      instrument: "GBP_USD",
      strategyName:
        "H02_GBPUSD_M15",
      signalId:
        "H02-GBPUSD-M15-flow-L",
      units: 1850,
    })

    const entry = await postWebhook(
      env,
      ctx,
      payload
    )

    assert.equal(
      entry.status,
      202
    )

    const row = db.rows[0]
    const tradeId =
      row.oanda_trade_id

    const update =
      await postWebhook(
        env,
        ctx,
        {
          action:
            "update_bracket",
          version: "v5",
          signalId:
            payload.signalId,
          strategyName:
            payload.strategyName,
          instrument:
            payload.instrument,
          stopOffsetFromEntry:
            0.00200,
          targetOffsetFromEntry:
            0.02000,
        }
      )

    assert.equal(
      update.status,
      202
    )

    const bracketCalls =
      oanda.calls.filter(
        (call) =>
          call.method === "PUT" &&
          call.url.endsWith(
            `/trades/${tradeId}/orders`
          )
      )

    const managedBracket =
      JSON.parse(
        bracketCalls.at(-1).body
      )

    assert.equal(
      managedBracket.stopLoss.price,
      "1.30200"
    )
    assert.equal(
      managedBracket.takeProfit.price,
      "1.32000"
    )

    const partial =
      await postWebhook(
        env,
        ctx,
        {
          action:
            "partial_close",
          version: "v5",
          signalId:
            payload.signalId,
          strategyName:
            payload.strategyName,
          instrument:
            payload.instrument,
          units: 925,
        }
      )

    assert.equal(
      partial.status,
      202
    )

    assert.equal(
      oanda.trades.get(
        tradeId
      ).currentUnits,
      "925"
    )

    const close =
      await postWebhook(
        env,
        ctx,
        {
          action: "close",
          version: "v5",
          signalId:
            payload.signalId,
          strategyName:
            payload.strategyName,
          instrument:
            payload.instrument,
          direction: "long",
          reason:
            "time_progress",
        }
      )

    assert.equal(
      close.status,
      202
    )

    assert.equal(
      oanda.trades.get(
        tradeId
      ).state,
      "CLOSED"
    )

    assert.ok(
      row.bot_close_transaction_id
    )

    const duplicateClose =
      await postWebhook(
        env,
        ctx,
        {
          action: "close",
          version: "v5",
          signalId:
            payload.signalId,
          strategyName:
            payload.strategyName,
          instrument:
            payload.instrument,
          direction: "long",
          reason:
            "time_progress",
        }
      )

    assert.equal(
      duplicateClose.status,
      202
    )

    const fullClosePuts =
      oanda.calls.filter(
        (call) =>
          call.method === "PUT" &&
          call.url.endsWith(
            `/trades/${tradeId}/close`
          ) &&
          JSON.parse(call.body)
            .units === "ALL"
      )

    assert.equal(
      fullClosePuts.length,
      1
    )
  } finally {
    globalThis.fetch =
      originalFetch
  }
})

test("v5 max-hold close uses the same validated close path", async () => {
  const db = createFakeDb()
  const ctx = createContext()
  const oanda = createOandaMock()
  const env = createEnv(db)
  const originalFetch =
    globalThis.fetch

  globalThis.fetch =
    oanda.fetchMock

  try {
    const payload = entryPayload({
      instrument: "GBP_CAD",
      strategyName:
        "H02_GBPCAD_M15",
      signalId:
        "H02-GBPCAD-M15-maxhold-S",
      direction: "sell",
      units: 1500,
    })

    await postWebhook(
      env,
      ctx,
      payload
    )

    const row = db.rows[0]
    const tradeId =
      row.oanda_trade_id

    const close =
      await postWebhook(
        env,
        ctx,
        {
          action: "close",
          version: "v5",
          signalId:
            payload.signalId,
          strategyName:
            payload.strategyName,
          instrument:
            payload.instrument,
          direction: "short",
          reason: "max_hold",
        }
      )

    assert.equal(
      close.status,
      202
    )
    assert.equal(
      oanda.trades.get(
        tradeId
      ).state,
      "CLOSED"
    )
  } finally {
    globalThis.fetch =
      originalFetch
  }
})

test("v5 rejects a mismatched strategy and instrument before execution", async () => {
  const db = createFakeDb()
  const ctx = createContext()
  const oanda = createOandaMock()
  const env = createEnv(db)
  const originalFetch =
    globalThis.fetch

  globalThis.fetch =
    oanda.fetchMock

  try {
    const result =
      await postWebhook(
        env,
        ctx,
        entryPayload({
          instrument:
            "GBP_USD",
          strategyName:
            "H02_EURUSD_M15",
          signalId:
            "bad-pairing",
        })
      )

    assert.equal(
      result.status,
      400
    )
    assert.equal(
      result.body.accepted,
      false
    )
    assert.ok(
      result.body.errors.includes(
        "strategyName H02_EURUSD_M15 must use instrument EUR_USD"
      )
    )
    assert.equal(
      oanda.calls.length,
      0
    )
  } finally {
    globalThis.fetch =
      originalFetch
  }
})
