const v5StrategyInstruments = {
  H02_EURUSD_M15: "EUR_USD",
  H02_GBPUSD_M15: "GBP_USD",
  H02_GBPCAD_M15: "GBP_CAD",
}

function validateSignalIdentity(payload, errors) {
  if (!payload.signalId || typeof payload.signalId !== "string") {
    errors.push("signalId is required")
  }

  if (!payload.strategyName || typeof payload.strategyName !== "string") {
    errors.push("strategyName is required")
  }
}

function validateV5Identity(payload, errors) {
  const expectedInstrument =
    v5StrategyInstruments[payload.strategyName]

  if (!expectedInstrument) {
    errors.push(
      `unsupported v5 strategyName: ${payload.strategyName}`
    )
    return
  }

  if (!payload.instrument || typeof payload.instrument !== "string") {
    errors.push("instrument is required for v5")
    return
  }

  if (payload.instrument !== expectedInstrument) {
    errors.push(
      `strategyName ${payload.strategyName} must use instrument ${expectedInstrument}`
    )
  }
}

export function validateUpdateStop(payload) {
  const errors = []
  validateSignalIdentity(payload, errors)

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
  validateSignalIdentity(payload, errors)

  if (payload.version === "v5") {
    validateV5Identity(payload, errors)

    if (!["long", "short"].includes(payload.direction)) {
      errors.push("direction must be long or short for v5 close")
    }

    if (!payload.reason || typeof payload.reason !== "string") {
      errors.push("reason is required for v5 close")
    }
  }

  return errors
}

export function validateUpdateBracket(payload) {
  const errors = []
  validateSignalIdentity(payload, errors)

  if (payload.version === "v5") {
    validateV5Identity(payload, errors)

    if (
      !Number.isFinite(Number(payload.stopOffsetFromEntry))
    ) {
      errors.push("stopOffsetFromEntry must be a finite number for v5")
    }

    if (
      !Number.isFinite(Number(payload.targetOffsetFromEntry)) ||
      Number(payload.targetOffsetFromEntry) === 0
    ) {
      errors.push(
        "targetOffsetFromEntry must be a non-zero finite number for v5"
      )
    }

    if (payload.stopLoss !== undefined) {
      errors.push("v5 update_bracket must not send stopLoss")
    }

    if (payload.takeProfit !== undefined) {
      errors.push("v5 update_bracket must not send takeProfit")
    }

    return errors
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

export function validatePartialClose(payload) {
  const errors = []
  validateSignalIdentity(payload, errors)

  if (payload.version === "v5") {
    validateV5Identity(payload, errors)
  }

  if (!Number.isInteger(payload.units) || payload.units <= 0) {
    errors.push("units must be a positive integer")
  }

  return errors
}
