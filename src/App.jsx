import {
  useEffect,
  useMemo,
  useState,
} from "react"

import {
  getLiveDashboard,
  getClosedTrades,
} from "./services/trades"

import TradeTable from "./components/TradeTable"
import SummaryCard from "./components/SummaryCard"

import { formatMoney } from "./utils/format"

import "./App.css"


function App() {

  const [account, setAccount] = useState(null)

  const [openTrades, setOpenTrades] = useState([])
  const [closedTrades, setClosedTrades] = useState([])

  const [filter, setFilter] = useState("all")

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  async function loadLiveData() {
    const [
      liveData,
      closedData,
    ] = await Promise.all([
      getLiveDashboard(),
      getClosedTrades(),
    ])

    setAccount(liveData.account)
    setOpenTrades(liveData.openTrades)
    setClosedTrades(closedData.trades)
  }


  useEffect(() => {

    async function loadInitialData() {
      try {
        await loadLiveData()

      } catch (error) {
        setError(error.message)

      } finally {
        setLoading(false)
      }
    }


    loadInitialData()


    async function refreshIfVisible() {
      if (document.visibilityState !== "visible") {
        return
      }

      try {
        await loadLiveData()
      } catch (error) {
        console.error(
          "Dashboard refresh failed:",
          error
        )
      }
    }


    const interval = setInterval(
      refreshIfVisible,
      30000
    )


    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        refreshIfVisible()
      }
    }


    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    )


    return () => {
      clearInterval(interval)

      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      )
    }

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
    return (
      <div className="page-message">
        Loading dashboard...
      </div>
    )
  }


  if (error) {
    return (
      <div className="page-message error">
        {error}
      </div>
    )
  }


  const currency =
    account?.currency ?? "GBP"


  return (
    <main className="dashboard">

      <header className="dashboard-header">

        <div>
          <h1>Forex Executor</h1>
          <p>OANDA Practice Account</p>
        </div>

        <span className="environment-badge">
          PRACTICE
        </span>

      </header>


      <div className="summary-grid">

        <SummaryCard
          label="Balance"
          value={formatMoney(
            account.balance,
            currency
          )}
        />

        <SummaryCard
          label="NAV"
          value={formatMoney(
            account.NAV,
            currency
          )}
        />

        <SummaryCard
          label="Open Trades"
          value={account.openTradeCount}
        />

        <SummaryCard
          label="Pending Orders"
          value={account.pendingOrderCount}
        />

      </div>


      <div className="filters">

        {[
          ["all", "All"],
          ["automated", "Automated"],
          ["manual", "Manual"],
        ].map(([value, label]) => (

          <button
            key={value}
            className={
              filter === value
                ? "filter-active"
                : ""
            }
            onClick={() => setFilter(value)}
          >
            {label}
          </button>

        ))}

      </div>


      <section className="trade-section">

        <div className="section-header">

          <h2>Open Trades</h2>

          <span>
            {filteredOpenTrades.length}
          </span>

        </div>

        <TradeTable
          trades={filteredOpenTrades}
          currency={currency}
        />

      </section>


      <section className="trade-section">

        <div className="section-header">

          <h2>Trade History</h2>

          <span>
            {filteredClosedTrades.length}
          </span>

        </div>

        <TradeTable
          trades={filteredClosedTrades}
          closed
          currency={currency}
        />

      </section>

    </main>
  )
}


export default App