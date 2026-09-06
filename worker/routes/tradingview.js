import { validateSignal } from "../validation/signal.js"
import { saveSignal } from "../services/signals.js"
import { executeSignalById } from "../services/execution.js"
import {
  validateUpdateStop,
  validateUpdateBracket,
  validateClose,
} from "../validation/trade-management.js"

import {
  updateSignalStopLoss,
  updateSignalBracket,
  closeSignalTrade,
} from "../services/trade-management.js"

const TRADINGVIEW_IPS = new Set([
  "52.89.214.238",
  "34.212.75.30",
  "54.218.53.128",
  "52.32.178.7",
])

export async function handleTradingViewWebhook(
  request,
  env,
  ctx
) {
  if (request.method !== "POST") {
    return new Response("Not Found", {
      status: 404,
    })
  }

  const clientIp =
    request.headers.get("CF-Connecting-IP")

  const localTesting =
    env.ALLOW_TEST_ENDPOINTS === "true"

  if (
    !localTesting &&
    !TRADINGVIEW_IPS.has(clientIp)
  ) {
    return new Response("Not Found", {
      status: 404,
    })
  }

  let payload

  try {
    payload = await request.json()
  } catch {
    return Response.json(
      {
        accepted: false,
        error: "Request body must contain valid JSON",
      },
      {
        status: 400,
      }
    )
  }

  const action = payload.action ?? "entry"


// ─────────────────────────────────────────────
// ENTRY
// ─────────────────────────────────────────────

if (action === "entry") {
  const validationErrors =
    validateSignal(payload)

  if (validationErrors.length > 0) {
    return Response.json(
      {
        accepted: false,
        errors: validationErrors,
      },
      {
        status: 400,
      }
    )
  }

  try {
    const result =
      await saveSignal(env, payload)

    if (result.duplicate) {
      return Response.json({
        accepted: true,
        duplicate: true,
        executionScheduled: false,

        signal: {
          id: result.signal.id,
          signalId: result.signal.signal_id,
          strategyName:
            result.signal.strategy_name,
          status:
            result.signal.execution_status,
        },
      })
    }

    ctx.waitUntil(
      executeSignalById(
        env,
        result.signal.id
      ).catch((error) => {
        console.error(
          "Background entry execution failed:",
          error
        )
      })
    )

    return Response.json(
      {
        accepted: true,
        action: "entry",
        duplicate: false,
        executionScheduled: true,

        signal: {
          id: result.signal.id,
          signalId: result.signal.signal_id,
          strategyName:
            result.signal.strategy_name,
          instrument:
            result.signal.instrument,
          direction:
            result.signal.direction,
          units:
            result.signal.requested_units,
          status: "received",
        },
      },
      {
        status: 202,
      }
    )

  } catch (error) {
    return Response.json(
      {
        accepted: false,
        error: error.message,
      },
      {
        status: 500,
      }
    )
  }
}


// ─────────────────────────────────────────────
// UPDATE STOP
// ─────────────────────────────────────────────

if (action === "update_stop") {
  const validationErrors =
    validateUpdateStop(payload)

  if (validationErrors.length > 0) {
    return Response.json(
      {
        accepted: false,
        errors: validationErrors,
      },
      {
        status: 400,
      }
    )
  }

  ctx.waitUntil(
    updateSignalStopLoss(
      env,
      payload.strategyName,
      payload.signalId,
      payload.stopLoss
    ).catch((error) => {
      console.error(
        "Background stop update failed:",
        error
      )
    })
  )

  return Response.json(
    {
      accepted: true,
      action: "update_stop",
      executionScheduled: true,
    },
    {
      status: 202,
    }
  )
}

// ─────────────────────────────────────────────
// UPDATE BRACKET
// ─────────────────────────────────────────────

if (action === "update_bracket") {
  const validationErrors =
    validateUpdateBracket(payload)

  if (validationErrors.length > 0) {
    return Response.json(
      {
        accepted: false,
        errors: validationErrors,
      },
      {
        status: 400,
      }
    )
  }

  ctx.waitUntil(
    updateSignalBracket(
      env,
      payload.strategyName,
      payload.signalId,
      payload.stopLoss,
      payload.takeProfit
    ).catch((error) => {
      console.error(
        "Background bracket update failed:",
        error
      )
    })
  )

  return Response.json(
    {
      accepted: true,
      action: "update_bracket",
      executionScheduled: true,
    },
    {
      status: 202,
    }
  )
}


// ─────────────────────────────────────────────
// CLOSE
// ─────────────────────────────────────────────

if (action === "close") {
  const validationErrors =
    validateClose(payload)

  if (validationErrors.length > 0) {
    return Response.json(
      {
        accepted: false,
        errors: validationErrors,
      },
      {
        status: 400,
      }
    )
  }

  ctx.waitUntil(
    closeSignalTrade(
      env,
      payload.strategyName,
      payload.signalId
    ).catch((error) => {
      console.error(
        "Background trade close failed:",
        error
      )
    })
  )

  return Response.json(
    {
      accepted: true,
      action: "close",
      executionScheduled: true,
    },
    {
      status: 202,
    }
  )
}


// ─────────────────────────────────────────────
// UNKNOWN ACTION
// ─────────────────────────────────────────────

return Response.json(
  {
    accepted: false,
    error: `Unsupported action: ${action}`,
  },
  {
    status: 400,
  }
)
}