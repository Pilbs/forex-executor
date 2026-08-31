import {
  formatMoney,
  formatDateTime,
} from "../utils/format"


function TradeTable({
  trades,
  closed = false,
  currency = "GBP",
}) {
  if (trades.length === 0) {
    return (
      <p className="empty-state">
        {closed
          ? "No historic trades."
          : "No open trades."}
      </p>
    )
  }

  return (
    <div className="table-wrapper">

      <table>

        <thead>
          <tr>
            <th>Pair</th>
            <th>Direction</th>
            <th>Units</th>
            <th>Entry</th>

            {closed && <th>Close</th>}

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
            <th>
              {closed ? "Closed" : "Opened"}
            </th>
          </tr>
        </thead>

        <tbody>

          {trades.map((trade) => {

            const pnl = closed
              ? Number(trade.realisedPL)
              : Number(trade.unrealisedPL)

            return (
              <tr key={trade.tradeId}>

                <td>
                  <strong>
                    {trade.instrument.replace("_", "/")}
                  </strong>
                </td>

                <td>
                  <span
                    className={`badge ${
                      trade.direction === "buy"
                        ? "badge-buy"
                        : "badge-sell"
                    }`}
                  >
                    {trade.direction.toUpperCase()}
                  </span>
                </td>

                <td>{trade.units}</td>

                <td>{trade.entryPrice}</td>

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

                <td
                  className={
                    pnl > 0
                      ? "pnl-positive"
                      : pnl < 0
                        ? "pnl-negative"
                        : ""
                  }
                >
                  {formatMoney(pnl, currency)}
                </td>

                <td>
                  <span
                    className={`badge ${
                      trade.automated
                        ? "badge-auto"
                        : "badge-manual"
                    }`}
                  >
                    {trade.automated
                      ? "Automated"
                      : "Manual"}
                  </span>
                </td>

                <td>
                  {trade.strategyName ?? "—"}
                </td>

                <td className="signal-id">
                  {trade.signalId ?? "—"}
                </td>

                <td>
                  {formatDateTime(
                    closed
                      ? trade.closeTime
                      : trade.openTime
                  )}
                </td>

              </tr>
            )
          })}

        </tbody>

      </table>

    </div>
  )
}

export default TradeTable