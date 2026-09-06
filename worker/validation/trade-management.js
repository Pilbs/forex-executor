
export function validateUpdateStop(payload) {
  const errors = []

  if (!payload.signalId || typeof payload.signalId !== "string") {
    errors.push("signalId is required")
  }

  if (!payload.strategyName || typeof payload.strategyName !== "string") {
    errors.push("strategyName is required")
  }

  if (
    !Number.isFinite(Number(payload.stopLoss)) ||
    Number(payload.stopLoss) <= 0
  ) {
    errors.push("stopLoss must be a positive number")
  }

  return errors
}


export function validateClose(payload) {
  const errors = []

  if (!payload.signalId || typeof payload.signalId !== "string") {
    errors.push("signalId is required")
  }

  if (!payload.strategyName || typeof payload.strategyName !== "string") {
    errors.push("strategyName is required")
  }

  return errors
}

export function validateUpdateBracket(payload) {
  const errors = []

  if (!payload.signalId || typeof payload.signalId !== "string") {
    errors.push("signalId is required")
  }

  if (!payload.strategyName || typeof payload.strategyName !== "string") {
    errors.push("strategyName is required")
  }

  if (
    !Number.isFinite(Number(payload.stopLoss)) ||
    Number(payload.stopLoss) <= 0
  ) {
    errors.push("stopLoss must be a positive number")
  }

  if (
    !Number.isFinite(Number(payload.takeProfit)) ||
    Number(payload.takeProfit) <= 0
  ) {
    errors.push("takeProfit must be a positive number")
  }

  return errors
}