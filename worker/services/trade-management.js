import {
  updateTradeStopLoss,
  closeTrade,
} from "./oanda.js"

import {
  getSignalByStrategySignalId,
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
    stopLoss
  )
}


export async function closeSignalTrade(
  env,
  strategyName,
  signalId
) {
  const signal = await getExecutedSignal(
    env,
    strategyName,
    signalId
  )

  return closeTrade(
    env,
    signal.oanda_trade_id
  )
}
