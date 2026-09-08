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

  if (!lastTransactionId) {
    return []
  }

  const lastId = BigInt(lastTransactionId)
  const transactionWindow = BigInt(Math.max(count * 10, 1000))
  const firstId =
    lastId >= transactionWindow
      ? lastId - transactionWindow + 1n
      : 1n

  const params = new URLSearchParams({
    from: firstId.toString(),
    to: lastId.toString(),
    type: "ORDER_FILL",
  })

  const transactionData = await oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/transactions/idrange?${params}`
  )

  const events = []

  for (const transaction of transactionData.transactions ?? []) {
    for (const closed of transaction.tradesClosed ?? []) {
      events.push({
        tradeId: String(closed.tradeID),
        closeTime: transaction.time ?? null,
        transactionId: transaction.id ?? null,
        reason: transaction.reason ?? null,
      })
    }

    if (transaction.tradeReduced?.tradeID) {
      events.push({
        tradeId: String(transaction.tradeReduced.tradeID),
        closeTime: transaction.time ?? null,
        transactionId: transaction.id ?? null,
        reason: transaction.reason ?? null,
      })
    }
  }

  events.sort((a, b) => {
    if (a.closeTime && b.closeTime) {
      return b.closeTime.localeCompare(a.closeTime)
    }

    return Number(b.transactionId ?? 0) - Number(a.transactionId ?? 0)
  })

  const eventByTradeId = new Map()

  for (const event of events) {
    if (!eventByTradeId.has(event.tradeId)) {
      eventByTradeId.set(event.tradeId, event)
    }
  }

  const recentTradeIds = [
    ...eventByTradeId.keys(),
  ].slice(0, count)

  const trades = await Promise.all(
    recentTradeIds.map(async (tradeId) => {
      try {
        const data = await oandaJson(
          env,
          `/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}`
        )

        const trade = data.trade
        const event = eventByTradeId.get(tradeId)

        if (!trade || trade.state !== "CLOSED") {
          return null
        }

        return {
          ...trade,
          closeTransactionId: event?.transactionId ?? null,
          closeReason: event?.reason ?? null,
        }
      } catch (error) {
        console.error(
          `Failed to load closed trade ${tradeId}:`,
          error
        )
        return null
      }
    })
  )

  return trades.filter(Boolean)
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
