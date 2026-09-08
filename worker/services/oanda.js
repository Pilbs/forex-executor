const OANDA_BASE_URL = "https://api-fxpractice.oanda.com"

export async function getAccountSummary(env) {
  if (!env.OANDA_API_TOKEN) {
    throw new Error("OANDA_API_TOKEN is not configured")
  }

  if (!env.OANDA_ACCOUNT_ID) {
    throw new Error("OANDA_ACCOUNT_ID is not configured")
  }

  const response = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/summary`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.errorMessage || `OANDA request failed: ${response.status}`
    )
  }

  return data
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

  const response = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/orders`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order,
      }),
    }
  )

  const data = await response.json()

  if (!response.ok) {
    const error = new Error(
      data.errorMessage || `OANDA request failed: ${response.status}`
    )

    error.code = data.errorCode ?? null
    throw error
  }

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
  const response = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/openTrades`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  )

  const data = await response.json()

  if (!response.ok) {
    throw new Error(
      data.errorMessage || `OANDA request failed: ${response.status}`
    )
  }

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

  const transactionParams = new URLSearchParams({
    from: firstId.toString(),
    to: lastId.toString(),
    type: "ORDER_FILL",
  })

  const transactionResponse = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/transactions/idrange?${transactionParams}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  )

  const transactionData = await transactionResponse.json()

  if (!transactionResponse.ok) {
    throw new Error(
      transactionData.errorMessage ||
      `OANDA transaction request failed: ${transactionResponse.status}`
    )
  }

  const closedTradeEvents = []

  for (const transaction of transactionData.transactions ?? []) {
    for (const closedTrade of transaction.tradesClosed ?? []) {
      closedTradeEvents.push({
        tradeId: String(closedTrade.tradeID),
        closeTime: transaction.time ?? null,
        transactionId: transaction.id ?? null,
      })
    }
  }

  closedTradeEvents.sort((a, b) => {
    if (a.closeTime && b.closeTime) {
      return b.closeTime.localeCompare(a.closeTime)
    }

    return Number(b.transactionId ?? 0) - Number(a.transactionId ?? 0)
  })

  const recentTradeIds = [
    ...new Set(
      closedTradeEvents.map((event) => event.tradeId)
    ),
  ].slice(0, count)

  if (recentTradeIds.length === 0) {
    return []
  }

  const tradeParams = new URLSearchParams({
    ids: recentTradeIds.join(","),
  })

  const tradeResponse = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades?${tradeParams}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  )

  const tradeData = await tradeResponse.json()

  if (!tradeResponse.ok) {
    throw new Error(
      tradeData.errorMessage ||
      `OANDA trade request failed: ${tradeResponse.status}`
    )
  }

  const closeOrder = new Map(
    recentTradeIds.map((tradeId, index) => [tradeId, index])
  )

  return (tradeData.trades ?? [])
    .filter((trade) => trade.state === "CLOSED")
    .sort(
      (a, b) =>
        (closeOrder.get(String(a.id)) ?? Number.MAX_SAFE_INTEGER) -
        (closeOrder.get(String(b.id)) ?? Number.MAX_SAFE_INTEGER)
    )
}


export async function updateTradeStopLoss(
  env,
  tradeId,
  stopLoss
) {
  const response = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}/orders`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        stopLoss: {
          price: String(stopLoss),
          timeInForce: "GTC",
        },
      }),
    }
  )

  const data = await response.json()

  if (!response.ok) {
    const error = new Error(
      data.errorMessage ||
      `OANDA stop update failed: ${response.status}`
    )

    error.code = data.errorCode ?? null
    throw error
  }

  return {
    tradeId: String(tradeId),
    stopLoss: String(stopLoss),
    lastTransactionId:
      data.lastTransactionID ?? null,
  }
}


export async function updateTradeBracket(
  env,
  tradeId,
  stopLoss,
  takeProfit
) {
  const response = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}/orders`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
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

  const data = await response.json()

  if (!response.ok) {
    const error = new Error(
      data.errorMessage ||
      `OANDA bracket update failed: ${response.status}`
    )

    error.code = data.errorCode ?? null
    throw error
  }

  return {
    tradeId: String(tradeId),
    stopLoss: String(stopLoss),
    takeProfit: String(takeProfit),
    lastTransactionId: data.lastTransactionID ?? null,
  }
}


export async function closeTrade(
  env,
  tradeId
) {
  const response = await fetch(
    `${OANDA_BASE_URL}/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}/close`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.OANDA_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        units: "ALL",
      }),
    }
  )

  const data = await response.json()

  if (!response.ok) {
    const error = new Error(
      data.errorMessage ||
      `OANDA trade close failed: ${response.status}`
    )

    error.code = data.errorCode ?? null
    throw error
  }

  return {
    tradeId: String(tradeId),
    lastTransactionId:
      data.lastTransactionID ?? null,
  }
}
