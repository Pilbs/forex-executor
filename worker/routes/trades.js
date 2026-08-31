import {
  getOpenTrades,
  getClosedTrades,
} from "../services/oanda.js"
import { getSignalsByOandaTradeIds } from "../services/signals.js"

export async function handleGetOpenTrades(request, env) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    )
  }

  try {
    const oandaTrades = await getOpenTrades(env)

    const tradeIds = oandaTrades.map((trade) =>
      String(trade.id)
    )

    const signalMap =
      await getSignalsByOandaTradeIds(env, tradeIds)

    const trades = oandaTrades.map((trade) => {
      const signal = signalMap.get(String(trade.id))

      const currentUnits = Number(trade.currentUnits)

      return {
        tradeId: trade.id,

        instrument: trade.instrument,

        direction:
          currentUnits > 0 ? "buy" : "sell",

        units: Math.abs(currentUnits),

        entryPrice: trade.price,

        stopLoss:
          trade.stopLossOrder?.price ?? null,

        takeProfit:
          trade.takeProfitOrder?.price ?? null,

        openTime: trade.openTime,

        unrealisedPL: trade.unrealizedPL,

        realisedPL: trade.realizedPL,

        automated: Boolean(signal),

        strategyName:
          signal?.strategy_name ?? null,

        signalId:
          signal?.signal_id ?? null,

        oandaOrderId:
          signal?.oanda_order_id ?? null,
      }
    })

    return Response.json({
      count: trades.length,
      trades,
    })

  } catch (error) {
    return Response.json(
      {
        error: error.message,
      },
      {
        status: 500,
      }
    )
  }
}

export async function handleGetClosedTrades(request, env) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    )
  }

  try {
    const oandaTrades = await getClosedTrades(env)

    const tradeIds = oandaTrades.map((trade) =>
      String(trade.id)
    )

    const signalMap =
      await getSignalsByOandaTradeIds(env, tradeIds)

    const trades = oandaTrades
      .map((trade) => {
        const signal = signalMap.get(String(trade.id))

        const initialUnits = Number(trade.initialUnits)

        return {
          tradeId: trade.id,

          instrument: trade.instrument,

          direction:
            initialUnits > 0 ? "buy" : "sell",

          units: Math.abs(initialUnits),

          entryPrice: trade.price,

          closePrice:
            trade.averageClosePrice ?? null,

          stopLoss:
            signal?.requested_stop_loss ?? null,

          takeProfit:
            signal?.requested_take_profit ?? null,

          openTime: trade.openTime,

          closeTime:
            trade.closeTime ?? null,

          realisedPL:
            trade.realizedPL,

          financing:
            trade.financing ?? null,

          automated:
            Boolean(signal),

          strategyName:
            signal?.strategy_name ?? null,

          signalId:
            signal?.signal_id ?? null,

          oandaOrderId:
            signal?.oanda_order_id ?? null,
        }
      })


    return Response.json({
      count: trades.length,
      trades,
    })

  } catch (error) {
    return Response.json(
      {
        error: error.message,
      },
      {
        status: 500,
      }
    )
  }
}