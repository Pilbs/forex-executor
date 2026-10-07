import { buildClosedTradesFromTransactions } from "./trade-history.js"

const OANDA_PRACTICE_BASE_URL = "https://api-fxpractice.oanda.com"
const OANDA_LIVE_BASE_URL = "https://api-fxtrade.oanda.com"

const PRICE_PRECISION_BY_INSTRUMENT = {
  EUR_USD: 5,
  GBP_USD: 5,
  GBP_CAD: 5,
}

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

function getLiveProfile(env) {
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

function getProfileForInstrument(env, instrument) {
  if (instrument === "EUR_USD") {
    if (env.EUR_USD_LIVE_ENABLED !== "true") {
      throw new Error("EUR_USD live execution is not enabled")
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

  if (instrument === "GBP_USD") {
    if (env.GBP_USD_LIVE_ENABLED !== "true") {
      throw new Error("GBP_USD live execution is not enabled")
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

  if (instrument === "GBP_CAD") {
    if (env.GBP_CAD_LIVE_ENABLED !== "true") {
      throw new Error("GBP_CAD live execution is not enabled")
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

function parseWebhookPayload(signal) {
  if (!signal.webhook_payload) {
    return {}
  }

  try {
    return JSON.parse(signal.webhook_payload)
  } catch {
    throw new Error("Stored webhook payload is not valid JSON")
  }
}

function formatPrice(instrument, value, displayPrecision = null) {
  const hasExplicitPrecision =
    displayPrecision !== null &&
    displayPrecision !== undefined &&
    Number.isInteger(Number(displayPrecision))

  const precision = hasExplicitPrecision
    ? Number(displayPrecision)
    : PRICE_PRECISION_BY_INSTRUMENT[instrument] ?? 5

  const number = Number(value)

  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Calculated OANDA price must be a positive number")
  }

  return number.toFixed(precision)
}

function buildInitialV5Bracket(
  direction,
  instrument,
  entryPrice,
  stopDistance,
  targetDistance,
  displayPrecision
) {
  const entry = Number(entryPrice)
  const stopDistanceNumber = Number(stopDistance)
  const targetDistanceNumber = Number(targetDistance)

  if (!Number.isFinite(entry) || entry <= 0) {
    throw new Error("OANDA fill did not contain a valid entry price")
  }

  if (!Number.isFinite(stopDistanceNumber) || stopDistanceNumber <= 0) {
    throw new Error("v5 stopDistance must be a positive number")
  }

  if (!Number.isFinite(targetDistanceNumber) || targetDistanceNumber <= 0) {
    throw new Error("v5 targetDistance must be a positive number")
  }

  const stop =
    direction === "buy"
      ? entry - stopDistanceNumber
      : entry + stopDistanceNumber

  const target =
    direction === "buy"
      ? entry + targetDistanceNumber
      : entry - targetDistanceNumber

  if (direction === "buy" && !(stop < entry && target > entry)) {
    throw new Error("Invalid long bracket relative to actual OANDA fill")
  }

  if (direction === "sell" && !(stop > entry && target < entry)) {
    throw new Error("Invalid short bracket relative to actual OANDA fill")
  }

  return {
    stopLoss: formatPrice(
      instrument,
      stop,
      displayPrecision
    ),
    takeProfit: formatPrice(
      instrument,
      target,
      displayPrecision
    ),
  }
}

async function getAccountSummaryForProfile(profile) {
  return oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/summary`
  )
}

export async function getAccountSummary(env) {
  return getAccountSummaryForProfile(
    getDefaultProfile(env)
  )
}

export async function getLiveAccountSummary(env) {
  return getAccountSummaryForProfile(
    getLiveProfile(env)
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
  let instrumentDetails = null

  if (
    signal.instrument === "EUR_USD" ||
    signal.instrument === "BCO_USD" ||
    signal.instrument === "GBP_USD" ||
    signal.instrument === "GBP_CAD"
  ) {
    instrumentDetails = await assertInstrumentTradeable(
      profile,
      signal.instrument,
      requestedUnits
    )
  }

  const units =
    signal.direction === "buy"
      ? requestedUnits
      : -requestedUnits

  const webhookPayload = parseWebhookPayload(signal)
  const isV5 = webhookPayload.version === "v5"

  const order = {
    type: "MARKET",
    instrument: signal.instrument,
    units: String(units),
    timeInForce: "FOK",
    positionFill: "DEFAULT",
  }

  if (!isV5 && signal.requested_stop_loss) {
    order.stopLossOnFill = {
      price: String(signal.requested_stop_loss),
      timeInForce: "GTC",
    }
  }

  if (!isV5 && signal.requested_take_profit) {
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

  const execution = {
    orderId:
      data.orderCreateTransaction?.id ??
      fill.orderID ??
      null,
    tradeId,
    price: fill.price ?? null,
    time: fill.time ?? null,
  }

  if (!isV5) {
    return execution
  }

  const bracket = buildInitialV5Bracket(
    signal.direction,
    signal.instrument,
    fill.price,
    webhookPayload.stopDistance,
    webhookPayload.targetDistance,
    instrumentDetails?.displayPrecision
  )

  try {
    await updateTradeBracket(
      env,
      tradeId,
      bracket.stopLoss,
      bracket.takeProfit,
      signal.instrument
    )
  } catch (bracketError) {
    let emergencyCloseError = null

    try {
      await closeTrade(
        env,
        tradeId,
        signal.instrument
      )
    } catch (closeError) {
      emergencyCloseError = closeError
    }

    if (emergencyCloseError) {
      throw new Error(
        `V5 entry filled but bracket placement failed: ${bracketError.message}. Emergency close also failed: ${emergencyCloseError.message}`
      )
    }

    throw new Error(
      `V5 entry filled but bracket placement failed; trade was emergency-closed: ${bracketError.message}`
    )
  }

  return {
    ...execution,
    stopLoss: bracket.stopLoss,
    takeProfit: bracket.takeProfit,
  }
}

async function getOpenTradesForProfile(profile) {
  const data = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/openTrades`
  )

  return data.trades ?? []
}

export async function getOpenTrades(env) {
  return getOpenTradesForProfile(
    getDefaultProfile(env)
  )
}

export async function getLiveOpenTrades(env) {
  return getOpenTradesForProfile(
    getLiveProfile(env)
  )
}

async function getClosedTradesForProfile(
  profile,
  count = 100
) {
  const summary = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/summary`
  )
  const lastTransactionId = summary.lastTransactionID
  if (!/^\d+$/.test(String(lastTransactionId ?? ""))) {
    throw new Error("OANDA summary did not return a valid lastTransactionID")
  }

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
      throw new Error(
        `OANDA transaction page ${from}-${to} is missing transactions`
      )
    }
    transactions.push(...data.transactions)
  }

  return buildClosedTradesFromTransactions(transactions, count)
}

export async function getClosedTrades(env, count = 100) {
  return getClosedTradesForProfile(
    getDefaultProfile(env),
    count
  )
}

export async function getLiveClosedTrades(env, count = 100) {
  return getClosedTradesForProfile(
    getLiveProfile(env),
    count
  )
}

export async function getTrade(
  env,
  tradeId,
  instrument = null
) {
  const profile = instrument
    ? getProfileForInstrument(env, instrument)
    : getDefaultProfile(env)

  const data = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/trades/${tradeId}`
  )

  if (!data.trade) {
    throw new Error("OANDA trade response did not contain a trade")
  }

  return {
    trade: data.trade,
    lastTransactionId: data.lastTransactionID ?? null,
  }
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

export async function updateTradeBracketFromOffsets(
  env,
  tradeId,
  direction,
  stopOffsetFromEntry,
  targetOffsetFromEntry,
  instrument
) {
  const current = await getTrade(
    env,
    tradeId,
    instrument
  )

  if (current.trade.state && current.trade.state !== "OPEN") {
    throw new Error("Cannot update bracket for a non-open OANDA trade")
  }

  const entryPrice = Number(current.trade.price)
  const stopOffset = Number(stopOffsetFromEntry)
  const targetOffset = Number(targetOffsetFromEntry)

  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error("OANDA trade does not have a valid entry price")
  }

  if (!Number.isFinite(stopOffset)) {
    throw new Error("stopOffsetFromEntry must be finite")
  }

  if (!Number.isFinite(targetOffset) || targetOffset === 0) {
    throw new Error("targetOffsetFromEntry must be non-zero and finite")
  }

  const stopLoss = entryPrice + stopOffset
  const takeProfit = entryPrice + targetOffset

  if (direction === "buy" && takeProfit <= entryPrice) {
    throw new Error(
      "Rejected long take-profit at or below actual OANDA entry"
    )
  }

  if (direction === "sell" && takeProfit >= entryPrice) {
    throw new Error(
      "Rejected short take-profit at or above actual OANDA entry"
    )
  }

  const formattedStop = formatPrice(
    instrument,
    stopLoss
  )
  const formattedTarget = formatPrice(
    instrument,
    takeProfit
  )

  const result = await updateTradeBracket(
    env,
    tradeId,
    formattedStop,
    formattedTarget,
    instrument
  )

  return {
    ...result,
    entryPrice: formatPrice(instrument, entryPrice),
    stopOffsetFromEntry: stopOffset,
    targetOffsetFromEntry: targetOffset,
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

  const current = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/trades/${tradeId}`
  )

  if (current.trade?.state && current.trade.state !== "OPEN") {
    return {
      tradeId: String(tradeId),
      alreadyClosed: true,
      closeTransactionId: null,
      lastTransactionId: current.lastTransactionID ?? null,
    }
  }

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
    alreadyClosed: false,
    closeTransactionId:
      data.orderFillTransaction?.id ?? null,
    lastTransactionId: data.lastTransactionID ?? null,
  }
}

export async function closeTradeUnits(
  env,
  tradeId,
  units,
  instrument = null,
  originalUnits = null
) {
  const profile = instrument
    ? getProfileForInstrument(env, instrument)
    : getDefaultProfile(env)

  const current = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/trades/${tradeId}`
  )

  const currentUnits = Math.abs(Number(current.trade?.currentUnits))

  if (!Number.isFinite(currentUnits) || currentUnits <= 0) {
    return {
      tradeId: String(tradeId),
      alreadyReducedOrClosed: true,
      lastTransactionId: current.lastTransactionID ?? null,
    }
  }

  const original = Math.abs(Number(originalUnits))

  if (
    Number.isFinite(original) &&
    original > 0 &&
    currentUnits < original
  ) {
    return {
      tradeId: String(tradeId),
      alreadyReducedOrClosed: true,
      currentUnits,
      lastTransactionId: current.lastTransactionID ?? null,
    }
  }

  const closeUnits = Number(units)

  if (!Number.isInteger(closeUnits) || closeUnits <= 0) {
    throw new Error("partial close units must be a positive integer")
  }

  if (closeUnits >= currentUnits) {
    throw new Error(
      `partial close units must be less than current open units (${currentUnits})`
    )
  }

  const data = await oandaJson(
    profile,
    `/v3/accounts/${profile.accountId}/trades/${tradeId}/close`,
    {
      method: "PUT",
      body: JSON.stringify({ units: String(closeUnits) }),
    }
  )

  return {
    tradeId: String(tradeId),
    closedUnits: closeUnits,
    lastTransactionId: data.lastTransactionID ?? null,
  }
}
