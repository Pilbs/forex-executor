import { placeMarketOrder } from "./oanda.js"

import {
  getSignalById,
  claimSignalForExecution,
  markSignalExecuted,
  markSignalFailed,
} from "./signals.js"


export async function executeSignalById(env, id) {
  const signal = await getSignalById(env, id)

  if (!signal) {
    return {
      executed: false,
      reason: "Signal not found",
    }
  }

  const claimed =
    await claimSignalForExecution(env, id)

  if (!claimed) {
    const current =
      await getSignalById(env, id)

    return {
      executed: false,
      reason: "Signal cannot be executed",
      status: current?.execution_status ?? null,
    }
  }

  try {
    const execution =
      await placeMarketOrder(env, signal)

    await markSignalExecuted(
      env,
      id,
      execution.orderId,
      execution.tradeId
    )

    return {
      executed: true,
      signalId: signal.signal_id,
      oanda: execution,
    }

  } catch (error) {

    await markSignalFailed(
      env,
      id,
      error.code ?? null,
      error.message
    )

    return {
      executed: false,
      signalId: signal.signal_id,
      error: error.message,
      errorCode: error.code ?? null,
    }
  }
}