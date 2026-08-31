const allowedInstruments = [
  "EUR_USD",
]

export function validateSignal(payload) {
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

  if (payload.units > 10000) {
    errors.push("units cannot exceed 10000")
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