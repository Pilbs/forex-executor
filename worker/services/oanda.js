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
    `https://api-fxpractice.oanda.com/v3/accounts/${env.OANDA_ACCOUNT_ID}/orders`,
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
    `https://api-fxpractice.oanda.com/v3/accounts/${env.OANDA_ACCOUNT_ID}/openTrades`,
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