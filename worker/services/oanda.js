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

async function getAllOpenedTradeIds(env, lastTransactionId) {
  const lastId = BigInt(lastTransactionId)
  const chunkSize = 1000n
  const tradeIds = []
  const seen = new Set()

  for (let from = 1n; from <= lastId; from += chunkSize) {
    const to =
      from + chunkSize - 1n > lastId
        ? lastId
        : from + chunkSize - 1n

    const params = new URLSearchParams({
      from: from.toString(),
      to: to.toString(),
      type: "ORDER_FILL",
    })

    const data = await oandaJson(
      env,
      `/v3/accounts/${env.OANDA_ACCOUNT_ID}/transactions/idrange?${params}`
    )

    for (const transaction of data.transactions ?? []) {
      const candidates = []

      if (transaction.tradeOpened?.tradeID) {
        candidates.push(String(transaction.tradeOpened.tradeID))
      }

      // OANDA trade IDs are created from the opening fill transaction.
      // Keep the fill transaction ID as a fallback so a journal entry is not
      // lost if tradeOpened is absent from a returned transaction payload.
      if (
        transaction.reason === "MARKET_ORDER" &&
        transaction.id
      ) {
        candidates.push(String(transaction.id))
      }

      for (const tradeId of candidates) {
        if (!seen.has(tradeId)) {
          seen.add(tradeId)
          tradeIds.push(tradeId)
        }
      }
    }
  }

  return tradeIds
}

async function getTradeById(env, tradeId) {
  const data = await oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/trades/${tradeId}`
  )

  return data.trade ?? null
}

async function getTransactionById(env, transactionId) {
  if (!transactionId) {
    return null
  }

  const data = await oandaJson(
    env,
    `/v3/accounts/${env.OANDA_ACCOUNT_ID}/transactions/${transactionId}`
  )

  return data.transaction ?? null
}

export async function getClosedTrades(env, count = 100) {
  const summary = await getAccountSummary(env)
  const lastTransactionId = summary.lastTransactionID

  if (!lastTransactionId) {
    return []
  }

  const openedTradeIds = await getAllOpenedTradeIds(
    env,
    lastTransactionId
  )

  const tradeResults = await Promise.all(
    openedTradeIds.map(async (tradeId) => {
      try {
        return await getTradeById(env, tradeId)
      } catch (error) {
        console.error(`Failed to load trade ${tradeId}:`, error)
        return null
      }
    })
  )

  const closedTrades = tradeResults
    .filter((trade) => trade?.state === "CLOSED")
    .sort((a, b) =>
      String(b.closeTime ?? "").localeCompare(
        String(a.closeTime ?? "")
      )
    )
    .slice(0, count)

  const enrichedTrades = await Promise.all(
    closedTrades.map(async (trade) => {
      const closingIds = trade.closingTransactionIDs ?? []
      const closeTransactionId =
        closingIds.length > 0
          ? String(closingIds[closingIds.length - 1])
          : null

      let closeReason = null

      if (closeTransactionId) {
        try {
          const transaction = await getTransactionById(
            env,
            closeTransactionId
          )

          closeReason = transaction?.reason ?? null
        } catch (error) {
          console.error(
            `Failed to load closing transaction ${closeTransactionId}:`,
            error
          )
        }
      }

      return {
        ...trade,
        closeTransactionId,
        closeReason,
      }
    })
  )

  return enrichedTrades
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
