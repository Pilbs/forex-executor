export async function getDatabaseHealth(env) {
  const result = await env.DB
    .prepare(`
      SELECT COUNT(*) AS signal_count
      FROM trade_signals
    `)
    .first()

  return {
    connected: true,
    signalCount: result.signal_count,
  }
}