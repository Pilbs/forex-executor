const allowedInstruments = [
  "EUR_USD",
  "BCO_USD",
]

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

  if (payload.instrument === "EUR_USD" && payload.units > 10000) {
    errors.push("units cannot exceed 10000 for EUR_USD")
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
    (!Number.isFinite(Number(payload.stopLoss)) || Number(payload.stopLoss) <= 0)
  ) {
    errors.push("stopLoss must be a positive number")
  }

  if (
    payload.takeProfit !== undefined &&
    (!Number.isFinite(Number(payload.takeProfit)) ||
      Number(payload.takeProfit) <= 0)
  ) {
    errors.push("takeProfit must be a positive number")
  }

  return errors
}
