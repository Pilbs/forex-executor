const allowedInstruments = [
  "EUR_USD",
  "GBP_USD",
  "GBP_CAD",
  "BCO_USD",
]

const v5StrategyInstruments = {
  H02_EURUSD_M15: "EUR_USD",
  H02_GBPUSD_M15: "GBP_USD",
  H02_GBPCAD_M15: "GBP_CAD",
}

function isPositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0
}

export function validateSignal(payload, env = {}) {
  const errors = []

  if (!payload || typeof payload !== "object") {
    return ["Request body must be a JSON object"]
  }

  if (!payload.signalId || typeof payload.signalId !== "string") {
    errors.push("signalId is required")
  }

  if (!payload.strategyName || typeof payload.strategyName !== "string") {
    errors.push("strategyName is required")
  }

  if (
    !payload.instrument ||
    typeof payload.instrument !== "string" ||
    !/^[A-Z]{3}_[A-Z]{3}$/.test(payload.instrument)
  ) {
    errors.push("instrument must look like EUR_USD")
  }

  if (
    payload.instrument &&
    !allowedInstruments.includes(payload.instrument)
  ) {
    errors.push(
      `instrument is not allowed: ${payload.instrument}`
    )
  }

  if (!["buy", "sell"].includes(payload.direction)) {
    errors.push("direction must be buy or sell")
  }

  if (!Number.isInteger(payload.units) || payload.units <= 0) {
    errors.push("units must be a positive integer")
  }

  const isV5 = payload.version === "v5"

  if (isV5) {
    const expectedInstrument =
      v5StrategyInstruments[payload.strategyName]

    if (!expectedInstrument) {
      errors.push(
        `unsupported v5 strategyName: ${payload.strategyName}`
      )
    } else if (
      payload.instrument &&
      payload.instrument !== expectedInstrument
    ) {
      errors.push(
        `strategyName ${payload.strategyName} must use instrument ${expectedInstrument}`
      )
    }

    if (!isPositiveNumber(payload.stopDistance)) {
      errors.push("stopDistance must be a positive number for v5")
    }

    if (!isPositiveNumber(payload.targetDistance)) {
      errors.push("targetDistance must be a positive number for v5")
    }

    if (payload.stopLoss !== undefined) {
      errors.push("v5 entry must not send stopLoss")
    }

    if (payload.takeProfit !== undefined) {
      errors.push("v5 entry must not send takeProfit")
    }
  }

  if (payload.instrument === "EUR_USD") {
    if (env.EUR_USD_LIVE_ENABLED !== "true") {
      errors.push("EUR_USD live execution is not enabled")
    }

    const maxUnits = Number(env.EUR_USD_MAX_UNITS ?? 10000)

    if (!Number.isInteger(maxUnits) || maxUnits <= 0) {
      errors.push("EUR_USD_MAX_UNITS must be configured as a positive integer")
    } else if (Number.isInteger(payload.units) && payload.units > maxUnits) {
      errors.push(`units cannot exceed ${maxUnits} for EUR_USD`)
    }

    if (!isV5 && payload.stopLoss === undefined) {
      errors.push("stopLoss is required for EUR_USD live execution")
    }
  }

  if (payload.instrument === "GBP_USD") {
    if (env.GBP_USD_LIVE_ENABLED !== "true") {
      errors.push("GBP_USD live execution is not enabled")
    }

    if (Number.isInteger(payload.units) && payload.units > 3000) {
      errors.push("units cannot exceed 3000 for GBP_USD")
    }

    if (!isV5 && payload.stopLoss === undefined) {
      errors.push("stopLoss is required for GBP_USD live execution")
    }
  }

  if (payload.instrument === "GBP_CAD") {
    if (env.GBP_CAD_LIVE_ENABLED !== "true") {
      errors.push("GBP_CAD live execution is not enabled")
    }

    const maxUnits = Number(env.GBP_CAD_MAX_UNITS)

    if (!Number.isInteger(maxUnits) || maxUnits <= 0) {
      errors.push("GBP_CAD_MAX_UNITS must be configured as a positive integer")
    } else if (Number.isInteger(payload.units) && payload.units > maxUnits) {
      errors.push(`units cannot exceed ${maxUnits} for GBP_CAD`)
    }

    if (!isV5 && payload.stopLoss === undefined) {
      errors.push("stopLoss is required for GBP_CAD live execution")
    }
  }

  if (payload.instrument === "BCO_USD") {
    if (env.BCO_USD_LIVE_ENABLED !== "true") {
      errors.push("BCO_USD live execution is not enabled")
    }

    const maxUnits = Number(env.BCO_USD_MAX_UNITS)

    if (!Number.isInteger(maxUnits) || maxUnits <= 0) {
      errors.push("BCO_USD_MAX_UNITS must be configured as a positive integer")
    } else if (Number.isInteger(payload.units) && payload.units > maxUnits) {
      errors.push(`units cannot exceed ${maxUnits} for BCO_USD`)
    }

    if (payload.stopLoss === undefined) {
      errors.push("stopLoss is required for BCO_USD live execution")
    }
  }

  if (
    payload.stopLoss !== undefined &&
    !isPositiveNumber(payload.stopLoss)
  ) {
    errors.push("stopLoss must be a positive number")
  }

  if (
    payload.takeProfit !== undefined &&
    !isPositiveNumber(payload.takeProfit)
  ) {
    errors.push("takeProfit must be a positive number")
  }

  return errors
}
