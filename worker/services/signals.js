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