import { useEffect, useMemo, useState } from "react"

import {
  getOpenTrades,
  getClosedTrades,
} from "./services/trades"

import TradeTable from "./components/TradeTable"

import "./App.css"


function App() {
  const [openTrades, setOpenTrades] = useState([])
  const [closedTrades, setClosedTrades] = useState([])

  const [filter, setFilter] = useState("all")

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)


  useEffect(() => {
    async function loadTrades() {
      try {
        const [
          openData,
          closedData,
        ] = await Promise.all([
          getOpenTrades(),
          getClosedTrades(),
        ])

        setOpenTrades(openData.trades)
        setClosedTrades(closedData.trades)

      } catch (error) {
        setError(error.message)

      } finally {
        setLoading(false)
      }
    }

    loadTrades()
  }, [])


  function filterTrades(trades) {
    if (filter === "automated") {
      return trades.filter(
        (trade) => trade.automated
      )
    }

    if (filter === "manual") {
      return trades.filter(
        (trade) => !trade.automated
      )
    }

    return trades
  }


  const filteredOpenTrades = useMemo(
    () => filterTrades(openTrades),
    [openTrades, filter]
  )

  const filteredClosedTrades = useMemo(
    () => filterTrades(closedTrades),
    [closedTrades, filter]
  )


  if (loading) {
    return <p>Loading trades...</p>
  }

  if (error) {
    return <p>Error: {error}</p>
  }


  return (
    <main className="dashboard">

      <header>
        <h1>Forex Executor</h1>
        <p>OANDA Practice Account</p>
      </header>


      <div className="filters">

        <button
          onClick={() => setFilter("all")}
          disabled={filter === "all"}
        >
          All
        </button>

        <button
          onClick={() => setFilter("automated")}
          disabled={filter === "automated"}
        >
          Automated
        </button>

        <button
          onClick={() => setFilter("manual")}
          disabled={filter === "manual"}
        >
          Manual
        </button>

      </div>


      <section>

        <h2>Open Trades</h2>

        <p>
          {filteredOpenTrades.length} open trade
          {filteredOpenTrades.length === 1
            ? ""
            : "s"}
        </p>

        <TradeTable
          trades={filteredOpenTrades}
        />

      </section>


      <section>

        <h2>Trade History</h2>

        <p>
          {filteredClosedTrades.length} historic trade
          {filteredClosedTrades.length === 1
            ? ""
            : "s"}
        </p>

        <TradeTable
          trades={filteredClosedTrades}
          closed
        />

      </section>

    </main>
  )
}

export default App