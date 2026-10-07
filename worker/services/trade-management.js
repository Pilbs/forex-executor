import {
  updateTradeStopLoss,
  updateTradeBracket,
  updateTradeBracketFromOffsets,
  closeTrade,
  closeTradeUnits,
} from "./oanda.js"

import {
  getSignalByStrategySignalId,
  markSignalBotClosed,
} from "./signals.js"

async function getExecutedSignal(
  env,
  strategyName,
  signalId
) {
  const signal =
    await getSignalByStrategySignalId(
      env,
      strategyName,
      signalId
    )

  if (!signal) {
    throw new Error(
      "Original automated trade signal not found"
    )
  }

  if (
    signal.execution_status !== "executed" ||
    !signal.oanda_trade_id
  ) {
    throw new Error(
      "Signal does not have an executed OANDA trade"
    )
  }

  return signal
}

function assertInstrumentMatches(signal, instrument) {
  if (!instrument) {
    return
  }

  if (signal.instrument !== instrument) {
    throw new Error(
      `Instrument mismatch: signal is ${signal.instrument}, payload is ${instrument}`
    )
  }
}

function assertCloseDirectionMatches(signal, direction) {
  if (!direction) {
    return
  }

  const expectedDirection =
    signal.direction === "buy" ? "long" : "short"

  if (direction !== expectedDirection) {
    throw new Error(
      `Direction mismatch: signal is ${expectedDirection}, payload is ${direction}`
    )
  }
}

export async function updateSignalStopLoss(
  env,
  strategyName,
  signalId,
  stopLoss
) {
  const signal = await getExecutedSignal(
    env,
    strategyName,
    signalId
  )

  return updateTradeStopLoss(
    env,
    signal.oanda_trade_id,
    stopLoss,
    signal.instrument
  )
}

export async function updateSignalBracket(
  env,
  strategyName,
  signalId,
  stopLoss,
  takeProfit
) {
  const signal = await getExecutedSignal(
    env,
    strategyName,
    signalId
  )

  return updateTradeBracket(
    env,
    signal.oanda_trade_id,
    stopLoss,
    takeProfit,
    signal.instrument
  )
}

export async function updateSignalBracketV5(
  env,
  strategyName,
  signalId,
  instrument,
  stopOffsetFromEntry,
  targetOffsetFromEntry
) {
  const signal = await getExecutedSignal(
    env,
    strategyName,
    signalId
  )

  assertInstrumentMatches(
    signal,
    instrument
  )

  return updateTradeBracketFromOffsets(
    env,
    signal.oanda_trade_id,
    signal.direction,
    stopOffsetFromEntry,
    targetOffsetFromEntry,
    signal.instrument
  )
}

export async function closeSignalTrade(
  env,
  strategyName,
  signalId,
  instrument = null,
  direction = null
) {
  const signal = await getExecutedSignal(
    env,
    strategyName,
    signalId
  )

  assertInstrumentMatches(
    signal,
    instrument
  )

  assertCloseDirectionMatches(
    signal,
    direction
  )

  const result = await closeTrade(
    env,
    signal.oanda_trade_id,
    signal.instrument
  )

  if (result.closeTransactionId) {
    await markSignalBotClosed(
      env,
      signal.id,
      result.closeTransactionId
    )
  }

  return result
}

export async function closeSignalTradePartial(
  env,
  strategyName,
  signalId,
  units,
  instrument = null
) {
  const signal = await getExecutedSignal(
    env,
    strategyName,
    signalId
  )

  assertInstrumentMatches(
    signal,
    instrument
  )

  if (units >= Number(signal.requested_units)) {
    throw new Error(
      "partial close units must be less than original requested units"
    )
  }

  return closeTradeUnits(
    env,
    signal.oanda_trade_id,
    units,
    signal.instrument,
    signal.requested_units
  )
}
