import { placeMarketOrder } from "../services/oanda.js"

import {
  getSignalById,
  claimSignalForExecution,
  markSignalExecuted,
  markSignalFailed,
} from "../services/signals.js"


export async function handleExecuteSignal(request, env, id) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    )
  }

  const signal = await getSignalById(env, id)

  if (!signal) {
    return Response.json(
      { error: "Signal not found" },
      { status: 404 }
    )
  }

  const claimed = await claimSignalForExecution(env, id)

  if (!claimed) {
    const current = await getSignalById(env, id)

    return Response.json(
      {
        executed: false,
        message: "Signal cannot be executed again",
        status: current.execution_status,
        oandaOrderId: current.oanda_order_id,
        oandaTradeId: current.oanda_trade_id,
      },
      {
        status: 409,
      }
    )
  }

  try {
    const execution = await placeMarketOrder(env, signal)

    await markSignalExecuted(
      env,
      id,
      execution.orderId,
      execution.tradeId
    )

    return Response.json({
      executed: true,
      signalId: signal.signal_id,
      oanda: execution,
    })

  } catch (error) {
    await markSignalFailed(
      env,
      id,
      error.code ?? null,
      error.message
    )

    return Response.json(
      {
        executed: false,
        error: error.message,
        errorCode: error.code ?? null,
      },
      {
        status: 500,
      }
    )
  }
}