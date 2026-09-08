// Journal rows come from executions, not from the optional /trades/:id resource.
// No broker requests, database writes, or trade actions take place in this module.
export const JOURNAL_VERSION = "journal-v4-transaction-ledger"

function decimal(value, label) {
  const text = String(value ?? "")
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text)
  if (!match || !Number.isFinite(Number(text))) {
    throw new Error(`Invalid ${label} in OANDA transaction history`)
  }
  const fraction = match[3] ?? ""
  return {
    value: BigInt(`${match[1]}${match[2]}${fraction}`),
    scale: fraction.length,
  }
}

// Add broker-reported money without binary floating-point rounding.
function sumAmounts(values) {
  const parts = values.map((value) => decimal(value, "amount"))
  const scale = Math.max(4, ...parts.map((part) => part.scale))
  const total = parts.reduce(
    (sum, part) => sum + part.value * 10n ** BigInt(scale - part.scale),
    0n
  )
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, "0")
  return `${total < 0n ? "-" : ""}${digits.slice(0, -scale)}.${digits.slice(-scale)}`
}

function requiredNumber(value, label) {
  decimal(value, label)
  return Number(value)
}

function transactionId(value) {
  if (!/^\d+$/.test(String(value ?? ""))) {
    throw new Error("Invalid transaction ID in OANDA history")
  }
  return BigInt(value)
}

/**
 * Rebuild closed trades using explicit tradeOpened/tradeReduced/tradesClosed
 * references. A closing market order alone is not evidence of a filled exit.
 * Input must cover the account history up to a consistent transaction ID.
 */
export function buildClosedTradesFromTransactions(transactions, count = 100) {
  if (!Array.isArray(transactions)) {
    throw new Error("OANDA transaction history is not an array")
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("History count must be a positive integer")
  }

  const unique = new Map()
  for (const transaction of transactions) {
    const id = transactionId(transaction?.id).toString()
    if (!unique.has(id)) unique.set(id, transaction)
  }
  const ordered = [...unique.values()].sort((a, b) => {
    const left = transactionId(a.id)
    const right = transactionId(b.id)
    return left < right ? -1 : left > right ? 1 : 0
  })
  const trades = new Map()

  function requireTrade(id, transaction) {
    const trade = trades.get(String(id))
    if (!trade) {
      throw new Error(
        `Journal history incomplete: opening fill for trade ${id} is missing ` +
        `(referenced by transaction ${transaction.id})`
      )
    }
    return trade
  }

  for (const transaction of ordered) {
    if (transaction.type === "ORDER_FILL") {
      const opened = transaction.tradeOpened
      if (opened) {
        const id = transactionId(opened.tradeID).toString()
        if (trades.has(id)) throw new Error(`Duplicate opening fill for trade ${id}`)
        const units = requiredNumber(opened.units, "opening units")
        const price = opened.price ?? transaction.price
        requiredNumber(price, "entry price")
        if (units === 0 || !transaction.instrument || !transaction.time) {
          throw new Error(`Incomplete opening fill for trade ${id}`)
        }
        trades.set(id, {
          id,
          instrument: transaction.instrument,
          price: String(price),
          openTime: transaction.time,
          initialUnits: String(opened.units),
          state: "OPEN",
          currentUnits: String(opened.units),
          openingOrderId: transaction.orderID == null ? null : String(transaction.orderID),
          closingTransactionIDs: [],
          closeTime: null,
          closeTransactionId: null,
          closeReason: null,
          stopLossOrder: null,
          takeProfitOrder: null,
          _closedUnits: 0,
          _exits: [],
          _financing: [],
          _dividends: [],
        })
      }

      const reductions = [
        ...(transaction.tradesClosed ?? []).map((trade) => ({ trade, final: true })),
        ...(transaction.tradeReduced ? [{ trade: transaction.tradeReduced, final: false }] : []),
      ]
      for (const { trade: reduction, final } of reductions) {
        const trade = requireTrade(reduction.tradeID, transaction)
        const units = Math.abs(requiredNumber(reduction.units, "closing units"))
        const price = reduction.price ?? transaction.price
        requiredNumber(price, "exit price")
        decimal(reduction.realizedPL, "realized P/L")
        if (trade.state === "CLOSED" || units === 0 || !transaction.time) {
          throw new Error(`Invalid closing fill for trade ${trade.id}`)
        }
        trade._closedUnits += units
        const initial = Math.abs(Number(trade.initialUnits))
        const remaining = initial - trade._closedUnits
        const tolerance = Math.max(1, initial) * Number.EPSILON * 16
        if (remaining < -tolerance || (final && Math.abs(remaining) > tolerance)) {
          throw new Error(`Journal units do not reconcile for trade ${trade.id}`)
        }
        trade._exits.push({ units, price: String(price), pl: reduction.realizedPL })
        trade._financing.push(reduction.financing ?? "0")
        trade.closingTransactionIDs.push(String(transaction.id))
        trade.currentUnits = String(Math.sign(Number(trade.initialUnits)) * Math.max(0, remaining))
        if (final || Math.abs(remaining) <= tolerance) {
          trade.state = "CLOSED"
          trade.currentUnits = "0"
          trade.closeTime = transaction.time
          trade.closeTransactionId = String(transaction.id)
          trade.closeReason = transaction.reason ?? null
        }
      }
    }

    if (transaction.type === "DAILY_FINANCING") {
      for (const position of transaction.positionFinancings ?? []) {
        for (const charge of position.openTradeFinancings ?? []) {
          requireTrade(charge.tradeID, transaction)._financing.push(charge.financing)
        }
      }
    }
    if (transaction.type === "DIVIDEND_ADJUSTMENT") {
      for (const adjustment of transaction.openTradeDividendAdjustments ?? []) {
        requireTrade(adjustment.tradeID, transaction)._dividends.push(adjustment.dividendAdjustment)
      }
    }

    // Retain the first broker-confirmed protective prices as an entry snapshot.
    // Signal metadata remains preferred by the API for automated entries.
    if (transaction.tradeID && transaction.price != null) {
      const trade = trades.get(String(transaction.tradeID))
      if (trade) {
        if (["STOP_LOSS_ORDER", "GUARANTEED_STOP_LOSS_ORDER"].includes(transaction.type)) {
          trade.stopLossOrder ??= { price: String(transaction.price) }
        } else if (transaction.type === "TAKE_PROFIT_ORDER") {
          trade.takeProfitOrder ??= { price: String(transaction.price) }
        }
      }
    }
  }

  return [...trades.values()]
    .filter((trade) => trade.state === "CLOSED")
    .sort((a, b) => {
      const left = transactionId(a.closeTransactionId)
      const right = transactionId(b.closeTransactionId)
      return left > right ? -1 : left < right ? 1 : 0
    })
    .slice(0, count)
    .map(({ _exits, _financing, _dividends, _closedUnits, ...trade }) => ({
      ...trade,
      // Preserve a single fill's exact decimal string; weight multiple exits.
      averageClosePrice: _exits.length === 1
        ? _exits[0].price
        : (_exits.reduce((sum, exit) => sum + Number(exit.price) * exit.units, 0) / _closedUnits).toFixed(10),
      realizedPL: sumAmounts(_exits.map((exit) => exit.pl)),
      financing: sumAmounts(_financing),
      dividendAdjustment: sumAmounts(_dividends),
      historySource: "transactions",
    }))
}
