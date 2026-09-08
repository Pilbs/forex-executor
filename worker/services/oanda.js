import { buildClosedTradesFromTransactions } from "./trade-history.js"

const OANDA_BASE_URL = "https://api-fxpractice.oanda.com"

function headers(env) {
  return {
    Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
    "Content-Type": "application/json",
  }
}

async function oandaJson(env, path, options = {}) {
  const response = await fetch(`${OANDA_BASE_URL}${path}`, {
    ...options,
    headers: headers(env),
  })

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.errorMessage || `OANDA request failed: ${response.status}`
    )
  }

  return data
}

export async function getAccountSummary(env) {
  if (!env.OANDA_API_TOKEN) {
    throw new Error("OANDA_API_TOKEN is not configured")
  }

  if (!env.OANDA_ACCOUNT_ID) {
    throw new Error("OANDA_ACCOUNT_ID is not configured")
  }

  return oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/summary`
  )
}

export async function placeMarketOrder(env, signal) {
  const units =
    signal.direction === "buy"
      ? signal.requested_units
      : -signal.requested_units

  const order = {
    type: "MARKET",
    instrument: signal.instrument,
    units: String(units),
    timeInForce: "FOK",
    positionFill: "DEFAULT",
  }

  if (signal.requested_stop_loss) {
    order.stopLossOnFill = {
      price: String(signal.requested_stop_loss),
      timeInForce: "GTC",
    }
  }

  if (signal.requested_take_profit) {
    order.takeProfitOnFill = {
      price: String(signal.requested_take_profit),
      timeInForce: "GTC",
    }
  }

  const data = await oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/orders`,
    {
      method: "POST",
      body: JSON.stringify({ order }),
    }
  )

  const fill = data.orderFillTransaction

  if (!fill) {
    throw new Error("OANDA accepted the order but it was not filled")
  }

  const tradeId = fill.tradeOpened?.tradeID ?? null

  if (!tradeId) {
    throw new Error(
      "OANDA filled the order but did not open a new trade"
    )
  }

  return {
    orderId:
      data.orderCreateTransaction?.id ??
      fill.orderID ??
      null,
    tradeId,
    price: fill.price ?? null,
    time: fill.time ?? null,
  }
}

export async function getOpenTrades(env) {
  const data = await oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/openTrades`
  )

  return data.trades ?? []
}

export async function getClosedTrades(env, count = 100) {
  const summary = await getAccountSummary(env)
  const lastTransactionId = summary.lastTransactionID
  if (!/^\d+$/.test(String(lastTransactionId ?? ""))) {
    throw new Error("OANDA summary did not return a valid lastTransactionID")
  }

  // Take a fixed snapshot. Page through account history without one HTTP request
  // per trade. Never re-fetch /trades/:id: a missing resource must not erase a fill.
  const lastId = BigInt(lastTransactionId)
  const transactions = []
  for (let from = 1n; from <= lastId; from += 1000n) {
    const to = from + 999n < lastId ? from + 999n : lastId
    const params = new URLSearchParams({
      from: from.toString(),
      to: to.toString(),
    })
    const data = await oandaJson(
      env,
      `/v3/accounts/${env.OANDA_ACCOUNT_ID}/transactions/idrange?${params}`
    )
    if (!Array.isArray(data.transactions)) {
      throw new Error(`OANDA transaction page ${from}-${to} is missing transactions`)
    }
    transactions.push(...data.transactions)
  }

  return buildClosedTradesFromTransactions(transactions, count)
}

export async function updateTradeStopLoss(env, tradeId, stopLoss) {
  const data = await oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}/orders`,
    {
      method: "PUT",
      body: JSON.stringify({
        stopLoss: {
          price: String(stopLoss),
          timeInForce: "GTC",
        },
      }),
    }
  )

  return {
    tradeId: String(tradeId),
    stopLoss: String(stopLoss),
    lastTransactionId: data.lastTransactionID ?? null,
  }
}

export async function updateTradeBracket(
  env,
  tradeId,
  stopLoss,
  takeProfit
) {
  const data = await oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}/orders`,
    {
      method: "PUT",
      body: JSON.stringify({
        stopLoss: {
          price: String(stopLoss),
          timeInForce: "GTC",
        },
        takeProfit: {
          price: String(takeProfit),
          timeInForce: "GTC",
        },
      }),
    }
  )

  return {
    tradeId: String(tradeId),
    stopLoss: String(stopLoss),
    takeProfit: String(takeProfit),
    lastTransactionId: data.lastTransactionID ?? null,
  }
}

export async function closeTrade(env, tradeId) {
  const data = await oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}/close`,
    {
      method: "PUT",
      body: JSON.stringify({ units: "ALL" }),
    }
  )

  return {
    tradeId: String(tradeId),
    lastTransactionId: data.lastTransactionID ?? null,
  }
}
