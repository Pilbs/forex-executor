function TradeTable({ trades, closed = false }) {
  if (trades.length === 0) {
    return (
      <p>
        {closed
          ? "No historic trades."
          : "No open trades."}
      </p>
    )
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Pair</th>
          <th>Direction</th>
          <th>Units</th>
          <th>Entry</th>

          {closed && (
            <th>Close</th>
          )}

          <th>Stop Loss</th>
          <th>Take Profit</th>

          {closed ? (
            <th>Realised P/L</th>
          ) : (
            <th>Unrealised P/L</th>
          )}

          <th>Type</th>
          <th>Strategy</th>
          <th>Signal ID</th>
        </tr>
      </thead>

      <tbody>
        {trades.map((trade) => (
          <tr key={trade.tradeId}>
            <td>
              {trade.instrument.replace("_", "/")}
            </td>

            <td>
              {trade.direction.toUpperCase()}
            </td>

            <td>
              {trade.units}
            </td>

            <td>
              {trade.entryPrice}
            </td>

            {closed && (
              <td>
                {trade.closePrice ?? "—"}
              </td>
            )}

            <td>
              {trade.stopLoss ?? "—"}
            </td>

            <td>
              {trade.takeProfit ?? "—"}
            </td>

            <td>
              {closed
                ? trade.realisedPL
                : trade.unrealisedPL}
            </td>

            <td>
              {trade.automated
                ? "Automated"
                : "Manual"}
            </td>

            <td>
              {trade.strategyName ?? "—"}
            </td>

            <td>
              {trade.signalId ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default TradeTable