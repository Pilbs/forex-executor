import { buildClosedTradesFromTransactions } from "./trade-history.js"

const OANDA_PRACTICE_BASE_URL = "https://api-fxpractice.oanda.com"
const OANDA_LIVE_BASE_URL = "https://api-fxtrade.oanda.com"

function requireValue(value, name) {
  if (!value) {
    throw new Error(`${name} is not configured`)
  }

  return value
}

function getDefaultProfile(env) {
  return {
    baseUrl: OANDA_PRACTICE_BASE_URL,
    token: requireValue(env.OANDA_API_TOKEN, "OANDA_API_TOKEN"),
    accountId: requireValue(env.OANDA_ACCOUNT_ID, "OANDA_ACCOUNT_ID"),
  }
}

function getProfileForInstrument(env, instrument) {
  if (instrument === "BCO_USD") {
    if (env.BCO_USD_LIVE_ENABLED !== "true") {
      throw new Error("BCO_USD live execution is not enabled")
    }

    return {
      baseUrl: OANDA_LIVE_BASE_URL,
      token: requireValue(
        env.OANDA_LIVE_API_TOKEN,
        "OANDA_LIVE_API_TOKEN"
      ),
      accountId: requireValue(
        env.OANDA_LIVE_ACCOUNT_ID,
        "OANDA_LIVE_ACCOUNT_ID"
      ),
    }
  }

  return getDefaultProfile(env)
}

function headers(profile) {
  return {
    Authorization: `Bearer ${profile.token}`,
    "Content-Type": "application/json",
  }
}

async function oandaJson(profile, path, options = {}) {
  const response = await fetch(`${profile.baseUrl}${path}`, {
    ...options,
    headers: headers(profile),
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
  const profile = getDefaultProfile(env)

  return oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/summary`
  )
}

async function assertInstrumentTradeable(profile, instrument, requestedUnits) {
  const params = new URLSearchParams({
    instruments: instrument,
  })

  const data = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/instruments?${params}`
  )

  const details = (data.instruments ?? []).find(
    (candidate) => candidate.name === instrument
  )

  if (!details) {
    throw new Error(
      `${instrument} is not available on the configured OANDA live account`
    )
  }

  const minimumTradeSize = Number(details.minimumTradeSize)
  const maximumOrderUnits = Number(details.maximumOrderUnits)

  if (
    Number.isFinite(minimumTradeSize) &&
    requestedUnits < minimumTradeSize
  ) {
    throw new Error(
      `${instrument} requires at least ${details.minimumTradeSize} units`
    )
  }

  if (
    Number.isFinite(maximumOrderUnits) &&
    maximumOrderUnits > 0 &&
    requestedUnits > maximumOrderUnits
  ) {
    throw new Error(
      `${instrument} cannot exceed ${details.maximumOrderUnits} units on this account`
    )
  }

  return details
}

export async function placeMarketOrder(env, signal) {
  const profile = getProfileForInstrument(env, signal.instrument)
  const requestedUnits = Number(signal.requested_units)

  if (signal.instrument === "BCO_USD") {
    await assertInstrumentTradeable(
      profile,
      signal.instrument,
      requestedUnits
    )
  }

  const units =
    signal.direction === "buy"
      ? requestedUnits
      : -requestedUnits

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
    profile,
    `/v3/accounts/${profile.accountId}/orders`,
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
  const profile = getDefaultProfile(env)
  const data = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/openTrades`
  )

  return data.trades ?? []
}

export async function getClosedTrades(env, count = 100) {
  const profile = getDefaultProfile(env)
  const summary = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/summary`
  )
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
      profile,
      `/v3/accounts/${profile.accountId}/transactions/idrange?${params}`
    )
    if (!Array.isArray(data.transactions)) {
      throw new Error(`OANDA transaction page ${from}-${to} is missing transactions`)
    }
    transactions.push(...data.transactions)
  }

  return buildClosedTradesFromTransactions(transactions, count)
}

export async function updateTradeStopLoss(
  env,
  tradeId,
  stopLoss,
  instrument = null
) {
  const profile = instrument
    ? getProfileForInstrument(env, instrument)
    : getDefaultProfile(env)

  const data = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/trades/${tradeId}/orders`,
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
  takeProfit,
  instrument = null
) {
  const profile = instrument
    ? getProfileForInstrument(env, instrument)
    : getDefaultProfile(env)

  const data = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/trades/${tradeId}/orders`,
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

export async function closeTrade(
  env,
  tradeId,
  instrument = null
) {
  const profile = instrument
    ? getProfileForInstrument(env, instrument)
    : getDefaultProfile(env)

  const data = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/trades/${tradeId}/close`,
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
