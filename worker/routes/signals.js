import { validateSignal } from "../validation/signal.js"
import { saveSignal } from "../services/signals.js"

export async function handleTestSignal(request, env) {
  if (request.method !== "POST") {
    return Response.json(
      {
        error: "Method not allowed",
      },
      {
        status: 405,
      }
    )
  }

  let payload

  try {
    payload = await request.json()
  } catch {
    return Response.json(
      {
        error: "Request body must contain valid JSON",
      },
      {
        status: 400,
      }
    )
  }

  const validationErrors = validateSignal(payload)

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
    const result = await saveSignal(env, payload)

    return Response.json({
      accepted: true,
      duplicate: result.duplicate,
      signal: {
        id: result.signal.id,
        signalId: result.signal.signal_id,
        strategyName: result.signal.strategy_name,
        instrument: result.signal.instrument,
        direction: result.signal.direction,
        units: result.signal.requested_units,
        stopLoss: result.signal.requested_stop_loss,
        takeProfit: result.signal.requested_take_profit,
        status: result.signal.execution_status,
        receivedAt: result.signal.received_at,
      },
    })
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

