export async function saveSignal(env, payload) {
  const idempotencyKey =
    `${payload.strategyName}:${payload.signalId}`

  const webhookPayload = JSON.stringify(payload)

  const result = await env.DB
    .prepare(`
      INSERT INTO trade_signals (
        idempotency_key,
        signal_id,
        strategy_name,
        instrument,
        direction,
        requested_units,
        requested_stop_loss,
        requested_take_profit,
        webhook_payload,
        execution_status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')
      ON CONFLICT(idempotency_key) DO NOTHING
    `)
    .bind(
      idempotencyKey,
      payload.signalId,
      payload.strategyName,
      payload.instrument,
      payload.direction,
      payload.units,
      payload.stopLoss ?? null,
      payload.takeProfit ?? null,
      webhookPayload
    )
    .run()

  const signal = await env.DB
    .prepare(`
      SELECT *
      FROM trade_signals
      WHERE idempotency_key = ?
    `)
    .bind(idempotencyKey)
    .first()

  return {
    duplicate: result.meta.changes === 0,
    signal,
  }
}

export async function getSignalById(env, id) {
  return env.DB
    .prepare(`
      SELECT *
      FROM trade_signals
      WHERE id = ?
    `)
    .bind(id)
    .first()
}


export async function claimSignalForExecution(env, id) {
  const result = await env.DB
    .prepare(`
      UPDATE trade_signals
      SET
        execution_status = 'processing',
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND execution_status = 'received'
    `)
    .bind(id)
    .run()

  return result.meta.changes === 1
}


export async function markSignalExecuted(
  env,
  id,
  orderId,
  tradeId
) {
  await env.DB
    .prepare(`
      UPDATE trade_signals
      SET
        execution_status = 'executed',
        oanda_order_id = ?,
        oanda_trade_id = ?,
        executed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(orderId, tradeId, id)
    .run()
}


export async function markSignalFailed(
  env,
  id,
  errorCode,
  errorMessage
) {
  await env.DB
    .prepare(`
      UPDATE trade_signals
      SET
        execution_status = 'failed',
        oanda_error_code = ?,
        oanda_error_message = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(errorCode, errorMessage, id)
    .run()
}