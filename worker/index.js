import { getAccountSummary } from "./services/oanda.js"
import { getDatabaseHealth } from "./services/database.js"
import { handleTestSignal } from "./routes/signals.js"
import { handleExecuteSignal } from "./routes/execution.js"
import {
  handleGetOpenTrades,
  handleGetClosedTrades,
} from "./routes/trades.js"
import { handleGetLiveDashboard } from "./routes/dashboard.js"
import { handleTradingViewWebhook } from "./routes/tradingview.js"

import { JOURNAL_VERSION } from "./services/trade-history.js"

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname === "/api/health") {
      return Response.json(
        {
          status: "ok",
          journalVersion: JOURNAL_VERSION,
        },
        {
          headers: {
            "Cache-Control": "no-store",
          },
        }
      )
    }

    if (url.pathname === "/api/db/health") {
      try {
        const data = await getDatabaseHealth(env)

        return Response.json(data)
      } catch (error) {
        return Response.json(
          {
            connected: false,
            error: error.message,
          },
          {
            status: 500,
          }
        )
      }
    }

    if (url.pathname === "/api/oanda/account") {
      try {
        const data = await getAccountSummary(env)

        return Response.json({
          connected: true,
          account: {
            id: data.account.id,
            currency: data.account.currency,
            balance: data.account.balance,
            NAV: data.account.NAV,
            openTradeCount: data.account.openTradeCount,
            openPositionCount: data.account.openPositionCount,
            pendingOrderCount: data.account.pendingOrderCount,
          },
        })
      } catch (error) {
        return Response.json(
          {
            connected: false,
            error: error.message,
          },
          {
            status: 500,
          }
        )
      }
    }

    if (url.pathname === "/api/signals/test") {
      if (env.ALLOW_TEST_ENDPOINTS !== "true") {
        return new Response("Not Found", {
          status: 404,
        })
      }

      return handleTestSignal(request, env)
    }

    const executeMatch =
      url.pathname.match(/^\/api\/signals\/(\d+)\/execute$/)

    if (executeMatch) {
      if (env.ALLOW_TEST_ENDPOINTS !== "true") {
        return new Response("Not Found", {
          status: 404,
        })
      }

      return handleExecuteSignal(
        request,
        env,
        Number(executeMatch[1])
      )
    }

    if (url.pathname === "/api/oanda/trades/open") {
      return handleGetOpenTrades(request, env)
    }

    if (url.pathname === "/api/oanda/trades/closed") {
      return handleGetClosedTrades(request, env)
    }

    if (url.pathname === "/api/dashboard/live") {
      return handleGetLiveDashboard(request, env)
    }

    if (url.pathname === "/api/webhook/tradingview") {
      return handleTradingViewWebhook(
        request,
        env,
        ctx
      )
    }

    // MUST BE LAST
    return new Response("Worker 404", {
      status: 404,
    })
  },
}
