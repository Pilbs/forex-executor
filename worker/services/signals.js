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

export async function markSignalBotClosed(
  env,
  id,
  closeTransactionId
) {
  await env.DB
    .prepare(`
      UPDATE trade_signals
      SET
        bot_close_transaction_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)
    .bind(closeTransactionId, id)
    .run()
}

export async function getSignalsByOandaTradeIds(env, tradeIds) {
  if (tradeIds.length === 0) {
    return new Map()
  }

  const placeholders = tradeIds
    .map(() => "?")
    .join(", ")

  const result = await env.DB
    .prepare(`
      SELECT
        signal_id,
        strategy_name,
        oanda_order_id,
        oanda_trade_id,
        requested_stop_loss,
        requested_take_profit,
        bot_close_transaction_id
      FROM trade_signals
      WHERE oanda_trade_id IN (${placeholders})
    `)
    .bind(...tradeIds)
    .all()

  return new Map(
    result.results.map((row) => [
      String(row.oanda_trade_id),
      row,
    ])
  )
}

export async function getSignalByStrategySignalId(
  env,
  strategyName,
  signalId
) {
  return env.DB
    .prepare(`
      SELECT *
      FROM trade_signals
      WHERE strategy_name = ?
        AND signal_id = ?
    `)
    .bind(
      strategyName,
      signalId
    )
    .first()
}