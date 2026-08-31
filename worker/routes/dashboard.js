import { getAccountSummary, getOpenTrades } from "../services/oanda.js"
import { getSignalsByOandaTradeIds } from "../services/signals.js"

export async function handleGetLiveDashboard(request, env) {
  if (request.method !== "GET") {
    return Response.json(
      { error: "Method not allowed" },
      { status: 405 }
    )
  }

  try {
    const [accountData, oandaTrades] = await Promise.all([
      getAccountSummary(env),
      getOpenTrades(env),
    ])

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
      account: {
        id: accountData.account.id,
        currency: accountData.account.currency,
        balance: accountData.account.balance,
        NAV: accountData.account.NAV,
        openTradeCount: accountData.account.openTradeCount,
        openPositionCount: accountData.account.openPositionCount,
        pendingOrderCount: accountData.account.pendingOrderCount,
      },

      openTrades: trades,
    })

  } catch (error) {
    return Response.json(
      { error: error.message },
      { status: 500 }
    )
  }
}